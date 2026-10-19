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

// A lumped step's Rhea reactions (bqbiol:hasPart, ./annotations.ts) added up: each part's equation from Rhea's REST
// API, what cancels between the parts (the same ChEBI entity, on the same side of a membrane, made by one part and
// used by another), and the net equation, compared with the step's own (its species' ChEBI IDs). Two ChEBI IDs are
// the same entity when one is the other or is_a the other (Rhea's alpha-D-glucose 6-phosphate is a D-glucose
// 6-phosphate), from the ancestors the EBI's Ontology Lookup Service gives.

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
            const [, coefficient, name, , location] = TERM.exec(term.trim()) ?? []
            participants.push({
                side: k === 0 ? 'L' : 'R',
                count: coefficient && coefficient !== 'n' ? Number(coefficient) : 1,
                name: name ?? term.trim(),
                location: location as RheaParticipant['location']
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

/** The parts added up: an amount one part makes and another uses cancels, the rest is the net equation. */
export function combineParts(reactions: RheaReaction[], related: Related = identical): Combination {
    const representative = representatives(related)
    const keyOf = (p: RheaParticipant) => `${p.chebi ? representative(p.chebi) : `?${p.name}`}|${p.location ?? ''}`
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
            if (count > 0) net.push({ side, count, name: p.name, chebi: p.chebi, location: p.location })
        }
    }
    return { parts, net }
}

//==============================================================================

function termLatex(p: RheaParticipant, cancelled = 0): string {
    const name = `${labelLatex(p.name)}${p.location ? labelLatex(`(${p.location})`) : ''}`
    if (cancelled >= p.count) return `\\cancel{${p.count === 1 ? '' : `${p.count}\\,`}${name}}`
    if (cancelled > 0) return `\\cancelto{${p.count - cancelled}}{${p.count}}\\,${name}`
    return `${p.count === 1 ? '' : `${p.count}\\,`}${name}`
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

function amountText(count: number): string {
    return count > 0 ? `makes ${count}` : count < 0 ? `uses ${-count}` : 'none'
}

/**
 * How the net equation differs from the step's, by ChEBI entity (a membrane's sides are not compared): [] when they
 * agree. Undefined when a species of the step has no ChEBI ID to compare by.
 */
export function netDifferences(net: RheaParticipant[], step: StepEquation, chebiOf: (node: string) => string|undefined,
                               related: Related = identical): string[]|undefined {
    const representative = representatives(related)
    const stoichiometry = (terms: { chebi?: string, count: number, made: boolean, name: string }[]) => {
        const m = new Map<string, { count: number, name: string }>()
        for (const t of terms) {
            const key = t.chebi ? representative(t.chebi) : `?${t.name}`
            const entry = m.get(key) ?? { count: 0, name: t.name }
            entry.count += t.made ? t.count : -t.count
            m.set(key, entry)
        }
        return m
    }
    const stepTerms = [...step.substrates.map(p => ({ p, made: false })), ...step.products.map(p => ({ p, made: true }))]
    const chebis = stepTerms.map(t => t.p.node ? chebiOf(t.p.node) : undefined)
    if (chebis.some(c => !c)) return undefined
    const ours = stoichiometry(stepTerms.map((t, k) => ({ chebi: chebis[k], count: t.p.count, made: t.made, name: t.p.species })))
    const rhea = stoichiometry(net.map(p => ({ chebi: p.chebi, count: p.count, made: p.side === 'R', name: p.name })))
    const differences: string[] = []
    for (const key of new Set([...rhea.keys(), ...ours.keys()])) {
        const a = rhea.get(key), b = ours.get(key)
        if ((a?.count ?? 0) !== (b?.count ?? 0)) {
            differences.push(`${a?.name ?? b!.name}: Rhea ${amountText(a?.count ?? 0)}, the step ${amountText(b?.count ?? 0)}`)
        }
    }
    return differences
}

//==============================================================================
//==============================================================================
