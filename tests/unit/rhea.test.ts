/** biome-ignore-all lint/style/noNonNullAssertion: <the parts exist> */
import { describe, expect, test } from 'bun:test'

import { latexAsSvgString } from '../../src/mathjax'
import type { StepEquation } from '../../src/plugins/bondgraph/equations'
import {
    combineParts, fetchAncestors, fetchRhea, netDifferences, netLatex, parseRheaEquation, partLatex, relatedBy
} from '../../src/plugins/bondgraph/rhea'

// hexokinase then glucose-6-phosphate isomerase, as Rhea writes them
const HK = parseRheaEquation('17825', 'D-glucose + ATP = D-glucose 6-phosphate + ADP + H(+)',
                             ['CHEBI:4167', 'CHEBI:30616', 'CHEBI:61548', 'CHEBI:456216', 'CHEBI:15378'])
const PGI = parseRheaEquation('11816', 'D-glucose 6-phosphate = D-fructose 6-phosphate', ['CHEBI:61548', 'CHEBI:57634'])

describe('Rhea reactions', () => {
    test('an equation\'s terms, with coefficients, sides of a membrane and ChEBI IDs', () => {
        const r = parseRheaEquation('1', '2 H(+)(out) + ATP = 2 H(+)(in) + ADP', ['CHEBI:15378', 'CHEBI:30616', 'CHEBI:456216'])
        expect(r.participants).toEqual([
            { side: 'L', count: 2, name: 'H(+)', location: 'out', chebi: '15378' },
            { side: 'L', count: 1, name: 'ATP', location: undefined, chebi: '30616' },
            { side: 'R', count: 2, name: 'H(+)', location: 'in', chebi: '15378' },
            { side: 'R', count: 1, name: 'ADP', location: undefined, chebi: '456216' },
        ])
    })

    test('fetched from Rhea\'s REST API once', async () => {
        const asked: string[] = []
        const fetcher = (async (url: string) => {
            asked.push(url)
            return new Response('Reaction identifier\tEquation\tChEBI identifier\n'
                              + 'RHEA:11816\tD-glucose 6-phosphate = D-fructose 6-phosphate\tCHEBI:61548;CHEBI:57634\n')
        }) as unknown as typeof fetch
        const r = await fetchRhea('11816', fetcher)
        await fetchRhea('11816', fetcher)
        expect(r).toEqual(PGI)
        expect(asked).toHaveLength(1)
        expect(asked[0]).toContain('query=RHEA%3A11816')
    })
})

