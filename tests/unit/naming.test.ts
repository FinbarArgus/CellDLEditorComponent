/** biome-ignore-all lint/style/noNonNullAssertion: <the presets exist> */
import { describe, expect, test } from 'bun:test'

import {
    bondgraphName, matchingPreset, NAMING_PRESETS, type NamingElement, previewNames, renderName, validName
} from '../../src/plugins/bondgraph/naming'

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const CHEM = `${BGF}Chemical`

// tests/models/chemostat_named.ttl in BG-Tools, whose CellML names bg2cellml's tests check
const elements: NamingElement[] = [
    { id: 'm#Se_A_1', identifier: 'Se_A_1', elementClass: `${BGF}PotentialSource`, domain: CHEM, label: 'Se', species: 'A', location: 'c', variables: ['v', 'u'] },
    { id: 'm#Se_A_2', identifier: 'Se_A_2', elementClass: `${BGF}PotentialSource`, domain: CHEM, label: 'Se', species: 'A', location: 'c', variables: ['v', 'u'] },
    { id: 'm#Re_1', identifier: 'Re_1', elementClass: `${BGF}Reaction`, domain: CHEM, variables: ['v', 'u_f', 'u_r', 'kappa'] },
    { id: 'm#Re_2', identifier: 'Re_2', elementClass: `${BGF}Reaction`, domain: CHEM, variables: ['v', 'u_f', 'u_r', 'kappa'] },
    { id: 'm#q_B', identifier: 'q_B', elementClass: `${BGF}QuantityStore`, domain: CHEM, species: 'B', location: 'c', variables: ['v', 'u', 'K', 'q'], intrinsic: 'q' },
]
const rules = [
    { elementClass: `${BGF}QuantityStore`, variable: 'q', pattern: 'n_{species}_{location}' },
    { elementClass: `${BGF}QuantityStore`, variable: 'u', pattern: 'mu_{species}_{location}' },
    { elementClass: `${BGF}PotentialSource`, variable: 'u', pattern: 'mu_{species}_{location}' },
    { elementClass: `${BGF}PotentialSource`, variable: 'v', pattern: 'J_{species}_{location}' },
    { elementClass: `${BGF}Reaction`, variable: 'v', pattern: 'v_{name}' },
    { variable: 'kappa', pattern: 'k_{name}' },
    { elementClass: `${BGF}QuantityStore`, domain: `${BGF}Electrical`, variable: 'K', pattern: 'never_{name}' },
    { domain: CHEM, variable: 'K', pattern: 'Kd_{species}' },
    { elementClass: `${BGF}QuantityStore`, domain: CHEM, variable: 'v', pattern: 'dndt_{species}' },
    { elementClass: `${BGF}QuantityStore`, variable: 'v', pattern: 'not_this_{species}' },
]

describe('variable names', () => {
    test('names are made valid as bg2cellml makes them', () => {
        expect(validName('mu_H+_c', 'u')).toBe('mu_H_c')
        expect(validName('3PG_c', 'q')).toBe('q_3PG_c')
        expect(validName('__n__G6P__', 'q')).toBe('n_G6P')
        expect(validName('', 'v')).toBe('v')
        expect(renderName('{var}_{name}_{location}', { var: 'q', element: 'q_G6P_c', label: 'q', species: 'G6P', location: '', name: 'G6P' }))
            .toBe('q_G6P')
    })

    test('the preview gives bg2cellml\'s names for chemostat_named.ttl', () => {
        const names = previewNames(elements, rules, new Map([['m#Re_2|v', 'v_second']]))
        expect(Object.fromEntries(names)).toMatchObject({
            'm#q_B|q': 'n_B_c', 'm#q_B|u': 'mu_B_c', 'm#q_B|K': 'Kd_B', 'm#q_B|v': 'dndt_B',
            'm#Se_A_1|u': 'mu_A_c', 'm#Se_A_2|u': 'mu_A_c_2', 'm#Se_A_1|v': 'J_A_c', 'm#Se_A_2|v': 'J_A_c_2',
            'm#Re_1|v': 'v_Re_1', 'm#Re_2|v': 'v_second', 'm#Re_1|kappa': 'k_Re_1', 'm#Re_2|kappa': 'k_Re_2',
        })
    })

    test('without rules, a variable has its bond graph name', () => {
        const names = previewNames(elements, [], new Map())
        expect(names.get('m#q_B|q')).toBe(bondgraphName(elements[4]!, 'q'))
        expect(names.get('m#q_B|q')).toBe('q_B_B_c')
        expect(names.get('m#Re_1|kappa')).toBe('kappa_Re_1')
    })

    test('a preset is recognised in its rules, whatever their order', () => {
        const chemistry = NAMING_PRESETS.find(p => p.id === 'chemistry')!
        expect(matchingPreset([...chemistry.rules].reverse())?.id).toBe('chemistry')
        expect(matchingPreset([])?.id).toBe('bondgraph')
        expect(matchingPreset(rules)).toBeUndefined()
    })

    test('the chemistry preset names stores, chemostats and reactions in their own terms', () => {
        const chemistry = NAMING_PRESETS.find(p => p.id === 'chemistry')!
        const names = previewNames(elements, chemistry.rules, new Map())
        expect(names.get('m#q_B|q')).toBe('n_B_c')
        expect(names.get('m#q_B|v')).toBe('dndt_B_c')
        expect(names.get('m#Re_1|u_f')).toBe('A_f_Re_1')
        expect(names.get('m#Se_A_1|v')).toBe('J_A_c')
    })

    test('a preset for one domain leaves another domain\'s elements their bond graph names', () => {
        const capacitor: NamingElement = { id: 'm#C_m', identifier: 'C_m', elementClass: `${BGF}QuantityStore`,
                                           domain: `${BGF}Electrical`, label: 'C', location: 'm',
                                           variables: ['v', 'u', 'C', 'q'], intrinsic: 'q' }
        const chemistry = NAMING_PRESETS.find(p => p.id === 'chemistry')!
        const names = previewNames([...elements, capacitor], chemistry.rules, new Map())
        expect(names.get('m#C_m|q')).toBe('C_m')
        expect(names.get('m#C_m|u')).toBe('u_C_m')
        const circuit = NAMING_PRESETS.find(p => p.id === 'circuit')!
        expect(previewNames([capacitor], circuit.rules, new Map()).get('m#C_m|u')).toBe('p_C_m')
    })
})
