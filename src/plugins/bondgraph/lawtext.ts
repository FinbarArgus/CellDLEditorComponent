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
/** biome-ignore-all lint/style/noNonNullAssertion: <an operator's arguments, as content MathML requires them> */

// An element's constitutive law for its hover: the template's relation (content MathML, bgf:constitutiveRelation)
// as LaTeX in the template's own symbols, and what each symbol is in the model, by the names the CellML gives
// them (./naming.ts): a reaction's u_f and u_r are the potentials bonded to its sides, a store's flow the net of
// its reactions' flows, a resistance's potential the difference across it.

//==============================================================================

// the parts of a DOM node the conversion reads (a browser's, or @xmldom/xmldom's in tests)
export interface MathNode {
    nodeType: number
    nodeName: string
    localName?: string | null
    textContent: string | null
    childNodes: ArrayLike<MathNode>
}

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'kappa', 'lambda', 'mu',
                       'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega'])

/** A variable's name as LaTeX: Greek letters as symbols, the part after the first _ as a subscript. */
export function symbolLatex(name: string): string {
    const [head, ...rest] = name.split('_')
    const letter = (s: string) => GREEK.has(s) ? `\\${s}` : s.length > 1 && !/^[A-Z]+$/.test(s) ? `\\mathrm{${s}}` : s
    const base = letter(head ?? name)
    if (rest.length === 0) return base
    const sub = rest.join('_')
    return `${base}_{${sub.length > 1 ? `\\mathrm{${sub.replace(/_/g, '\\_')}}` : sub}}`
}

function elements(node: MathNode): MathNode[] {
    return Array.from(node.childNodes).filter(n => n.nodeType === 1)
}

function name(node: MathNode): string {
    return (node.localName || node.nodeName).replace(/^.*:/, '')
}

// binding strength: a child binding less tightly than its parent is put in brackets
const PRECEDENCE: Record<string, number> = { eq: 0, plus: 1, minus: 1, times: 2, divide: 3, power: 4 }

function convert(node: MathNode): { latex: string, precedence: number } {
    const tag = name(node)
    if (tag === 'math') {
        const [first] = elements(node)
        return first ? convert(first) : { latex: '', precedence: 9 }
    }
    if (tag === 'ci') return { latex: symbolLatex((node.textContent ?? '').trim()), precedence: 9 }
    if (tag === 'cn') return { latex: (node.textContent ?? '').trim(), precedence: 9 }
    if (tag !== 'apply') return { latex: '', precedence: 9 }
    const [operator, ...args] = elements(node)
    if (!operator) return { latex: '', precedence: 9 }
    const op = name(operator)
    const own = PRECEDENCE[op] ?? 9
    const arg = (n: MathNode, tighter = false) => {
        const c = convert(n)
        return c.precedence < own || (tighter && c.precedence === own) ? `\\left(${c.latex}\\right)` : c.latex
    }
    switch (op) {
        case 'eq': return { latex: args.map(a => convert(a).latex).join(' = '), precedence: 0 }
        case 'plus': return { latex: args.map(a => arg(a)).join(' + '), precedence: 1 }
        case 'minus':
            return args.length === 1 ? { latex: `-${arg(args[0]!, true)}`, precedence: 1 }
                                     : { latex: `${arg(args[0]!)} - ${arg(args[1]!, true)}`, precedence: 1 }
        case 'times': return { latex: args.map(a => arg(a)).join('\\,'), precedence: 2 }
        case 'divide':
            return { latex: `\\frac{${convert(args[0]!).latex}}{${convert(args[1]!).latex}}`, precedence: 9 }
        case 'power': return { latex: `${arg(args[0]!, true)}^{${convert(args[1]!).latex}}`, precedence: 4 }
        case 'exp': return { latex: `e^{${convert(args[0]!).latex}}`, precedence: 9 }
        case 'ln': return { latex: `\\ln\\left(${convert(args[0]!).latex}\\right)`, precedence: 9 }
        case 'abs': return { latex: `\\left|${convert(args[0]!).latex}\\right|`, precedence: 9 }
        case 'root': {
            const degree = args.find(a => name(a) === 'degree')
            const body = args.find(a => name(a) !== 'degree')!
            const n = degree ? elements(degree)[0] : undefined
            return { latex: n ? `\\sqrt[${convert(n).latex}]{${convert(body).latex}}` : `\\sqrt{${convert(body).latex}}`,
                     precedence: 9 }
        }
        case 'diff': {
            const bvar = args.find(a => name(a) === 'bvar')
            const of = args.find(a => name(a) !== 'bvar')!
            const by = bvar ? elements(bvar)[0] : undefined
            return { latex: `\\frac{d${convert(of).latex}}{d${by ? convert(by).latex : 't'}}`, precedence: 9 }
        }
        default: return { latex: `\\mathrm{${op}}\\left(${args.map(a => convert(a).latex).join(', ')}\\right)`, precedence: 9 }
    }
}

/** Each equation of content MathML (an element's <math>) as LaTeX in the template's symbols. */
export function mathmlEquations(math: MathNode): string[] {
    const equations = name(math) === 'math' ? elements(math) : [math]
    return equations.map(e => convert(e).latex).filter(Boolean)
}

/** Content MathML as one line of LaTeX, its equations side by side. */
export function mathmlLatex(math: MathNode): string {
    return mathmlEquations(math).join(',\\qquad ')
}

//==============================================================================

export interface LawTerm {
    count: number               // a bond's bgf:bondCount, or a transformer's ratio
    name: string                // the CellML name of the variable it brings
}

/** a + 2 b - c, from signed terms (a count of 1 is left out). */
export function sumText(terms: { sign: number, count: number, name: string }[]): string {
    if (terms.length === 0) return '0'
    return terms.map((t, k) => {
        const magnitude = Math.abs(t.count) === 1 ? t.name
                        : `${Number.isInteger(t.count) ? Math.abs(t.count) : Math.abs(t.count).toPrecision(6)}·${t.name}`
        const negative = t.sign * Math.sign(t.count) < 0
        return k === 0 ? (negative ? `−${magnitude}` : magnitude) : `${negative ? ' − ' : ' + '}${magnitude}`
    }).join('')
}

export interface WhereLine {
    symbol: string              // the template's name (u_f, v, K, ...)
    name: string                // the CellML name
    is?: string                 // what it equals in the model, from the bonds
}

/** "u_f = mu_Glc_c + mu_ATP_c" style lines, one per symbol, its CellML name and what the bonds make it. */
export function whereText(lines: WhereLine[]): string[] {
    return lines.map(l => l.is ? `${l.symbol} = ${l.name} = ${l.is}` : `${l.symbol} = ${l.name}`)
}

//==============================================================================
//==============================================================================
