/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
    bondgraphSymbol, defaultSymbol, MAPPING_COLUMNS, mappingCsv, mappingRows, parseCsv, readMapping
} from '../../src/plugins/bondgraph/mapping'
import { type NamingElement, previewNames } from '../../src/plugins/bondgraph/naming'

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const CHEM = `${BGF}Chemical`

// tests/models/chemostat_named.ttl in BG-Tools (as in naming.test.ts)
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
const overrides = new Map([['m#Re_2|v', 'v_second']])

// bgtool's mapping of the same model (bg2cellml/variable_mapping.py), every CellML variable
const bg2cellml = readFileSync(`${import.meta.dir}/fixtures/chemostat_named_variable_mapping.csv`, 'utf8')

describe('variable mapping', () => {
    test('symbols follow libcuflynx\'s default rule', () => {
        // libcuflynx.reporting.latex_names.symbol of each name
        const expected: Record<string, string> = {
            n_B_c: 'n_{B,c}', mu_A_c_2: '\\mu_{A,c,2}', kappa_Re_1: '\\kappa_{\\mathrm{Re},1}', V0: 'V_{0}',
            Delta_G: '\\Delta_{G}', Alpha_x: '\\alpha_{x}', g_leak_Na: 'g_{\\mathrm{leak},\\mathrm{Na}}', K_d: 'K_{d}',
            c_G6P: 'c_{\\mathrm{G6P}}', x__y: 'x_{y}', 'a_{b}': 'a_{\\mathrm{\\{b\\}}}'
        }
        for (const [name, latex] of Object.entries(expected)) expect(defaultSymbol(name)).toBe(latex)
    })

    test('a variable keeping its bond graph name is in bond graph notation, as bg2cellml writes it', () => {
        expect(bondgraphSymbol('q', 'G6P', 'c', 'q_G6P_c')).toBe('q^{\\mathrm{G6P}}_{c}')
        expect(bondgraphSymbol('u', 'A', 'c', 'Se_A_1')).toBe('u^{A}_{c}')
        expect(bondgraphSymbol('v', '', '', 'Re_HK')).toBe('v_{\\mathrm{Re\\_HK}}')
        expect(bondgraphSymbol('q', '', '', 'q_B')).toBe('q_{B}')
        expect(bondgraphSymbol('u_f', '', '', 'Re_1')).toBe('u_{f,\\mathrm{Re\\_1}}')
        expect(bondgraphSymbol('kappa', '', '', 'Re_2')).toBe('\\kappa_{\\mathrm{Re\\_2}}')
    })

    test('the mapping has libcuflynx\'s columns, and its rows are bg2cellml\'s', () => {
        const csv = mappingCsv(mappingRows(elements, rules, overrides))
        const [header, ...records] = parseCsv(csv)
        expect(header).toEqual([...MAPPING_COLUMNS])
        const [theirHeader, ...theirs] = parseCsv(bg2cellml)
        expect(theirHeader).toEqual([...MAPPING_COLUMNS])
        const at = (h: string[], c: string) => h.indexOf(c)
        const byName = new Map(theirs.map(r => [r[0]!, r]))
        expect(records.length).toBe(theirs.filter(r => r[at(theirHeader!, 'bondgraph')]).length)
        for (const record of records) {
            const theirsRow = byName.get(record[0]!)!
            expect(theirsRow).toBeDefined()
            for (const column of ['latex', 'component', 'bondgraph']) {
                expect(record[at(header!, column)]).toBe(theirsRow[at(theirHeader!, column)]!)
            }
            // a store's quantity is a state; other kinds and the units are left for libcuflynx to fill in
            if (record[at(header!, 'kind')]) expect(record[at(header!, 'kind')]).toBe(theirsRow[at(theirHeader!, 'kind')]!)
        }
        expect(records.find(r => r[0] === 'main/n_B_c')![at(header!, 'kind')]).toBe('state')
    })

    test('a symbol with a comma is quoted, and reads back', () => {
        const csv = mappingCsv(mappingRows(elements, rules, overrides))
        expect(csv).toContain('"n_{B,c}"')
        const records = parseCsv(`${csv}`)
        expect(records.find(r => r[0] === 'main/n_B_c')![1]).toBe('n_{B,c}')
        expect(parseCsv('a,"b ""c"", d"\r\n\r\n1,2\n')).toEqual([['a', 'b "c", d'], ['1', '2']])
    })

    test('a mapping read back names the variables its rows rename, and only those', () => {
        const csv = mappingCsv(mappingRows(elements, rules, overrides))
        // unchanged: no new names
        const same = readMapping(csv, elements, rules, overrides)
        expect([...same.overrides]).toEqual([...overrides])
        expect(same.matched).toBe(16)
        // renamed in the file (a spreadsheet, or libcuflynx's mapping with the column): those names are given
        const edited = csv.replace('main/u_f_Re_1,', 'main/mu_forward_1,').replace('main/v_second,', 'main/v_Re_2,')
                          + 'main/t,t,time,main,second,\r\nmain/x,x,state,main,,q_gone\r\n'
        const read = readMapping(edited, elements, rules, overrides)
        expect(read.overrides.get('m#Re_1|u_f')).toBe('mu_forward_1')
        expect(read.overrides.has('m#Re_2|v')).toBe(false)             // the rule names it so
        expect(previewNames(elements, rules, read.overrides).get('m#Re_2|v')).toBe('v_Re_2')
        expect(read.unmatched).toBe(1)                                // q_gone; time isn't a bond graph variable
        expect(() => readMapping('variable_name,latex\r\nmain/x,x\r\n', elements, rules, overrides)).toThrow()
    })
})
