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
/** biome-ignore-all lint/style/noNonNullAssertion: <indices are within the nodes, cycles and regions> */

// Reorganising a bond graph's layout, so that each region is one piece (a rectangle where it can be), bonds are
// short and seldom cross, cycles are circles and nodes of a kind line up. Stages:
//
//  1. Cycles from the bonds (findCycles): the graph of stores and reactions without side compounds (sources,
//     stores bonded to more than `hubDegree` steps, and the species named in `sideCompounds`, such as ATP or
//     NAD), whose longest simple cycles, one
//     after another without sharing nodes, are the cycles to draw as circles.
//  2. Each cycle a circle: its nodes in cycle order on a circle whose circumference is a bond length per node,
//     with the side compounds bonded to them outside it; a cycle then moves, turns and flips as one body.
//  3. Regions first: the regions are placed as points (a stress layout of the regions, adjacent when a step
//     joins them), and each region's nodes moved to its point, a step between regions to between theirs.
//  4. Stress (stochastic gradient descent, Zheng, Pawar & Goodman 2018): each pair of nodes is drawn its graph
//     distance apart, in bond lengths; each node is pulled a little towards its region's point; a cycle is
//     put back to its circle (the best rigid fit) after each sweep.
//  5. Overlapping nodes pushed apart.
//  5b. Rectangles (`rectangles`, planRectangles): when the regions can be rectangles (a slicing of a box in
//     which every two regions a step joins share an edge, and every three a corner), each region's nodes are
//     mapped into its rectangle and the steps onto the shared edges, and from then on are kept there.
//  6. Annealing on the layout's complexity (./regions.ts, layoutComplexity) plus `weights.align` per column
//     and row each kind of node takes (lineCount), weighted by the options: first a snap of nearly lined-up
//     nodes of a kind onto shared columns and rows, then moves of single nodes, of a node into another's
//     column or row, of a cycle (moved, turned, flipped), of a split region's stray piece, and swaps of two
//     nodes of a region; the best layout is kept, centred where the layout was.

import {
    type Complexity, complexityOptions, layoutComplexity, type LayoutBond, type LayoutNode, type Point2, type Rect,
    strayPieces, WEIGHTS
} from './regions'

//==============================================================================

// the usual currency metabolites: drawn beside the reactions using them, never as part of a pathway's cycle
export const SIDE_COMPOUNDS = ['ATP', 'ADP', 'AMP', 'GTP', 'GDP', 'NAD', 'NADH', 'NADP', 'NADPH', 'FAD', 'FADH2', 'H',
                               'H2O', 'Pi', 'PPi', 'CO2', 'O2', 'CoA', 'Q', 'QH2', 'NH3', 'NH4', 'cytcox', 'cytcred']

export interface LayoutOptions {
    seed: number
    hubDegree: number           // a store bonded to more steps is a side compound, left out of cycles
    sideCompounds: string[]     // species that are side compounds wherever they are (ATP, NAD, H, ...)
    minCycle: number            // the fewest nodes of a cycle drawn as a circle
    cycles: boolean             // draw cycles as circles
    regionsFirst: boolean       // place the regions, then their nodes
    rectangles: boolean         // regions as rectangles where they can be (planRectangles), else free-form
    regionPull: number          // how strongly stress pulls a node towards its region (0: not at all)
    sgdSweeps: number           // stress sweeps
    steps: number               // annealing moves
    weights: typeof WEIGHTS     // of the complexity the annealing lowers
}

export const DEFAULT_OPTIONS: LayoutOptions = {
    seed: 1, hubDegree: 3, sideCompounds: SIDE_COMPOUNDS, minCycle: 6, cycles: true, regionsFirst: true, rectangles: true,
    regionPull: 0.08, sgdSweeps: 60, steps: 2000, weights: { ...WEIGHTS, align: 1.5 }
}

export interface LayoutPreset {
    id: string
    name: string
    description: string
    options: Partial<Omit<LayoutOptions, 'weights'>> & { weights?: Partial<typeof WEIGHTS> }
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
    { id: 'balanced', name: 'Balanced', description: 'Regions in one piece each, cycles as circles, short bonds and few crossings, weighed evenly.',
      options: {} },
    { id: 'crossings', name: 'Fewer crossings', description: 'Crossing bonds cost four times as much, and the annealing runs longer.',
      options: { steps: 3000, weights: { crossing: 8 } } },
    { id: 'compact', name: 'Short bonds', description: 'Bonds held near their natural length more strongly, and nodes pulled harder to their region.',
      options: { regionPull: 0.15, weights: { stretch: 2 } } },
    { id: 'regions', name: 'Simple regions', description: 'Boundaries that turn and run long cost more: smoother, more compact regions.',
      options: { regionPull: 0.12, weights: { length: 0.6, split: 20 } } },
    { id: 'cycles', name: 'Clear cycles', description: 'A node other than a cycle\'s own inside its circle costs three times as much: cleaner circles, a few more crossings.',
      options: { weights: { inside: 30 } } },
    { id: 'aligned', name: 'Lined up', description: 'Each column and row a kind of node takes costs more than twice as much: fewer, fuller lines.',
      options: { weights: { align: 4 } } },
    { id: 'gentle', name: 'Stay close', description: 'The layout as drawn, tidied: no stress stage, regions left free-form, and moving nodes far costs more.',
      options: { regionsFirst: false, rectangles: false, sgdSweeps: 0, weights: { moved: 0.3 } } },
    { id: 'freeform', name: 'Free-form regions', description: 'Regions shaped by their nodes rather than as rectangles, and no cost for columns and rows.',
      options: { rectangles: false, weights: { align: 0 } } }
]

export function presetOptions(id: string): LayoutOptions {
    const preset = LAYOUT_PRESETS.find(p => p.id === id) ?? LAYOUT_PRESETS[0]!
    return { ...DEFAULT_OPTIONS, ...preset.options, weights: { ...DEFAULT_OPTIONS.weights, ...preset.options.weights } }
}

//==============================================================================