describe('a lumped step\'s parts added up', () => {
    test('what one part makes and the next uses cancels, and is struck through in both', () => {
        const c = combineParts([HK, PGI])
        expect(c.parts.map(p => p.terms.filter(t => t.cancelled).map(t => `${p.id} ${t.side} ${t.name}`)).flat())
            .toEqual(['17825 R D-glucose 6-phosphate', '11816 L D-glucose 6-phosphate'])
        expect(c.net.map(p => `${p.side} ${p.count} ${p.name}`))
            .toEqual(['L 1 D-glucose', 'L 1 ATP', 'R 1 ADP', 'R 1 H(+)', 'R 1 D-fructose 6-phosphate'])
        expect(partLatex(c.parts[0]!.terms).join(' ')).toBe('\\text{D-glucose} + \\mathrm{ATP} \\rightleftharpoons '
            + '\\cancel{\\text{D-glucose 6-phosphate}} + \\mathrm{ADP} + \\text{H(+)}')
        expect(netLatex(c.net).join(' ')).toBe('\\text{D-glucose} + \\mathrm{ATP} \\rightleftharpoons '
            + '\\mathrm{ADP} + \\text{H(+)} + \\text{D-fructose 6-phosphate}')
    })

    test('a coefficient that only partly cancels is crossed to what is left', () => {
        const c = combineParts([parseRheaEquation('1', 'A = 2 B', ['CHEBI:1', 'CHEBI:2']),
                                parseRheaEquation('2', 'B = C', ['CHEBI:2', 'CHEBI:3'])])
        expect(partLatex(c.parts[0]!.terms).join(' ')).toBe('\\mathrm{A} \\rightleftharpoons \\cancelto{1}{2}\\,\\mathrm{B}')
        expect(partLatex(c.parts[1]!.terms).join(' ')).toBe('\\cancel{\\mathrm{B}} \\rightleftharpoons \\mathrm{C}')
        expect(netLatex(c.net).join(' ')).toBe('\\mathrm{A} \\rightleftharpoons \\mathrm{B} + \\mathrm{C}')
    })

    test('a term Rhea writes more specifically cancels the general one it is_a', () => {
        const isomerase = parseRheaEquation('11816', 'alpha-D-glucose 6-phosphate = beta-D-fructose 6-phosphate',
                                            ['CHEBI:58225', 'CHEBI:57634'])
        expect(combineParts([HK, isomerase]).parts.flatMap(p => p.terms).filter(t => t.cancelled)).toHaveLength(0)
        const related = relatedBy(new Map([['58225', ['61548', '24870']]]))
        const c = combineParts([HK, isomerase], related)
        expect(c.parts.flatMap(p => p.terms).filter(t => t.cancelled).map(t => t.name))
            .toEqual(['D-glucose 6-phosphate', 'alpha-D-glucose 6-phosphate'])
        expect(c.net.map(p => p.name)).toEqual(['D-glucose', 'ATP', 'ADP', 'H(+)', 'beta-D-fructose 6-phosphate'])
    })

    test('ancestors from the Ontology Lookup Service, page by page', async () => {
        const pages: Record<string, unknown> = {
            first: { _embedded: { terms: [{ obo_id: 'CHEBI:61548' }, { obo_id: 'BFO:0000001' }] }, _links: { next: { href: 'second' } } },
            second: { _embedded: { terms: [{ obo_id: 'CHEBI:24870' }] }, _links: {} }
        }
        const asked: string[] = []
        const fetcher = (async (url: string) => {
            asked.push(url)
            return Response.json(pages[url.startsWith('http') ? 'first' : url])
        }) as unknown as typeof fetch
        expect(await fetchAncestors('58225', fetcher)).toEqual(['61548', '24870'])
        expect(asked[0]).toContain('/ols4/api/ontologies/chebi/terms/http%253A%252F%252Fpurl.obolibrary.org%252Fobo%252FCHEBI_58225/ancestors')
    })

    test('a species on the two sides of a membrane does not cancel', () => {
        const c = combineParts([parseRheaEquation('1', 'H(+)(out) = H(+)(in)', ['CHEBI:15378']),
                                parseRheaEquation('2', 'A = B', ['CHEBI:1', 'CHEBI:2'])])
        expect(c.parts[0]!.terms.every(t => t.cancelled === 0)).toBe(true)
        expect(c.net).toHaveLength(4)
    })

    test('struck-through terms typeset', () => {
        const c = combineParts([HK, PGI])
        expect(partLatex(c.parts[0]!.terms).map(t => latexAsSvgString(t)).every(svg => svg.includes('<svg'))).toBe(true)
        expect(latexAsSvgString('\\cancelto{1}{2}\\,\\mathrm{B}')).toContain('<svg')
    })
})

describe('the net equation against the step\'s', () => {
    const step: StepEquation = {
        id: 'Re_HK_PGI', name: 'HK+PGI', kind: 'reaction', regions: ['c'],
        substrates: [{ species: 'Glc', location: 'c', count: 1, node: 'q_Glc' }, { species: 'ATP', location: 'c', count: 1, node: 'q_ATP' }],
        products: [{ species: 'F6P', location: 'c', count: 1, node: 'q_F6P' }, { species: 'ADP', location: 'c', count: 1, node: 'q_ADP' }]
    }
    const chebi: Record<string, string> = { q_Glc: '4167', q_ATP: '30616', q_F6P: '57634', q_ADP: '456216' }
    const net = combineParts([HK, PGI]).net

    test('compared by ChEBI ID, naming what differs', () => {
        expect(netDifferences(net, step, n => chebi[n])).toEqual(['H(+): Rhea makes 1, the step none'])
        const withH = { ...step, products: [...step.products, { species: 'H', location: 'c', count: 1, node: 'q_H' }] }
        expect(netDifferences(net, withH, n => ({ ...chebi, q_H: '15378' })[n])).toEqual([])
    })

    test('not compared while a species of the step has no ChEBI ID', () => {
        expect(netDifferences(net, step, n => n === 'q_F6P' ? undefined : chebi[n])).toBeUndefined()
    })
})
