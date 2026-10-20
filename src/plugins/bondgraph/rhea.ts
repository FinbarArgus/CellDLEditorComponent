/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

// A lumped step's Rhea reactions (bqbiol:hasPart, ./annotations.ts) added up and compared with the step, by the
// rules of the module library's bondgraph_reactions_test (cam_testing/bondgraph.py), which this mirrors:
// - each part's equation comes from Rhea's REST API;
// - each part takes the multiplier (either sign, so either direction) that a least-squares fit to the step's
//   stoichiometry gives, over every participant but H+ and H2O, rounded to a fraction with denominator at most 12;
// - a polymer ([glucosyl](n) on one side, (n-1) or (n+1) on the other) counts the units it gains;
// - the net equation must equal k times the step's for one common factor k (k < 0: the step runs it reversed); a
//   difference only in H+ or H2O is a warning, unless they are all a reaction has;
// - Rhea's in and out are read as whichever of the step's compartments fits best.
// Two ChEBI IDs are the same entity when one is the other or is_a the other (Rhea's alpha-D-glucose 6-phosphate is
// a D-glucose 6-phosphate), from the ancestors the EBI's Ontology Lookup Service gives.

import { labelLatex, type StepEquation } from './equations'

//==============================================================================

export const RHEA_REST = 'https://www.rhea-db.org/rhea'
export const OLS_CHEBI = 'https://www.ebi.ac.uk/ols4/api/ontologies/chebi/terms'

export interface RheaParticipant {
    side: 'L' | 'R'
    count: number
    name: string                // as Rhea writes it (H2O, ATP(4-), ...)
    chebi?: string              // without its CHEBI: prefix
    location?: 'in' | 'out'     // a transport's side of the membrane
    polymer?: string            // a polymer's index: n, n+1, n-1
}

export interface RheaReaction {
    id: string
    equation: string
    participants: RheaParticipant[]
}

// "2 H(+)(in)", "a quinol", "[thioredoxin]-dithiol": an optional coefficient, the name, a polymer's (n) and a side
const TERM = /^(?:(\d+|n) )?(.*?)(?:\((n(?:[+-]\d+)?)\))?(?:\((in|out)\))?$/

/** A reaction from Rhea's equation and its ChEBI list (distinct compounds, in the order the equation names them). */
export function parseRheaEquation(id: string, equation: string, chebis: string[]): RheaReaction {
    const participants: RheaParticipant[] = []
    equation.split(' = ').forEach((text, k) => {
        for (const term of text.split(' + ')) {
            const [, coefficient, name, polymer, location] = TERM.exec(term.trim()) ?? []
            participants.push({
                side: k === 0 ? 'L' : 'R',
                count: coefficient && coefficient !== 'n' ? Number(coefficient) : 1,
                name: name ?? term.trim(),
                location: location as RheaParticipant['location'],
                ...(polymer ? { polymer } : {})
            })
        }
    })
    const names = [...new Set(participants.map(p => p.name))]
    if (names.length === chebis.length) {
        const chebiOf = new Map(names.map((n, k) => [n, chebis[k]!.replace(/^CHEBI:/, '')]))
        for (const p of participants) p.chebi = chebiOf.get(p.name)
    }
    return { id, equation, participants }
}

const fetched = new Map<string, Promise<RheaReaction>>()

/** A Rhea reaction, fetched once per session. */
export function fetchRhea(id: string, fetcher: typeof fetch = fetch): Promise<RheaReaction> {
    let reaction = fetched.get(id)
    if (!reaction) {
        const query = new URLSearchParams({ query: `RHEA:${id}`, columns: 'rhea-id,equation,chebi-id', format: 'tsv' })
        reaction = fetcher(`${RHEA_REST}?${query}`).then(async response => {
            if (!response.ok) throw new Error(`Rhea answered ${response.status}`)
            const row = (await response.text()).trim().split('\n').slice(1).map(line => line.split('\t'))
                                                .find(r => r[0] === `RHEA:${id}`)
            if (!row) throw new Error(`Rhea has no reaction ${id}`)
            return parseRheaEquation(id, row[1] ?? '', (row[2] ?? '').split(';').filter(Boolean))
        })
        reaction.catch(() => fetched.delete(id))
        fetched.set(id, reaction)
    }
    return reaction
}