function random(seed: number): () => number {         // mulberry32
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function adjacencyOf(nodes: LayoutNode[], bonds: LayoutBond[]): Set<number>[] {
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const adjacency = nodes.map(() => new Set<number>())
    for (const b of bonds) {
        const i = index.get(b.a), j = index.get(b.b)
        if (i === undefined || j === undefined || i === j) continue
        adjacency[i]!.add(j); adjacency[j]!.add(i)
    }
    return adjacency
}

//==============================================================================

/**
 * Cycles to draw as circles, each its nodes' indices in cycle order: the longest simple cycles of the graph of
 * stores and reactions without side compounds, taken one after another without sharing nodes.
 */
export function findCycles(nodes: LayoutNode[], bonds: LayoutBond[],
                           options: { hubDegree?: number, minCycle?: number, sideCompounds?: string[], budgetMs?: number } = {}): number[][] {
    const hubDegree = options.hubDegree ?? DEFAULT_OPTIONS.hubDegree
    const side = new Set(options.sideCompounds ?? SIDE_COMPOUNDS)
    const minCycle = options.minCycle ?? DEFAULT_OPTIONS.minCycle
    const adjacency = adjacencyOf(nodes, bonds)
    const isStep = (i: number) => nodes[i]!.kind === 'reaction' || nodes[i]!.kind === 'resistance'
    const steps = (i: number) => [...adjacency[i]!].filter(isStep).length
    const usable = new Set(nodes.map((_n, i) => i).filter(i =>
        isStep(i) || (nodes[i]!.kind === 'store' && steps(i) <= hubDegree && !side.has(nodes[i]!.text ?? ''))))
    const deadline = Date.now() + (options.budgetMs ?? 300)
    const cycles: number[][] = []
    for (;;) {
        let best: number[] = []
        const order = [...usable].sort((a, b) => a - b)
        for (const start of order) {
            // cycles through `start` and larger indices only, so each is found from its smallest node
            const path = [start], onPath = new Set([start])
            const extend = (node: number): void => {
                if (Date.now() > deadline) return
                for (const next of adjacency[node]!) {
                    if (!usable.has(next) || next < start) continue
                    if (next === start && path.length >= 3) {
                        if (path.length > best.length) best = [...path]
                        continue
                    }
                    if (onPath.has(next) || path.length >= 60) continue
                    path.push(next); onPath.add(next)
                    extend(next)
                    path.pop(); onPath.delete(next)
                }
            }
            extend(start)
        }
        if (best.length < minCycle) break
        cycles.push(best)
        for (const i of best) usable.delete(i)
        if (Date.now() > deadline) break
    }
    return cycles
}

//==============================================================================

interface Body {                // a cycle drawn as a circle, with the side compounds bonded to it
    members: number[]           // in cycle order
    attached: number[]
    shape: Point2[]             // members' and attached nodes' offsets from the centre, as first drawn
}

function circleOf(cycle: number[], attachedTo: Map<number, number>, bondLength: number): Body {
    const radius = Math.max(bondLength, bondLength * cycle.length / (2 * Math.PI))
    const shape: Point2[] = cycle.map((_i, k) => {
        const angle = 2 * Math.PI * k / cycle.length
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
    })
    const attached = [...attachedTo.keys()]
    for (const a of attached) {
        const k = cycle.indexOf(attachedTo.get(a)!)
        const siblings = attached.filter(b => attachedTo.get(b) === attachedTo.get(a))
        const spread = (siblings.indexOf(a) - (siblings.length - 1) / 2) * 0.35
        const angle = 2 * Math.PI * k / cycle.length + spread
        const r = radius + 0.75 * bondLength
        shape.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
    }
    return { members: cycle, attached, shape }
}

/** The rigid motion (turn, perhaps a flip, then a shift) that best takes the body's shape to the points. */
function fit(shape: Point2[], points: Point2[]): Point2[] {
    const n = shape.length
    const sc = { x: shape.reduce((s, p) => s + p.x, 0) / n, y: shape.reduce((s, p) => s + p.y, 0) / n }
    const pc = { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
    let best: Point2[] = [], bestError = Infinity
    for (const flip of [1, -1]) {
        let a = 0, b = 0
        shape.forEach((s, k) => {
            const sx = s.x - sc.x, sy = flip * (s.y - sc.y), px = points[k]!.x - pc.x, py = points[k]!.y - pc.y
            a += sx * px + sy * py; b += sx * py - sy * px
        })
        const angle = Math.atan2(b, a), cos = Math.cos(angle), sin = Math.sin(angle)
        const placed = shape.map(s => {
            const sx = s.x - sc.x, sy = flip * (s.y - sc.y)
            return { x: pc.x + cos * sx - sin * sy, y: pc.y + sin * sx + cos * sy }
        })
        const error = placed.reduce((e, p, k) => e + (p.x - points[k]!.x) ** 2 + (p.y - points[k]!.y) ** 2, 0)
        if (error < bestError) { bestError = error; best = placed }
    }
    return best
}

function bodyNodes(body: Body): number[] {
    return [...body.members, ...body.attached]
}

//==============================================================================

/**
 * All-pairs distances along bonds (breadth first), the disconnected one more than the longest. A path doesn't go
 * through a hub (`hubs`: side compounds such as ATP, and a membrane's capacitor), which would draw together steps
 * that only share it.
 */
function graphDistances(adjacency: Set<number>[], hubs: Set<number> = new Set()): number[][] {
    const n = adjacency.length
    const d = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity))
    let longest = 1
    for (let s = 0; s < n; s++) {
        d[s]![s] = 0
        const queue = [s]
        for (let q = 0; q < queue.length; q++) {
            const u = queue[q]!
            if (u !== s && hubs.has(u)) continue
            for (const v of adjacency[u]!) {
                if (d[s]![v] === Infinity) { d[s]![v] = d[s]![u]! + 1; longest = Math.max(longest, d[s]![v]!); queue.push(v) }
            }
        }
    }
    for (const row of d) for (let j = 0; j < n; j++) if (row[j] === Infinity) row[j] = longest + 1
    return d
}

/** Stress normalised by its pairs' target distances: 0 when every pair is its graph distance apart. */
export function normalisedStress(nodes: LayoutNode[], bonds: LayoutBond[], bondLength: number): number {
    const d = graphDistances(adjacencyOf(nodes, bonds))
    let stress = 0, scale = 0
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const target = bondLength * d[i]![j]!, w = 1 / (target * target)
            stress += w * (Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y) - target) ** 2
            scale += 1
        }
    }
    return scale ? stress / scale : 0
}

