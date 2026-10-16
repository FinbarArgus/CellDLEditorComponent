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

import { Buffer } from 'buffer'
import toSvgDataUrl from "mini-svg-data-uri"

//==============================================================================

import type { Extent } from '#editor/geometry'
import { lengthToPixels, pixelsToLength } from '#editor/geometry/units'
import { round } from '#editor/utils'

import { type BorderStyle, borderStroke, doubleInnerWidth, doubleInset } from '#root/utils/borders'

import { latexAsSvgDocument } from '#root/mathjax'
import type { PointLike } from '#root/utils/points'
import { STYLE_STRING_FIELD_SEPARATOR, type StrokeAttributes } from '#root/utils/styling'
import type { StringProperties } from '#root/utils/types'

//==============================================================================

export const SVG_URI = 'http://www.w3.org/2000/svg'

//==============================================================================

export interface LatexMathSvgOptions {
    background?: string
    border?: string
    'border-style'?: BorderStyle
    'border-width'?: string
    class?: string
    'corner-radius'?: string
    'min-height'?: string
    'min-width'?: string
    padding?: string
    'vertical-align'?: string
}

//==============================================================================

export function svgSize(svgDocument: Document): PointLike | null {
    const svgElement = svgDocument.documentElement
    const width = lengthToPixels(svgElement.getAttribute('width'))
    const height = lengthToPixels(svgElement.getAttribute('height'))
    if (width && height) {
        return {
            x: width,
            y: height
        }
    }
    return null
}

export function getViewbox(svgElement: SVGGraphicsElement): Extent {
    return svgElement
        .getAttribute('viewBox')
        ?.split(' ')
        .map((n) => +n) as Extent
}

//==============================================================================

type Attributes = StringProperties

export function createSVGElement(tagName: string, attributes: Attributes): SVGElement {
    const element = document.createElementNS(SVG_URI, tagName)
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, value)
    }
    return element
}

function attributePairs(attributes: Attributes): string {
    const attributePairs: string[] = []
    for (const [key, value] of Object.entries(attributes)) {
        attributePairs.push(` ${key}="${value}"`)
    }
    return attributePairs.join('')
}

//==============================================================================

function svgCircleAttributes(c: PointLike, r: number, attributes: Attributes): Attributes {
    return Object.assign({}, attributes, {
        cx: `${c.x}`,
        cy: `${c.y}`,
        r: `${r}`
    })
}

export function svgCircle(centre: PointLike, radius: number, attributes: Attributes = {}): string {
    return `<circle${attributePairs(svgCircleAttributes(centre, radius, attributes))}/>`
}

export function svgCircleElement(centre: PointLike, radius: number, attributes: Attributes = {}): SVGCircleElement {
    return createSVGElement('circle', svgCircleAttributes(centre, radius, attributes)) as SVGCircleElement
}

//==============================================================================

export function svgPath(points: PointLike[], attributes: Attributes = {}): string {
    const description = svgPathDescription(points)
    return description ? `<path${attributePairs(attributes)} d="${description}"/>` : ''
}

export function svgPathDescription(points: PointLike[]): string {
    const pts = points.map((pt) => `${pt.x},${pt.y}`)
    return pts.length > 1 ? `M${pts.join(' L')}` : ''
}

export function svgPathElement(points: PointLike[], attributes: Attributes = {}): SVGPathElement {
    const description = svgPathDescription(points)
    return createSVGElement('path', Object.assign({}, attributes, { d: description })) as SVGPathElement
}

//==============================================================================

function svgRectAttributes(tl: PointLike, br: PointLike, attributes: Attributes): Attributes {
    return Object.assign({}, attributes, {
        x: `${Math.min(tl.x, br.x)}`,
        y: `${Math.min(tl.y, br.y)}`,
        width: `${Math.abs(br.x - tl.x)}`,
        height: `${Math.abs(br.y - tl.y)}`
    })
}

export function svgRect(topLeft: PointLike, bottomRight: PointLike, attributes: Attributes = {}): string {
    return `<rect${attributePairs(svgRectAttributes(topLeft, bottomRight, attributes))}/>`
}

export function svgRectElement(
    topLeft: PointLike,
    bottomRight: PointLike,
    attributes: StringProperties = {}
): SVGRectElement {
    return createSVGElement('rect', svgRectAttributes(topLeft, bottomRight, attributes)) as SVGRectElement
}

