/** biome-ignore-all lint/style/noNonNullAssertion: <the parts exist> */
import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { latexAsSvgString } from '../../src/mathjax'
import type { StepEquation } from '../../src/plugins/bondgraph/equations'
import {
    combineParts, fetchAncestors, fetchRhea, leastSquares, netLatex, orientPart, parseRheaEquation, partLatex,
    relatedBy, type RheaReaction, simpleFraction, type StepTerm, stepTerms, verifyReaction
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

// the module library's Rhea cache (cam_testing/data/rhea), in Rhea's REST form, with the ChEBI ancestors it holds
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'rhea-energy-metabolism.json'), 'utf8')) as {
    reactions: Record<string, { equation: string, chebis: string[] }>, ancestors: Record<string, string[]>
}
const rhea = (id: string): RheaReaction => parseRheaEquation(id, FIXTURE.reactions[id]!.equation, FIXTURE.reactions[id]!.chebis)
const related = relatedBy(new Map(Object.entries(FIXTURE.ancestors)))

const CHEBI: Record<string, string> = {
    Glc: '4167', ATP: '30616', H2O: '15377', G6P: '61548', ADP: '456216', Pi: '43474', H: '15378', ADPglc: '57498',
    glyc: '15444', lac: '16651', Na: '29101', K: '29103'
}
// a step's participants: species, signed count (used negative), compartment c unless given
const terms = (...entries: [string, number, string?][]): StepTerm[] =>
    entries.map(([name, count, location]) => ({ chebi: CHEBI[name], location: location ?? 'c', count, name }))

describe('a step against Rhea, as the module library compares them', () => {
    test('a lumped step by its net equation: a futile cycle', () => {
        const v = verifyReaction([rhea('17825'), rhea('16689')], terms(['ATP', -1], ['H2O', -1], ['ADP', 1], ['Pi', 1], ['H', 1]))
        expect(v?.status).toBe('match')
        expect(v?.multipliers).toEqual([1, 1])
    })

    test('a part taken more than once, and one ADP too many', () => {
        const step = terms(['Glc', -1], ['ATP', -2], ['H2O', -1], ['G6P', 1], ['ADP', 2], ['Pi', 1], ['H', 2])
        const v = verifyReaction([rhea('17825'), rhea('16689')], step)
        expect(v?.status).toBe('match')
        expect(v?.multipliers).toEqual([2, 1])
        step[4]!.count = 3
        expect(verifyReaction([rhea('17825'), rhea('16689')], step)?.status).toBe('differs')
    })

    test('a polymer counts the units it gains', () => {
        expect(verifyReaction([rhea('18189')], terms(['ADPglc', -1], ['glyc', 1], ['ADP', 1], ['H', 1]))?.status).toBe('match')
        expect(combineParts([rhea('41732')]).parts[0]!.terms.every(t => t.cancelled === 0)).toBe(true)
    })

    test('a species written more specifically than Rhea\'s matches by ChEBI is_a', () => {
        const step: StepTerm[] = [...terms(['Glc', -1], ['ATP', -1], ['ADP', 1], ['H', 1]),
                                  { chebi: '99999', location: 'c', count: 1, name: 'G6Pa' }]
        const v = verifyReaction([rhea('17825')], step, relatedBy(new Map([['99999', ['61548']]])))
        expect(v?.status).toBe('match')
        expect(v?.notes[0]).toContain('by ChEBI is_a')
        expect(verifyReaction([rhea('17825')], step)?.status).toBe('differs')
    })

    test('a transport reads Rhea\'s in and out as the step\'s compartments', () => {
        const nka = parseRheaEquation('18353', '2 K(+)(out) + 3 Na(+)(in) + ATP + H2O = 2 K(+)(in) + 3 Na(+)(out) + ADP + phosphate + H(+)',
            ['CHEBI:29103', 'CHEBI:29101', 'CHEBI:30616', 'CHEBI:15377', 'CHEBI:456216', 'CHEBI:43474', 'CHEBI:15378'])
        const step = terms(['Na', -3, 'c'], ['K', -2, 'e'], ['ATP', -1], ['H2O', -1], ['Na', 3, 'e'], ['K', 2, 'c'],
                           ['ADP', 1], ['Pi', 1], ['H', 1])
        expect(verifyReaction([nka], step)?.status).toBe('match')
        const backwards = step.map(t => t.name === 'K' ? { ...t, location: t.location === 'c' ? 'e' : 'c' } : t)
        expect(verifyReaction([nka], backwards)?.status).toBe('differs')
    })

    test('a reaction of protons alone compares them strictly', () => {
        const leak = parseRheaEquation('34979', 'H(+)(in) = H(+)(out)', ['CHEBI:15378'])
        expect(verifyReaction([leak], terms(['H', -1, 'c'], ['H', 1, 'm']))?.status).toBe('match')
        expect(verifyReaction([leak], terms(['H', -2, 'c'], ['H', 1, 'm']))?.status).toBe('differs')
    })

    test('a difference only in H+ or H2O is a warning', () => {
        const v = verifyReaction([rhea('17825')], terms(['Glc', -1], ['ATP', -1], ['G6P', 1], ['ADP', 1]))
        expect(v).toMatchObject({ status: 'warn', text: 'matches (as written) but for H+ (c): 0 where Rhea has 1' })
    })

    test('not compared while a species of the step has no ChEBI ID', () => {
        const step: StepEquation = {
            id: 'Re_HK', name: 'HK', kind: 'reaction', regions: ['c'],
            substrates: [{ species: 'Glc', location: 'c', count: 1, node: 'q_Glc' }], products: []
        }
        expect(verifyReaction([rhea('17825')], stepTerms(step, () => undefined))).toBeUndefined()
        expect(stepTerms(step, () => '4167')).toEqual([{ chebi: '4167', location: 'c', count: -1, name: 'Glc' }])
    })
})