const ancestorsFetched = new Map<string, Promise<string[]>>()

/** A ChEBI ID's is_a ancestors (without their CHEBI: prefix), fetched once per session. */
export function fetchAncestors(chebi: string, fetcher: typeof fetch = fetch): Promise<string[]> {
    let ancestors = ancestorsFetched.get(chebi)
    if (!ancestors) {
        const iri = encodeURIComponent(encodeURIComponent(`http://purl.obolibrary.org/obo/CHEBI_${chebi}`))
        ancestors = (async () => {
            const found: string[] = []
            let url: string|undefined = `${OLS_CHEBI}/${iri}/ancestors?size=500`
            while (url) {
                const response = await fetcher(url, { headers: { Accept: 'application/json' } })
                if (!response.ok) throw new Error(`the Ontology Lookup Service answered ${response.status}`)
                const page = await response.json() as { _embedded?: { terms?: { obo_id?: string }[] },
                                                         _links?: { next?: { href: string } } }
                found.push(...(page._embedded?.terms ?? []).map(t => t.obo_id ?? '').filter(id => id.startsWith('CHEBI:'))
                                                           .map(id => id.slice(6)))
                url = page._links?.next?.href
            }
            return [...new Set(found)]
        })()
        ancestors.catch(() => ancestorsFetched.delete(chebi))
        ancestorsFetched.set(chebi, ancestors)
    }
    return ancestors
}

/** Whether two ChEBI IDs are the same entity, as one is the other or is_a the other. */
export type Related = (a: string, b: string) => boolean

/** Related, from each ID's ancestors. */
export function relatedBy(ancestors: Map<string, string[]>): Related {
    return (a, b) => a === b || !!ancestors.get(a)?.includes(b) || !!ancestors.get(b)?.includes(a)
}

const identical: Related = (a, b) => a === b

// each entity's first ChEBI ID seen stands for every ID related to it
function representatives(related: Related): (chebi: string) => string {
    const seen: string[] = []
    return chebi => {
        const found = seen.find(r => related(r, chebi))
        if (found !== undefined) return found
        seen.push(chebi)
        return chebi
    }
}

//==============================================================================

export interface CombinedTerm extends RheaParticipant {
    cancelled: number           // how much of its count another part cancels
}

export interface Combination {
    parts: { id: string, terms: CombinedTerm[] }[]
    net: RheaParticipant[]      // what is left, substrates (L) then products (R)
}

/** A part as the step uses it: its sides swapped for a negative multiplier, its counts scaled. */
export function orientPart(reaction: RheaReaction, multiplier: number): RheaReaction {
    const scale = Math.abs(multiplier)
    return { ...reaction, participants: reaction.participants.map(p => ({
        ...p, side: multiplier < 0 ? (p.side === 'L' ? 'R' : 'L') : p.side, count: p.count * scale
    })) }
}

/**
 * The parts added up: an amount one part makes and another uses cancels, the rest is the net equation. A polymer's
 * terms of different index ([glucosyl](n), [glucosyl](n-1)) are kept apart, as Rhea writes them.
 */
export function combineParts(reactions: RheaReaction[], related: Related = identical): Combination {
    const representative = representatives(related)
    const keyOf = (p: RheaParticipant) =>
        `${p.chebi ? representative(p.chebi) : `?${p.name}`}|${p.location ?? ''}|${p.polymer ?? ''}`
    const made = new Map<string, number>()
    const used = new Map<string, number>()
    for (const p of reactions.flatMap(r => r.participants)) {
        const totals = p.side === 'R' ? made : used
        totals.set(keyOf(p), (totals.get(keyOf(p)) ?? 0) + p.count)
    }
    // what cancels of each entity, shared out over its terms in order on each side
    const left = { L: new Map<string, number>(), R: new Map<string, number>() }
    for (const [key, n] of made) {
        const cancels = Math.min(n, used.get(key) ?? 0)
        left.L.set(key, cancels)
        left.R.set(key, cancels)
    }
    const parts = reactions.map(r => ({
        id: r.id,
        terms: r.participants.map(p => {
            const remaining = left[p.side].get(keyOf(p)) ?? 0
            const cancelled = Math.min(remaining, p.count)
            left[p.side].set(keyOf(p), remaining - cancelled)
            return { ...p, cancelled }
        })
    }))
    const net: RheaParticipant[] = []
    for (const side of ['L', 'R'] as const) {
        const seen = new Set<string>()
        for (const p of reactions.flatMap(r => r.participants)) {
            const key = keyOf(p)
            if (seen.has(key)) continue
            seen.add(key)
            const count = side === 'R' ? (made.get(key) ?? 0) - (used.get(key) ?? 0) : (used.get(key) ?? 0) - (made.get(key) ?? 0)
            if (count > 1e-9) {
                net.push({ side, count, name: p.name, chebi: p.chebi, location: p.location, ...(p.polymer ? { polymer: p.polymer } : {}) })
            }
        }
    }
    return { parts, net }
}

