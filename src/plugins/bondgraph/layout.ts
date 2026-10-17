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

// Reorganising a bond graph's layout, so that each region is one piece, bonds are short and seldom cross, and
// cycles are circles. Stages:
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
//  6. Annealing on the layout's complexity (./regions.ts, layoutComplexity), weighted by the options: moves of
//     single nodes, of a cycle (moved, turned, flipped), of a split region's stray piece, and swaps of two
//     nodes of a region; the best layout is kept, centred where the layout was.

import {
    type Complexity, complexityOptions, layoutComplexity, type LayoutBond, type LayoutNode, type Point2, strayPieces,
    WEIGHTS
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
    regionPull: number          // how strongly stress pulls a node towards its region (0: not at all)
    sgdSweeps: number           // stress sweeps
    steps: number               // annealing moves
    weights: typeof WEIGHTS     // of the complexity the annealing lowers
}

export const DEFAULT_OPTIONS: LayoutOptions = {
    seed: 1, hubDegree: 3, sideCompounds: SIDE_COMPOUNDS, minCycle: 6, cycles: true, regionsFirst: true, regionPull: 0.08,
    sgdSweeps: 60, steps: 2000, weights: { ...WEIGHTS }
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
    { id: 'gentle', name: 'Stay close', description: 'The layout as drawn, tidied: no stress stage, and moving nodes far costs more.',
      options: { regionsFirst: false, sgdSweeps: 0, weights: { moved: 0.3 } } }
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
    stress: number
    meanBond: number            // mean bond length, in natural bond lengths
    circularity: number         // mean over the cycles drawn as circles (0: circles)
}

export interface LayoutResult {
    positions: Map<string, Point2>
    before: LayoutMeasures
    after: LayoutMeasures
    cycles: string[][]          // the cycles drawn as circles, by node id
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
                  & { start?: Map<string, Point2> }, weights: typeof WEIGHTS): LayoutMeasures {
    const saved = { ...WEIGHTS }
    Object.assign(WEIGHTS, weights)
    const complexity = withCircles(layoutComplexity(nodes, bonds, settings), nodes, cycles, weights)
    Object.assign(WEIGHTS, saved)
    const byId = new Map(nodes.map(n => [n.id, n]))
    const lengths = bonds.map(b => [byId.get(b.a), byId.get(b.b)]).filter(([a, c]) => a && c)
                         .map(([a, c]) => Math.hypot(a!.x - c!.x, a!.y - c!.y) / settings.bondLength)
    return {
        complexity,
        stress: normalisedStress(nodes, bonds, settings.bondLength),
        meanBond: lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0,
        circularity: cycles.length ? cycles.reduce((s, c) => s + circularity(nodes, c), 0) / cycles.length : 0
    }
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
    const settings = { ...base, start }
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
    const before = measures(input, bonds, cycles, settings, options.weights)
    const total = options.sgdSweeps + options.steps

    // 3. regions first: their points, then their nodes
    const labels = [...new Set(nodes.flatMap(m => m.labels))].sort()
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
            if (options.regionPull > 0) {
                const pts = nodes.map(regionPoint)
                nodes.forEach((m, i) => {
                    const p = pts[i]
                    if (!p) return
                    const k = options.regionPull * (m.labels.length > 1 ? 2 : 1)
                    m.x += k * (p.x - m.x); m.y += k * (p.y - m.y)
                })
            }
            snap()
            if (onProgress && sweep % 10 === 0) await onProgress(sweep, total)
        }
    }

    // 5. overlapping nodes pushed apart (a cycle's as one body)
    const gap = base.gap
    for (let pass = 0; pass < 30; pass++) {
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
        if (!moved) break
    }

    // 6. annealing on the weighted complexity
    const saved = { ...WEIGHTS }
    Object.assign(WEIGHTS, options.weights)
    const energyOf = () => withCircles(layoutComplexity(nodes, bonds, settings), nodes, cycles, options.weights)
    let current = energyOf(), energy = current.total
    let best = nodes.map(m => ({ x: m.x, y: m.y })), bestEnergy = energy
    for (let it = 0; it < options.steps; it++) {
        const cooling = 1 - it / options.steps
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
        const measured = energyOf()
        const temperature = 2 * cooling + 1e-3
        if (measured.total < energy || rand() < Math.exp(-(measured.total - energy) / temperature)) {
            energy = measured.total; current = measured
            if (energy < bestEnergy) { bestEnergy = energy; best = nodes.map(m => ({ x: m.x, y: m.y })) }
        } else {
            old.forEach((p, i) => { nodes[i]!.x = p.x; nodes[i]!.y = p.y })
        }
        if (onProgress && it % 100 === 0) await onProgress(options.sgdSweeps + it, total)
    }
    Object.assign(WEIGHTS, saved)
    best.forEach((p, i) => { nodes[i]!.x = p.x; nodes[i]!.y = p.y })
    // centred where the layout was
    const sx = (input.reduce((s, m) => s + m.x, 0) - nodes.reduce((s, m) => s + m.x, 0)) / n
    const sy = (input.reduce((s, m) => s + m.y, 0) - nodes.reduce((s, m) => s + m.y, 0)) / n
    for (const m of nodes) { m.x += sx; m.y += sy }
    const after = measures(nodes, bonds, cycles, settings, options.weights)
    const improved = after.complexity.total < before.complexity.total
    return {
        positions: improved ? new Map(nodes.map(m => [m.id, { x: m.x, y: m.y }])) : start,
        before, after: improved ? after : before,
        cycles: cycles.map(c => c.map(i => nodes[i]!.id)), improved, milliseconds: Date.now() - started
    }
}

//==============================================================================
//==============================================================================