//==============================================================================
//==============================================================================

//  Minimal CSS needed for stand-alone image
export const LatexStyleRules = [
    'svg {color: black}', // default value of ``currentColor``
    'svg a{fill:blue;stroke:blue}',
    // Round the corners of filled background rectangles
    '[data-mml-node="mstyle"]>rect[data-bgcolor="true"]{rx: 8%; ry: 12%}',
    '[data-mml-node="merror"]>g{fill:red;stroke:red}',
    '[data-mml-node="merror"]>rect[data-background]{fill:yellow;stroke:none}',
    '[data-frame],[data-line]{stroke-width:70px;fill:none}',
    '.mjx-dashed{stroke-dasharray:140}',
    '.mjx-dotted{stroke-linecap:round;stroke-dasharray:0,140}',
    'use[data-c]{stroke-width:3px}'
].join('')

//==============================================================================

function getLengthFromOptions(options: LatexMathSvgOptions, key: string): number {
    // @ts-expect-error: `key` is an option
    const length = key in options ? lengthToPixels(options[key]) : null
    return length || 0
}

//==============================================================================

function latexToSvgRect(latex: string, suffix: string,
    options: LatexMathSvgOptions={},
    includeStyleRules:boolean=false): string
{
    let svgDocument = latexAsSvgDocument(latex)
    let svgElement: SVGSVGElement = (<Element>svgDocument.documentElement) as SVGSVGElement
    const svgWidth = lengthToPixels(svgElement.getAttribute('width')) || 0
    const svgHeight = lengthToPixels(svgElement.getAttribute('height')) || 0
    const gradient: string[] = []
    if (svgWidth && svgHeight) {
        let viewBox = getViewbox(svgElement)
        const scale = [viewBox[2]/svgWidth, viewBox[3]/svgHeight]
        const border = ('border' in options) ? getLengthFromOptions(options, 'border-width') : 0
        const padding = getLengthFromOptions(options, 'padding')
        // @ts-expect-error: `scale` is two long
        let width = scale[0]*Math.max(2*border + 2*padding + svgWidth, getLengthFromOptions(options, 'min-width'))
        // @ts-expect-error: `scale` is two long
        const extrawidth = width - scale[0]*svgWidth
        const left = viewBox[0] - extrawidth/2
        let right = left + width

        // @ts-expect-error: `scale` is two long
        let height = scale[1]*Math.max(2*border + 2*padding + svgHeight, getLengthFromOptions(options, 'min-height'))
        // @ts-expect-error: `scale` is two long
        const extraHeight = height - scale[1]*svgHeight
        let top = viewBox[1] - extraHeight/2
        let bottom = top + height
        // @ts-expect-error: `scale` is two long
        const rectSize = ` width="${round(width-2*border*scale[0])}" height="${round(height-2*border*scale[1])}"`
        if (suffix !== '') {
            const suffixLatex = (suffix !== '') ? `\\;${suffix}` : ''
            svgDocument = latexAsSvgDocument(`${latex}${suffixLatex}`)
            svgElement = (<Element>svgDocument.documentElement) as SVGSVGElement
            viewBox = getViewbox(svgElement)
            // @ts-expect-error: `scale` is two long
            right = Math.max(right, viewBox[0] + viewBox[2] + scale[0]*padding)
            // @ts-expect-error: `scale` is two long
            top = Math.min(top, viewBox[1] - scale[1]*(padding + border))
            // @ts-expect-error: `scale` is two long
            bottom = Math.max(bottom, viewBox[1] + viewBox[3] + scale[1]*(padding + border))

            // We add `data-centre-x` and `data-centre-y` attributes to the root <svg> element,
            // giving the ratios needed to find the centre of the unsuffixed text.
            svgElement.dataset.centreX = `${round(0.5*width/(right - left))}`
            svgElement.dataset.centreY = `${round(0.5*height/(bottom - top))}`
            width = right - left
            height = bottom - top
        }
        // @ts-expect-error: `scale` is two long
        let verticalAlign = scale[1]*getLengthFromOptions(options, 'vertical-align')
        if (verticalAlign) {
            bottom = -verticalAlign
            top = bottom - height
        } else {
            verticalAlign = -bottom
        }
        // @ts-expect-error: `scale` is two long
        svgElement.style.setProperty('vertical-align', pixelsToLength(verticalAlign/scale[1], 'ex'))
        viewBox[0] = round(left)
        viewBox[1] = round(top)
        viewBox[2] = round(width)
        viewBox[3] = round(height)
        svgElement.setAttribute('viewBox', viewBox.map(n => n.toString()).join(' '))
        // @ts-expect-error: `scale` is two long
        svgElement.setAttribute('width', pixelsToLength(width/scale[0], 'ex') as number)
        // @ts-expect-error: `scale` is two long
        svgElement.setAttribute('height', pixelsToLength(height/scale[1], 'ex') as number)

        const fill = getFillFromString(options.background, 'fill-gradient')
        gradient.push(...fill.gradient)

        // @ts-expect-error: `scale` is two long
        const strokeWidth = scale[0]*border
        const borderStyle = options['border-style'] || 'solid'
        const stroke = border ? borderStroke(options.border!, strokeWidth, borderStyle) : ''
        const radius = getLengthFromOptions(options, 'corner-radius');
        // @ts-expect-error: `scale` is two long
        const cornerRadius = radius ? ` rx="${round(radius*scale[0])}"` : ''
        // @ts-expect-error: `scale` is two long
        const topLeft = `x="${round(viewBox[0]+border*scale[0])}" y="${round(viewBox[1]+border*scale[1])}"`
        const rectClass = options.class ? ` class="${options.class}"` : ''
        const bgRect = `<rect ${topLeft}${rectSize} fill="${fill.fillAttribute}" data-fill-style="${fill.dataFillStyle}"${stroke}${cornerRadius}${rectClass}></rect>`
        svgElement.firstElementChild?.insertAdjacentHTML('afterend', bgRect)
        if (border && borderStyle === 'double') {
            // The inner line of a double border
            const inset = doubleInset(strokeWidth)
            // @ts-expect-error: `scale` is two long
            const innerX = viewBox[0] + border*scale[0] + inset
            // @ts-expect-error: `scale` is two long
            const innerY = viewBox[1] + border*scale[1] + inset
            // @ts-expect-error: `scale` is two long
            const innerSize = ` width="${round(width - 2*border*scale[0] - 2*inset)}" height="${round(height - 2*border*scale[1] - 2*inset)}"`
            // @ts-expect-error: `scale` is two long
            const innerRadius = radius ? ` rx="${round(Math.max(0, radius*scale[0] - inset))}"` : ''
            const innerRect = `<rect x="${round(innerX)}" y="${round(innerY)}"${innerSize} fill="none"${borderStroke(options.border!, doubleInnerWidth(strokeWidth))}${innerRadius}></rect>`
            svgElement.firstElementChild?.nextElementSibling?.insertAdjacentHTML('afterend', innerRect)
        }

        if (suffix !== '') {
            // @ts-expect-error: `scale` is two long
            const topLeft = `x="${viewBox[0]+border*scale[0]}" y="${viewBox[1]+border*scale[1]}"`;
            // @ts-expect-error: `scale` is two long
            const boundingRect = `<rect ${topLeft} width="${width-2*border*scale[0]}" height="${height-2*border*scale[1]}"></rect>`
            svgElement.insertAdjacentHTML('afterbegin', boundingRect)
        }
    }
    const svgSerialiser = new XMLSerializer()
    let svg = svgSerialiser.serializeToString(svgDocument)
    if (gradient.length) {
        svg = svg.replace(/<defs>/, `<defs>${gradient.join('')}`)
    }
    return includeStyleRules ? svg.replace(/<defs>/, `<defs><style>${LatexStyleRules}</style>`) : svg
}

