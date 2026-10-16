/** biome-ignore-all lint/style/noNonNullAssertion: <the query rows have their keys> */

// Unit tests of how an element shows its constitutive relation (src/plugins/bondgraph/laws.ts):
//
//     bun run test
//
// The templates are read from the BG-RDF submodule, as the editor reads them.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'

import { SPARQL_PREFIXES } from '@celldl/metadata'
import { initialise, RdfStore } from '@celldl/rdf'

import { elementTemplatesQuery, makeLatex, styleOverrides, templateStyle } from '#root/plugins/bondgraph/laws'
import { borderStroke, doubleInnerWidth, doubleInset } from '#root/utils/borders'

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

const REACTION_STYLE = { text: '#72329F', background: '#FFD966', border: 'black' }

describe('law labels', () => {
    test('a law label is a small upright pre-superscript before the symbol', () => {
        expect(makeLatex('Rx', 'i', 'j', 'sat')).toBe('{}^{\\scriptscriptstyle\\mathrm{sat}}\\!Rx^{i}_{j}')
    })
    test('without a law label the symbol is as before', () => {
        expect(makeLatex('Rx', 'i', 'j')).toBe('Rx^{i}_{j}')
        expect(makeLatex('k', undefined, undefined)).toBe('k')
    })
})

describe('template styles', () => {
    test('a template style sets what it gives over the base style', () => {
        const style = templateStyle(REACTION_STYLE, { background: '#FFE9A8', border: '#C55A11', borderStyle: 'dashed' })
        expect(style).toEqual({ text: '#72329F', background: '#FFE9A8', border: '#C55A11', borderStyle: 'dashed' })
        expect(REACTION_STYLE).toEqual({ text: '#72329F', background: '#FFD966', border: 'black' })   // unchanged
    })
    test('no overrides, or an unknown border style, leave the base style', () => {
        expect(templateStyle(REACTION_STYLE, {})).toEqual(REACTION_STYLE)
        // @ts-expect-error: an unknown border style
        expect(templateStyle(REACTION_STYLE, { borderStyle: 'wavy' }).borderStyle).toBeUndefined()
    })
})

describe('borders', () => {
    test('a solid border is a plain stroke, a dashed one a dash pattern scaled to its width', () => {
        expect(borderStroke('red', 2)).toBe(' stroke="red" stroke-width="2"')
        expect(borderStroke('red', 2, 'dashed')).toBe(' stroke="red" stroke-width="2" stroke-dasharray="6 4"')
        expect(borderStroke('red', 2, 'double')).toBe(' stroke="red" stroke-width="2"')
        expect(doubleInset(2)).toBe(3.2)
        expect(doubleInnerWidth(2)).toBe(1.2)
    })
})

describe('the BG-RDF templates', async () => {
    await initialise()
    const store = new RdfStore()
    store.load('https://bg-rdf.org/ontologies/bondgraph-framework', readFileSync('BG-RDF/schema/ontology.ttl', 'utf8'))
    for (const file of readdirSync('BG-RDF/templates')) {
        store.load(`https://bg-rdf.org/templates/${file}`, readFileSync(`BG-RDF/templates/${file}`, 'utf8'))
    }
    const templates = (base: string) => {
        const rows = store.query(`${SPARQL_PREFIXES}${elementTemplatesQuery(`${BGF}${base}`)}`)
        // one row per template: a template defined twice would be offered twice
        expect(new Set(rows.map((r: Map<string, { value: string }>) => r.get('element')!.value)).size).toBe(rows.length)
        return new Map(rows.map((r: Map<string, { value: string }>) =>
            [r.get('element')!.value.replace(BGF, ''), { lawLabel: r.get('lawLabel')?.value, overrides: styleOverrides(r) }]))
    }

    test('each element class offers its laws, a non-default law with its label and style', () => {
        const reactions = templates('Reaction')
        expect(reactions.get('ChemicalReaction')).toEqual({ lawLabel: undefined, overrides: {
            text: undefined, background: undefined, border: undefined, borderStyle: undefined } })
        expect(reactions.get('SaturatingChemicalReaction')).toEqual({ lawLabel: 'sat', overrides: {
            text: '#72329F', background: '#FFE9A8', border: '#C55A11', borderStyle: 'dashed' } })
        expect(templates('QuantityStore').get('SaturatingChemicalConcentration')?.lawLabel).toBe('sat')
        const resistances = templates('Resistance')
        expect(resistances.has('HydraulicResistor')).toBe(true)
        expect(resistances.get('BernoulliHydraulicResistor')?.overrides.borderStyle).toBe('double')
    })

    test('within an element class, every labelled law is drawn differently from the others and the default', () => {
        for (const base of ['Reaction', 'Resistance', 'QuantityStore']) {
            const drawn = [...templates(base).values()].map(t =>
                JSON.stringify([t.lawLabel, templateStyle(REACTION_STYLE, t.overrides)]))
            const labelled = [...templates(base).values()].filter(t => t.lawLabel).length
            expect(labelled).toBeGreaterThan(0)
            // the unlabelled templates share the base look; each labelled one has its own
            expect(new Set(drawn).size).toBe(labelled + 1)
        }
    })
})