/** How far a cycle's nodes are from a circle: RMS distance from their best-fit circle over its radius. */
export function circularity(nodes: LayoutNode[], cycle: number[]): number {
    const pts = cycle.map(i => nodes[i]!)
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const radii = pts.map(p => Math.hypot(p.x - cx, p.y - cy))
    const r = radii.reduce((s, x) => s + x, 0) / radii.length
    return r > 0 ? Math.sqrt(radii.reduce((s, x) => s + (x - r) ** 2, 0) / radii.length) / r : 1
}

//==============================================================================

export interface LayoutMeasures {
    complexity: Complexity
    columns: number             // distinct x of the nodes of each kind, summed over kinds (a circle's left out)
    rows: number                // the same for y
    allColumns: number          // distinct x of every node, as the diagram shows them
    allRows: number             // the same for y
    stress: number
    meanBond: number            // mean bond length, in natural bond lengths
    circularity: number         // mean over the cycles drawn as circles (0: circles)
}

export interface LayoutResult {
    positions: Map<string, Point2>
    before: LayoutMeasures
    after: LayoutMeasures
    cycles: string[][]          // the cycles drawn as circles, by node id
    rectangles?: Map<string, Rect>  // the regions' rectangles, when they could be
    improved: boolean
    milliseconds: number
}

/** The layout's complexity with a cost for each cycle by how far its nodes are from a circle. */
/** A cycle's centre and radius, as drawn. */
function circleAt(nodes: LayoutNode[], cycle: number[]): { x: number, y: number, r: number } {
    const x = cycle.reduce((s, i) => s + nodes[i]!.x, 0) / cycle.length, y = cycle.reduce((s, i) => s + nodes[i]!.y, 0) / cycle.length
    return { x, y, r: cycle.reduce((s, i) => s + Math.hypot(nodes[i]!.x - x, nodes[i]!.y - y), 0) / cycle.length }
}

/** Nodes, not a cycle's own, inside its circle (as CiSE, a circle's inside is kept clear). */
export function intruders(nodes: LayoutNode[], cycles: number[][]): number {
    let count = 0
    for (const cycle of cycles) {
        const own = new Set(cycle), c = circleAt(nodes, cycle)
        nodes.forEach((m, i) => { if (!own.has(i) && Math.hypot(m.x - c.x, m.y - c.y) < 0.8 * c.r) count++ })
    }
    return count
}

/**
 * The layout's complexity with a cost for each cycle by how far its nodes are from a circle, and for each node
 * inside a cycle's circle that isn't the cycle's.
 */
function withCircles(complexity: Complexity, nodes: LayoutNode[], cycles: number[][], weights: typeof WEIGHTS): Complexity {
    const off = cycles.reduce((s, c) => s + circularity(nodes, c), 0)
    const inside = intruders(nodes, cycles)
    return { ...complexity, total: complexity.total + weights.circle * off + weights.inside * inside }
}

function measures(nodes: LayoutNode[], bonds: LayoutBond[], cycles: number[][], settings: ReturnType<typeof complexityOptions>
                  & { start?: Map<string, Point2> }, weights: typeof WEIGHTS, exclude: Set<number>): LayoutMeasures {
    const saved = { ...WEIGHTS }
    Object.assign(WEIGHTS, weights)
    const lines = lineCount(nodes, exclude)
    const measured = withCircles(layoutComplexity(nodes, bonds, settings), nodes, cycles, weights)
    const complexity = { ...measured, total: measured.total + weights.align * (lines.columns + lines.rows) }
    Object.assign(WEIGHTS, saved)
    const byId = new Map(nodes.map(n => [n.id, n]))
    const lengths = bonds.map(b => [byId.get(b.a), byId.get(b.b)]).filter(([a, c]) => a && c)
                         .map(([a, c]) => Math.hypot(a!.x - c!.x, a!.y - c!.y) / settings.bondLength)
    return {
        complexity, columns: lines.columns, rows: lines.rows, allColumns: lines.allColumns, allRows: lines.allRows,
        stress: normalisedStress(nodes, bonds, settings.bondLength),
        meanBond: lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0,
        circularity: cycles.length ? cycles.reduce((s, c) => s + circularity(nodes, c), 0) / cycles.length : 0
    }
}

//==============================================================================

/**
 * Distinct columns (x) and rows (y) of the nodes, by kind (reactions, stores, ...) and summed over kinds,
 * leaving out `exclude` (the nodes on a cycle's circle, which the circle places): what the layout's cost counts.
 * Fewer reads as tidier: nodes lined up. `allColumns` and `allRows` are the distinct x and y of every node, of
 * any kind, as the diagram shows them.
 */
export function lineCount(nodes: LayoutNode[], exclude: Set<number> = new Set()):
        { columns: number, rows: number, allColumns: number, allRows: number } {
    const kinds = new Map<string, number[]>()
    nodes.forEach((m, i) => { if (!exclude.has(i)) kinds.set(m.kind ?? 'other', [...(kinds.get(m.kind ?? 'other') ?? []), i]) })
    let columns = 0, rows = 0
    const distinct = (values: number[]) => values.sort((a, b) => a - b).filter((v, k) => k === 0 || v - values[k - 1]! > 0.5).length
    for (const idx of kinds.values()) {
        columns += distinct(idx.map(i => nodes[i]!.x))
        rows += distinct(idx.map(i => nodes[i]!.y))
    }
    return { columns, rows, allColumns: distinct(nodes.map(m => m.x)), allRows: distinct(nodes.map(m => m.y)) }
}

type Target = Rect                  // where a node must be: a rectangle, a segment or a point (a degenerate rectangle)

interface Slicing { leaf?: string, cut?: 'x'|'y', a?: Slicing, b?: Slicing }

function slicings(labels: string[]): Slicing[] {
    if (labels.length === 1) return [{ leaf: labels[0]! }]
    const out: Slicing[] = []
    const n = labels.length
    for (let mask = 1; mask < (1 << n) - 1; mask++) {
        const a = labels.filter((_l, k) => mask & (1 << k)), b = labels.filter((_l, k) => !(mask & (1 << k)))
        for (const ta of slicings(a)) for (const tb of slicings(b)) for (const cut of ['x', 'y'] as const) out.push({ cut, a: ta, b: tb })
    }
    return out
}

