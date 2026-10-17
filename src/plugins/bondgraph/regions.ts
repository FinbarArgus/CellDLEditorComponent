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
/** biome-ignore-all lint/style/noNonNullAssertion: <indices are within the grid, the nodes and the rings> */

// Regions of a bond graph diagram, and a layout that keeps them simple.
//
// A node's regions are its locations (bgf:hasLocation, the subscript of q_c^{G6P}): one for a store, a source
// or a reaction within one compartment; two or more for a step between compartments, which sits on their
// boundary; none for a junction, transformer or capacitor.
//
// The partition (regionGrid). The diagram's domain, its nodes' bounds and a margin, is sampled on a grid.
// Each region has a density, a sum of Gaussians (width sigma) at its nodes; a step on a boundary adds one
// point per region, displaced towards that region's neighbours, so the boundary runs through the step. Each
// cell goes to the region of highest density (the nearest region far from every node), and a node's own cells
// to its region. connectRegions then joins the pieces of a split region by the shortest corridor that splits no
// other region, so the partition has as few subspaces as the nodes' positions allow.
//
// The complexity of a layout (layoutComplexity), in radians of boundary turning:
//     2 pi W (subspaces beyond one per region)     a split region costs W full turns
//   + sum over boundaries of |curvature| ds        total turning: 2 pi for a convex region, more when it bends
//   + boundary length / sigma * A
//   + bond crossings * X  +  stretched or squeezed bonds  +  overlapping nodes  +  distance moved (a little)
// The turning integral is the measure of boundary complexity: it is invariant under scale, zero for a straight
// boundary between two regions, and grows with every wiggle, where length alone would favour a tight wiggly
// boundary over a longer straight one.
//
// ./layout.ts reorganises a layout to lower it.

//==============================================================================

export interface LayoutNode {
    id: string
    x: number               // centre
    y: number
    w: number               // size
    h: number
    labels: string[]        // its regions: one, several (a step on a boundary) or none
    kind?: string           // store, reaction, resistance, source or other (./layout.ts finds cycles by it)
    text?: string           // its species, else its identifier (side compounds are known by it)
}

export interface LayoutBond {
    a: string
    b: string
}

export interface Point2 {
    x: number
    y: number
}

export interface RegionGrid {
    x0: number              // centre of cell (0, 0)
    y0: number
    cell: number
    cols: number
    rows: number
    labels: string[]
    owner: Int16Array       // the region (index into labels) of each cell, row by row
    fixed: Uint8Array       // a node's own cell: its region can't change
}

export interface RegionLoop {
    points: Point2[]
    border: boolean[]       // on the domain's edge, not a boundary between regions
}

export interface Complexity {
    total: number
    subspaces: number       // connected regions
    regions: number         // distinct regions
    turning: number         // radians
    length: number          // of boundaries between regions
    crossings: number
    stretch: number
    overlap: number
    moved: number
    rectangular?: boolean   // the regions are rectangles (rectangularRegions)
}

export const WEIGHTS = {
    split: 10,              // full turns per extra subspace
    length: 0.2,
    crossing: 2,
    stretch: 0.5,
    overlap: 20,
    moved: 0.02,
    circle: 30,             // per cycle drawn as a circle, times how far its nodes are from one (./layout.ts)
    inside: 10,             // per node inside a cycle's circle that isn't the cycle's (./layout.ts)
    align: 0                // per distinct column and row of a kind of node (./layout.ts, lineCount)
}

//==============================================================================

