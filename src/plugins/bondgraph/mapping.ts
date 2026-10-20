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

// A model's variable mapping as a CSV in libcuflynx's format (libcuflynx.reporting.variable_mapping, read by
// cuflynx-methods-latex --mapping), with each variable's bond graph name as one more column: the format bg2cellml
// writes (bgtool --variable-mapping, bg2cellml/variable_mapping.py). Columns:
//
//  variable_name   `main/<CellML name>` (bg2cellml's one component is `main`)
//  latex           the symbol: in bond graph notation (q^{G6P}_{c}) for a variable keeping its bond graph name,
//                  else libcuflynx's default rule for its CellML name (c_{\mathrm{G6P}})
//  kind            state for a store's quantity, else empty (libcuflynx fills it in when it refreshes the file)
//  component       main
//  units           empty (likewise)
//  bondgraph       the bond graph name (q_G6P_c)
//
// Reading a mapping back names each variable whose bond graph name a row has by the row's variable_name.

import {
    bondgraphName, elementNames, type NameOverrides, type NamingElement, type NamingRule, previewNames
} from './naming'

//==============================================================================

export const MAPPING_COLUMNS = ['variable_name', 'latex', 'kind', 'component', 'units', 'bondgraph'] as const
export const COMPONENT = 'main'

export type MappingRow = Record<typeof MAPPING_COLUMNS[number], string>

// libcuflynx.reporting.latex_names: the default rule for a name's symbol
const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
               'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']
const GREEK_UPPER = ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']
const SPECIAL: Record<string, string> = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '_': '\\_', '%': '\\%', '$': '\\$', '#': '\\#', '&': '\\&',
    '^': '\\^{}', '~': '\\~{}'
}

const escape = (text: string) => [...text].map(ch => SPECIAL[ch] ?? ch).join('')

function greek(token: string): string|undefined {
    if (GREEK.includes(token) || GREEK_UPPER.includes(token)) return `\\${token}`
    if (GREEK.includes(token.toLowerCase()) && token[0] !== token[0]!.toLowerCase()) return `\\${token.toLowerCase()}`
    return undefined
}

const token = (t: string) => greek(t) ?? (t.length === 1 ? t : `\\mathrm{${escape(t)}}`)

/** libcuflynx's default symbol for a name: its first part, with the rest as subscripts. */
export function defaultSymbol(name: string): string {
    const tokens = name.split('_').filter(t => t)
    if (tokens.length === 0) return `\\mathrm{${escape(name)}}`
    const [head, ...rest] = tokens as [string, ...string[]]
    const subs: string[] = []
    let headTex: string
    const match = /^([A-Za-z])(\d+)$/.exec(head)
    if (match) {
        headTex = match[1]!
        subs.push(match[2]!)
    } else {
        headTex = token(head)
    }
    subs.push(...rest.map(token))
    return headTex + (subs.length ? `_{${subs.join(',')}}` : '')
}

/**
 * A variable in bond graph notation: a species' as q^{species}_{location}, another element's with its identifier
 * (less a leading repeat of the variable) as a subscript.
 */
export function bondgraphSymbol(variable: string, species: string, location: string, identifier: string): string {
    const parts = variable.split('_').filter(p => p)
    const head = token(parts[0] ?? variable)
    const subs = parts.slice(1).map(token)
    if (species) {
        if (location) subs.push(token(location))
        return `${head}^{${token(species)}}` + (subs.length ? `_{${subs.join(',')}}` : '')
    }
    const first = parts[0]
    const element = first && identifier.startsWith(`${first}_`) && identifier.length > first.length + 1
                  ? identifier.slice(first.length + 1) : identifier
    subs.push(token(element))
    return `${head}_{${subs.join(',')}}`
}

//==============================================================================

/** A row for each element variable, in the order of the elements' identifiers. */
export function mappingRows(elements: NamingElement[], rules: NamingRule[], overrides: NameOverrides): MappingRow[] {
    const names = previewNames(elements, rules, overrides)
    const ofElement = elementNames(elements)
    const ordered = [...elements].sort((a, b) => a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0)
    return ordered.flatMap(e => e.variables.map(variable => {
        const cellml = names.get(`${e.id}|${variable}`)!
        const bondgraph = bondgraphName(e, variable, ofElement.get(e.id))
        return {
            variable_name: `${COMPONENT}/${cellml}`,
            latex: cellml === bondgraph ? bondgraphSymbol(variable, e.species ?? '', e.location ?? '', e.identifier)
                                        : defaultSymbol(cellml),
            kind: variable === e.intrinsic ? 'state' : '',
            component: COMPONENT, units: '', bondgraph
        }
    }))
}

const quoted = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** The rows as CSV text, with a header row. */
export function mappingCsv(rows: MappingRow[]): string {
    return [MAPPING_COLUMNS.join(','), ...rows.map(r => MAPPING_COLUMNS.map(c => quoted(r[c])).join(','))].join('\r\n') + '\r\n'
}

/** CSV text as records (quoted fields, "" inside quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
    const records: string[][] = []
    let record: string[] = [], field = '', quoting = false
    const body = text.replace(/^﻿/, '')
    for (let k = 0; k < body.length; k++) {
        const ch = body[k]!
        if (quoting) {
            if (ch === '"' && body[k + 1] === '"') { field += '"'; k++ }
            else if (ch === '"') quoting = false
            else field += ch
        } else if (ch === '"') quoting = true
        else if (ch === ',') { record.push(field); field = '' }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && body[k + 1] === '\n') k++
            record.push(field); records.push(record); record = []; field = ''
        } else field += ch
    }
    if (field !== '' || record.length) { record.push(field); records.push(record) }
    return records.filter(r => r.some(f => f.trim() !== ''))
}

export class MappingError extends Error {}

/**
 * The names a mapping's rows give, as overrides on top of `overrides`: a row whose `bondgraph` names an element
 * variable names it by its variable_name (the part after the component), when the rules don't already. Returns
 * the overrides and how many rows named a variable and how many named none of the model's.
 */
export function readMapping(text: string, elements: NamingElement[], rules: NamingRule[], overrides: NameOverrides):
        { overrides: NameOverrides, matched: number, unmatched: number } {
    const [header, ...records] = parseCsv(text)
    const column = (name: string) => (header ?? []).map(h => h.trim()).indexOf(name)
    const nameAt = column('variable_name'), bondgraphAt = column('bondgraph')
    if (nameAt < 0 || bondgraphAt < 0) throw new MappingError('A variable mapping needs variable_name and bondgraph columns')
    const ofElement = elementNames(elements)
    const byBondgraph = new Map<string, string>()
    for (const e of elements) {
        for (const v of e.variables) byBondgraph.set(bondgraphName(e, v, ofElement.get(e.id)), `${e.id}|${v}`)
    }
    const next = new Map(overrides)
    let matched = 0, unmatched = 0
    for (const record of records) {
        const bondgraph = (record[bondgraphAt] ?? '').trim()
        const key = byBondgraph.get(bondgraph)
        const name = (record[nameAt] ?? '').trim().split('/').pop() ?? ''
        if (!bondgraph) continue
        if (!key || !name) { unmatched++; continue }
        matched++
        next.delete(key)
        if (previewNames(elements, rules, next).get(key) !== name) next.set(key, name)
    }
    return { overrides: next, matched, unmatched }
}
