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
/** biome-ignore-all lint/style/noNonNullAssertion: <indices are within the palette and the grid> */

// A bond graph's regions drawn behind it, and reorganising its layout around them (../../plugins/bondgraph/regions.ts).
// The regions are a background in the editor's frame, redrawn whenever the diagram changes and never saved.

import type { CellDLObject } from '#editor/celldlObjects'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import {
    type Complexity, complexityOptions, connectRegions, type LayoutBond, type LayoutNode, layoutComplexity,
    type Point2, regionComponents, regionGrid, regionLoops, reorganise, sortedLabels
} from '#root/plugins/bondgraph/regions'
import { SVG_URI } from '#root/utils/svgUtils'

import { CellDLEditor, notifyChanges } from '.'
import { EDITOR_BACKGROUND_ID } from './editorframe'

//==============================================================================

export const REGION_LAYER_ID = 'celldl-region-layer'

// region colours, by the region's place in its diagram's sorted locations
export const REGION_COLOURS = ['#3d7fc1', '#d38b2a', '#b9547c', '#4c9a64', '#8566c0', '#2f9c9c', '#a0763e']

//==============================================================================

function plugin(): BondgraphPlugin|undefined {
    return componentLibraryPlugin.getPlugin('bondgraph-components') as unknown as BondgraphPlugin|undefined
}

/** The diagram's components as layout nodes (centre, size, regions), and its bonds. */
export function diagramLayout(): { nodes: LayoutNode[], bonds: LayoutBond[], objects: Map<string, CellDLObject> } {
    const nodes: LayoutNode[] = [], objects = new Map<string, CellDLObject>()
    const diagram = CellDLEditor.instance?.celldlDiagram
    const layout = plugin()?.regionLayout()
    if (!diagram?.svgDiagram || !layout) return { nodes, bonds: [], objects }
    for (const element of diagram.svgDiagram.querySelectorAll('g.celldl-Component')) {
        const object = diagram.objectById(element.id)
        const svg = object?.celldlSvgElement
        if (!object || !svg) continue
        const centre = svg.centroid
        nodes.push({ id: object.uri.value, x: centre.x, y: centre.y, w: svg.width, h: svg.height,
                     labels: layout.regions.get(object.uri.value) ?? [] })
        objects.set(object.uri.value, object)
    }
    const ids = new Set(nodes.map(n => n.id))
    return { nodes, bonds: layout.bonds.filter(b => ids.has(b.a) && ids.has(b.b)), objects }
}

//==============================================================================

function regionLayer(): SVGGElement|null {
    const diagram = CellDLEditor.instance?.celldlDiagram
    const background = diagram?.svgDiagram?.getElementById(EDITOR_BACKGROUND_ID) as SVGGElement|null
    if (!background) return null
    let layer = background.querySelector<SVGGElement>(`#${REGION_LAYER_ID}`)
    if (!layer) {
        layer = document.createElementNS(SVG_URI, 'g') as SVGGElement
        layer.id = REGION_LAYER_ID
        layer.setAttribute('pointer-events', 'none')
        background.prepend(layer)
    }
    return layer
}

export interface RegionSummary {
    regions: string[]
    subspaces: Map<string, number>          // connected pieces of each region
}

let showing = true

/** Draw (or, with `show` false, remove) the regions behind the diagram; returns what was drawn. */
export function drawRegions(show: boolean = showing): RegionSummary {
    showing = show
    const layer = regionLayer()
    const summary: RegionSummary = { regions: [], subspaces: new Map() }
    if (!layer) return summary
    layer.replaceChildren()
    const { nodes, bonds } = diagramLayout()
    const regions = sortedLabels(nodes)
    if (!show || regions.length === 0) return summary
    const { sigma } = complexityOptions(nodes, bonds)
    const grid = regionGrid(nodes, bonds, { sigma, cell: sigma / 4 })
    connectRegions(grid)
    summary.regions = regions
    summary.subspaces = regionComponents(grid)
    regions.forEach((label, k) => {
        const colour = REGION_COLOURS[k % REGION_COLOURS.length]!
        const loops = regionLoops(grid, label, { blur: 2, smooth: 2 })
        const d = loops.map(loop => `M${loop.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} Z`).join(' ')
        const path = document.createElementNS(SVG_URI, 'path')
        path.setAttribute('d', d)
        path.setAttribute('fill', colour)
        path.setAttribute('fill-opacity', '0.13')
        path.setAttribute('fill-rule', 'evenodd')
        path.setAttribute('stroke', colour)
        path.setAttribute('stroke-opacity', '0.45')
        path.setAttribute('stroke-width', '1.2')
        path.dataset.region = label
        layer.append(path)
        // its name, in the cell of the region nearest its middle
        let sx = 0, sy = 0, n = 0
        const l = grid.labels.indexOf(label)
        for (let k2 = 0; k2 < grid.owner.length; k2++) {
            if (grid.owner[k2] !== l) continue
            sx += k2 % grid.cols; sy += Math.floor(k2 / grid.cols); n++
        }
        if (n === 0) return
        let best = -1, bestD = Infinity
        for (let k2 = 0; k2 < grid.owner.length; k2++) {
            if (grid.owner[k2] !== l || grid.fixed[k2]) continue
            const d2 = (k2 % grid.cols - sx / n) ** 2 + (Math.floor(k2 / grid.cols) - sy / n) ** 2
            if (d2 < bestD) { bestD = d2; best = k2 }
        }
        if (best < 0) return
        const text = document.createElementNS(SVG_URI, 'text')
        text.setAttribute('x', String(grid.x0 + (best % grid.cols) * grid.cell))
        text.setAttribute('y', String(grid.y0 + Math.floor(best / grid.cols) * grid.cell))
        text.setAttribute('fill', colour)
        text.setAttribute('fill-opacity', '0.75')
        text.setAttribute('font-size', '18')
        text.setAttribute('font-weight', '600')
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('font-family', 'system-ui, sans-serif')
        text.textContent = label
        text.dataset.region = label
        layer.append(text)
    })
    return summary
}

