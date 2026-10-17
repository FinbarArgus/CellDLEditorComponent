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

/** biome-ignore-all lint/style/noNonNullAssertion: <every element has an image and a box> */

// A CellDL document from a generated bond graph (a "CellDL spec": its Turtle, and its elements and connections
// with positions), with each element's image drawn as the editor draws it (see app/render-celldl.html).

//==============================================================================

export interface SpecElement {
    id: string
    type: string                // the element's BG-RDF template (URI)
    symbol: string
    species?: string
    location?: string
    x: number                   // centre
    y: number
}

export interface SpecConnection {
    id: string
    source: string
    target: string
    count: number               // bgf:bondCount (1 when not given)
}

export interface CelldlSpec {
    label: string
    turtle: string
    elements: SpecElement[]
    connections: SpecConnection[]
}

export interface ElementImage {
    href: string                // the image's data URL
    width: number               // px
    height: number
}

//==============================================================================

const MARGIN = 30

const ARROW_MARKER = `<marker id="connection-end-arrow-bondgraph" viewBox="0 0 11 10" class="bondgraph" refX="10" refY="5" \
orient="auto-start-reverse" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8">\
<path fill="currentcolor" stroke="currentcolor" d="M0,0 L10.1,4.4 L10.1,5.6 L0,10 L2,5 z"/></marker>`

const STYLE = '.celldl-Connection.bondgraph.arrow{marker-end:url(#connection-end-arrow-bondgraph)}'
            + '.celldl-Connection{fill:none;stroke:#555;stroke-width:1.2px;color:#555}'
            + '.bond-count{font:bold 10px sans-serif;fill:#333}'

function round(x: number): number {
    return Math.round(1000*x)/1000
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Where the line from the centre of a box (cx, cy, width, height) towards (tx, ty) leaves the box.
 */
export function boxEdge(cx: number, cy: number, width: number, height: number, tx: number, ty: number): [number, number] {
    const dx = tx - cx
    const dy = ty - cy
    if (dx === 0 && dy === 0) {
        return [cx, cy]
    }
    const t = Math.min(dx ? (width/2)/Math.abs(dx) : Infinity, dy ? (height/2)/Math.abs(dy) : Infinity)
    return [cx + dx*t, cy + dy*t]
}

/**
 * The CellDL document (SVG with the BG-RDF in its metadata) of a spec, with each element's image placed centred on
 * its position and each connection a straight bond between the images' edges (with its bond count beside it when
 * above 1, outside the diagram layer).
 */
export function celldlDocument(spec: CelldlSpec, images: Map<string, ElementImage>): string {
    const box = new Map(spec.elements.map(e => {
        const image = images.get(e.id)!
        return [e.id, { x: e.x, y: e.y, width: image.width, height: image.height }]
    }))
    const xs = [...box.values()].flatMap(b => [b.x - b.width/2, b.x + b.width/2])
    const ys = [...box.values()].flatMap(b => [b.y - b.height/2, b.y + b.height/2])
    const x0 = Math.min(...xs) - MARGIN
    const y0 = Math.min(...ys) - MARGIN
    const width = Math.max(...xs) + MARGIN - x0
    const height = Math.max(...ys) + MARGIN - y0

    const components = spec.elements.map(e => {
        const b = box.get(e.id)!
        const image = images.get(e.id)!
        return `<g transform="matrix(1,0,0,1,${round(b.x - b.width/2)},${round(b.y - b.height/2)})" id="${escapeXml(e.id)}" `
             + `class="celldl-Component"><image href="${image.href}" width="${round(b.width)}" height="${round(b.height)}"/></g>`
    })
    const connections: string[] = []
    const counts: string[] = []
    for (const c of spec.connections) {
        const s = box.get(c.source)!
        const t = box.get(c.target)!
        const [x1, y1] = boxEdge(s.x, s.y, s.width, s.height, t.x, t.y)
        const [x2, y2] = boxEdge(t.x, t.y, t.width, t.height, s.x, s.y)
        connections.push(`<path class="celldl-Connection bondgraph arrow" d="M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}" `
                       + `id="${escapeXml(c.id)}"/>`)
        if (c.count > 1) {
            counts.push(`<text class="bond-count" x="${round((x1 + x2)/2 + 4)}" y="${round((y1 + y2)/2 - 4)}">${c.count}</text>`)
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(x0)} ${round(y0)} ${round(width)} ${round(height)}">`
         + `<metadata id="celldl-rdf-metadata" data-content-type="text/turtle"><![CDATA[${spec.turtle}]]></metadata>`
         + `<defs id="celldl-svg-definitions"><style id="celldl-svg-stylesheet">${STYLE}</style>${ARROW_MARKER}</defs>`
         + `<g id="celldl-diagram-layer" class="celldl-Layer">${components.join('')}${connections.join('')}</g>`
         + (counts.length ? `<g id="bond-counts">${counts.join('')}</g>` : '')
         + '</svg>'
}

//==============================================================================
//==============================================================================
