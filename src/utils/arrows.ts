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

// PhLynx's arrowhead (its CouplingEdge, a copy of Vue Flow's closed arrow): one head at a connection's target end,
// its tip where the path ends, sized in stroke widths. As a <marker> for documents the editor draws, and as a plain
// shape for exported figures (PhLynx's SVG export draws heads as shapes too: some editors mishandle <marker>).

export const ARROW_POINTS = '-5,-4 0,0 -5,4 -5,-4'
export const ARROW_VIEWBOX = [-10, -10, 20, 20] as const
export const ARROW_SIZE = 12.5                    // markerWidth and markerHeight, in stroke widths

/** The arrowhead as an SVG marker with `id`, filled and outlined in the connection's colour. */
export function arrowMarker(id: string, className = '', colour = 'context-stroke'): string {
    return `<marker id="${id}"${className ? ` class="${className}"` : ''} viewBox="${ARROW_VIEWBOX.join(' ')}" refX="0" refY="0" `
         + `markerWidth="${ARROW_SIZE}" markerHeight="${ARROW_SIZE}" markerUnits="strokeWidth" orient="auto-start-reverse">`
         + `<polyline points="${ARROW_POINTS}" fill="${colour}" stroke="${colour}" stroke-width="1" `
         + `stroke-linecap="round" stroke-linejoin="round"/></marker>`
}

/**
 * The arrowhead as a plain shape at the end (x2, y2) of a line from (x1, y1), for a line `strokeWidth` wide: the
 * marker's polyline, turned along the line and scaled as the marker would be.
 */
export function arrowShape(x1: number, y1: number, x2: number, y2: number, strokeWidth: number, colour: string): string {
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
    const scale = strokeWidth * ARROW_SIZE / ARROW_VIEWBOX[2]
    const r = (x: number) => Math.round(1000 * x) / 1000
    return `<polyline points="${ARROW_POINTS}" fill="${colour}" stroke="${colour}" stroke-width="${r(1 / scale)}" `
         + `stroke-linecap="round" stroke-linejoin="round" `
         + `transform="translate(${r(x2)},${r(y2)}) rotate(${r(angle)}) scale(${r(scale)})"/>`
}
