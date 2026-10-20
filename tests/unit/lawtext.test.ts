/** biome-ignore-all lint/style/noNonNullAssertion: <the templates exist> */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DOMParser } from '@xmldom/xmldom'

import {
    type MathNode, mathmlEquations, mathmlLatex, sumLatex, sumText, symbolLatex, whereLatex, whereText
} from '../../src/plugins/bondgraph/lawtext'

const TEMPLATES = join(import.meta.dir, '..', '..', 'BG-RDF', 'templates')

// a template's constitutive relation, from its Turtle
function relation(file: string, template: string): MathNode {
    const text = readFileSync(join(TEMPLATES, file), 'utf8')
    const start = text.indexOf(`\n${template}\n`)
    const math = text.slice(start).match(/bgf:constitutiveRelation\s+"""([\s\S]*?)"""/)![1]!
    return new DOMParser().parseFromString(math.trim(), 'text/xml').documentElement as unknown as MathNode
}

describe('constitutive laws as LaTeX', () => {
    test('symbols: Greek letters, subscripts, multi-letter names', () => {
        expect(symbolLatex('kappa')).toBe('\\kappa')
        expect(symbolLatex('u_f')).toBe('u_{f}')
        expect(symbolLatex('k_sat')).toBe('k_{\\mathrm{sat}}')
        expect(symbolLatex('RT')).toBe('RT')
    })

    test('mass action', () => {
        expect(mathmlLatex(relation('chemical.ttl', 'bgf:ChemicalReaction')))
            .toBe('v = \\kappa\\,\\left(e^{\\frac{u_{f}}{RT}} - e^{\\frac{u_{r}}{RT}}\\right)')
    })

    test('the saturating reaction and store', () => {
        const reaction = mathmlLatex(relation('chemical.ttl', 'bgf:SaturatingChemicalReaction'))
        expect(reaction.startsWith('v = \\frac{')).toBe(true)
        expect(reaction).toContain('\\sigma')
        expect(mathmlLatex(relation('chemical.ttl', 'bgf:SaturatingChemicalConcentration'))).toContain('k_{\\mathrm{sat}}')
    })

    test('the ideal store', () => {
        expect(mathmlEquations(relation('chemical.ttl', 'bgf:ChemicalConcentration')))
            .toEqual(['\\frac{dq}{dt} = v', 'u = RT\\,\\ln\\left(K\\,q\\right)'])
    })

    test('sums of bonded variables, with counts and signs', () => {
        expect(sumText([{ sign: 1, count: 2, name: 'mu_ADP_c' }, { sign: 1, count: 1, name: 'mu_Pi_c' }]))
            .toBe('2·mu_ADP_c + mu_Pi_c')
        expect(sumText([{ sign: -1, count: 1, name: 'v_HK' }, { sign: 1, count: 3, name: 'v_PK' }])).toBe('−v_HK + 3·v_PK')
        expect(sumText([{ sign: 1, count: -48242.666, name: 'u_C_m' }])).toBe('−48242.7·u_C_m')
        expect(sumText([])).toBe('0')
        expect(whereText([{ symbol: 'u_f', name: 'A_f_HK', is: [{ sign: 1, count: 1, name: 'mu_Glc_c' }] },
                          { symbol: 'kappa', name: 'kappa_HK' }]))
            .toEqual(['u_f = A_f_HK = mu_Glc_c', 'kappa = kappa_HK'])
    })

    test('the hover\'s lines typeset as the law is, in math rather than text', () => {
        expect(sumLatex([{ sign: 1, count: 2, name: 'mu_ADP_c' }, { sign: 1, count: 1, name: 'mu_Pi_c' }]))
            .toBe('2\\,\\mu_{\\mathrm{ADP\\_c}} + \\mu_{\\mathrm{Pi\\_c}}')
        expect(sumLatex([{ sign: -1, count: 1, name: 'v_HK' }, { sign: 1, count: -48242.666, name: 'u_C_m' }]))
            .toBe('-v_{\\mathrm{HK}} - 48242.7\\,u_{\\mathrm{C\\_m}}')
        expect(sumLatex([])).toBe('0')
        expect(whereLatex([{ symbol: 'u_f', name: 'A_f_HK', is: [{ sign: 1, count: 1, name: 'mu_Glc_c' }] },
                           { symbol: 'kappa', name: 'kappa_HK' }]))
            .toEqual(['u_{f} = A_{\\mathrm{f\\_HK}} = \\mu_{\\mathrm{Glc\\_c}}', '\\kappa = \\kappa_{\\mathrm{HK}}'])
    })
})
