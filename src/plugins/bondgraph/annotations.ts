/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

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

// Reaction and species annotations as triples on a bond graph's elements (subject: the element's URI):
//
// - a reaction or transporter: bqbiol:isVersionOf rhea:N (its Rhea master reaction), or bqbiol:hasPart rhea:N for
//   each reaction a lumped step combines; bqbiol:isVersionOf SBO:0000176 (biochemical reaction) or SBO:0000655
//   (transport reaction); semsim:hasMediatorParticipant uniprot:ACC (its enzyme or transporter);
// - a store or source of a species: bqbiol:is CHEBI:N and bqbiol:isPartOf GO:N (its compartment), the same on
//   every element of that species and location.
//
// Objects are identifiers.org IRIs, https://identifiers.org/<prefix>:<id>. bg2cellml exports these as OMEX
// Metadata, and the module library's CI checks the reactions against Rhea.

//==============================================================================

export const BQBIOL = 'http://biomodels.net/biology-qualifiers/'
export const SEMSIM = 'http://bime.uw.edu/semsim/'
export const IDENTIFIERS = 'https://identifiers.org/'

export const IS_VERSION_OF = `${BQBIOL}isVersionOf`
export const HAS_PART = `${BQBIOL}hasPart`
export const IS = `${BQBIOL}is`
export const IS_PART_OF = `${BQBIOL}isPartOf`
export const HAS_MEDIATOR = `${SEMSIM}hasMediatorParticipant`

/** The predicates annotations use. */
export const ANNOTATION_PREDICATES = [IS_VERSION_OF, HAS_PART, IS, IS_PART_OF, HAS_MEDIATOR]

export type IdKind = 'rhea' | 'CHEBI' | 'GO' | 'SBO' | 'uniprot'

const ID_PATTERNS: Record<IdKind, RegExp> = {
    rhea: /^\d{5,6}$/,
    CHEBI: /^\d+$/,
    GO: /^\d{7}$/,
    SBO: /^\d{7}$/,
    uniprot: /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/
}

const ID_FORMS: Record<IdKind, string> = {
    rhea: 'a Rhea ID is 5 or 6 digits (e.g. 17825)',
    CHEBI: 'a ChEBI ID is digits (e.g. 4167)',
    GO: 'a GO ID is 7 digits (e.g. 0005829)',
    SBO: 'an SBO term is 7 digits',
    uniprot: 'a UniProt accession is like P00558 or A0A023GPI8'
}

export const SBO_TYPES: { id: string, label: string }[] = [
    { id: '0000176', label: 'biochemical reaction' },
    { id: '0000655', label: 'transport reaction' }
]

export interface Triple {
    subject: string
    predicate: string
    object: string
}

/** An element's annotations, as IDs without their prefixes. */
export interface Annotation {
    rhea?: string               // its Rhea master reaction
    parts: string[]             // the Rhea reactions of a lumped step
    sbo?: string
    uniprot?: string
    chebi?: string
    go?: string
}

export function emptyAnnotation(): Annotation {
    return { parts: [] }
}

//==============================================================================

/** An ID as typed: trimmed, without its prefix (RHEA:, CHEBI:, GO:, ...), UniProt accessions in capitals. */
export function normaliseId(kind: IdKind, value: string): string {
    const trimmed = value.trim().replace(new RegExp(`^${kind}:`, 'i'), '').trim()
    return kind === 'uniprot' ? trimmed.toUpperCase() : trimmed
}

/** Why `value` (normalised) is not an ID of this kind, or undefined when it is one or is empty. */
export function idError(kind: IdKind, value: string): string|undefined {
    if (value === '') return undefined
    return ID_PATTERNS[kind].test(value) ? undefined : ID_FORMS[kind]
}

/** The identifiers.org IRI of an ID. */
export function identifierIri(kind: IdKind, id: string): string {
    return `${IDENTIFIERS}${kind}:${id}`
}

/** The page about an ID, to link it to. */
export function identifierLink(kind: IdKind, id: string): string {
    switch (kind) {
        case 'rhea': return `https://www.rhea-db.org/rhea/${id}`
        case 'CHEBI': return `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:${id}`
        case 'GO': return `https://amigo.geneontology.org/amigo/term/GO:${id}`
        case 'SBO': return `https://identifiers.org/SBO:${id}`
        case 'uniprot': return `https://www.uniprot.org/uniprotkb/${id}`
    }
}

// the kind and ID of an identifiers.org IRI
function parseIri(iri: string): { kind: IdKind, id: string }|undefined {
    if (!iri.startsWith(IDENTIFIERS)) return undefined
    const match = iri.slice(IDENTIFIERS.length).match(/^([A-Za-z]+):(.+)$/)
    if (!match) return undefined
    const kind = (Object.keys(ID_PATTERNS) as IdKind[]).find(k => k.toLowerCase() === match[1]!.toLowerCase())
    return kind ? { kind, id: match[2]! } : undefined
}

