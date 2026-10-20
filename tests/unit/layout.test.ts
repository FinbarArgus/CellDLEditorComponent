/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'

import { circularity, findCycles, lineCount, planRectangles, presetOptions, reorganiseLayout, snapToLines } from '../../src/plugins/bondgraph/layout'
import type { LayoutBond, LayoutNode } from '../../src/plugins/bondgraph/regions'

const node = (id: string, x: number, y: number, labels: string[], kind = 'store', text = id): LayoutNode =>
    ({ id, x, y, w: 30, h: 20, labels, kind, text })

// a pathway cycle of four stores and four reactions (A -> R1 -> B -> R2 -> C -> R3 -> D -> R4 -> A), scattered
function scatteredCycle(): { nodes: LayoutNode[], bonds: LayoutBond[], order: string[] } {
    const order = ['A', 'R1', 'B', 'R2', 'C', 'R3', 'D', 'R4']
    const spots = [[0, 0], [300, 40], [60, 220], [250, 260], [20, 120], [330, 180], [150, 0], [160, 300]]
    const nodes = order.map((id, k) => node(id, spots[k]![0]!, spots[k]![1]!, ['c'], id.startsWith('R') ? 'reaction' : 'store'))
    const bonds = order.map((id, k) => ({ a: id, b: order[(k + 1) % order.length]! }))
    return { nodes, bonds, order }
}

describe('cycles', () => {
    test('a pathway cycle is found from the bonds, in cycle order', () => {
        const { nodes, bonds, order } = scatteredCycle()
        const [cycle] = findCycles(nodes, bonds)
        expect(cycle!.length).toBe(8)
        const ids = cycle!.map(i => nodes[i]!.id)
        const at = ids.indexOf('A')
        const rotated = [...ids.slice(at), ...ids.slice(0, at)]
        expect([order, [order[0]!, ...order.slice(1).reverse()]]).toContainEqual(rotated)
    })

    test('a loop through a side compound, or shorter than the least cycle, is not drawn as a circle', () => {
        const { nodes, bonds } = scatteredCycle()
        nodes[0]!.text = 'NAD'                     // a side compound by name
        expect(findCycles(nodes, bonds)).toEqual([])
        const hub = scatteredCycle()               // a store bonded to more steps than hubDegree
        const extra = ['R5', 'R6', 'R7'].map((id, k) => node(id, 400, 100 * k, ['c'], 'reaction'))
        hub.nodes.push(...extra)
        hub.bonds.push(...extra.map(e => ({ a: 'A', b: e.id })))
        expect(findCycles(hub.nodes, hub.bonds)).toEqual([])
        const short = scatteredCycle()
        expect(findCycles(short.nodes, short.bonds, { minCycle: 10 })).toEqual([])
    })

    test('a scattered cycle is drawn as a circle, its nodes in cycle order around it', async () => {
        const { nodes, bonds, order } = scatteredCycle()
        const result = await reorganiseLayout(nodes, bonds, { ...presetOptions('balanced'), steps: 300 })
        expect(result.cycles.length).toBe(1)
        expect(result.after.circularity).toBeLessThan(0.02)
        const moved = nodes.map(n => ({ ...n, ...result.positions.get(n.id) }))
        const cx = moved.reduce((s, n) => s + n.x, 0) / 8, cy = moved.reduce((s, n) => s + n.y, 0) / 8
        const angle = (id: string) => { const n = moved.find(m => m.id === id)!; return Math.atan2(n.y - cy, n.x - cx) }
        // neighbours in the cycle are neighbours around the circle
        const sorted = [...order].sort((a, b) => angle(a) - angle(b))
        for (let k = 0; k < 8; k++) {
            const here = order.indexOf(sorted[k]!), next = order.indexOf(sorted[(k + 1) % 8]!)
            expect([1, 7]).toContain((next - here + 8) % 8)
        }
        expect(circularity(moved, [0, 1, 2, 3, 4, 5, 6, 7])).toBeLessThan(0.02)
    })
})