function slicingArea(t: Slicing, area: Map<string, number>): number {
    return t.leaf ? area.get(t.leaf)! : slicingArea(t.a!, area) + slicingArea(t.b!, area)
}

function placeSlicing(t: Slicing, box: Rect, area: Map<string, number>, out: Map<string, Rect>) {
    if (t.leaf) { out.set(t.leaf, box); return }
    const f = slicingArea(t.a!, area) / slicingArea(t, area)
    if (t.cut === 'x') {
        const x = box.x0 + f * (box.x1 - box.x0)
        placeSlicing(t.a!, { ...box, x1: x }, area, out); placeSlicing(t.b!, { ...box, x0: x }, area, out)
    } else {
        const y = box.y0 + f * (box.y1 - box.y0)
        placeSlicing(t.a!, { ...box, y1: y }, area, out); placeSlicing(t.b!, { ...box, y0: y }, area, out)
    }
}

/**
 * Rectangles for the regions, when they can be: a slicing of a box into a rectangle per region (sized to its
 * nodes and any cycle in it), where every two regions a step joins share an edge at least a bond long and every
 * three share a corner. Of those, the one with the squarest rectangles that best keeps the regions' current
 * arrangement. Each boundary step's target is the shared edge (or corner). Undefined when no slicing meets the
 * conditions, or there are more than five regions or a step joins more than three.
 */
export function planRectangles(nodes: LayoutNode[], L: number, cycleSpan: Map<string, number>):
        { rects: Map<string, Rect>, targets: Map<number, Target> } | undefined {
    const labels = [...new Set(nodes.flatMap(m => m.labels))].sort()
    if (labels.length === 0 || labels.length > 5) return undefined
    const steps = nodes.map((m, i) => m.labels.length > 1 ? i : -1).filter(i => i >= 0)
    if (steps.some(i => nodes[i]!.labels.length > 3)) return undefined
    const own = (l: string) => nodes.filter(m => m.labels.length === 1 && m.labels[0] === l)
    if (labels.some(l => own(l).length === 0)) return undefined
    const area = new Map(labels.map(l => {
        const span = cycleSpan.get(l) ?? 0
        return [l, Math.max((own(l).length + 1) * (1.7 * L) ** 2, 1.3 * span * span)]
    }))
    const all = { x0: Math.min(...nodes.map(m => m.x)), y0: Math.min(...nodes.map(m => m.y)),
                  x1: Math.max(...nodes.map(m => m.x)), y1: Math.max(...nodes.map(m => m.y)) }
    const aspect = Math.min(2, Math.max(0.5, (all.x1 - all.x0 + L) / (all.y1 - all.y0 + L)))
    const total = [...area.values()].reduce((s, a) => s + a, 0) * 1.15
    const W = Math.sqrt(total * aspect), H = total / W
    const cx = (all.x0 + all.x1) / 2, cy = (all.y0 + all.y1) / 2
    const box = { x0: cx - W / 2, y0: cy - H / 2, x1: cx + W / 2, y1: cy + H / 2 }
    // each region's shape now (width over height), to keep it as close as can be
    const shapeNow = new Map(labels.map(l => {
        const m = own(l)
        const w = Math.max(...m.map(o => o.x)) - Math.min(...m.map(o => o.x)) + L, h = Math.max(...m.map(o => o.y)) - Math.min(...m.map(o => o.y)) + L
        return [l, w / h]
    }))
    // where each region is now, in the box's frame
    const now = new Map(labels.map(l => {
        const m = own(l)
        const x = m.reduce((s, o) => s + o.x, 0) / m.length, y = m.reduce((s, o) => s + o.y, 0) / m.length
        return [l, { x: box.x0 + (x - all.x0) / Math.max(all.x1 - all.x0, 1) * W, y: box.y0 + (y - all.y0) / Math.max(all.y1 - all.y0, 1) * H }]
    }))
    const eps = 1e-6 * (W + H)
    const shared = (a: Rect, b: Rect): Rect|undefined => {
        const oy = [Math.max(a.y0, b.y0), Math.min(a.y1, b.y1)], ox = [Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)]
        if ((Math.abs(a.x1 - b.x0) < eps || Math.abs(b.x1 - a.x0) < eps) && oy[1]! - oy[0]! >= L) {
            const x = Math.abs(a.x1 - b.x0) < eps ? a.x1 : a.x0
            return { x0: x, x1: x, y0: oy[0]! + 0.5 * L, y1: oy[1]! - 0.5 * L }
        }
        if ((Math.abs(a.y1 - b.y0) < eps || Math.abs(b.y1 - a.y0) < eps) && ox[1]! - ox[0]! >= L) {
            const y = Math.abs(a.y1 - b.y0) < eps ? a.y1 : a.y0
            return { y0: y, y1: y, x0: ox[0]! + 0.5 * L, x1: ox[1]! - 0.5 * L }
        }
        return undefined
    }
    const near = (p: Point2, r: Rect) => p.x >= r.x0 - eps && p.x <= r.x1 + eps && p.y >= r.y0 - eps && p.y <= r.y1 + eps
    let best: { score: number, rects: Map<string, Rect>, targets: Map<number, Target> } | undefined
    for (const t of slicings(labels)) {
        const rects = new Map<string, Rect>()
        placeSlicing(t, box, area, rects)
        const targets = new Map<number, Target>()
        const atCorner = new Map<string, number[]>()
        let ok = true
        for (const i of steps) {
            const rs = nodes[i]!.labels.map(l => rects.get(l)!)
            if (rs.length === 2) {
                const s = shared(rs[0]!, rs[1]!)
                if (!s) { ok = false; break }
                targets.set(i, s)
            } else {
                const corner = rs.flatMap(r => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x0, y: r.y1 }, { x: r.x1, y: r.y1 }])
                                 .find(p => rs.every(r => near(p, r)))
                if (!corner) { ok = false; break }
                targets.set(i, { x0: corner.x, x1: corner.x, y0: corner.y, y1: corner.y })
                const key = `${corner.x},${corner.y}`
                atCorner.set(key, [...(atCorner.get(key) ?? []), i])
            }
        }
        if (!ok) continue
        // three regions meet at a point only: the steps joining them sit side by side across it, along the
        // longest edge running from it
        for (const idx of atCorner.values()) {
            if (idx.length < 2) continue
            const c = targets.get(idx[0]!)!
            const rs = nodes[idx[0]!]!.labels.map(l => rects.get(l)!)
            const run = (dx: number, dy: number) => {
                let reach = 0
                for (const r of rs) {
                    if (dx && r.y0 <= c.y0 + eps && r.y1 >= c.y0 - eps && (r.y0 < c.y0 - eps) !== (r.y1 > c.y0 + eps)) {
                        reach = Math.max(reach, dx > 0 ? r.x1 - c.x0 : c.x0 - r.x0)
                    }
                    if (dy && r.x0 <= c.x0 + eps && r.x1 >= c.x0 - eps && (r.x0 < c.x0 - eps) !== (r.x1 > c.x0 + eps)) {
                        reach = Math.max(reach, dy > 0 ? r.y1 - c.y0 : c.y0 - r.y0)
                    }
                }
                return reach
            }
            const ways: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            const [dx, dy] = ways.reduce((a, w) => run(w[0], w[1]) > run(a[0], a[1]) ? w : a, ways[0]!)
            const across = (Math.abs(dx) ? Math.max(...idx.map(i => nodes[i]!.w)) : Math.max(...idx.map(i => nodes[i]!.h))) + 0.4 * L
            idx.forEach((i, k) => {
                const off = (k - (idx.length - 1) / 2) * across
                targets.set(i, { x0: c.x0 + dx * off, x1: c.x0 + dx * off, y0: c.y0 + dy * off, y1: c.y0 + dy * off })
            })
        }
        let score = 0
        for (const [l, r] of rects) {
            const w = r.x1 - r.x0, h = r.y1 - r.y0
            const span = cycleSpan.get(l) ?? 0
            if (Math.min(w, h) < span) { ok = false; break }
            score += 0.5 * Math.abs(Math.log(w / h)) + Math.abs(Math.log((w / h) / shapeNow.get(l)!)) + 3 * Math.hypot((r.x0 + r.x1) / 2 - now.get(l)!.x, (r.y0 + r.y1) / 2 - now.get(l)!.y) / Math.hypot(W, H)
        }
        if (ok && (!best || score < best.score)) best = { score, rects, targets }
    }
    return best && { rects: best.rects, targets: best.targets }
}

