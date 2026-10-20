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

// A bond graph's reactions as equations in their usual form (2 ADP[c] + Pi[c] ⇌ ATP[c] + H2O[c]), from the
// bonds of each reaction (or resistance) element: its substrates are the stores and sources bonded into it, its
// products those it bonds to, each with its bond's bgf:bondCount. A step that moves species between compartments
// unchanged (a carrier, a channel) is transport, and a resistance is a flow down a potential difference (diffusion,
// Poiseuille flow): both are drawn with ⇄. Charge a reaction moves across a membrane through its transformers
// (bgf:TransformerNode, ratio -q F / 2 on its forward side) is noted.

//==============================================================================

export const FARADAY = 96485.33212   // C/mol

export interface Participant {
    species: string
    location?: string
    count: number
    node?: string               // the store or source it is
    bond?: string               // the bond joining it to the step
}

export type StepKind = 'reaction' | 'transport' | 'flow'

export interface StepEquation {
    id: string
    name: string                // the element's species label (e.g. its enzyme), or its id
    kind: StepKind
    substrates: Participant[]
    products: Participant[]
    charge?: { count: number, location?: string }   // positive charges moved into location per turnover
    regions: string[]           // the locations of its species, sorted: one, or several for a step between them
}

export interface BondInfo {
    id?: string
    source: string
    target: string
    count: number
}

export interface NodeInfo {
    species?: string
    location?: string
    symbol?: string
    transformRatio?: number     // for a transformer node
}

//==============================================================================

const ARROWS: Record<StepKind, string> = { reaction: '⇌', transport: '⇄', flow: '⇄' }

export function participantText(p: Participant): string {
    const coefficient = p.count === 1 ? '' : `${p.count} `
    return `${coefficient}${p.species}${p.location ? `[${p.location}]` : ''}`
}

function sideText(side: Participant[]): string {
    return side.length ? side.map(participantText).join(' + ') : '∅'
}

/** "moves 2 charges into [m]", for a step that moves charge across a membrane, else ''. */
export function chargeText(eq: StepEquation): string {
    if (!eq.charge || eq.charge.count === 0) return ''
    const n = Math.abs(eq.charge.count)
    const where = eq.charge.location ? ` ${eq.charge.count > 0 ? 'into' : 'out of'} [${eq.charge.location}]` : ''
    return `moves ${n} charge${n === 1 ? '' : 's'}${where}`
}

/** The equation as text: substrates, the step's arrow, products, and any charge it moves across a membrane. */
export function equationText(eq: StepEquation): string {
    const text = `${sideText(eq.substrates)} ${ARROWS[eq.kind]} ${sideText(eq.products)}`
    const charge = chargeText(eq)
    return charge ? `${text}   (${charge})` : text
}

const LATEX_ARROWS: Record<StepKind, string> = { reaction: '\\rightleftharpoons', transport: '\\leftrightarrows', flow: '\\leftrightarrows' }

// MathJax's \text is literal but for braces, backslashes and $, which are set in math mode instead
const TEXT_SPECIALS: Record<string, string> = { '{': '\\{', '}': '\\}', '\\': '\\backslash ', $: '\\$' }

/** A label as upright LaTeX: \mathrm for a plain name, else \text. */
export function labelLatex(label: string): string {
    if (/^[A-Za-z0-9]+$/.test(label)) return `\\mathrm{${label}}`
    return label.split(/([{}\\$])/).filter(Boolean)
                .map(part => TEXT_SPECIALS[part] ?? `\\text{${part}}`).join('')
}

export function participantLatex(p: Participant): string {
    const coefficient = p.count === 1 ? '' : `${p.count}\\,`
    return `${coefficient}${labelLatex(p.species)}${p.location ? `[${labelLatex(p.location)}]` : ''}`
}

function sideLatex(side: Participant[]): string {
    return side.length ? side.map(participantLatex).join(' + ') : '\\varnothing'
}

/** equationText as LaTeX. */
export function equationLatex(eq: StepEquation): string {
    const latex = `${sideLatex(eq.substrates)} ${LATEX_ARROWS[eq.kind]} ${sideLatex(eq.products)}`
    const charge = chargeText(eq)
    return charge ? `${latex}\\qquad ${labelLatex(`(${charge})`)}` : latex
}

/** True when both sides hold the same species in the same amounts, at least one of them in another compartment. */
export function isTransport(substrates: Participant[], products: Participant[]): boolean {
    const amounts = (side: Participant[]) => {
        const m = new Map<string, number>()
        for (const p of side) m.set(p.species, (m.get(p.species) || 0) + p.count)
        return m
    }
    const a = amounts(substrates)
    const b = amounts(products)
    if (a.size === 0 || a.size !== b.size) return false
    for (const [species, n] of a) {
        if (b.get(species) !== n) return false
    }
    const where = (side: Participant[]) => new Set(side.map(p => `${p.species}@${p.location ?? ''}`))
    const wa = where(substrates)
    return [...where(products)].some(w => !wa.has(w))
}

/**
 * The equation of a reaction or resistance element `id`, from the diagram's bonds and its nodes' labels: what is
 * bonded into it is on its left, what it bonds to on its right; a transformer between it and a capacitor gives the
 * charge it moves (from the forward-side transformer's ratio, -q F / 2, into the capacitor's location).
 */