describe('reorganising', () => {
    // two compartments, their nodes interleaved on a line, joined through one transport step
    const labels = ['c', 'm', 'c', 'm', 'c', 'm', 'c', 'm']
    const nodes: LayoutNode[] = labels.map((l, i) => node(`${l}${i}`, i * 60, (i % 3) * 25, [l], i % 2 ? 'reaction' : 'store'))
    nodes.push(node('t', 240, 120, ['c', 'm'], 'reaction'))
    const bonds: LayoutBond[] = []
    for (const l of ['c', 'm']) {
        const own = nodes.filter(n => n.labels.length === 1 && n.labels[0] === l)
        for (let i = 1; i < own.length; i++) bonds.push({ a: own[i - 1]!.id, b: own[i]!.id })
        bonds.push({ a: own[0]!.id, b: 't' })
    }
    const options = { ...presetOptions('balanced'), steps: 400 }

    test('puts each region in one piece, lowers the complexity, and is reproducible', async () => {
        const result = await reorganiseLayout(nodes, bonds, options)
        expect(result.before.complexity.subspaces).toBeGreaterThan(result.before.complexity.regions)
        expect(result.after.complexity.subspaces).toBe(result.after.complexity.regions)
        expect(result.after.complexity.total).toBeLessThan(result.before.complexity.total)
        expect(result.after.complexity.overlap).toBe(0)
        const again = await reorganiseLayout(nodes, bonds, options)
        expect([...again.positions]).toEqual([...result.positions])
    })

    test('the layout stays centred where it was', async () => {
        const result = await reorganiseLayout(nodes, bonds, options)
        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
        expect(mean([...result.positions.values()].map(p => p.x))).toBeCloseTo(mean(nodes.map(n => n.x)), 6)
        expect(mean([...result.positions.values()].map(p => p.y))).toBeCloseTo(mean(nodes.map(n => n.y)), 6)
    })

    test('every preset leaves the regions no more split than they were', async () => {
        for (const id of ['balanced', 'crossings', 'compact', 'regions', 'cycles', 'aligned', 'gentle', 'freeform']) {
            const result = await reorganiseLayout(nodes, bonds, { ...presetOptions(id), steps: 200 })
            expect(result.after.complexity.subspaces).toBeLessThanOrEqual(result.before.complexity.subspaces)
        }
    })

    test('regions become rectangles, each node in its own and the step on their shared edge', async () => {
        const result = await reorganiseLayout(nodes, bonds, options)
        const rects = result.rectangles!
        expect([...rects.keys()].sort()).toEqual(['c', 'm'])
        expect(result.after.complexity.rectangular).toBe(true)
        const at = (id: string) => result.positions.get(id)!
        const inside = (p: { x: number, y: number }, l: string) => {
            const r = rects.get(l)!
            return p.x >= r.x0 - 1e-6 && p.x <= r.x1 + 1e-6 && p.y >= r.y0 - 1e-6 && p.y <= r.y1 + 1e-6
        }
        for (const n of nodes) for (const l of n.labels) expect(inside(at(n.id), l)).toBe(true)
        const c = rects.get('c')!, m = rects.get('m')!
        const p = at('t')
        expect([c.x0, c.x1, c.y0, c.y1].some(v => Math.abs(v - p.x) < 1e-6 || Math.abs(v - p.y) < 1e-6)).toBe(true)
        expect([m.x0, m.x1, m.y0, m.y1].some(v => Math.abs(v - p.x) < 1e-6 || Math.abs(v - p.y) < 1e-6)).toBe(true)
    })

    test('nodes of a kind line up: fewer columns and rows than without the cost', async () => {
        const aligned = await reorganiseLayout(nodes, bonds, options)
        const free = await reorganiseLayout(nodes, bonds, { ...options, weights: { ...options.weights, align: 0 } })
        const lines = (r: typeof aligned) => r.after.columns + r.after.rows
        expect(lines(aligned)).toBeLessThan(lines(free))
    })

    test('a layout it cannot improve is left where it is', async () => {
        const tidy = [node('a', 0, 0, ['c']), node('b', 0, 80, ['c']), node('r', 80, 40, ['c', 'm'], 'reaction'),
                      node('x', 160, 0, ['m']), node('y', 160, 80, ['m'])]
        const tidyBonds = [{ a: 'a', b: 'r' }, { a: 'b', b: 'r' }, { a: 'r', b: 'x' }, { a: 'r', b: 'y' }]
        const result = await reorganiseLayout(tidy, tidyBonds, { ...presetOptions('balanced'), steps: 100 })
        expect(result.after.complexity.total).toBeLessThanOrEqual(result.before.complexity.total + 1e-9)
        if (!result.improved) {
            expect([...result.positions].map(([, p]) => [p.x, p.y])).toEqual(tidy.map(n => [n.x, n.y]))
        }
    })
})