function clampTo(p: Point2, r: Target): Point2 {
    return { x: Math.min(Math.max(p.x, r.x0), r.x1), y: Math.min(Math.max(p.y, r.y0), r.y1) }
}

/** A layout of the nodes, by the stages in the module's comment. */
export async function reorganiseLayout(input: LayoutNode[], bonds: LayoutBond[], given: Partial<LayoutOptions> = {},
                                       onProgress?: (done: number, of: number) => void | Promise<void>): Promise<LayoutResult> {
    const started = Date.now()
    const options: LayoutOptions = { ...DEFAULT_OPTIONS, ...given, weights: { ...DEFAULT_OPTIONS.weights, ...given.weights } }
    const rand = random(options.seed)
    const nodes = input.map(n => ({ ...n }))
    const n = nodes.length
    const base = complexityOptions(input, bonds)
    const L = base.bondLength
    const start = new Map(input.map(m => [m.id, { x: m.x, y: m.y }]))
    const settings = { ...base, start, rectangles: options.rectangles }
    const adjacency = adjacencyOf(nodes, bonds)

    // 1-2. cycles, as rigid circles with their side compounds
    const cycles = options.cycles ? findCycles(nodes, bonds, options) : []
    const inCycle = new Set(cycles.flat())
    const bodies: Body[] = cycles.map(cycle => {
        const attachedTo = new Map<number, number>()
        for (const m of cycle) {
            for (const a of adjacency[m]!) {
                if (!inCycle.has(a) && adjacency[a]!.size === 1 && !attachedTo.has(a)) attachedTo.set(a, m)
            }
        }
        return circleOf(cycle, attachedTo, L)
    })
    const bodyOf = new Int32Array(n).fill(-1)
    bodies.forEach((b, k) => { for (const i of bodyNodes(b)) bodyOf[i] = k })
    const before = measures(input, bonds, cycles, settings, options.weights, inCycle)
    // each cycle's region (most of its nodes'), and the span its circle needs
    const cycleSpan = new Map<string, number>()
    const bodyLabel = bodies.map(body => {
        const count = new Map<string, number>()
        for (const i of body.members) if (nodes[i]!.labels.length === 1) count.set(nodes[i]!.labels[0]!, (count.get(nodes[i]!.labels[0]!) ?? 0) + 1)
        const label = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        const radius = Math.max(...body.shape.map(p => Math.hypot(p.x, p.y)))
        if (label) cycleSpan.set(label, Math.max(cycleSpan.get(label) ?? 0, 2 * radius + 1.5 * L))
        return label
    })
    const total = options.sgdSweeps + options.steps

    // 3. regions first: as rectangles when they can be, else as points; then their nodes
    const labels = [...new Set(nodes.flatMap(m => m.labels))].sort()
    let plan: ReturnType<typeof planRectangles>
    const inset = 0.35 * L
    const targetOf = (i: number): Target|undefined => {
        const m = nodes[i]!
        if (!plan) return undefined
        if (m.labels.length > 1) return plan.targets.get(i)
        if (m.labels.length === 1) {
            const r = plan.rects.get(m.labels[0]!)!
            const ix = Math.min(m.w / 2 + inset, (r.x1 - r.x0) / 2), iy = Math.min(m.h / 2 + inset, (r.y1 - r.y0) / 2)
            return { x0: r.x0 + ix, x1: r.x1 - ix, y0: r.y0 + iy, y1: r.y1 - iy }
        }
        return undefined
    }
    // every node where it must be: a node in its region's rectangle, a boundary step on its edge, a cycle (as a body)
    // in its region's rectangle
    const project = () => {
        const placed = plan
        if (!placed) return
        bodies.forEach((body, k) => {
            const label = bodyLabel[k]
            const r = label ? placed.rects.get(label) : undefined
            if (!r) return
            const idx = bodyNodes(body)
            const bx0 = Math.min(...idx.map(i => nodes[i]!.x - nodes[i]!.w / 2)) - inset, bx1 = Math.max(...idx.map(i => nodes[i]!.x + nodes[i]!.w / 2)) + inset
            const by0 = Math.min(...idx.map(i => nodes[i]!.y - nodes[i]!.h / 2)) - inset, by1 = Math.max(...idx.map(i => nodes[i]!.y + nodes[i]!.h / 2)) + inset
            const dx = bx1 - bx0 > r.x1 - r.x0 ? (r.x0 + r.x1 - bx0 - bx1) / 2 : bx0 < r.x0 ? r.x0 - bx0 : bx1 > r.x1 ? r.x1 - bx1 : 0
            const dy = by1 - by0 > r.y1 - r.y0 ? (r.y0 + r.y1 - by0 - by1) / 2 : by0 < r.y0 ? r.y0 - by0 : by1 > r.y1 ? r.y1 - by1 : 0
            for (const i of idx) { nodes[i]!.x += dx; nodes[i]!.y += dy }
        })
        nodes.forEach((m, i) => {
            if (bodyOf[i]! >= 0) return
            const t = targetOf(i)
            if (t) { const p = clampTo(m, t); m.x = p.x; m.y = p.y }
        })
    }
    if (options.regionsFirst && labels.length) {
        const members = labels.map(l => nodes.map((m, i) => m.labels.length === 1 && m.labels[0] === l ? i : -1).filter(i => i >= 0))
        const centre = (idx: number[]) => idx.length
            ? { x: idx.reduce((s, i) => s + nodes[i]!.x, 0) / idx.length, y: idx.reduce((s, i) => s + nodes[i]!.y, 0) / idx.length }
            : { x: 0, y: 0 }
        const points = members.map(centre)
        const size = members.map(m => L * Math.sqrt(Math.max(m.length, 1)) * 0.9)
        const adjacent = labels.map(() => labels.map(() => false))
        for (const m of nodes) {
            if (m.labels.length < 2) continue
            for (const a of m.labels) for (const b of m.labels) if (a !== b) adjacent[labels.indexOf(a)]![labels.indexOf(b)] = true
        }
        for (let it = 0; it < 200 && labels.length > 1; it++) {
            for (let a = 0; a < labels.length; a++) {
                for (let b = a + 1; b < labels.length; b++) {
                    const target = (size[a]! + size[b]!) * (adjacent[a]![b] ? 1 : 1.6)
                    const dx = points[b]!.x - points[a]!.x, dy = points[b]!.y - points[a]!.y, d = Math.hypot(dx, dy) || 1
                    const move = 0.1 * (d - target) / d
                    points[a]!.x += move * dx; points[a]!.y += move * dy; points[b]!.x -= move * dx; points[b]!.y -= move * dy
                }
            }
        }
        members.forEach((idx, l) => {
            const c = centre(idx)
            for (const i of idx) { nodes[i]!.x += points[l]!.x - c.x; nodes[i]!.y += points[l]!.y - c.y }
        })
        nodes.forEach(m => {
            if (m.labels.length < 2) return
            const ps = m.labels.map(l => points[labels.indexOf(l)]!)
            m.x = ps.reduce((s, p) => s + p.x, 0) / ps.length + (rand() - 0.5) * L
            m.y = ps.reduce((s, p) => s + p.y, 0) / ps.length + (rand() - 0.5) * L
        })
    }
    const regionPoint = (m: LayoutNode): Point2|undefined => {
        const idx = nodes.map((o, i) => o.labels.length === 1 && m.labels.includes(o.labels[0]!) ? i : -1).filter(i => i >= 0)
        if (!m.labels.length || !idx.length) return undefined
        return { x: idx.reduce((s, i) => s + nodes[i]!.x, 0) / idx.length, y: idx.reduce((s, i) => s + nodes[i]!.y, 0) / idx.length }
    }
    // each cycle drawn as its circle where its nodes are, turned and flipped to fit them
    const snap = () => {
        for (const body of bodies) {
            const idx = bodyNodes(body)
            const placed = fit(body.shape, idx.map(i => nodes[i]!))
            idx.forEach((i, k) => { nodes[i]!.x = placed[k]!.x; nodes[i]!.y = placed[k]!.y })
            // other nodes out of the circle, to just beyond it
            const own = new Set(idx), c = circleAt(nodes, body.members)
            nodes.forEach((m, i) => {
                if (own.has(i) || bodyOf[i]! >= 0) return
                const dx = m.x - c.x, dy = m.y - c.y, d = Math.hypot(dx, dy)
                if (d >= 0.8 * c.r) return
                const angle = d > 1e-6 ? Math.atan2(dy, dx) : 2 * Math.PI * rand()
                m.x = c.x + (c.r + 0.6 * L) * Math.cos(angle); m.y = c.y + (c.r + 0.6 * L) * Math.sin(angle)
            })
        }
    }
    snap()
    project()

    // 4. stress by stochastic gradient descent, with a pull towards each node's region
    if (options.sgdSweeps > 0) {
        const hubs = new Set(nodes.map((m, i) => m.kind !== 'reaction' && m.kind !== 'resistance'
                                                  && adjacency[i]!.size > options.hubDegree ? i : -1).filter(i => i >= 0))
        const d = graphDistances(adjacency, hubs)
        const pairs: [number, number][] = []
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j])
        const wMin = 1 / (L * Math.max(...d.flat())) ** 2, wMax = 1 / (L * L)
        const etaMax = 1 / wMin, etaMin = 0.01 / wMax
        const lambda = Math.log(etaMax / etaMin) / Math.max(options.sgdSweeps - 1, 1)
        for (let sweep = 0; sweep < options.sgdSweeps; sweep++) {
            const eta = etaMax * Math.exp(-lambda * sweep)
            for (let k = pairs.length - 1; k > 0; k--) {
                const r = Math.floor(rand() * (k + 1)); [pairs[k], pairs[r]] = [pairs[r]!, pairs[k]!]
            }
            for (const [i, j] of pairs) {
                const a = nodes[i]!, b = nodes[j]!
                const target = L * d[i]![j]!, w = 1 / (target * target)
                const dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy) || 1e-6
                const mu = Math.min(w * eta, 1)
                const r = mu * (dist - target) / (2 * dist)
                a.x -= r * dx; a.y -= r * dy; b.x += r * dx; b.y += r * dy
            }
            if (options.regionPull > 0 && !plan) {
                const pts = nodes.map(regionPoint)
                nodes.forEach((m, i) => {
                    const p = pts[i]
                    if (!p) return
                    const k = options.regionPull * (m.labels.length > 1 ? 2 : 1)
                    m.x += k * (p.x - m.x); m.y += k * (p.y - m.y)
                })
            }
            snap()
            project()
            if (onProgress && sweep % 10 === 0) await onProgress(sweep, total)
        }
    }

    // 5. overlapping nodes pushed apart (a cycle's as one body), kept where they must be
    const gap = base.gap
    const separate = () => { for (let pass = 0; pass < 30; pass++) {
        let moved = false
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (bodyOf[i]! >= 0 && bodyOf[i] === bodyOf[j]) continue
                const a = nodes[i]!, b = nodes[j]!
                const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y)
                if (ox <= 0 || oy <= 0) continue
                moved = true
                const along = ox < oy ? 'x' : 'y', push = (Math.min(ox, oy) / 2 + 0.5) * (a[along] <= b[along] ? 1 : -1)
                const shift = (k: number, s: number) => {
                    const idx = bodyOf[k]! >= 0 ? bodyNodes(bodies[bodyOf[k]!]!) : [k]
                    for (const m of idx) nodes[m]![along] += s / (bodyOf[k]! >= 0 ? 2 : 1)
                }
                shift(i, -push); shift(j, push)
            }
        }
        project()
        if (!moved) break
    } }
    separate()
    // 5b. rectangles for the regions, planned from where the free-form stages left them; each region's nodes
    // mapped into its rectangle keeping their arrangement, so the untangling is kept
    plan = options.rectangles ? planRectangles(nodes, L, cycleSpan) : undefined
    if (plan) {
        for (const label of labels) {
            const idx = nodes.map((m, i) => m.labels.length === 1 && m.labels[0] === label ? i : -1).filter(i => i >= 0)
            const r = plan.rects.get(label)!
            if (idx.length === 0) continue
            const x0 = Math.min(...idx.map(i => nodes[i]!.x)), x1 = Math.max(...idx.map(i => nodes[i]!.x))
            const y0 = Math.min(...idx.map(i => nodes[i]!.y)), y1 = Math.max(...idx.map(i => nodes[i]!.y))
            for (const i of idx) {
                nodes[i]!.x = r.x0 + inset + (x1 > x0 ? (nodes[i]!.x - x0) / (x1 - x0) : 0.5) * (r.x1 - r.x0 - 2 * inset)
                nodes[i]!.y = r.y0 + inset + (y1 > y0 ? (nodes[i]!.y - y0) / (y1 - y0) : 0.5) * (r.y1 - r.y0 - 2 * inset)
            }
        }
        // the steps on one edge spread evenly along it, in their order
        const byEdge = new Map<string, number[]>()
        for (const [i, t] of plan.targets) {
            const key = `${t.x0},${t.y0},${t.x1},${t.y1}`
            byEdge.set(key, [...(byEdge.get(key) ?? []), i])
        }
        for (const idx of byEdge.values()) {
            const t = plan.targets.get(idx[0]!)!
            const along = t.x1 - t.x0 >= t.y1 - t.y0 ? 'x' : 'y'
            idx.sort((a, b) => nodes[a]![along] - nodes[b]![along])
            idx.forEach((i, k) => {
                const f = (k + 1) / (idx.length + 1)
                nodes[i]!.x = t.x0 + f * (t.x1 - t.x0); nodes[i]!.y = t.y0 + f * (t.y1 - t.y0)
            })
        }
        snap()
        project()
        separate()
    }
    project()

    // 6. annealing on the weighted complexity, with a cost for each column and row a kind of node takes
    const saved = { ...WEIGHTS }
    Object.assign(WEIGHTS, options.weights)
    const energyOf = () => {
        const c = withCircles(layoutComplexity(nodes, bonds, settings), nodes, cycles, options.weights)
        if (options.weights.align <= 0) return c
        const lines = lineCount(nodes, inCycle)
        return { ...c, total: c.total + options.weights.align * (lines.columns + lines.rows) }
    }
    // nodes of a kind snapped to shared columns and rows (within half a bond), then apart along them; kept if better
    if (options.weights.align > 0) {
        const keep = nodes.map(m => ({ x: m.x, y: m.y }))
        const was = energyOf().total
        const kinds = new Map<string, number[]>()
        nodes.forEach((m, i) => { if (!inCycle.has(i)) kinds.set(m.kind ?? 'other', [...(kinds.get(m.kind ?? 'other') ?? []), i]) })
        for (const idx of kinds.values()) {
            for (const axis of ['x', 'y'] as const) {
                const sorted = [...idx].sort((a, b) => nodes[a]![axis] - nodes[b]![axis])
                let group: number[] = []
                const flush = () => {
                    if (group.length > 1) {
                        const values = group.map(i => nodes[i]![axis]).sort((a, b) => a - b)
                        const median = values[Math.floor(values.length / 2)]!
                        for (const i of group) nodes[i]![axis] = median
                    }
                    group = []
                }
                for (const i of sorted) {
                    if (group.length && nodes[i]![axis] - nodes[group[0]!]![axis] > 0.5 * L) flush()
                    group.push(i)
                }
                flush()
            }
        }
        // nodes sharing a column (or row) and overlapping are moved apart along it
        for (let pass = 0; pass < 20; pass++) {
            let movedApart = false
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    if (bodyOf[i]! >= 0 || bodyOf[j]! >= 0) continue
                    const a = nodes[i]!, b = nodes[j]!
                    const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y)
                    if (ox <= 0 || oy <= 0) continue
                    movedApart = true
                    const along = Math.abs(a.x - b.x) < 0.5 ? 'y' : Math.abs(a.y - b.y) < 0.5 ? 'x' : ox < oy ? 'x' : 'y'
                    const push = ((along === 'x' ? ox : oy) / 2 + 0.5) * (a[along] <= b[along] ? 1 : -1)
                    a[along] -= push; b[along] += push
                }
            }
            project()
            if (!movedApart) break
        }
        if (energyOf().total >= was) keep.forEach((p, i) => { nodes[i]!.x = p.x; nodes[i]!.y = p.y })
    }
    let current = energyOf(), energy = current.total
    let best = nodes.map(m => ({ x: m.x, y: m.y })), bestEnergy = energy
    const steps = plan ? 3 * options.steps : options.steps         // a move is cheaper with rectangles (no grid)
    for (let it = 0; it < steps; it++) {
        const cooling = 1 - it / steps
        const old = nodes.map(m => ({ x: m.x, y: m.y }))
        const choice = rand()
        const stray = current.subspaces > current.regions && choice < 0.15
            ? strayPieces(nodes, bonds, base).filter(p => p.members.every(i => bodyOf[i]! < 0)) : []
        if (stray.length) {
            const piece = stray[Math.floor(rand() * stray.length)]!
            const cx = piece.members.reduce((s, i) => s + nodes[i]!.x, 0) / piece.members.length
            const cy = piece.members.reduce((s, i) => s + nodes[i]!.y, 0) / piece.members.length
            const f = 0.3 + 0.7 * rand()
            for (const i of piece.members) { nodes[i]!.x += f * (piece.x - cx); nodes[i]!.y += f * (piece.y - cy) }
        } else if (choice < 0.3) {
            // a node (not in a cycle) to the middle of its neighbours, which untangles crossings
            const k = Math.floor(rand() * n)
            const around = [...adjacency[k]!]
            if (bodyOf[k]! < 0 && around.length) {
                const f = 0.5 + 0.5 * rand()
                nodes[k]!.x += f * (around.reduce((s, i) => s + nodes[i]!.x, 0) / around.length - nodes[k]!.x)
                nodes[k]!.y += f * (around.reduce((s, i) => s + nodes[i]!.y, 0) / around.length - nodes[k]!.y)
            }
        } else if (choice < 0.4) {
            // swap two nodes of one region (neither in a cycle)
            const i = Math.floor(rand() * n), j = Math.floor(rand() * n)
            if (i !== j && bodyOf[i]! < 0 && bodyOf[j]! < 0 && nodes[i]!.labels.join() === nodes[j]!.labels.join()) {
                const t = { x: nodes[i]!.x, y: nodes[i]!.y }
                nodes[i]!.x = nodes[j]!.x; nodes[i]!.y = nodes[j]!.y; nodes[j]!.x = t.x; nodes[j]!.y = t.y
            }
        } else if (choice < 0.55 && options.weights.align > 0) {
            // a node (not on a cycle's circle) into another's column or row, of its own kind
            const k = Math.floor(rand() * n), j = Math.floor(rand() * n)
            if (k !== j && !inCycle.has(k) && nodes[k]!.kind === nodes[j]!.kind) {
                if (rand() < 0.5) nodes[k]!.x = nodes[j]!.x
                else nodes[k]!.y = nodes[j]!.y
            }
        } else {
            const k = Math.floor(rand() * n)
            const idx = bodyOf[k]! >= 0 ? bodyNodes(bodies[bodyOf[k]!]!) : [k]
            const step = base.sigma * (0.8 * cooling + 0.1)
            const angle = 2 * Math.PI * rand(), radius = step * Math.sqrt(-2 * Math.log(rand() + 1e-12))
            if (idx.length > 1 && rand() < 0.4) {
                // turn the cycle, or flip it over its centre's vertical
                const cx = idx.reduce((s, i) => s + nodes[i]!.x, 0) / idx.length
                const cy = idx.reduce((s, i) => s + nodes[i]!.y, 0) / idx.length
                if (rand() < 0.25) {
                    for (const i of idx) nodes[i]!.x = 2 * cx - nodes[i]!.x
                } else {
                    const turn = (rand() - 0.5) * 0.8 * (cooling + 0.1), cos = Math.cos(turn), sin = Math.sin(turn)
                    for (const i of idx) {
                        const dx = nodes[i]!.x - cx, dy = nodes[i]!.y - cy
                        nodes[i]!.x = cx + cos * dx - sin * dy; nodes[i]!.y = cy + sin * dx + cos * dy
                    }
                }
            } else {
                for (const i of idx) { nodes[i]!.x += radius * Math.cos(angle); nodes[i]!.y += radius * Math.sin(angle) }
            }
        }
        project()
        const measured = energyOf()
        const temperature = 2 * cooling + 1e-3
        if (measured.total < energy || rand() < Math.exp(-(measured.total - energy) / temperature)) {
            energy = measured.total; current = measured
            if (energy < bestEnergy) { bestEnergy = energy; best = nodes.map(m => ({ x: m.x, y: m.y })) }
        } else {
            old.forEach((p, i) => { nodes[i]!.x = p.x; nodes[i]!.y = p.y })
        }
        if (onProgress && it % 100 === 0) await onProgress(options.sgdSweeps + it * options.steps / steps, total)
    }
    Object.assign(WEIGHTS, saved)
    best.forEach((p, i) => { nodes[i]!.x = p.x; nodes[i]!.y = p.y })
    // centred where the layout was
    const sx = (input.reduce((s, m) => s + m.x, 0) - nodes.reduce((s, m) => s + m.x, 0)) / n
    const sy = (input.reduce((s, m) => s + m.y, 0) - nodes.reduce((s, m) => s + m.y, 0)) / n
    for (const m of nodes) { m.x += sx; m.y += sy }
    const after = measures(nodes, bonds, cycles, settings, options.weights, inCycle)
    const improved = after.complexity.total < before.complexity.total
    const moveRect = (r: Rect) => ({ x0: r.x0 + sx, y0: r.y0 + sy, x1: r.x1 + sx, y1: r.y1 + sy })
    return {
        positions: improved ? new Map(nodes.map(m => [m.id, { x: m.x, y: m.y }])) : start,
        before, after: improved ? after : before,
        cycles: cycles.map(c => c.map(i => nodes[i]!.id)),
        rectangles: improved && plan ? new Map([...plan.rects].map(([l, r]) => [l, moveRect(r)])) : undefined,
        improved, milliseconds: Date.now() - started
    }
}

//==============================================================================
//==============================================================================
