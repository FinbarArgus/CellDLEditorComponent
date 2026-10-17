/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'

import { circularity, findCycles, presetOptions, reorganiseLayout } from '../../src/plugins/bondgraph/layout'
import { complexityOptions, type LayoutBond, type LayoutNode, layoutComplexity } from '../../src/plugins/bondgraph/regions'

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
        for (const id of ['balanced', 'crossings', 'compact', 'regions', 'cycles', 'gentle']) {
            const result = await reorganiseLayout(nodes, bonds, { ...presetOptions(id), steps: 200 })
            expect(result.after.complexity.subspaces).toBeLessThanOrEqual(result.before.complexity.subspaces)
        }
    })

    test('a layout it cannot improve is left where it is', async () => {
        const tidy = [node('a', 0, 0, ['c']), node('b', 0, 80, ['c']), node('r', 80, 40, ['c', 'm'], 'reaction'),
                      node('x', 160, 0, ['m']), node('y', 160, 80, ['m'])]
        const tidyBonds = [{ a: 'a', b: 'r' }, { a: 'b', b: 'r' }, { a: 'r', b: 'x' }, { a: 'r', b: 'y' }]
        const before = layoutComplexity(tidy, tidyBonds, complexityOptions(tidy, tidyBonds))
        const result = await reorganiseLayout(tidy, tidyBonds, { ...presetOptions('balanced'), steps: 100 })
        expect(result.after.complexity.total).toBeLessThanOrEqual(before.total + 1e-9)
        if (!result.improved) {
            expect([...result.positions].map(([, p]) => [p.x, p.y])).toEqual(tidy.map(n => [n.x, n.y]))
        }
    })
})