//==============================================================================

export namespace LatexMathSvg {
    const svgCache: Map<string, string> = new Map()

    export function svgRect(latex: string, suffix: string = '', options: LatexMathSvgOptions = {}): string {
        const key = `${latex}${suffix}-${JSON.stringify(options)}`
        if (svgCache.has(key)) {
            return svgCache.get(key) as string
        } else {
            const svg = latexToSvgRect(latex, suffix, options)
            svgCache.set(key, svg)
            return svg
        }
    }
}

//==============================================================================

export function svgToDataUrl(svg: string, base64: boolean=false): string {
    if (base64) {
        return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    } else {
        return toSvgDataUrl(svg)
    }
}

//==============================================================================

export function svgFromDataUrl(dataUri: string): string|undefined {
    const data = dataUri.match(/data:image\/svg\+xml(?<base64>;base64)?,(?<svgText>.*)/)
    if (data) {
        const svgText = data.groups?.svgText as string
        if (data.groups?.base64) {
            return Buffer.from(svgText, 'base64').toString('utf8')
        } else {
            return decodeURIComponent(svgText).replace(/'/g, '"')
        }
    }
}

//==============================================================================

export function getFillString(svgElement: SVGGraphicsElement): string {
    const svgText = svgElement.outerHTML
    const dataUrl = svgText.match(/<image href="(?<dataUrl>.*)"><\/image>/)
    if (!dataUrl) {
        return ''
    }
    const svgData = svgFromDataUrl(dataUrl.groups?.dataUrl as string)
    if (svgData) {
        const fillStyle = svgData.match(/ data-fill-style="(?<fillStyle>[^"]*)"/)
        if (fillStyle) {
            return fillStyle.groups?.fillStyle as string
        }
        const fill = svgData.match(/ fill="(?<fill>[^"]*)"/)
        if (fill && !(fill.groups?.fill as string).startsWith('url(')) {
            return fill.groups?.fill as string
        }
        // Shouldn't get here...
        return 'yellow'
    }
    return ''
}

