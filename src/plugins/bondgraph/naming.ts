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

// Names for a model's variables in the CellML bg2cellml writes (BG-RDF's bgf:NamingRule and bgf:VariableName,
// applied by bg2cellml/variable_names.py, whose rules this mirrors for the Variables panel's preview).
//
// A rule names one variable (q, u, v, u_f, K, kappa, ...) of one class of element (all classes when it has none) in
// one physical domain (all domains when it has none) by a pattern with {species}, {location}, {name} (the species,
// else the element's identifier), {element} (the bond graph's name for the element), {label} (its symbol) and
// {var}; an element's explicit name for a variable wins over rules. A name keeps letters, digits and _, drops repeated and surrounding _, starts with {var}_ when it
// would start with a digit, and gets _2, _3, ... when taken (elements in the order of their identifiers). Of the
// rules for a variable, the one for the element's class and domain wins, then its class, then its domain.

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// the classes of element a rule can be for, as the panel names them
export const ELEMENT_CLASSES: { uri: string, label: string }[] = [
    { uri: `${BGF}QuantityStore`, label: 'Store' },
    { uri: `${BGF}Reaction`, label: 'Reaction' },
    { uri: `${BGF}PotentialSource`, label: 'Potential source (chemostat)' },
    { uri: `${BGF}FlowSource`, label: 'Flow source' },
    { uri: `${BGF}Resistance`, label: 'Resistance' },
    { uri: `${BGF}FlowStore`, label: 'Flow store (inertance)' }
]

export const DOMAINS: { uri: string, label: string }[] = [
    { uri: `${BGF}Chemical`, label: 'chemical' },
    { uri: `${BGF}Electrical`, label: 'electrical' },
    { uri: `${BGF}Hydraulic`, label: 'hydraulic' },
    { uri: `${BGF}Mechanical`, label: 'mechanical' }
]

export interface NamingRule {
    elementClass?: string       // a class's URI; every class when absent
    domain?: string             // a physical domain's URI; every domain when absent
    variable: string
    pattern: string
}

export interface NamingElement {
    id: string                  // its URI
    identifier: string          // the URI's fragment
    elementClass?: string       // one of ELEMENT_CLASSES
    domain?: string             // its physical domain's URI
    label?: string              // its symbol (q, Re, Se, ...)
    species?: string
    location?: string
    variables: string[]         // the template's names of its variables
    intrinsic?: string          // the variable that is its own name (a store's q)
}

export type NameOverrides = Map<string, string>          // `${element id}|${variable}` -> name

export interface NamingPreset {
    id: string
    name: string
    description: string
    rules: NamingRule[]
}

//==============================================================================

export function validName(name: string, variable: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
    if (cleaned === '') return variable
    return /^[0-9]/.test(cleaned) ? `${variable}_${cleaned}` : cleaned
}

export function renderName(pattern: string, values: { var: string, element: string, label: string, species: string,
                                                       location: string, name: string }): string {
    const filled = pattern.replace(/\{(\w+)\}/g, (_, key: string) => (values as Record<string, string>)[key] ?? '')
    return validName(filled, values.var)
}

// bg2cellml's clean_latex (species and locations) and clean_name (identifiers)
function cleanLatex(latex: string): string {
    return latex.trim().replace(/\\[^{]*\{([^}]*)\}/g, '_$1').replace(/\^/g, '_').replace(/[^a-zA-Z_0-9]/g, '').replace(/^_*/, '')
}
function cleanName(name: string): string {
    return name.replace(/[:\-. ]/g, '_')
}

/** The bond graph's name for an element on its own (its symbol, species and location), as bg2cellml makes it. */
export function elementName(e: NamingElement): string {
    let name = e.label || e.identifier
    if (e.species) name += `_${cleanLatex(e.species)}`
    if (e.location) name += `_${cleanLatex(e.location)}`
    return name
}

/**
 * Every element's bond graph name, as bg2cellml makes them: in the order of the elements' identifiers, an element
 * whose name is taken (a copy of a chemostat) is named by its identifier instead, numbered if that is taken too.
 */