//==============================================================================

// a count as LaTeX: an integer, or a fraction with denominator at most 12
function countLatex(count: number): string {
    const [p, q] = simpleFraction(count, COUNT_DENOMINATOR)
    return q === 1 ? `${p}` : `\\tfrac{${p}}{${q}}`
}

function termLatex(p: RheaParticipant, cancelled = 0): string {
    const name = `${labelLatex(p.name)}${p.polymer ? labelLatex(`(${p.polymer})`) : ''}${p.location ? labelLatex(`(${p.location})`) : ''}`
    const coefficient = (n: number) => Math.abs(n - 1) < 1e-9 ? '' : `${countLatex(n)}\\,`
    if (cancelled >= p.count - 1e-9) return `\\cancel{${coefficient(p.count)}${name}}`
    if (cancelled > 1e-9) return `\\cancelto{${countLatex(p.count - cancelled)}}{${countLatex(p.count)}}\\,${name}`
    return `${coefficient(p.count)}${name}`
}

// an equation's pieces (terms, + and the arrow) as LaTeX, to be typeset one by one so a narrow panel can wrap them
function sidesLatex(terms: { p: RheaParticipant, cancelled?: number }[]): string[] {
    const side = (s: 'L'|'R') => {
        const own = terms.filter(t => t.p.side === s).map(t => termLatex(t.p, t.cancelled))
        return own.length ? own.flatMap((t, k) => k === 0 ? [t] : ['+', t]) : ['\\varnothing']
    }
    return [...side('L'), '\\rightleftharpoons', ...side('R')]
}

/** A part's equation as LaTeX pieces, what cancels struck through (a coefficient that partly cancels crossed to what is left). */
export function partLatex(terms: CombinedTerm[]): string[] {
    return sidesLatex(terms.map(t => ({ p: t, cancelled: t.cancelled })))
}

/** The net equation as LaTeX pieces. */
export function netLatex(net: RheaParticipant[]): string[] {
    return sidesLatex(net.map(p => ({ p })))
}

//==============================================================================

// ---- the module library's comparison, mirrored -----------------------------------------------------------------

export const H_PLUS = '15378'
export const WATER = '15377'
const SOFT = new Set([H_PLUS, WATER])
const TOLERANCE = 1e-9

/**
 * The fraction p/q nearest x with q at most maxDenominator, as [p, q]: 12 for a part's multiplier, as the module
 * library rounds it; a sum of such multiples needs more.
 */
export function simpleFraction(x: number, maxDenominator = 12): [number, number] {
    let best: [number, number] = [Math.round(x), 1]
    for (let q = 2; q <= maxDenominator; q += 1) {
        const p = Math.round(x * q)
        if (Math.abs(x - p / q) < Math.abs(x - best[0] / best[1]) - TOLERANCE) best = [p, q]
    }
    return best
}

// denominators of a count: a sum of counts times multipliers with denominators up to 12 (their LCM is 27720)
const COUNT_DENOMINATOR = 27720

function roundFraction(x: number): number {
    const [p, q] = simpleFraction(x)
    return p / q
}

function amountText(x: number): string {
    const [p, q] = simpleFraction(Math.abs(x), COUNT_DENOMINATOR)
    return q === 1 ? `${p}` : `${p}/${q}`
}