export function getFillFromString(fillString: string|undefined, gradientId: string) {
    let fillAttribute: string
    const gradient: string[] = []
    let dataFillStyle: string = ''
    if (!fillString) {
        fillAttribute = 'transparent'
        dataFillStyle = fillAttribute
    } else {
        dataFillStyle = fillString
        const fillArray: string[] = fillString.split(STYLE_STRING_FIELD_SEPARATOR)
        if (fillArray.length === 0) {
            fillAttribute = 'transparent'
            dataFillStyle = fillAttribute
        } else if (fillArray.length === 1) {
            fillAttribute = (fillArray[0] as string).trim()
        } else {
            const transform = (fillArray.at(0) === 'V') ? 'gradientTransform="rotate(90)"' : ''
            gradient.push(`<linearGradient id="${gradientId}" ${transform}>`)
            const nStops = fillArray.length - 2
            fillArray.slice(1).forEach((colour: string, index: number) => {
                colour = colour.trim()
                gradient.push(`<stop stop-color="${colour}" offset="${100*index/nStops}%"/>`)
            })
            gradient.push('</linearGradient>')
            fillAttribute = `url(#${gradientId})`
        }
    }
    return {
        fillAttribute,
        dataFillStyle,
        gradient,
    }
}

//==============================================================================

export function getStrokeString(svgElement: SVGGraphicsElement, defaults: StrokeAttributes): string {
    const strokeWidth = lengthToPixels(svgElement.getAttribute('stroke-width')) || defaults.width
    const strokeAttributes = [
        svgElement.getAttribute('stroke') || defaults.colour,
        String(strokeWidth)
    ]
    if (svgElement.hasAttribute('stroke-dasharray')) {
        const dashString = svgElement.getAttribute('stroke-dasharray') as string
        const dashWidth = Number(
            ((dashString.includes(',')) ? dashString.split(STYLE_STRING_FIELD_SEPARATOR)
                                        : dashString.split(STYLE_STRING_FIELD_SEPARATOR)).at(0)?.trim())
        strokeAttributes.push('1')
        strokeAttributes.push(String(dashWidth/strokeWidth))
    } else {
        strokeAttributes.push('0')
        strokeAttributes.push(String(defaults.dashScale || 0))
    }
    return strokeAttributes.join(STYLE_STRING_FIELD_SEPARATOR)
}

export function setStrokeFromString(svgElement: SVGGraphicsElement, strokeString: string) {
    const strokeArray = strokeString.split(STYLE_STRING_FIELD_SEPARATOR)
    if (strokeArray.length >= 4) {
        const strokeWidth = Number(strokeArray.at(1) as string)
        svgElement.setAttribute('stroke', strokeArray.at(0) as string)
        svgElement.setAttribute('stroke-width', String(strokeWidth))
        const dashScale = Number(strokeArray.at(3) as string)
        if (strokeArray.at(2) === '1' && dashScale > 0) {
            svgElement.setAttribute('stroke-dasharray', String(dashScale*strokeWidth))
        } else {
            svgElement.removeAttribute('stroke-dasharray')
        }
    }
}

//==============================================================================
//==============================================================================