export function elementNames(elements: NamingElement[]): Map<string, string> {
    const names = new Map<string, string>(), taken = new Set<string>()
    for (const e of [...elements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        let name = elementName(e)
        if (taken.has(name)) {
            name = cleanName(e.identifier)
            for (let n = 2; taken.has(name); n++) name = `${cleanName(e.identifier)}_${n}`
        }
        taken.add(name)
        names.set(e.id, name)
    }
    return names
}

/** The bond graph's name for one of an element's variables (`element`: its name from elementNames). */
export function bondgraphName(e: NamingElement, variable: string, element: string = elementName(e)): string {
    return variable === e.intrinsic ? element : `${variable}_${element}`
}

/** The most specific rule for one of an element's variables: for its class and domain, its class, its domain, or neither. */
export function ruleFor(rules: NamingRule[], elementClass: string|undefined, domain: string|undefined,
                        variable: string): NamingRule|undefined {
    const fits = rules.filter(r => r.variable === variable && (!r.elementClass || r.elementClass === elementClass)
                                   && (!r.domain || r.domain === domain))
    const rank = (r: NamingRule) => (r.elementClass ? 2 : 0) + (r.domain ? 1 : 0)
    return fits.reduce<NamingRule|undefined>((best, r) => !best || rank(r) > rank(best) ? r : best, undefined)
}

/**
 * The CellML name of every element variable, keyed `${element id}|${variable}`. `reserved` names (time, the
 * domains' constants) are never given.
 */
export function previewNames(elements: NamingElement[], rules: NamingRule[], overrides: NameOverrides,
                             reserved: string[] = ['t', 'RT', 'F']): Map<string, string> {
    const names = new Map<string, string>()
    const taken = new Set(reserved)
    const ofElement = elementNames(elements)
    const ordered = [...elements].sort((a, b) => a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0)
    for (const e of ordered) {
        for (const variable of e.variables) {
            const key = `${e.id}|${variable}`
            const given = overrides.get(key)
            const rule = ruleFor(rules, e.elementClass, e.domain, variable)
            const wanted = given !== undefined && given !== '' ? validName(given, variable)
                         : rule ? renderName(rule.pattern, {
                               var: variable, element: ofElement.get(e.id) ?? elementName(e), label: e.label ?? '',
                               species: e.species ?? '', location: e.location ?? '', name: e.species || e.identifier
                           })
                         : bondgraphName(e, variable, ofElement.get(e.id))
            let name = wanted
            for (let n = 2; taken.has(name); n++) name = `${wanted}_${n}`
            taken.add(name)
            names.set(key, name)
        }
    }
    return names
}

//==============================================================================

const QS = `${BGF}QuantityStore`, RE = `${BGF}Reaction`, PS = `${BGF}PotentialSource`
const FS = `${BGF}FlowSource`, RS = `${BGF}Resistance`, FL = `${BGF}FlowStore`
const CHEMICAL = `${BGF}Chemical`

// a preset's rules for each of these domains
function inDomains(domains: string[], rules: Omit<NamingRule, 'domain'>[]): NamingRule[] {
    return domains.flatMap(domain => rules.map(r => ({ ...r, domain })))
}

export const NAMING_PRESETS: NamingPreset[] = [
    {
        id: 'bondgraph',
        name: 'Bond graph names',
        description: 'Each variable named after its element: q_G6P_c, u_q_G6P_c, v_Re_HK_c.',
        rules: []
    },
    {
        id: 'chemistry',
        name: 'Amounts, potentials and rates',
        description: 'For chemical elements: n_G6P_c (amount), mu_G6P_c (chemical potential), dndt_G6P_c, v_HK (reaction rate), '
                   + 'A_f_HK and A_r_HK (affinities of its sides), J_ATP_c (flow from a chemostat).',
        rules: inDomains([CHEMICAL], [
            { elementClass: QS, variable: 'q', pattern: 'n_{name}_{location}' },
            { elementClass: QS, variable: 'u', pattern: 'mu_{name}_{location}' },
            { elementClass: QS, variable: 'v', pattern: 'dndt_{name}_{location}' },
            { elementClass: QS, variable: 'K', pattern: 'K_{name}_{location}' },
            { elementClass: QS, variable: 'k_sat', pattern: 'n_sat_{name}_{location}' },
            { elementClass: PS, variable: 'u', pattern: 'mu_{name}_{location}' },
            { elementClass: PS, variable: 'v', pattern: 'J_{name}_{location}' },
            { elementClass: RE, variable: 'v', pattern: 'v_{name}' },
            { elementClass: RE, variable: 'u_f', pattern: 'A_f_{name}' },
            { elementClass: RE, variable: 'u_r', pattern: 'A_r_{name}' },
            { elementClass: RE, variable: 'kappa', pattern: 'kappa_{name}' },
            { elementClass: RE, variable: 'sigma', pattern: 'sigma_{name}' },
            { elementClass: RS, variable: 'v', pattern: 'v_{name}' }
        ])
    },
    {
        id: 'circuit',
        name: 'Pressures, flows and volumes',
        description: 'For hydraulic and electrical elements: V_aorta (stored quantity), p_aorta (pressure or '
                   + 'voltage), Q_aorta (flow or current), R_ and C_ parameters by element name.',
        rules: inDomains([`${BGF}Hydraulic`, `${BGF}Electrical`], [
            { elementClass: QS, variable: 'q', pattern: 'V_{name}' },
            { elementClass: QS, variable: 'u', pattern: 'p_{name}' },
            { elementClass: QS, variable: 'v', pattern: 'dVdt_{name}' },
            { elementClass: RS, variable: 'v', pattern: 'Q_{name}' },
            { elementClass: RS, variable: 'u', pattern: 'dp_{name}' },
            { elementClass: FL, variable: 'v', pattern: 'Q_{name}' },
            { elementClass: FL, variable: 'u', pattern: 'dp_{name}' },
            { elementClass: PS, variable: 'u', pattern: 'p_{name}' },
            { elementClass: PS, variable: 'v', pattern: 'Q_{name}' },
            { elementClass: FS, variable: 'v', pattern: 'Q_{name}' },
            { elementClass: FS, variable: 'u', pattern: 'p_{name}' }
        ])
    },
    {
        id: 'short',
        name: 'Short bond graph names',
        description: 'The bond graph\'s letters without the element\'s symbol: q_G6P_c, u_G6P_c, v_HK.',
        rules: ['q', 'u', 'v', 'u_f', 'u_r', 'K', 'k_sat', 'kappa', 'sigma', 'R', 'C', 'L'].map(variable => ({
            variable, pattern: '{var}_{name}_{location}'
        }))
    }
]

/** The preset these rules are (ignoring order), or undefined for rules of the user's own. */
export function matchingPreset(rules: NamingRule[]): NamingPreset|undefined {
    const key = (r: NamingRule) => `${r.elementClass ?? ''}|${r.domain ?? ''}|${r.variable}|${r.pattern}`
    const given = new Set(rules.map(key))
    return NAMING_PRESETS.find(p => p.rules.length === given.size && p.rules.every(r => given.has(key(r))))
}

//==============================================================================
//==============================================================================
