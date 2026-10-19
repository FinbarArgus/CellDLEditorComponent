/*************************************************************************
 *
 *  direct/tex2svg
 *
 *  Uses MathJax v3 to convert a TeX string to an SVG string.
 *
 * ----------------------------------------------------------------------
 *
 *  Copyright (c) 2018 The MathJax Consortium
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

//  Load the packages needed for MathJax
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import type TexError from '@mathjax/src/js/input/tex/TexError.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import type { MmlNode } from '@mathjax/src/js/core/MmlTree/MmlNode.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { STATE } from '@mathjax/src/js/core/MathItem.js'
import '@mathjax/src/js/util/asyncLoad/esm.js'

import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'

//==============================================================================

import { EM_SIZE, EX_SIZE } from '#editor/geometry/units'

//==============================================================================

//  Create DOM adaptor and register it for HTML documents
const adaptor = liteAdaptor({ fontSize: EM_SIZE })
RegisterHTMLHandler(adaptor)

//==============================================================================

const tex = new TeX({
    packages: ['base', 'ams', 'color', 'mhchem'],
    formatError(_: unknown, error: TexError) {
        throw Error(`LaTeX: ${error.message}`)
    }
})
const svg = new SVG({
    fontCache: 'local'
})

const html = mathjax.document('', {
    InputJax: tex,
    OutputJax: svg,
    renderActions: {
        removeLatex: [  // remove LaTeX specific attributes
            (STATE.CONVERT as number) + 1,
            () => {},
            // @ts-expect-error:
            (math, _doc) => {
                math.root.walkTree((node: MmlNode) => {
                    const attributes = node.attributes
                    attributes.unset('data-latex')
                    attributes.unset('data-latex-item')
                })
            }
        ]
    }
})

//==============================================================================

export function latexAsSvgString(latex: string, display: boolean = false): string {
    const node = html.convert(latex, {
        display,        // inline math by default; display math is never broken across lines
        em: EM_SIZE,
        ex: EX_SIZE
    })
    return adaptor.innerHTML(node)
}

export function latexAsSvgDocument(latex: string): XMLDocument {
    const svg = latexAsSvgString(latex)
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

//==============================================================================
//==============================================================================