export const BOND_COUNTS_ID = 'bond-counts'

/**
 * Write each bond's bgf:bondCount (when not 1) beside the middle of its path, in the document's `bond-counts`
 * group (saved with it, so a figure shows them too). Returns the number written.
 */
export function drawBondCounts(): number {
    const diagram = CellDLEditor.instance?.celldlDiagram
    const svg = diagram?.svgDiagram
    const layout = plugin()?.regionLayout()
    if (!diagram || !svg || !layout) return 0
    let group = svg.querySelector<SVGGElement>(`#${BOND_COUNTS_ID}`)
    const counted = layout.bonds.filter(b => b.count > 1 && b.id)
    if (!group && counted.length === 0) return 0
    if (!group) {
        group = document.createElementNS(SVG_URI, 'g') as SVGGElement
        group.id = BOND_COUNTS_ID
        svg.append(group)
    }
    group.setAttribute('pointer-events', 'none')
    group.replaceChildren()
    for (const bond of counted) {
        const connection = diagram.objectById(bond.id!.split('#').pop()!)
        const element = connection?.celldlSvgElement?.svgElement
        const path = (element instanceof SVGPathElement ? element : element?.querySelector('path')) as SVGPathElement|null
        if (!path) continue
        const middle = path.getPointAtLength(path.getTotalLength() / 2)
        const text = document.createElementNS(SVG_URI, 'text')
        text.setAttribute('class', 'bond-count')
        text.setAttribute('x', (middle.x + 4).toFixed(1))
        text.setAttribute('y', (middle.y - 4).toFixed(1))
        text.setAttribute('font-size', '10')
        text.setAttribute('font-weight', 'bold')
        text.setAttribute('font-family', 'sans-serif')
        text.setAttribute('fill', '#333')
        text.textContent = String(bond.count)
        group.append(text)
    }
    return group.childElementCount
}

let scheduled: ReturnType<typeof setTimeout>|undefined

/** Redraw the regions and bond counts shortly: after a diagram opens and whenever it changes. */
export function scheduleRegions(delay: number = 150) {
    if (scheduled) clearTimeout(scheduled)
    scheduled = setTimeout(() => { scheduled = undefined; drawRegions(); drawBondCounts() }, delay)
}

document.addEventListener('file-edited', () => scheduleRegions())
document.addEventListener('diagram-opened', () => scheduleRegions(50))

//==============================================================================

let lastPositions: Map<string, Point2>|undefined

// exactly (an undo), or snapped to the editor's grid as a drag is
function moveTo(objects: Map<string, CellDLObject>, positions: Map<string, Point2>, exactly: boolean = false) {
    for (const [id, to] of positions) {
        const object = objects.get(id)
        const svg = object?.celldlSvgElement
        if (!object || !svg) continue
        const from = svg.centroid
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) continue
        object.initialiseMove(svg.svgElement)
        object.reposition(from, exactly ? to : { x: Math.round(to.x), y: Math.round(to.y) },
                          exactly ? { snapGrid: false, noAlign: true } : {})
        object.finaliseMove()
    }
    notifyChanges()
}

/** The complexity of the diagram's current layout. */
export function currentComplexity(): Complexity|undefined {
    const { nodes, bonds } = diagramLayout()
    if (nodes.length === 0) return
    return layoutComplexity(nodes, bonds, complexityOptions(nodes, bonds))
}

/**
 * Move the diagram's nodes to a layout of lower complexity. Returns its complexity before and after (after
 * equals before when no better layout was found, and nothing moves). undoReorganise() puts them back.
 */
export async function reorganiseDiagram(onProgress?: (done: number, of: number) => void,
                                        options: { steps?: number, forceSteps?: number, seed?: number } = {}) {
    const { nodes, bonds, objects } = diagramLayout()
    if (nodes.length === 0) return
    const result = await reorganise(nodes, bonds, {
        ...options,
        onProgress: async (done, of) => {
            onProgress?.(done, of)
            await new Promise(resolve => setTimeout(resolve, 0))      // keep the editor responsive
        }
    })
    if (result.after.total < result.before.total) {
        lastPositions = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]))
        moveTo(objects, result.positions)
    }
    drawRegions()
    drawBondCounts()
    return { before: result.before, after: result.after, rings: result.rings }
}

export function canUndoReorganise(): boolean {
    return lastPositions !== undefined
}

/** Put the nodes back where they were before the last reorganise. */
export function undoReorganise(): boolean {
    if (!lastPositions) return false
    moveTo(diagramLayout().objects, lastPositions, true)
    lastPositions = undefined
    drawRegions()
    drawBondCounts()
    return true
}

//==============================================================================
//==============================================================================