describe('lines and rectangles', () => {
    test('columns and rows are counted for each kind of node apart', () => {
        const nodes = [node('a', 0, 0, ['c']), node('b', 0, 100, ['c']), node('r1', 50, 0, ['c'], 'reaction'),
                       node('r2', 50, 100, ['c'], 'reaction'), node('r3', 0.2, 50, ['c'], 'reaction')]
        // stores: one column, two rows; reactions: two columns (0.2 and 50), three rows; every node: x 0 (0.2 within
        // half a unit) and 50, y 0, 50 and 100
        expect(lineCount(nodes)).toEqual({ columns: 3, rows: 5, allColumns: 2, allRows: 3 })
        expect(lineCount(nodes, new Set([4]))).toEqual({ columns: 2, rows: 4, allColumns: 2, allRows: 3 })
    })

    test('side compounds of a cycle line up, and only the circle\'s own nodes are left out of the count', async () => {
        const { nodes, bonds } = scatteredCycle()
        // a side compound on each reaction of the cycle, which moves with the cycle as one body
        for (const [k, r] of ['R1', 'R2', 'R3', 'R4'].entries()) {
            nodes.push(node(`S${k}`, 400 + 37 * k, 23 * k * k, ['c'], 'source'))
            bonds.push({ a: r, b: `S${k}` })
        }
        const result = await reorganiseLayout(nodes, bonds, { ...presetOptions('aligned'), steps: 600 })
        const moved = nodes.map(n => ({ ...n, ...result.positions.get(n.id) }))
        const circle = new Set(result.cycles.flat().map(id => nodes.findIndex(n => n.id === id)))
        expect(circle.size).toBe(8)
        const lines = lineCount(moved, circle)
        expect([result.after.columns, result.after.rows]).toEqual([lines.columns, lines.rows])
        // the four side compounds take fewer than four columns plus four rows
        const sources = moved.filter(n => n.kind === 'source')
        expect(lineCount(sources).columns + lineCount(sources).rows).toBeLessThan(8)
    })

    test('a last snap puts near-misses of a kind on one line, unless that costs something or leaves a node misplaced', () => {
        const make = () => [node('r1', 0, 0, ['c'], 'reaction'), node('r2', 100, 2, ['c'], 'reaction'),
                            node('r3', 200, -3, ['c'], 'reaction'), node('s1', 50, 1, ['c']), node('far', 300, 40, ['c'], 'reaction')]
        // free to snap: the reactions take one row (their median, 0); the store and the far reaction keep theirs
        const nodes = make()
        expect(snapToLines(nodes, new Set(), 10, () => true, () => 0)).toBe(1)
        expect(nodes.map(n => n.y)).toEqual([0, 0, 0, 1, 40])
        expect(lineCount(nodes).rows).toBe(3)
        // a snap that raises the energy, or moves a node where it may not be, is undone
        const costly = make()
        expect(snapToLines(costly, new Set(), 10, () => true, () => costly[1]!.y === 0 ? 1 : 0)).toBe(0)
        expect(costly.map(n => n.y)).toEqual([0, 2, -3, 1, 40])
        const held = make()
        expect(snapToLines(held, new Set(), 10, i => i !== 2, () => 0)).toBe(0)
        // a circle's nodes are left as they are
        const circle = make()
        snapToLines(circle, new Set([1]), 10, () => true, () => 0)
        expect(circle[1]!.y).toBe(2)
    })

    test('three regions meet at a corner, and two steps joining all three sit apart across it', () => {
        const nodes = [node('c1', 0, 0, ['c']), node('c2', 60, 0, ['c']), node('m1', 0, 200, ['m']), node('m2', 60, 200, ['m']),
                       node('p1', 300, 100, ['p']), node('p2', 300, 160, ['p']),
                       node('cm', 30, 100, ['c', 'm'], 'reaction'), node('cp', 150, 50, ['c', 'p'], 'reaction'),
                       node('x1', 150, 100, ['c', 'm', 'p'], 'reaction'), node('x2', 160, 110, ['c', 'm', 'p'], 'reaction')]
        const plan = planRectangles(nodes, 60, new Map())!
        const t1 = plan.targets.get(8)!, t2 = plan.targets.get(9)!
        // points, apart by more than a node
        expect(t1.x0).toBe(t1.x1)
        expect(t1.y0).toBe(t1.y1)
        expect(Math.hypot(t1.x0 - t2.x0, t1.y0 - t2.y0)).toBeGreaterThan(30)
        // each next to all three rectangles
        for (const t of [t1, t2]) {
            for (const l of ['c', 'm', 'p']) {
                const r = plan.rects.get(l)!
                expect(Math.max(r.x0 - t.x0, t.x0 - r.x1, 0) + Math.max(r.y0 - t.y0, t.y0 - r.y1, 0)).toBeLessThan(60)
            }
        }
        // the rectangles don't overlap
        const rs = [...plan.rects.values()]
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i]!, b = rs[j]!
            expect(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 1e-6 || Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= 1e-6).toBe(true)
        }
    })

    test('regions that can\'t be sliced into rectangles are left free-form', () => {
        // six regions: more than a slicing is tried for
        const labels = ['a', 'b', 'c', 'd', 'e', 'f']
        const nodes = labels.map((l, k) => node(l, 100 * k, 0, [l]))
        expect(planRectangles(nodes, 60, new Map())).toBeUndefined()
    })
})
