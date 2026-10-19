import { describe, expect, test } from 'bun:test'

import {
    type BondInfo, equationText, FARADAY, findSpeciesNode, type NodeInfo, parseEquation, planEquationEdit, stepEquation
} from '../../src/plugins/bondgraph/equations'

const nodes = (entries: [string, NodeInfo][]) => new Map<string, NodeInfo>(entries)

describe('reaction equations from bonds', () => {
    test('a reaction lists what is bonded into it, then what it bonds to, with bond counts', () => {
        const bonds: BondInfo[] = [
            { source: 'q_ADP', target: 'Re_ATPase', count: 2 },
            { source: 'q_Pi', target: 'Re_ATPase', count: 1 },
            { source: 'Re_ATPase', target: 'q_ATP', count: 1 },
        ]
        const eq = stepEquation('Re_ATPase', false, bonds, nodes([
            ['Re_ATPase', { species: 'ATP synthase' }],
            ['q_ADP', { species: 'ADP', location: 'm' }],
            ['q_Pi', { species: 'Pi', location: 'm' }],
            ['q_ATP', { species: 'ATP', location: 'm' }],
        ]))
        expect(eq.kind).toBe('reaction')
        expect(eq.name).toBe('ATP synthase')
        expect(equationText(eq)).toBe('2 ADP[m] + Pi[m] ⇌ ATP[m]')
    })

    test('moving a species unchanged between compartments is transport, with a two-sided arrow', () => {
        const bonds: BondInfo[] = [
            { source: 'q_Pyr_c', target: 'Re_MPC', count: 1 },
            { source: 'Re_MPC', target: 'q_Pyr_m', count: 1 },
        ]
        const eq = stepEquation('Re_MPC', false, bonds, nodes([
            ['q_Pyr_c', { species: 'Pyr', location: 'c' }],
            ['q_Pyr_m', { species: 'Pyr', location: 'm' }],
        ]))
        expect(eq.kind).toBe('transport')
        expect(equationText(eq)).toBe('Pyr[c] ⇄ Pyr[m]')
    })

    test('a resistance is a flow down a potential difference, with a two-sided arrow', () => {
        const bonds: BondInfo[] = [
            { source: 'q_O2_a', target: 'R_diff', count: 1 },
            { source: 'R_diff', target: 'q_O2_t', count: 1 },
        ]
        const eq = stepEquation('R_diff', true, bonds, nodes([
            ['q_O2_a', { species: 'O2', location: 'a' }],
            ['q_O2_t', { species: 'O2', location: 't' }],
        ]))
        expect(eq.kind).toBe('flow')
        expect(equationText(eq)).toBe('O2[a] ⇄ O2[t]')
    })

    test('a changed species across compartments is a reaction, not transport', () => {
        const bonds: BondInfo[] = [
            { source: 'q_A', target: 'Re', count: 1 },
            { source: 'Re', target: 'q_B', count: 1 },
        ]
        const eq = stepEquation('Re', false, bonds, nodes([
            ['q_A', { species: 'A', location: 'c' }], ['q_B', { species: 'B', location: 'm' }],
        ]))
        expect(eq.kind).toBe('reaction')
    })

    test('the charge an electrogenic step moves comes from its forward transformer', () => {
        // ANT: ATP4-[m] + ADP3-[c] -> ATP4-[c] + ADP3-[m], one negative charge out of the matrix (q = -1)
        const bonds: BondInfo[] = [
            { source: 'q_ATP_m', target: 'Re_ANT', count: 1 },
            { source: 'q_ADP_c', target: 'Re_ANT', count: 1 },
            { source: 'Re_ANT', target: 'q_ATP_c', count: 1 },
            { source: 'Re_ANT', target: 'q_ADP_m', count: 1 },
            { source: 'C_m', target: 'TF_f', count: 1 },
            { source: 'TF_f', target: 'Re_ANT', count: 1 },
            { source: 'Re_ANT', target: 'TF_r', count: 1 },
            { source: 'TF_r', target: 'C_m', count: 1 },
        ]
        const eq = stepEquation('Re_ANT', false, bonds, nodes([
            ['q_ATP_m', { species: 'ATP', location: 'm' }], ['q_ADP_c', { species: 'ADP', location: 'c' }],
            ['q_ATP_c', { species: 'ATP', location: 'c' }], ['q_ADP_m', { species: 'ADP', location: 'm' }],
            ['C_m', { location: 'm' }],
            ['TF_f', { transformRatio: FARADAY / 2 }], ['TF_r', { transformRatio: -2 / FARADAY }],
        ]))
        expect(eq.substrates.map(p => p.species)).toEqual(['ATP', 'ADP'])
        expect(eq.kind).toBe('transport')
        expect(eq.charge).toEqual({ count: -1, location: 'm' })
        expect(equationText(eq)).toBe('ATP[m] + ADP[c] ⇄ ATP[c] + ADP[m]   (moves 1 charge out of [m])')
    })
})