function median(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** The median distance from a node to its nearest neighbour. */
export function layoutSpacing(nodes: LayoutNode[]): number {
    const nearest = nodes.map((n, i) => Math.min(...nodes.filter((_, j) => j !== i)
                                                         .map(m => Math.hypot(m.x - n.x, m.y - n.y))))
    const spacing = median(nearest.filter(Number.isFinite))
    return spacing > 0 ? spacing : 50
}

export function sortedLabels(nodes: LayoutNode[]): string[] {
    return [...new Set(nodes.flatMap(n => n.labels))].sort()
}

/** The points that give each region its density: a node of one region, or one point per region of a boundary step. */
export function regionPoints(nodes: LayoutNode[], bonds: LayoutBond[], offset: number): (Point2 & { label: string })[] {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const neighbours = new Map<string, LayoutNode[]>()
    for (const b of bonds) {
        const a = byId.get(b.a), c = byId.get(b.b)
        if (!a || !c) continue
        if (!neighbours.has(a.id)) neighbours.set(a.id, [])
        if (!neighbours.has(c.id)) neighbours.set(c.id, [])
        neighbours.get(a.id)!.push(c)
        neighbours.get(c.id)!.push(a)
    }
    const points: (Point2 & { label: string })[] = []
    for (const node of nodes) {
        if (node.labels.length === 1) {
            points.push({ x: node.x, y: node.y, label: node.labels[0]! })
        } else if (node.labels.length > 1) {
            node.labels.forEach((label, k) => {
                let towards = (neighbours.get(node.id) ?? []).filter(m => m.labels.length === 1 && m.labels[0] === label)
                if (towards.length === 0) towards = nodes.filter(m => m.labels.length === 1 && m.labels[0] === label)
                let dx = 0, dy = 0
                if (towards.length) {
                    dx = towards.reduce((s, m) => s + m.x, 0) / towards.length - node.x
                    dy = towards.reduce((s, m) => s + m.y, 0) / towards.length - node.y
                }
                const d = Math.hypot(dx, dy)
                if (d < 1e-9) {
                    const angle = 2 * Math.PI * k / node.labels.length
                    dx = Math.cos(angle); dy = Math.sin(angle)
                } else {
                    dx /= d; dy /= d
                }
                points.push({ x: node.x + offset * dx, y: node.y + offset * dy, label })
            })
        }
    }
    return points
}

//==============================================================================

export function regionGrid(nodes: LayoutNode[], bonds: LayoutBond[],
                           options: { sigma: number, cell: number, margin?: number }): RegionGrid {
    const { sigma, cell } = options
    const margin = options.margin ?? sigma
    const labels = sortedLabels(nodes)
    const minX = Math.min(...nodes.map(n => n.x - n.w / 2)) - margin
    const maxX = Math.max(...nodes.map(n => n.x + n.w / 2)) + margin
    const minY = Math.min(...nodes.map(n => n.y - n.h / 2)) - margin
    const maxY = Math.max(...nodes.map(n => n.y + n.h / 2)) + margin
    const cols = Math.max(2, Math.ceil((maxX - minX) / cell) + 1)
    const rows = Math.max(2, Math.ceil((maxY - minY) / cell) + 1)
    const size = cols * rows
    const owner = new Int16Array(size).fill(-1)
    const fixed = new Uint8Array(size)
    const grid: RegionGrid = { x0: minX, y0: minY, cell, cols, rows, labels, owner, fixed }
    if (labels.length === 0) return grid

    const density = labels.map(() => new Float32Array(size))
    const reach = Math.ceil(3 * sigma / cell)
    const twoSigma2 = 2 * sigma * sigma
    for (const p of regionPoints(nodes, bonds, 0.6 * sigma)) {
        const f = density[labels.indexOf(p.label)]!
        const ci = Math.round((p.x - minX) / cell), cj = Math.round((p.y - minY) / cell)
        for (let j = Math.max(0, cj - reach); j <= Math.min(rows - 1, cj + reach); j++) {
            const dy = minY + j * cell - p.y
            for (let i = Math.max(0, ci - reach); i <= Math.min(cols - 1, ci + reach); i++) {
                const dx = minX + i * cell - p.x
                f[j * cols + i] = f[j * cols + i]! + Math.exp(-(dx * dx + dy * dy) / twoSigma2)
            }
        }
    }
    for (let k = 0; k < size; k++) {
        let best = -1, value = 1e-12
        for (let l = 0; l < labels.length; l++) {
            if (density[l]![k]! > value) { value = density[l]![k]!; best = l }
        }
        owner[k] = best
    }
    // a node's own cells are its region's
    for (const node of nodes) {
        if (node.labels.length !== 1) continue
        const l = labels.indexOf(node.labels[0]!)
        const i0 = Math.max(0, Math.floor((node.x - node.w / 2 - minX) / cell))
        const i1 = Math.min(cols - 1, Math.ceil((node.x + node.w / 2 - minX) / cell))
        const j0 = Math.max(0, Math.floor((node.y - node.h / 2 - minY) / cell))
        const j1 = Math.min(rows - 1, Math.ceil((node.y + node.h / 2 - minY) / cell))
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                owner[j * cols + i] = l
                fixed[j * cols + i] = 1
            }
        }
    }
    // cells far from every node go to the nearest region
    const queue: number[] = []
    for (let k = 0; k < size; k++) if (owner[k]! >= 0) queue.push(k)
    for (let q = 0; q < queue.length; q++) {
        const k = queue[q]!
        const i = k % cols, j = (k - i) / cols
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ni = i + di, nj = j + dj
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
            const nk = nj * cols + ni
            if (owner[nk]! < 0) { owner[nk] = owner[k]!; queue.push(nk) }
        }
    }
    return grid
}

