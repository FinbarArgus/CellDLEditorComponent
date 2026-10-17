/** biome-ignore-all lint/style/noNonNullAssertion: <test fixtures exist> */
import { describe, expect, test } from 'bun:test'

import {
    bondCrossings, boundaryShape, connectRegions, type LayoutNode, regionComponents, regionGrid, regionLoops, regionPoints
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