describe('editing an equation', () => {
    test('coefficients need a space, so names may start with a digit or end in +', () => {
        const eq = parseEquation('2 3PG[c] + NAD+[c] <=> 13BPG[c] + H+[c]')
        expect(eq.substrates).toEqual([{ species: '3PG', location: 'c', count: 2 },
                                       { species: 'NAD+', location: 'c', count: 1 }])
        expect(eq.products).toEqual([{ species: '13BPG', location: 'c', count: 1 },
                                     { species: 'H+', location: 'c', count: 1 }])
    })

    test('a shown equation parses back, its charge note and arrow included', () => {
        const eq = parseEquation('ATP[m] + ADP[c] ⇄ ATP[c] + ADP[m]   (moves 1 charge out of [m])')
        expect(eq.products.map(p => `${p.species}[${p.location}]`)).toEqual(['ATP[c]', 'ADP[m]'])
    })

    test('repeated species add up, and bad equations are refused', () => {
        expect(parseEquation('A + A -> B').substrates).toEqual([{ species: 'A', location: undefined, count: 2 }])
        expect(() => parseEquation('A + B')).toThrow(/one arrow/)
        expect(() => parseEquation('0 A -> B')).toThrow(/at least 1/)
        expect(() => parseEquation('2 A[c -> B')).toThrow(/not a species/)
    })

    test('the plan keeps matching bonds, changes counts, removes and adds the rest', () => {
        const bonds: BondInfo[] = [
            { id: 'b1', source: 'q_ADP', target: 'Re', count: 1 },
            { id: 'b2', source: 'q_Pi', target: 'Re', count: 1 },
            { id: 'b3', source: 'Re', target: 'q_ATP', count: 1 },
        ]
        const current = stepEquation('Re', false, bonds, new Map<string, NodeInfo>([
            ['q_ADP', { species: 'ADP', location: 'm' }], ['q_Pi', { species: 'Pi', location: 'm' }],
            ['q_ATP', { species: 'ATP', location: 'm' }],
        ]))
        expect(planEquationEdit(current, parseEquation('2 ADP[m] <=> ATP[m] + H2O[m]'))).toEqual([
            { op: 'count', bond: 'b1', count: 2 },
            { op: 'remove', bond: 'b2', node: 'q_Pi' },
            { op: 'add', side: 'product', species: 'H2O', location: 'm', count: 1 },
        ])
        // an unchanged equation, and one without locations, changes nothing
        expect(planEquationEdit(current, parseEquation(equationText(current)))).toEqual([])
        expect(planEquationEdit(current, parseEquation('ADP + Pi -> ATP'))).toEqual([])
        // moving a species to the other side is a removal and an addition
        expect(planEquationEdit(current, parseEquation('ADP[m] -> ATP[m] + Pi[m]')).map(e => e.op))
            .toEqual(['remove', 'add'])
    })

    test('a new participant joins its store, else a source; an unplaced species is ambiguous', () => {
        const nodes = [
            { id: 'Se_Pi', species: 'Pi', location: 'c', isSource: true },
            { id: 'q_Pi', species: 'Pi', location: 'c', isSource: false },
            { id: 'q_ATP_c', species: 'ATP', location: 'c', isSource: false },
            { id: 'q_ATP_m', species: 'ATP', location: 'm', isSource: false },
            { id: 'Se_H2O', species: 'H2O', location: 'c', isSource: true },
        ]
        expect(findSpeciesNode(nodes, 'Pi')?.id).toBe('q_Pi')
        expect(findSpeciesNode(nodes, 'H2O', 'c')?.id).toBe('Se_H2O')
        expect(findSpeciesNode(nodes, 'ATP', 'm')?.id).toBe('q_ATP_m')
        expect(findSpeciesNode(nodes, 'Glc', 'c')).toBeUndefined()
        expect(() => findSpeciesNode(nodes, 'ATP')).toThrow(/more than one compartment \(c, m\)/)
    })
})