/**
 * The least-squares solution x of a x = b of smallest norm (as numpy's lstsq gives), by a one-sided Jacobi SVD:
 * a is rows of the participants, columns of the parts.
 */
export function leastSquares(a: number[][], b: number[]): number[] {
    const m = a.length, n = a[0]?.length ?? 0
    const u = a.map(row => [...row])
    const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0))
    for (let sweep = 0; sweep < 60; sweep += 1) {
        let rotated = false
        for (let i = 0; i < n - 1; i += 1) {
            for (let j = i + 1; j < n; j += 1) {
                let alpha = 0, beta = 0, gamma = 0
                for (let r = 0; r < m; r += 1) {
                    alpha += u[r]![i]! ** 2
                    beta += u[r]![j]! ** 2
                    gamma += u[r]![i]! * u[r]![j]!
                }
                if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta)) continue
                rotated = true
                const zeta = (beta - alpha) / (2 * gamma)
                const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta))
                const c = 1 / Math.sqrt(1 + t * t), s = c * t
                for (const w of [u, v]) {
                    for (const row of w) {
                        const x = row[i]!, y = row[j]!
                        row[i] = c * x - s * y
                        row[j] = s * x + c * y
                    }
                }
            }
        }
        if (!rotated) break
    }
    const sigma = Array.from({ length: n }, (_, j) => Math.sqrt(u.reduce((sum, row) => sum + row[j]! ** 2, 0)))
    const cutoff = Number.EPSILON * Math.max(m, n) * Math.max(0, ...sigma)
    const x = new Array<number>(n).fill(0)
    for (let j = 0; j < n; j += 1) {
        if (sigma[j]! <= cutoff) continue
        const projection = u.reduce((sum, row, r) => sum + row[j]! * b[r]!, 0) / (sigma[j]! ** 2)
        for (let i = 0; i < n; i += 1) x[i]! += v[i]![j]! * projection
    }
    return x
}

// a participant's key: its ChEBI entity and compartment
type Key = string
const keyOf = (chebi: string, location?: string): Key => `${chebi}|${location ?? ''}`
const chebiOfKey = (key: Key) => key.split('|')[0]!
const locationOfKey = (key: Key) => key.split('|')[1] || undefined

/** A Rhea reaction's net coefficients by ChEBI ID and in|out, used negative: a polymer counts the units it gains. */
export function rheaVector(reaction: RheaReaction): Map<Key, number> {
    const nets = new Map<Key, [number, number]>()
    for (const p of reaction.participants) {
        if (!p.chebi) continue
        const index = p.polymer ? /^(\d*)n([+-]\d+)?$/.exec(p.polymer.replace(/ /g, '')) : null
        const [multiple, constant] = index ? [Number(index[1] || 1), Number(index[2] || 0)] : [0, 1]
        const sign = p.side === 'L' ? -1 : 1
        const key = keyOf(p.chebi, p.location)
        const [a, b] = nets.get(key) ?? [0, 0]
        nets.set(key, [a + sign * multiple * p.count, b + sign * constant * p.count])
    }
    return new Map([...nets].filter(([, [a, b]]) => a !== 0 || b !== 0).map(([key, [, b]]) => [key, b]))
}

/** A participant of the step, its count negative when used. */
export interface StepTerm {
    chebi?: string
    location?: string
    count: number
    name: string
}

/** The step's participants, with their species' ChEBI IDs. */
export function stepTerms(step: StepEquation, chebiOf: (node: string) => string|undefined): StepTerm[] {
    return [...step.substrates.map(p => ({ p, sign: -1 })), ...step.products.map(p => ({ p, sign: 1 }))]
        .map(({ p, sign }) => ({ chebi: p.node ? chebiOf(p.node) : undefined, location: p.location,
                                 count: sign * p.count, name: p.species }))
}

export interface Verification {
    status: 'match' | 'warn' | 'differs'
    text: string                // as the module library's report words it
    multipliers: number[]       // each part's, as the fit gives it (one part: 1)
    notes: string[]             // ChEBI IDs read as the step's by is_a
}

