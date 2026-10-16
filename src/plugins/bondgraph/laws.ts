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

// How an element shows which constitutive relation it follows: an element's relation is its Element
// Template's (BG-RDF templates/*.ttl); a template that is not its domain's default names its relation
// (bgf:lawLabel) and says how it is drawn (bgf:hasStyle).

import type { BorderStyle } from '#root/utils/borders'

import type { BGElementStyle } from './utils'

//==============================================================================

const BORDER_STYLES: BorderStyle[] = ['solid', 'dashed', 'double']

/**
 * An element's symbol as LaTeX: the symbol with its species as a superscript and its location as a
 * subscript, and the law label of its template's constitutive relation (e.g. `sat`) as a small upright
 * pre-superscript, so elements with different relations read differently.
 */
export function makeLatex(symbol: string, species: string|undefined, location: string|undefined,
                          lawLabel?: string): string {
    const latex: string[] = []
    if (lawLabel) {
        latex.push(`{}^{\\scriptscriptstyle\\mathrm{${lawLabel}}}\\!`)
    }
    latex.push(symbol)
    if (species) {
        latex.push(`^{${species}}`)
    }
    if (location) {
        latex.push(`_{${location}}`)
    }
    return latex.join('')
}

/**
 * The style an element of a template is drawn with: its base element's, with what the template's
 * `bgf:hasStyle` sets in place (colours, and a border style the editor knows); the base style when the
 * template sets none.
 */
export function templateStyle(base: BGElementStyle, overrides: Partial<BGElementStyle>): BGElementStyle {
    const style: BGElementStyle = Object.assign({}, base)
    if (overrides.text) style.text = overrides.text
    if (overrides.background) style.background = overrides.background
    if (overrides.border) style.border = overrides.border
    if (overrides.borderStyle && BORDER_STYLES.includes(overrides.borderStyle)) {
        style.borderStyle = overrides.borderStyle
    }
    return style
}

/**
 * The SPARQL (after the SPARQL prefixes) for the Element Templates of a base component (`base`, its URI):
 * each template's label, symbol, domain, constitutive relation, law label and style.
 */
export function elementTemplatesQuery(base: string): string {
    return `
        SELECT ?element ?label ?symbol ?domain ?relation ?lawLabel
               ?textColour ?backgroundColour ?borderColour ?borderStyle WHERE {
            ?element
                rdfs:subClassOf* ?subType ;
                rdfs:subClassOf* <${base}> .
            ?subType bgf:hasDomain ?domain .
            OPTIONAL { ?element rdfs:label ?label }
            OPTIONAL { ?element bgf:hasSymbol ?symbol }
            OPTIONAL { ?subType bgf:constitutiveRelation ?relation }
            OPTIONAL {
                # the template's, or for a composite (a template with its junction) its template's
                ?element rdfs:subClassOf* ?lawTemplate .
                ?lawTemplate bgf:lawLabel ?lawLabel .
                OPTIONAL {
                    ?lawTemplate bgf:hasStyle ?style .
                    OPTIONAL { ?style bgf:textColour ?textColour }
                    OPTIONAL { ?style bgf:backgroundColour ?backgroundColour }
                    OPTIONAL { ?style bgf:borderColour ?borderColour }
                    OPTIONAL { ?style bgf:borderStyle ?borderStyle }
                }
            }
            FILTER (
                exists { ?element a bgf:ElementTemplate }
             || exists {<${base}> a bgf:CompositeElement}
            )
          } order by ?label`
}

/** The style overrides in a row of `elementTemplatesQuery`'s results. */
export function styleOverrides(row: Map<string, { value: string }>): Partial<BGElementStyle> {
    return {
        text: row.get('textColour')?.value,
        background: row.get('backgroundColour')?.value,
        border: row.get('borderColour')?.value,
        borderStyle: row.get('borderStyle')?.value as BorderStyle|undefined
    }
}

//==============================================================================
//==============================================================================