/** Connected pieces of each region: a component index per cell, and each component's region and size. */
function components(grid: RegionGrid): { id: Int32Array, label: number[], size: number[] } {
    const { cols, rows, owner } = grid
    const id = new Int32Array(cols * rows).fill(-1)
    const label: number[] = [], size: number[] = []
    for (let start = 0; start < id.length; start++) {
        if (id[start]! >= 0 || owner[start]! < 0) continue
        const c = label.length
        label.push(owner[start]!); size.push(0)
        const stack = [start]
        id[start] = c
        while (stack.length) {
            const k = stack.pop()!
            size[c] = size[c]! + 1
            const i = k % cols, j = (k - i) / cols
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const ni = i + di, nj = j + dj
                if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
                const nk = nj * cols + ni
                if (id[nk]! < 0 && owner[nk] === owner[start]) { id[nk] = c; stack.push(nk) }
            }
        }
    }
    return { id, label, size }
}

/**
 * The smaller pieces of split regions: for each, the nodes (indices) of that region lying in it, and the centre of
 * the region's largest piece, where they belong.
 */
export function strayPieces(nodes: LayoutNode[], bonds: LayoutBond[],
                            options: { sigma: number, cell: number }): { members: number[], x: number, y: number }[] {
    const grid = regionGrid(nodes, bonds, options)
    const comp = components(grid)
    const pieces: { members: number[], x: number, y: number }[] = []
    grid.labels.forEach((label, l) => {
        const own = comp.label.map((cl, c) => cl === l ? c : -1).filter(c => c >= 0)
        if (own.length < 2) return
        const largest = own.reduce((a, c) => comp.size[c]! > comp.size[a]! ? c : a)
        let sx = 0, sy = 0, n = 0
        for (let k = 0; k < comp.id.length; k++) {
            if (comp.id[k] !== largest) continue
            sx += grid.x0 + (k % grid.cols) * grid.cell; sy += grid.y0 + Math.floor(k / grid.cols) * grid.cell; n++
        }
        for (const c of own) {
            if (c === largest) continue
            const members = nodes.map((node, i) => ({ node, i })).filter(({ node }) => {
                if (node.labels.length !== 1 || node.labels[0] !== label) return false
                const ci = Math.round((node.x - grid.x0) / grid.cell), cj = Math.round((node.y - grid.y0) / grid.cell)
                return ci >= 0 && cj >= 0 && ci < grid.cols && cj < grid.rows && comp.id[cj * grid.cols + ci] === c
            }).map(({ i }) => i)
            if (members.length) pieces.push({ members, x: sx / n, y: sy / n })
        }
    })
    return pieces
}

/** The number of connected pieces of each region. */
export function regionComponents(grid: RegionGrid): Map<string, number> {
    const counts = new Map(grid.labels.map(l => [l, 0]))
    for (const l of components(grid).label) counts.set(grid.labels[l]!, (counts.get(grid.labels[l]!) ?? 0) + 1)
    return counts
}

/**
 * Join the pieces of split regions: the smallest piece is joined to another piece of its region by the shortest
 * corridor (three cells wide) through cells that are not other nodes' own, kept only when the number of
 * subspaces falls. Returns the number of pieces joined.
 */