/** Each element's annotations, from its triples (others are ignored). */
export function readAnnotations(triples: Triple[]): Map<string, Annotation> {
    const annotations = new Map<string, Annotation>()
    for (const t of triples) {
        const parsed = parseIri(t.object)
        if (!parsed) continue
        const a = annotations.get(t.subject) ?? emptyAnnotation()
        const { kind, id } = parsed
        if (t.predicate === IS_VERSION_OF && kind === 'rhea') a.rhea = id
        else if (t.predicate === IS_VERSION_OF && kind === 'SBO') a.sbo = id
        else if (t.predicate === HAS_PART && kind === 'rhea') { if (!a.parts.includes(id)) a.parts.push(id) }
        else if (t.predicate === HAS_MEDIATOR && kind === 'uniprot') a.uniprot = id
        else if (t.predicate === IS && kind === 'CHEBI') a.chebi = id
        else if (t.predicate === IS_PART_OF && kind === 'GO') a.go = id
        else continue
        annotations.set(t.subject, a)
    }
    return annotations
}

/** An element's annotations as triples. A lumped step's parts are written instead of a single Rhea ID. */
export function annotationTriples(subject: string, a: Annotation): Triple[] {
    const triples: Triple[] = []
    const add = (predicate: string, kind: IdKind, id?: string) => {
        if (id) triples.push({ subject, predicate, object: identifierIri(kind, id) })
    }
    if (a.parts.length) a.parts.forEach(id => add(HAS_PART, 'rhea', id))
    else add(IS_VERSION_OF, 'rhea', a.rhea)
    add(IS_VERSION_OF, 'SBO', a.sbo)
    add(HAS_MEDIATOR, 'uniprot', a.uniprot)
    add(IS, 'CHEBI', a.chebi)
    add(IS_PART_OF, 'GO', a.go)
    return triples
}

const tripleKey = (t: Triple) => `${t.subject} ${t.predicate} ${t.object}`

/**
 * The triples to remove and add to turn the `current` annotations into the `wanted` ones, for the elements of
 * `wanted` only (an element left out keeps its triples).
 */
export function planAnnotationChanges(current: Map<string, Annotation>, wanted: Map<string, Annotation>):
        { remove: Triple[], add: Triple[] } {
    const remove: Triple[] = [], add: Triple[] = []
    for (const [subject, a] of wanted) {
        const now = annotationTriples(subject, current.get(subject) ?? emptyAnnotation())
        const next = annotationTriples(subject, a)
        const nextKeys = new Set(next.map(tripleKey)), nowKeys = new Set(now.map(tripleKey))
        remove.push(...now.filter(t => !nextKeys.has(tripleKey(t))))
        add.push(...next.filter(t => !nowKeys.has(tripleKey(t))))
    }
    return { remove, add }
}

//==============================================================================

export interface SpeciesElement {
    id: string
    species: string
    location?: string
}

export interface SpeciesGroup {
    key: string                 // `${species}[${location}]`
    species: string
    location?: string
    elements: string[]          // its stores and sources (chemostat copies included)
    chebi?: string
    go?: string
    differ: boolean             // its elements' annotations are not all the same
}

/**
 * The species' elements grouped by species and location, sorted by location then species, each with the
 * annotations its first annotated element has.
 */
export function speciesGroups(elements: SpeciesElement[], annotations: Map<string, Annotation>): SpeciesGroup[] {
    const groups = new Map<string, SpeciesGroup>()
    for (const e of elements) {
        const key = `${e.species}[${e.location ?? ''}]`
        const group = groups.get(key) ?? { key, species: e.species, location: e.location, elements: [], differ: false }
        group.elements.push(e.id)
        groups.set(key, group)
    }
    for (const group of groups.values()) {
        const terms = group.elements.map(id => annotations.get(id))
        group.chebi = terms.find(a => a?.chebi)?.chebi
        group.go = terms.find(a => a?.go)?.go
        group.differ = terms.some(a => (a?.chebi ?? '') !== (group.chebi ?? '') || (a?.go ?? '') !== (group.go ?? ''))
    }
    return [...groups.values()].sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '')
                                               || a.species.localeCompare(b.species))
}

/** The annotations each species element gets from its group's ChEBI and GO terms (its others as in `current`). */
export function speciesAnnotations(groups: { elements: string[], chebi?: string, go?: string }[],
                                   current: Map<string, Annotation> = new Map()): Map<string, Annotation> {
    const wanted = new Map<string, Annotation>()
    for (const g of groups) {
        for (const id of g.elements) {
            wanted.set(id, { ...(current.get(id) ?? emptyAnnotation()), chebi: g.chebi || undefined, go: g.go || undefined })
        }
    }
    return wanted
}

/** An element's annotations as a line of its hover: "Rhea 17825 · SBO:0000176", "CHEBI:4167 · GO:0005829". */
export function annotationText(a: Annotation|undefined): string {
    if (!a) return ''
    const parts: string[] = []
    if (a.parts.length) parts.push(`Rhea ${a.parts.join(' + ')} (lumped)`)
    else if (a.rhea) parts.push(`Rhea ${a.rhea}`)
    if (a.sbo) parts.push(`SBO:${a.sbo}`)
    if (a.uniprot) parts.push(`UniProt ${a.uniprot}`)
    if (a.chebi) parts.push(`CHEBI:${a.chebi}`)
    if (a.go) parts.push(`GO:${a.go}`)
    return parts.join(' · ')
}

//==============================================================================
//==============================================================================
