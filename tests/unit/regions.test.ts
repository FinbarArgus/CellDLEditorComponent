/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'

import {
    bondCrossings, boundaryShape, complexityOptions, connectRegions, findRings, type LayoutBond, type LayoutNode,
    layoutComplexity, regionComponents, regionGrid, regionLoops, regionPoints, reorganise
} from '../../src/plugins/bondgraph/regions'

const regionsFound = (nodes: LayoutNode[], bonds: LayoutBond[]) => findRings(nodes, bonds).map(r => [...r].sort((a, b) => a - b))

const node = (id: string, x: number, y: number, labels: string[]): LayoutNode => ({ id, x, y, w: 30, h: 20, labels })

describe('regions', () => {
    test('a step between two regions gives a point in each, towards its neighbours there', () => {
        const nodes = [node('a', 0, 0, ['c']), node('r', 100, 0, ['c', 'm']), node('b', 200, 0, ['m'])]
        const points = regionPoints(nodes, [{ a: 'a', b: 'r' }, { a: 'r', b: 'b' }], 20)
        expect(points.filter(p => p.label === 'c').map(p => p.x)).toEqual([0, 80])
        expect(points.filter(p => p.label === 'm').map(p => p.x)).toEqual([120, 200])
    })

    test('two clusters are two regions, and the boundary passes through the step between them', () => {
        const nodes = [node('a1', 0, 0, ['c']), node('a2', 0, 60, ['c']), node('r', 100, 30, ['c', 'm']),
                       node('b1', 200, 0, ['m']), node('b2', 200, 60, ['m'])]
        const bonds = [{ a: 'a1', b: 'r' }, { a: 'a2', b: 'r' }, { a: 'r', b: 'b1' }, { a: 'r', b: 'b2' }]
        const grid = regionGrid(nodes, bonds, { sigma: 50, cell: 5 })
        expect([...regionComponents(grid)]).toEqual([['c', 1], ['m', 1]])
        const at = (x: number, y: number) => grid.labels[grid.owner[Math.round((y - grid.y0) / 5) * grid.cols + Math.round((x - grid.x0) / 5)]!]
        expect(at(85, 30)).toBe('c')
        expect(at(115, 30)).toBe('m')
        const { turning, length } = boundaryShape(grid)
        expect(turning).toBeLessThan(1.5)           // nearly straight
        expect(length).toBeGreaterThan(100)
    })

    test('interleaved nodes split a region, and a corridor joins the pieces when it splits nothing else', () => {
        const nodes = [node('a1', 0, 0, ['c']), node('b1', 100, 0, ['m']), node('a2', 200, 0, ['c'])]
        const grid = regionGrid(nodes, [], { sigma: 30, cell: 5, margin: 60 })
        expect(regionComponents(grid).get('c')).toBe(2)
        expect(connectRegions(grid)).toBe(1)
        expect(regionComponents(grid).get('c')).toBe(1)
        expect(regionComponents(grid).get('m')).toBe(1)
    })

    test('a region inside another is one closed loop of about one full turn', () => {
        const nodes = [node('o1', -150, -150, ['c']), node('o2', 150, -150, ['c']), node('o3', -150, 150, ['c']),
                       node('o4', 150, 150, ['c']), node('i', 0, 0, ['m'])]
        const grid = regionGrid(nodes, [], { sigma: 60, cell: 5 })
        const loops = regionLoops(grid, 'm')
        expect(loops.length).toBe(1)
        expect(loops[0]!.border.every(b => !b)).toBe(true)
        const { turning } = boundaryShape(grid)
        expect(turning).toBeGreaterThan(2 * Math.PI - 0.3)
        expect(turning).toBeLessThan(2 * Math.PI + 1.5)
    })

    test('crossing bonds are counted, bonds sharing a node are not', () => {
        const nodes = [node('a', 0, 0, []), node('b', 100, 100, []), node('c', 100, 0, []), node('d', 0, 100, [])]
        expect(bondCrossings(nodes, [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }])).toBe(1)
        expect(bondCrossings(nodes, [{ a: 'a', b: 'b' }, { a: 'a', b: 'c' }])).toBe(0)
    })
})