export function connectRegions(grid: RegionGrid, attempts: number = 30): number {
    const { cols, rows, owner, fixed } = grid
    let joined = 0
    const hopeless = new Set<string>()
    for (let attempt = 0; attempt < attempts; attempt++) {
        const comp = components(grid)
        const total = comp.label.length
        const perLabel = new Map<number, number[]>()
        comp.label.forEach((l, c) => { perLabel.set(l, [...(perLabel.get(l) ?? []), c]) })
        const candidates = [...perLabel.values()].filter(cs => cs.length > 1).flat()
            .filter(c => !hopeless.has(`${comp.label[c]}:${comp.size[c]}`))
            .sort((a, b) => comp.size[a]! - comp.size[b]!)
        const piece = candidates[0]
        if (piece === undefined) break
        const label = comp.label[piece]!
        // breadth-first from the piece to another piece of its region
        const previous = new Int32Array(cols * rows).fill(-2)
        const queue: number[] = []
        for (let k = 0; k < previous.length; k++) if (comp.id[k] === piece) { previous[k] = -1; queue.push(k) }
        let reached = -1
        for (let q = 0; q < queue.length && reached < 0; q++) {
            const k = queue[q]!
            const i = k % cols, j = (k - i) / cols
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const ni = i + di, nj = j + dj
                if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
                const nk = nj * cols + ni
                if (previous[nk] !== -2) continue
                if (fixed[nk] && owner[nk] !== label) continue
                previous[nk] = k
                if (owner[nk] === label && comp.id[nk] !== piece) { reached = nk; break }
                queue.push(nk)
            }
        }
        const saved = owner.slice()
        if (reached >= 0) {
            for (let k = reached; k >= 0; k = previous[k]!) {
                const i = k % cols, j = (k - i) / cols
                for (let dj = -1; dj <= 1; dj++) {
                    for (let di = -1; di <= 1; di++) {
                        const ni = i + di, nj = j + dj
                        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
                        const nk = nj * cols + ni
                        if (!fixed[nk]) owner[nk] = label
                    }
                }
            }
        }
        if (reached >= 0 && components(grid).label.length < total) {
            joined += 1
        } else {
            owner.set(saved)
            hopeless.add(`${label}:${comp.size[piece]}`)
        }
    }
    return joined
}

//==============================================================================

/**
 * The outline of a region: closed loops (marching squares on the region's indicator, blurred `blur` times,
 * then `smooth` rounds of Chaikin's corner cutting), each point marked when it lies on the domain's edge.
 */
export function regionLoops(grid: RegionGrid, label: string,
                            options: { blur?: number, smooth?: number } = {}): RegionLoop[] {
    const { cols, rows, owner, cell, x0, y0 } = grid
    const l = grid.labels.indexOf(label)
    if (l < 0) return []
    let field = new Float32Array(cols * rows)
    for (let k = 0; k < field.length; k++) field[k] = owner[k] === l ? 1 : 0
    for (let b = 0; b < (options.blur ?? 1); b++) {
        const next = new Float32Array(field.length)
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                let sum = 0, n = 0
                for (let dj = -1; dj <= 1; dj++) {
                    for (let di = -1; di <= 1; di++) {
                        const ni = i + di, nj = j + dj
                        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
                        sum += field[nj * cols + ni]!; n++
                    }
                }
                next[j * cols + i] = sum / n
            }
        }
        field = next
    }
    // padded by one ring outside the domain, so every loop closes
    const pc = cols + 2, pr = rows + 2
    const value = (i: number, j: number) =>
        (i === 0 || j === 0 || i === pc - 1 || j === pr - 1) ? -0.5 : field[(j - 1) * cols + (i - 1)]! - 0.5
    const onEdge = (i: number, j: number) => i === 0 || j === 0 || i === pc - 1 || j === pr - 1
    const points = new Map<string, { p: Point2, border: boolean }>()
    const edgePoint = (key: string, i1: number, j1: number, i2: number, j2: number) => {
        if (!points.has(key)) {
            const v1 = value(i1, j1), v2 = value(i2, j2)
            const t = v1 / (v1 - v2)
            const x = x0 + (i1 - 1 + t * (i2 - i1)) * cell
            const y = y0 + (j1 - 1 + t * (j2 - j1)) * cell
            points.set(key, { p: { x, y }, border: onEdge(i1, j1) || onEdge(i2, j2) })
        }
        return key
    }
    const links = new Map<string, string[]>()
    const link = (a: string, b: string) => {
        if (!links.has(a)) links.set(a, [])
        if (!links.has(b)) links.set(b, [])
        links.get(a)!.push(b); links.get(b)!.push(a)
    }
    for (let j = 0; j < pr - 1; j++) {
        for (let i = 0; i < pc - 1; i++) {
            const a = value(i, j), b = value(i + 1, j), c = value(i + 1, j + 1), d = value(i, j + 1)
            const index = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0)
            if (index === 0 || index === 15) continue
            const top = () => edgePoint(`h${i},${j}`, i, j, i + 1, j)
            const right = () => edgePoint(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1)
            const bottom = () => edgePoint(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1)
            const left = () => edgePoint(`v${i},${j}`, i, j, i, j + 1)
            const centre = (a + b + c + d) / 4 > 0
            switch (index) {
                case 1: case 14: link(left(), bottom()); break
                case 2: case 13: link(bottom(), right()); break
                case 3: case 12: link(left(), right()); break
                case 4: case 11: link(top(), right()); break
                case 6: case 9: link(top(), bottom()); break
                case 7: case 8: link(left(), top()); break
                case 5:
                    if (centre) { link(left(), top()); link(bottom(), right()) }
                    else { link(top(), right()); link(left(), bottom()) }
                    break
                case 10:
                    if (centre) { link(top(), right()); link(left(), bottom()) }
                    else { link(left(), top()); link(bottom(), right()) }
                    break
            }
        }
    }
    const loops: RegionLoop[] = []
    const visited = new Set<string>()
    for (const start of links.keys()) {
        if (visited.has(start)) continue
        const keys: string[] = []
        let previous = '', current = start
        while (!visited.has(current)) {
            visited.add(current)
            keys.push(current)
            const next = links.get(current)!.find(k => k !== previous && !visited.has(k))
                      ?? links.get(current)!.find(k => k !== previous)
            if (next === undefined) break
            previous = current
            current = next
        }
        if (keys.length < 3) continue
        let loop: RegionLoop = { points: keys.map(k => points.get(k)!.p), border: keys.map(k => points.get(k)!.border) }
        for (let s = 0; s < (options.smooth ?? 2); s++) loop = chaikin(loop)
        loops.push(loop)
    }
    return loops
}