describe('energy_metabolism adaptive_ArgusUNPUBLISHED_v01, as its bondgraph_reactions_test reports it', () => {
    const LG = ['11816', '16109', '14729', '18585', '10300', '14801', '15901', '10164', '18157', '23444']

    test('Re_LG, glucose 6-phosphate to lactate: matches but for H+ and H2O', () => {
        const v = verifyReaction(LG.map(rhea), terms(['G6P', -1], ['ADP', -3], ['Pi', -2], ['lac', 2], ['ATP', 3]), related)
        expect(v).toMatchObject({ status: 'warn', text: 'matches (as written) but for H2O (c): 0 where Rhea has 2; H+ (c): 0 where Rhea has 1' })
        // triose-phosphate isomerase, phosphoglycerate kinase and mutase, pyruvate kinase and lactate dehydrogenase
        // run backwards, and everything after aldolase twice
        expect(v?.multipliers).toEqual([1, 1, 1, -1, 2, -2, -2, 2, -2, -2])
        expect(v?.notes).toEqual(['G6P (CHEBI:61548) for Rhea\'s alpha-D-glucose 6-phosphate (CHEBI:58225), by ChEBI is_a'])
    })

    test('Re_MOB, glycogen to glucose 6-phosphate: matches', () => {
        const v = verifyReaction(['41732', '23536'].map(rhea), terms(['glyc', -1], ['Pi', -1], ['G6P', 1]), related)
        expect(v).toMatchObject({ status: 'match', text: 'matches (as written)', multipliers: [1, 1] })
    })

    test('Re_STORE, glucose 6-phosphate to glycogen: matches but for H+ and H2O', () => {
        const v = verifyReaction(['24576', '18189', '12120', '23536'].map(rhea),
                                 terms(['G6P', -1], ['ATP', -1], ['glyc', 1], ['ADP', 1], ['Pi', 2]), related)
        expect(v).toMatchObject({ status: 'warn', text: 'matches (as written) but for H2O (c): 0 where Rhea has 1; H+ (c): 0 where Rhea has 1' })
        expect(v?.multipliers).toEqual([1, 1, 1, -1])
    })

    test('the parts are drawn as the step uses them, so what cancels is struck through', () => {
        const parts = LG.map(rhea)
        const v = verifyReaction(parts, terms(['G6P', -1], ['ADP', -3], ['Pi', -2], ['lac', 2], ['ATP', 3]), related)!
        const c = combineParts(parts.map((r, i) => orientPart(r, v.multipliers[i]!)), related)
        // lactate is made, and nothing else is left but what the step has, with H+ and H2O
        expect(c.net.filter(p => p.side === 'R').map(p => `${p.count} ${p.name}`).sort()).toEqual(['2 (S)-lactate', '2 H2O', '3 ATP'])
        expect(c.net.filter(p => p.side === 'L').map(p => `${p.count} ${p.name}`).sort())
            .toEqual(['1 H(+)', '1 alpha-D-glucose 6-phosphate', '2 phosphate', '3 ADP'])
        expect(c.parts.flatMap(p => p.terms).filter(t => t.cancelled > 0).length).toBeGreaterThan(10)
    })
})

describe('counts as fractions', () => {
    test('a multiplier is rounded as the module library rounds it; a sum of them is shown exactly', () => {
        expect(simpleFraction(0.3334)).toEqual([1, 3])
        expect(simpleFraction(1 / 9 + 5 / 8 - 0.7, 27720)[0]).not.toBe(0)
        const parts = [parseRheaEquation('1', 'A = B', ['CHEBI:1', 'CHEBI:2'])]
        expect(netLatex(combineParts([orientPart(parts[0]!, 1 / 11 - 1 / 12)]).net).join(' ')).toContain('\\tfrac{1}{132}')
    })
})

describe('least squares', () => {
    test('the smallest-norm solution, as numpy gives it', () => {
        expect(leastSquares([[1, 0], [0, 1], [1, 1]], [1, 2, 3]).map(x => +x.toFixed(9))).toEqual([1, 2])
        // two equal columns: the solution shares between them
        expect(leastSquares([[1, 1], [2, 2]], [2, 4]).map(x => +x.toFixed(9))).toEqual([1, 1])
    })
})
