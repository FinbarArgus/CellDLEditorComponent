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

import { round } from '#editor/utils'

//==============================================================================

export type BorderStyle = 'solid' | 'dashed' | 'double'

/**
 * The stroke attributes of a rectangle's border of the given colour, width and style: a dashed border is a
 * dash pattern scaled to the stroke width; a double border is drawn as the outer stroke plus an inner
 * rectangle inset by `doubleInset` (see `LatexMathSvg.svgRect`).
 */
export function borderStroke(colour: string, width: number, style: BorderStyle = 'solid'): string {
    const stroke = ` stroke="${colour}" stroke-width="${round(width)}"`
    if (style === 'dashed') {
        return `${stroke} stroke-dasharray="${round(3*width)} ${round(2*width)}"`
    }
    return stroke
}

/** How far inside the outer border a double border's inner line is drawn, for a stroke of the given width. */
export function doubleInset(width: number): number {
    return round(1.6*width)
}

/** The width of a double border's inner line, for an outer stroke of the given width: thinner, to clear the text. */
export function doubleInnerWidth(width: number): number {
    return round(0.6*width)
}

//==============================================================================
//==============================================================================