function chaikin(loop: RegionLoop): RegionLoop {
    const points: Point2[] = [], border: boolean[] = []
    const n = loop.points.length
    for (let k = 0; k < n; k++) {
        const p = loop.points[k]!, q = loop.points[(k + 1) % n]!
        const edge = loop.border[k]! || loop.border[(k + 1) % n]!
        points.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y }, { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y })
        border.push(edge, edge)
    }
    return { points, border }
}

/** The loop resampled every `step` along its length: the grid's staircase is shorter than a step. */
function resample(loop: RegionLoop, step: number): RegionLoop {
    const points: Point2[] = [], border: boolean[] = []
    const n = loop.points.length
    let carried = 0
    for (let k = 0; k < n; k++) {
        const p = loop.points[k]!, q = loop.points[(k + 1) % n]!
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        let s = step - carried
        while (s <= d) {
            const t = s / d
            points.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) })
            border.push(loop.border[k]! || loop.border[(k + 1) % n]!)
            s += step
        }
        carried = d - (s - step)
    }
    return points.length >= 3 ? { points, border } : loop
}

/** Total absolute turning (radians) and length of the boundaries between regions (not the domain's edge). */
export function boundaryShape(grid: RegionGrid, options: { blur?: number, smooth?: number } = {}): { turning: number, length: number } {
    let turning = 0, length = 0
    if (grid.labels.length < 2) return { turning, length }
    // a point within a cell of the domain's edge is on the edge
    const left = grid.x0, top = grid.y0, edge = 1.01 * grid.cell
    const right = grid.x0 + (grid.cols - 1) * grid.cell, bottom = grid.y0 + (grid.rows - 1) * grid.cell
    for (const label of grid.labels) {
        for (const loop of regionLoops(grid, label, options)) {
            const marked = { points: loop.points, border: loop.points.map((p, k) => loop.border[k]!
                || p.x < left + edge || p.x > right - edge || p.y < top + edge || p.y > bottom - edge) }
            const { points, border } = resample(marked, 3 * grid.cell)
            const n = points.length
            for (let k = 0; k < n; k++) {
                const a = points[(k + n - 1) % n]!, b = points[k]!, c = points[(k + 1) % n]!
                const interior = !border[(k + n - 1) % n] && !border[k] && !border[(k + 1) % n]
                if (!interior) continue
                let angle = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
                while (angle > Math.PI) angle -= 2 * Math.PI
                while (angle < -Math.PI) angle += 2 * Math.PI
                turning += Math.abs(angle)
                length += Math.hypot(c.x - b.x, c.y - b.y)
            }
        }
    }
    return { turning: turning / 2, length: length / 2 }      // each boundary is the outline of two regions
}

