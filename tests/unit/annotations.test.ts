/** biome-ignore-all lint/style/noNonNullAssertion: <the elements exist> */
import { describe, expect, test } from 'bun:test'

import {
    type Annotation, annotationText, annotationTriples, emptyAnnotation, HAS_MEDIATOR, HAS_PART, IS, IS_PART_OF,
    IS_VERSION_OF, idError, identifierIri, identifierLink, normaliseId, planAnnotationChanges, readAnnotations,
    speciesAnnotations, speciesGroups
} from '../../src/plugins/bondgraph/annotations'

const M = 'file:///glycogen.celldl#'

describe('IDs', () => {
    test('typed IDs lose their prefix and spaces', () => {
        expect(normaliseId('rhea', ' RHEA:17825 ')).toBe('17825')
        expect(normaliseId('CHEBI', 'chebi:4167')).toBe('4167')
        expect(normaliseId('GO', 'GO:0005829')).toBe('0005829')
        expect(normaliseId('uniprot', 'p00558')).toBe('P00558')
    })
    test('each kind has its pattern', () => {
        expect(idError('rhea', '17825')).toBeUndefined()
        expect(idError('rhea', '123456')).toBeUndefined()
        expect(idError('rhea', '1234')).toBeDefined()
        expect(idError('rhea', '1234567')).toBeDefined()
        expect(idError('CHEBI', '4167')).toBeUndefined()
        expect(idError('CHEBI', '41a7')).toBeDefined()
        expect(idError('GO', '0005829')).toBeUndefined()
        expect(idError('GO', '5829')).toBeDefined()
        expect(idError('SBO', '0000176')).toBeUndefined()
        expect(idError('uniprot', 'P00558')).toBeUndefined()
        expect(idError('uniprot', 'A0A023GPI8')).toBeUndefined()
        expect(idError('uniprot', 'P0055')).toBeDefined()
        expect(idError('uniprot', '')).toBeUndefined()
    })
    test('IRIs and links', () => {
        expect(identifierIri('rhea', '17825')).toBe('https://identifiers.org/rhea:17825')
        expect(identifierIri('CHEBI', '4167')).toBe('https://identifiers.org/CHEBI:4167')
        expect(identifierLink('rhea', '17825')).toBe('https://www.rhea-db.org/rhea/17825')
        expect(identifierLink('CHEBI', '4167')).toBe('https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:4167')
        expect(identifierLink('GO', '0005829')).toBe('https://amigo.geneontology.org/amigo/term/GO:0005829')
    })
})

describe('reading and writing triples', () => {
    const triples = [
        { subject: `${M}Re_PGM`, predicate: IS_VERSION_OF, object: 'https://identifiers.org/rhea:23536' },
        { subject: `${M}Re_PGM`, predicate: IS_VERSION_OF, object: 'https://identifiers.org/SBO:0000176' },
        { subject: `${M}Re_PGM`, predicate: HAS_MEDIATOR, object: 'https://identifiers.org/uniprot:P00558' },
        { subject: `${M}Re_GLGA`, predicate: HAS_PART, object: 'https://identifiers.org/rhea:18549' },
        { subject: `${M}Re_GLGA`, predicate: HAS_PART, object: 'https://identifiers.org/rhea:12345' },
        { subject: `${M}q_G6P`, predicate: IS, object: 'https://identifiers.org/CHEBI:58225' },
        { subject: `${M}q_G6P`, predicate: IS_PART_OF, object: 'https://identifiers.org/GO:0005829' },
        { subject: `${M}q_G6P`, predicate: IS, object: 'http://example.org/other' }
    ]
    test('each element\'s annotations', () => {
        const read = readAnnotations(triples)
        expect(read.get(`${M}Re_PGM`)).toEqual({ parts: [], rhea: '23536', sbo: '0000176', uniprot: 'P00558' })
        expect(read.get(`${M}Re_GLGA`)).toEqual({ parts: ['18549', '12345'] })
        expect(read.get(`${M}q_G6P`)).toEqual({ parts: [], chebi: '58225', go: '0005829' })
    })
    test('written back as the same triples', () => {
        const read = readAnnotations(triples)
        const written = [...read].flatMap(([subject, a]) => annotationTriples(subject, a))
        expect(new Set(written.map(t => JSON.stringify(t)))).toEqual(new Set(triples.slice(0, 7).map(t => JSON.stringify(t))))
    })
    test('a lumped step writes its parts instead of a single Rhea ID', () => {
        expect(annotationTriples('x', { parts: ['18549'], rhea: '23536' }))
            .toEqual([{ subject: 'x', predicate: HAS_PART, object: 'https://identifiers.org/rhea:18549' }])
    })
})