// the step's coefficients against k times Rhea's for the best k: [cost, verification without multipliers]
function match(model: Map<Key, number>, ref: Map<Key, number>, names: Map<string, string>)
: [number, Omit<Verification, 'multipliers' | 'notes'>] {
    const keys = new Set([...model.keys(), ...ref.keys()])
    const soft = [...keys].some(k => !SOFT.has(chebiOfKey(k))) ? SOFT : new Set<string>()
    const hard = (d: Map<Key, number>) => new Map([...d].filter(([k]) => !soft.has(chebiOfKey(k))))
    const m = hard(model), r = hard(ref)
    const shared = [...m.keys()].filter(k => r.has(k))
    if (shared.length === 0) return [1e6, { status: 'differs', text: 'no participant in common with Rhea\'s reaction' }]
    const ratios = shared.map(key => m.get(key)! / r.get(key)!)
    const count = (q: number) => ratios.filter(x => Math.abs(x - q) < TOLERANCE).length
    let k = ratios[0]!
    for (const q of ratios) {
        const better = [count(q) - count(k), +(Math.abs(Math.abs(q) - 1) < TOLERANCE) - +(Math.abs(Math.abs(k) - 1) < TOLERANCE),
                        +(q > 0) - +(k > 0)].find(d => d !== 0) ?? 0
        if (better > 0) k = q
    }
    const label = (key: Key) => `${names.get(chebiOfKey(key)) ?? chebiOfKey(key)} (CHEBI:${chebiOfKey(key)}`
                              + `${locationOfKey(key) ? `, ${locationOfKey(key)}` : ''})`
    const problems: string[] = []
    for (const key of [...new Set([...m.keys(), ...r.keys()])].sort()) {
        const want = k * (r.get(key) ?? 0), have = m.get(key) ?? 0
        if (Math.abs(want - have) < TOLERANCE) continue
        if (!m.has(key)) problems.push(`missing ${label(key)}: Rhea has ${amountText(want)}`)
        else if (!r.has(key)) problems.push(`extra ${label(key)}`)
        else problems.push(`${label(key)}: ${amountText(have)} where Rhea has ${amountText(want)}`)
    }
    const warnings: string[] = []
    for (const key of [...keys].sort()) {
        const want = k * (ref.get(key) ?? 0), have = model.get(key) ?? 0
        if (soft.has(chebiOfKey(key)) && Math.abs(want - have) >= TOLERANCE) {
            const where = locationOfKey(key)
            warnings.push(`${chebiOfKey(key) === H_PLUS ? 'H+' : 'H2O'}${where ? ` (${where})` : ''}: `
                        + `${amountText(have)} where Rhea has ${amountText(want)}`)
        }
    }
    const how = (k < 0 ? 'reversed' : 'as written') + (Math.abs(Math.abs(k) - 1) >= TOLERANCE ? `, scaled by ${amountText(k)}` : '')
    if (problems.length) return [problems.length, { status: 'differs', text: problems.join('; ') }]
    if (warnings.length) return [0.5, { status: 'warn', text: `matches (${how}) but for ${warnings.join('; ')}` }]
    return [0, { status: 'match', text: `matches (${how})` }]
}

// the multipliers of the parts that come nearest the step, and the net reaction they give
function lumped(model: Map<Key, number>, parts: Map<Key, number>[]): [number[], Map<Key, number>] {
    const keys = [...new Set([...parts.flatMap(p => [...p.keys()]), ...model.keys()])].sort()
    const hard = keys.filter(k => !SOFT.has(chebiOfKey(k)))
    const multipliers = leastSquares(hard.map(k => parts.map(p => p.get(k) ?? 0)), hard.map(k => model.get(k) ?? 0))
                            .map(roundFraction)
    const net = new Map<Key, number>()
    multipliers.forEach((x, i) => {
        for (const [k, c] of parts[i]!) net.set(k, (net.get(k) ?? 0) + x * c)
    })
    return [multipliers, new Map([...net].filter(([, c]) => Math.abs(c) >= TOLERANCE))]
}

function* permutations<T>(items: T[], size: number): Generator<T[]> {
    if (size === 0) { yield []; return }
    for (let i = 0; i < items.length; i += 1) {
        for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)], size - 1)) yield [items[i]!, ...rest]
    }
}