//==============================================================================

/** Bonds (straight, centre to centre) that cross, not counting bonds that share a node. */
export function bondCrossings(nodes: LayoutNode[], bonds: LayoutBond[]): number {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const segments = bonds.map(b => [byId.get(b.a), byId.get(b.b)] as const)
                          .filter((s): s is readonly [LayoutNode, LayoutNode] => !!s[0] && !!s[1])
    const side = (p: Point2, q: Point2, r: Point2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
    let crossings = 0
    for (let s = 0; s < segments.length; s++) {
        const [p1, p2] = segments[s]!
        for (let t = s + 1; t < segments.length; t++) {
            const [q1, q2] = segments[t]!
            if (p1 === q1 || p1 === q2 || p2 === q1 || p2 === q2) continue
            if (side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0) crossings++
        }
    }
    return crossings
}

export interface ComplexityOptions {
    sigma: number               // density width (about the nodes' spacing)
    cell: number                // grid cell
    bondLength: number          // natural bond length
    gap: number                 // clearance between nodes
    start?: Map<string, Point2> // positions to stay near
    rectangles?: boolean        // regions that can be rectangles are measured as such (rectangularRegions)
}

//==============================================================================

export interface Rect {
    x0: number
    y0: number
    x1: number
    y1: number
}

/**
 * Rectangular regions for the nodes as placed, when there are such: each region's rectangle holds its nodes and
 * reaches each of its boundary steps, the rectangles don't overlap, and none holds another
 * region's node. They are then grown until they meet each other or the edge of the regions' common box. Undefined
 * when the regions can't be rectangles (they interleave): draw them free-form (regionGrid) instead.
 */
export function rectangularRegions(nodes: LayoutNode[], pad: number): Map<string, Rect>|undefined {
    const labels = sortedLabels(nodes)
    if (labels.length === 0) return undefined
    const rects = new Map<string, Rect>()
    for (const label of labels) {
        const own = nodes.filter(n => n.labels.length === 1 && n.labels[0] === label)
        if (own.length === 0) return undefined
        rects.set(label, {
            x0: Math.min(...own.map(n => n.x - n.w / 2)), y0: Math.min(...own.map(n => n.y - n.h / 2)),
            x1: Math.max(...own.map(n => n.x + n.w / 2)), y1: Math.max(...own.map(n => n.y + n.h / 2))
        })
    }
    // a step between two regions is on the border of each; one joining three is near their common corner
    for (const n of nodes) {
        if (n.labels.length !== 2) continue
        for (const label of n.labels) {
            const r = rects.get(label)!
            r.x0 = Math.min(r.x0, n.x); r.y0 = Math.min(r.y0, n.y); r.x1 = Math.max(r.x1, n.x); r.y1 = Math.max(r.y1, n.y)
        }
    }
    const overlap = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6
                                          && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-6
    const all = [...rects.entries()]
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) if (overlap(all[i]![1], all[j]![1])) return undefined
    }
    for (const n of nodes) {
        if (n.labels.length !== 1) continue
        for (const [label, r] of all) {
            if (label !== n.labels[0] && n.x > r.x0 && n.x < r.x1 && n.y > r.y0 && n.y < r.y1) return undefined
        }
    }
    // grow each side to meet its neighbour half way, or the common box's edge (`pad` beyond the nodes)
    const box = { x0: Math.min(...all.map(([, r]) => r.x0)) - pad, y0: Math.min(...all.map(([, r]) => r.y0)) - pad,
                  x1: Math.max(...all.map(([, r]) => r.x1)) + pad, y1: Math.max(...all.map(([, r]) => r.y1)) + pad }
    const across = (a: Rect, b: Rect, axis: 'x'|'y') => axis === 'x'
        ? Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-6 : Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6
    for (const axis of ['x', 'y'] as const) {
        const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1'
        const targets = all.map(([, r]) => {
            let up = box[hi], down = box[lo]
            for (const [, o] of all) {
                if (o === r || !across(r, o, axis)) continue
                if (o[lo] >= r[hi] - 1e-6) up = Math.min(up, (r[hi] + o[lo]) / 2)
                if (o[hi] <= r[lo] + 1e-6) down = Math.max(down, (r[lo] + o[hi]) / 2)
            }
            return { up, down }
        })
        all.forEach(([, r], k) => { r[hi] = targets[k]!.up; r[lo] = targets[k]!.down })
    }
    // a step joining three regions is within a node (and the padding) of each of their rectangles, as grown: such
    // steps sit side by side across the corner where the three meet
    for (const n of nodes) {
        if (n.labels.length < 3) continue
        const reach = Math.max(n.w, n.h) + pad
        for (const label of n.labels) {
            const r = rects.get(label)!
            if (Math.max(r.x0 - n.x, n.x - r.x1, 0) > reach || Math.max(r.y0 - n.y, n.y - r.y1, 0) > reach) return undefined
        }
    }
    return rects
}