describe('reorganise', () => {
    // two compartments, their nodes interleaved on a line, joined through one transport step
    const labels = ['c', 'm', 'c', 'm', 'c', 'm', 'c', 'm']
    const nodes: LayoutNode[] = labels.map((l, i) => node(`${l}${i}`, i * 60, (i % 3) * 25, [l]))
    nodes.push(node('t', 240, 120, ['c', 'm']))
    const bonds: LayoutBond[] = []
    for (const l of ['c', 'm']) {
        const own = nodes.filter(n => n.labels.length === 1 && n.labels[0] === l)
        for (let i = 1; i < own.length; i++) bonds.push({ a: own[i - 1]!.id, b: own[i]!.id })
        bonds.push({ a: own[0]!.id, b: 't' })
    }

    test('splits fewer regions and lowers the complexity, and is reproducible', async () => {
        const result = await reorganise(nodes, bonds, { seed: 7, forceSteps: 200, steps: 400 })
        expect(result.before.subspaces).toBeGreaterThan(result.before.regions)
        expect(result.after.subspaces).toBe(result.after.regions)
        expect(result.after.total).toBeLessThan(result.before.total)
        expect(result.after.overlap).toBe(0)
        const again = await reorganise(nodes, bonds, { seed: 7, forceSteps: 200, steps: 400 })
        expect([...again.positions]).toEqual([...result.positions])
    })

    test('a ring of nodes on a circle is found, and keeps its shape while it moves', async () => {
        const ring: LayoutNode[] = Array.from({ length: 8 }, (_, k) =>
            node(`r${k}`, 300 + 200 * Math.cos(k * Math.PI / 4), 300 + 200 * Math.sin(k * Math.PI / 4), [k < 4 ? 'c' : 'm']))
        const others = [node('x', 0, 0, ['m']), node('y', 640, 40, ['c']), node('z', 50, 620, ['c'])]
        const all = [...ring, ...others]
        const ringBonds = ring.map((n, k) => ({ a: n.id, b: ring[(k + 1) % 8]!.id }))
        expect(regionsFound(all, ringBonds)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7]])
        // on a circle but not a cycle of bonds: not a ring
        expect(regionsFound(all, ringBonds.slice(0, 3))).toEqual([])
        const result = await reorganise(all, [...ringBonds, { a: 'x', b: 'r0' }, { a: 'y', b: 'r4' }],
                                        { seed: 3, forceSteps: 100, steps: 300 })
        const at = (id: string) => result.positions.get(id)!
        for (let k = 0; k < 8; k++) {
            for (let l = k + 1; l < 8; l++) {
                const before = Math.hypot(ring[k]!.x - ring[l]!.x, ring[k]!.y - ring[l]!.y)
                const after = Math.hypot(at(`r${k}`).x - at(`r${l}`).x, at(`r${k}`).y - at(`r${l}`).y)
                expect(after).toBeCloseTo(before, 6)
            }
        }
        expect(result.rings).toBe(1)
    })

    test('the layout stays centred where it was', async () => {
        const result = await reorganise(nodes, bonds, { seed: 7, forceSteps: 200, steps: 400 })
        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
        expect(mean([...result.positions.values()].map(p => p.x))).toBeCloseTo(mean(nodes.map(n => n.x)), 6)
        expect(mean([...result.positions.values()].map(p => p.y))).toBeCloseTo(mean(nodes.map(n => n.y)), 6)
    })

    test('a layout it cannot improve is left where it is', async () => {
        const tidy = [node('a', 0, 0, ['c']), node('b', 0, 80, ['c']), node('r', 80, 40, ['c', 'm']),
                      node('x', 160, 0, ['m']), node('y', 160, 80, ['m'])]
        const tidyBonds = [{ a: 'a', b: 'r' }, { a: 'b', b: 'r' }, { a: 'r', b: 'x' }, { a: 'r', b: 'y' }]
        const before = layoutComplexity(tidy, tidyBonds, complexityOptions(tidy, tidyBonds))
        const result = await reorganise(tidy, tidyBonds, { seed: 1, forceSteps: 50, steps: 100 })
        expect(result.after.total).toBeLessThanOrEqual(before.total + 1e-9)
        expect(result.after.subspaces).toBe(2)
    })
})