describe('planning changes', () => {
    const current = new Map<string, Annotation>([
        ['r', { parts: [], rhea: '23536', sbo: '0000176' }],
        ['s', { parts: [], chebi: '58225', go: '0005829' }]
    ])
    test('a changed ID replaces its triple; others stay', () => {
        const plan = planAnnotationChanges(current, new Map([['r', { parts: [], rhea: '17825', sbo: '0000176' }]]))
        expect(plan.remove).toEqual([{ subject: 'r', predicate: IS_VERSION_OF, object: 'https://identifiers.org/rhea:23536' }])
        expect(plan.add).toEqual([{ subject: 'r', predicate: IS_VERSION_OF, object: 'https://identifiers.org/rhea:17825' }])
    })
    test('removing a value removes its triple', () => {
        const plan = planAnnotationChanges(current, new Map([['s', { parts: [], chebi: '58225' }]]))
        expect(plan.remove).toEqual([{ subject: 's', predicate: IS_PART_OF, object: 'https://identifiers.org/GO:0005829' }])
        expect(plan.add).toEqual([])
    })
    test('an unchanged annotation, or an element left out, changes nothing', () => {
        const plan = planAnnotationChanges(current, new Map([['r', current.get('r')!]]))
        expect(plan).toEqual({ remove: [], add: [] })
    })
    test('a new element gets its triples', () => {
        const plan = planAnnotationChanges(current, new Map([['n', { parts: ['1', '2'] }]]))
        expect(plan.add.map(t => t.object)).toEqual(['https://identifiers.org/rhea:1', 'https://identifiers.org/rhea:2'])
    })
})

describe('species', () => {
    const elements = [
        { id: 'q_ATP', species: 'ATP', location: 'c' },
        { id: 'Se_ATP_1', species: 'ATP', location: 'c' },
        { id: 'Se_ATP_2', species: 'ATP', location: 'c' },
        { id: 'q_ATP_m', species: 'ATP', location: 'm' },
        { id: 'q_ADP', species: 'ADP', location: 'c' }
    ]
    test('grouped by species and location, with the terms of their annotated element', () => {
        const annotations = new Map<string, Annotation>([['Se_ATP_1', { parts: [], chebi: '30616', go: '0005829' }]])
        const groups = speciesGroups(elements, annotations)
        expect(groups.map(g => g.key)).toEqual(['ADP[c]', 'ATP[c]', 'ATP[m]'])
        const atp = groups.find(g => g.key === 'ATP[c]')!
        expect(atp.elements).toEqual(['q_ATP', 'Se_ATP_1', 'Se_ATP_2'])
        expect(atp).toMatchObject({ chebi: '30616', go: '0005829', differ: true })
        expect(groups.find(g => g.key === 'ADP[c]')!.differ).toBe(false)
    })
    test('every element of a group gets its terms, chemostat copies included', () => {
        const current = new Map<string, Annotation>([['q_ATP', { parts: [], rhea: '1' }]])
        const wanted = speciesAnnotations([{ elements: ['q_ATP', 'Se_ATP_1'], chebi: '30616', go: '' }], current)
        expect(wanted.get('q_ATP')).toEqual({ parts: [], rhea: '1', chebi: '30616', go: undefined })
        expect(wanted.get('Se_ATP_1')).toEqual({ parts: [], chebi: '30616', go: undefined })
    })
})

describe('hover text', () => {
    test('a reaction and a species', () => {
        expect(annotationText({ parts: [], rhea: '17825' })).toBe('Rhea 17825')
        expect(annotationText({ parts: ['1', '2'], sbo: '0000176' })).toBe('Rhea 1 + 2 (lumped) · SBO:0000176')
        expect(annotationText({ parts: [], chebi: '4167', go: '0005829' })).toBe('CHEBI:4167 · GO:0005829')
        expect(annotationText(emptyAnnotation())).toBe('')
        expect(annotationText(undefined)).toBe('')
    })
})