export function layoutComplexity(nodes: LayoutNode[], bonds: LayoutBond[], options: ComplexityOptions): Complexity {
    // rectangles are one piece each, with straight borders
    if (options.rectangles && rectangularRegions(nodes, 0.3 * options.bondLength)) {
        const regions = sortedLabels(nodes).length
        return finishComplexity(nodes, bonds, options, regions, regions, 0, 0, true)
    }
    const grid = regionGrid(nodes, bonds, { sigma: options.sigma, cell: options.cell })
    const counts = regionComponents(grid)
    const subspaces = [...counts.values()].reduce((s, c) => s + c, 0)
    const regions = grid.labels.length
    const { turning, length } = boundaryShape(grid, { blur: 1, smooth: 1 })
    return finishComplexity(nodes, bonds, options, subspaces, regions, turning, length, false)
}

function finishComplexity(nodes: LayoutNode[], bonds: LayoutBond[], options: ComplexityOptions, subspaces: number,
                          regions: number, turning: number, length: number, rectangular: boolean): Complexity {
    const crossings = bondCrossings(nodes, bonds)
    const byId = new Map(nodes.map(n => [n.id, n]))
    let stretch = 0
    for (const b of bonds) {
        const a = byId.get(b.a), c = byId.get(b.b)
        if (!a || !c) continue
        const d = Math.hypot(c.x - a.x, c.y - a.y)
        stretch += ((d - options.bondLength) / options.bondLength) ** 2
    }
    let overlap = 0
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i]!, c = nodes[j]!
            const ox = (a.w + c.w) / 2 + options.gap - Math.abs(a.x - c.x)
            const oy = (a.h + c.h) / 2 + options.gap - Math.abs(a.y - c.y)
            if (ox > 0 && oy > 0) overlap += (Math.min(ox, oy) / options.gap) ** 2
        }
    }
    let moved = 0
    if (options.start) {
        for (const n of nodes) {
            const p = options.start.get(n.id)
            if (p) moved += ((n.x - p.x) ** 2 + (n.y - p.y) ** 2) / (options.sigma * options.sigma)
        }
    }
    const total = 2 * Math.PI * WEIGHTS.split * (subspaces - regions) + turning + WEIGHTS.length * length / options.sigma
                + WEIGHTS.crossing * crossings + WEIGHTS.stretch * stretch + WEIGHTS.overlap * overlap + WEIGHTS.moved * moved
    return { total, subspaces, regions, turning, length, crossings, stretch, overlap, moved, rectangular }
}

//==============================================================================

/** The scales a layout's complexity is measured on: the nodes' spacing, a grid cell, a natural bond length. */
export function complexityOptions(nodes: LayoutNode[], bonds: LayoutBond[]): ComplexityOptions {
    const spacing = layoutSpacing(nodes)
    const byId = new Map(nodes.map(n => [n.id, n]))
    const lengths = bonds.map(b => [byId.get(b.a), byId.get(b.b)])
                         .filter(([a, c]) => a && c).map(([a, c]) => Math.hypot(c!.x - a!.x, c!.y - a!.y))
    const bondLength = Math.min(3 * spacing, Math.max(spacing, median(lengths) || spacing))
    return { sigma: spacing, cell: spacing / 2, bondLength, gap: 0.25 * spacing }
}

//==============================================================================
//==============================================================================