export function stepEquation(id: string, isResistance: boolean, bonds: BondInfo[],
                             nodes: Map<string, NodeInfo>): StepEquation {
    const substrates: Participant[] = []
    const products: Participant[] = []
    let charge: StepEquation['charge']
    for (const b of bonds) {
        const other = b.target === id ? b.source : b.source === id ? b.target : undefined
        if (other === undefined) continue
        const node = nodes.get(other) ?? {}
        if (node.transformRatio !== undefined) {
            if (b.target === id) {       // the forward side's transformer: from the capacitor, ratio -q F / 2
                const capacitor = bonds.find(c => c.target === other)?.source
                charge = {
                    count: Math.round(-2 * node.transformRatio / FARADAY),
                    location: capacitor ? nodes.get(capacitor)?.location : undefined
                }
            }
            continue
        }
        const participant: Participant = {
            species: node.species ?? node.symbol ?? other, location: node.location, count: b.count, node: other, bond: b.id
        }
        if (b.target === id) substrates.push(participant)
        else products.push(participant)
    }
    const kind: StepKind = isResistance ? 'flow' : isTransport(substrates, products) ? 'transport' : 'reaction'
    const name = nodes.get(id)?.species ?? id
    const regions = [...new Set([...substrates, ...products].map(p => p.location)
                                    .filter((l): l is string => !!l))].sort()
    return { id, name, kind, substrates, products, charge, regions }
}

//==============================================================================

// Editing a step's equation. Coefficients are written with a space, `2 ADP[c]`, as species names may start with a
// digit (3PG, 13BPG); sides are joined by ` + ` with spaces, as names may end in + (H+, NAD+).

const ARROW_PATTERN = /\s(?:⇌|⇄|↔|→|<=>|<->|->|=)\s/
const TERM_PATTERN = /^(?:(\d+)\s+)?([^\s[\]]+?)(?:\[([^\]\s]+)\])?$/

export interface ParsedEquation {
    substrates: Participant[]
    products: Participant[]
}

function parseSide(text: string): Participant[] {
    const trimmed = text.trim()
    if (trimmed === '' || trimmed === '∅') return []
    const participants: Participant[] = []
    for (const term of trimmed.split(/\s\+\s/)) {
        const match = term.trim().match(TERM_PATTERN)
        if (!match) {
            throw new Error(`'${term.trim()}' is not a species: write it as 'n Species[location]'`)
        }
        const count = match[1] ? Number(match[1]) : 1
        if (count < 1) {
            throw new Error(`'${term.trim()}': a stoichiometric coefficient is a whole number of at least 1`)
        }
        const same = participants.find(p => p.species === match[2] && p.location === match[3])
        if (same) same.count += count
        else participants.push({ species: match[2] ?? '', location: match[3], count })
    }
    return participants
}

/** `2 ADP[m] + Pi[m] ⇌ ATP[m] + H2O[m]` as its two sides (any of ⇌ ⇄ ↔ → <=> <-> -> = for the arrow). */
export function parseEquation(text: string): ParsedEquation {
    const sides = text.replace(/\(moves [^)]*\)\s*$/, '').split(ARROW_PATTERN)
    if (sides.length !== 2) {
        throw new Error('An equation has one arrow (⇌, <=> or ->) with spaces around it')
    }
    const equation = { substrates: parseSide(sides[0] ?? ''), products: parseSide(sides[1] ?? '') }
    if (equation.substrates.length + equation.products.length === 0) {
        throw new Error('An equation needs at least one species')
    }
    return equation
}

export type Side = 'substrate' | 'product'

export type EquationEdit =
    | { op: 'count', bond: string, count: number }
    | { op: 'remove', bond: string, node?: string }
    | { op: 'add', side: Side, species: string, location?: string, count: number }

/**
 * The bond changes that turn a step's equation into `edited`: a participant on the same side, with the same species
 * and location (or no location given), keeps its bond, with a new bondCount if its coefficient changed; the others
 * are removed, and new participants added.
 */
export function planEquationEdit(current: StepEquation, edited: ParsedEquation): EquationEdit[] {
    const edits: EquationEdit[] = []
    const sides: [Side, Participant[], Participant[]][] = [
        ['substrate', current.substrates, edited.substrates],
        ['product', current.products, edited.products]
    ]
    for (const [side, now, wanted] of sides) {
        const kept = new Set<Participant>()
        for (const w of wanted) {
            const match = now.find(p => !kept.has(p) && p.species === w.species
                                        && (w.location === undefined || p.location === w.location))
            if (match) {
                kept.add(match)
                if (match.count !== w.count && match.bond) {
                    edits.push({ op: 'count', bond: match.bond, count: w.count })
                }
            } else {
                edits.push({ op: 'add', side, species: w.species, location: w.location, count: w.count })
            }
        }
        for (const p of now) {
            if (!kept.has(p) && p.bond) {
                edits.push({ op: 'remove', bond: p.bond, node: p.node })
            }
        }
    }
    return edits
}

export interface SpeciesNode {
    id: string
    species: string
    location?: string
    isSource: boolean           // a potential source (chemostat): a copy is placed beside each step using it
}

/**
 * The node a new participant joins: the store of that species and location (or the only one of that species when
 * no location is given), else such a source; undefined when there is none, and an error when more than one store
 * of the species fits.
 */
export function findSpeciesNode(nodes: SpeciesNode[], species: string, location?: string): SpeciesNode|undefined {
    const fits = nodes.filter(n => n.species === species && (location === undefined || n.location === location))
    const stores = fits.filter(n => !n.isSource)
    if (stores.length > 1 && location === undefined) {
        const where = [...new Set(stores.map(n => n.location))].join(', ')
        throw new Error(`${species} is in more than one compartment (${where}): give it as ${species}[location]`)
    }
    return stores[0] ?? fits[0]
}

//==============================================================================
//==============================================================================
