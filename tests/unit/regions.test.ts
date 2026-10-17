/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'

import {
    bondCrossings, boundaryShape, complexityOptions, connectRegions, layoutComplexity, type LayoutNode, rectangularRegions,
    regionComponents, regionGrid, regionLoops, regionPoints
} from '../../src/plugins/bondgraph/regions'

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

    test('separate regions are drawn as rectangles meeting at the step between them; interleaved ones are not', () => {
        const nodes = [node('a1', 0, 0, ['c']), node('a2', 0, 60, ['c']), node('r', 100, 30, ['c', 'm']),
                       node('b1', 200, 0, ['m']), node('b2', 200, 60, ['m'])]
        const rects = rectangularRegions(nodes, 10)!
        const c = rects.get('c')!, m = rects.get('m')!
        expect(c.x1).toBeCloseTo(100, 6)            // they meet at the step
        expect(m.x0).toBeCloseTo(100, 6)
        for (const n of nodes) {
            for (const l of n.labels) {
                const r = rects.get(l)!
                expect(n.x >= r.x0 && n.x <= r.x1 && n.y >= r.y0 && n.y <= r.y1).toBe(true)
            }
        }
        const bonds = [{ a: 'a1', b: 'r' }, { a: 'a2', b: 'r' }, { a: 'r', b: 'b1' }, { a: 'r', b: 'b2' }]
        const measured = layoutComplexity(nodes, bonds, { ...complexityOptions(nodes, bonds), rectangles: true })
        expect(measured.rectangular).toBe(true)
        expect(measured.turning).toBe(0)
        // the padding only widens the outer edge: it never makes neighbouring regions overlap
        const padded = rectangularRegions(nodes, 100)!
        expect(padded.get('c')!.x1).toBeCloseTo(100, 6)
        expect(padded.get('c')!.x0).toBeCloseTo(-115, 6)
        const interleaved = [node('a1', 0, 0, ['c']), node('b1', 100, 0, ['m']), node('a2', 200, 0, ['c'])]
        expect(rectangularRegions(interleaved, 10)).toBeUndefined()
    })

    test('two steps joining three regions side by side across their corner still give rectangles', () => {
        // m above, p bottom left, c bottom right; the c nodes stop well short of the corner at (0, 100)
        const nodes = [node('m1', -100, 0, ['m']), node('m2', 100, 0, ['m']), node('p1', -100, 200, ['p']),
                       node('c1', 120, 200, ['c']), node('x1', -30, 100, ['c', 'm', 'p']), node('x2', 30, 100, ['c', 'm', 'p'])]
        const rects = rectangularRegions(nodes, 20)!
        expect([...rects.keys()]).toEqual(['c', 'm', 'p'])
        expect(rects.get('m')!.y1).toBeLessThanOrEqual(rects.get('c')!.y0 + 1e-6)
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