/**
 * The step against its Rhea reaction (one) or the reactions it lumps (several). Undefined when a species of the step
 * has no ChEBI ID to compare by.
 */
export function verifyReaction(reactions: RheaReaction[], terms: StepTerm[], related: Related = identical)
: Verification|undefined {
    if (terms.some(t => !t.chebi)) return undefined
    const names = new Map<string, string>()
    for (const p of reactions.flatMap(r => r.participants)) if (p.chebi && !names.has(p.chebi)) names.set(p.chebi, p.name)
    for (const t of terms) if (!names.has(t.chebi!)) names.set(t.chebi!, t.name)
    const model = new Map<Key, number>()
    for (const t of terms) model.set(keyOf(t.chebi!, t.location), (model.get(keyOf(t.chebi!, t.location)) ?? 0) + t.count)
    for (const [k, c] of model) if (c === 0) model.delete(k)
    // a Rhea term the step writes more or less specifically (ChEBI is_a either way) stands for the step's
    const modelChebis = [...new Set([...model.keys()].map(chebiOfKey))]
    const notes: string[] = [], renamed = new Map<string, string>()
    const rheaChebis = [...new Set(reactions.flatMap(r => r.participants.map(p => p.chebi)).filter((c): c is string => !!c))]
    for (const chebi of rheaChebis.filter(c => !modelChebis.includes(c)).sort()) {
        const matches = modelChebis.filter(c => related(c, chebi))
        if (matches.length === 1) {
            renamed.set(chebi, matches[0]!)
            notes.push(`${names.get(matches[0]!)} (CHEBI:${matches[0]}) for Rhea's ${names.get(chebi)} (CHEBI:${chebi}), by ChEBI is_a`)
        }
    }
    const vectors = reactions.map(r => {
        const v = new Map<Key, number>()
        for (const [key, c] of rheaVector(r)) {
            const k = keyOf(renamed.get(chebiOfKey(key)) ?? chebiOfKey(key), locationOfKey(key))
            v.set(k, (v.get(k) ?? 0) + c)
        }
        return v
    })
    const modelLocations = [...new Set([...model.keys()].map(k => locationOfKey(k) ?? ''))].sort()
    const rheaLocations = [...new Set(vectors.flatMap(v => [...v.keys()].map(locationOfKey)).filter((l): l is string => !!l))].sort()
    const assignments: (Record<string, string>|null)[] = rheaLocations.length === 0 ? [null]
        : [...permutations(modelLocations, rheaLocations.length)].map(chosen => Object.fromEntries(rheaLocations.map((l, i) => [l, chosen[i]!])))
    let best: [number, Verification]|undefined
    for (const assignment of assignments) {
        if (assignment === null && modelLocations.length > 1) continue    // Rhea's isn't a transport, this spans compartments
        const placed = vectors.map(v => {
            const ref = new Map<Key, number>()
            for (const [key, c] of v) {
                const chebi = chebiOfKey(key), l = locationOfKey(key)
                let where: string|undefined
                if (l !== undefined) where = assignment?.[l]
                else {
                    // an unlocated participant: wherever the step has that species
                    const own = [...new Set([...model.keys()].filter(k => chebiOfKey(k) === chebi).map(k => locationOfKey(k) ?? ''))]
                    where = own.length === 1 ? own[0] : (assignment?.in ?? modelLocations[0])
                }
                const k = keyOf(chebi, where || undefined)
                ref.set(k, (ref.get(k) ?? 0) + c)
            }
            return ref
        })
        const [multipliers, ref] = placed.length === 1 ? [[1], placed[0]!] : lumped(model, placed)
        const [cost, result] = match(model, ref, names)
        if (!best || cost < best[0]) best = [cost, { ...result, multipliers, notes }]
    }
    if (!best) {
        return { status: 'differs', multipliers: reactions.map(() => 1), notes,
                 text: `Rhea's reaction is ${rheaLocations.length ? 'a transport' : 'not a transport'}, but this one `
                     + (modelLocations.length > 1 ? `spans ${modelLocations.join(' and ')}` : 'is in one location') }
    }
    return best[1]
}

//==============================================================================
//==============================================================================
