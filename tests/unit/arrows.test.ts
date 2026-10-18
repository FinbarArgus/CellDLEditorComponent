/** biome-ignore-all lint/style/noNonNullAssertion: <the elements looked up exist> */

// PhLynx's arrowhead on bonds (src/utils/arrows.ts): as a marker in the editor and generated documents, and as a
// plain shape in exported figures.

import { describe, expect, test } from 'bun:test'

import { DOMParser } from '@xmldom/xmldom'

import { ARROW_POINTS, arrowMarker, arrowShape } from '#root/utils/arrows'
import { celldlDocument } from '#root/utils/celldlDocument'

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement!

describe('arrows', () => {
    test('the marker is PhLynx\'s closed arrow, its tip at the end of the connection', () => {
        const marker = parse(arrowMarker('end', 'bondgraph'))
        // PhLynx's CouplingEdge: viewBox -10 -10 20 20, tip (0, 0) at refX 0, 12.5 stroke widths, one head per edge
        expect(marker.getAttribute('viewBox')).toBe('-10 -10 20 20')
        expect([marker.getAttribute('refX'), marker.getAttribute('refY')]).toEqual(['0', '0'])
        expect(marker.getAttribute('markerUnits')).toBe('strokeWidth')
        expect([marker.getAttribute('markerWidth'), marker.getAttribute('markerHeight')]).toEqual(['12.5', '12.5'])
        expect(marker.getAttribute('orient')).toBe('auto-start-reverse')
        const polyline = marker.getElementsByTagName('polyline')[0]!
        expect(polyline.getAttribute('points')).toBe('-5,-4 0,0 -5,4 -5,-4')
        expect(polyline.getAttribute('fill')).toBe('context-stroke')
    })

    test('as a shape, the head points along the line with its tip on the line\'s end', () => {
        const shape = parse(arrowShape(0, 0, 0, 50, 2, '#333'))
        expect(shape.getAttribute('points')).toBe(ARROW_POINTS)
        // pointing down (90 degrees), at (0, 50), as large as the marker on a line 2 wide: 2 * 12.5 / 20
        expect(shape.getAttribute('transform')).toBe('translate(0,50) rotate(90) scale(1.25)')
        expect(shape.getAttribute('fill')).toBe('#333')
    })

    test('a generated document\'s bonds end at the target\'s edge with that marker', () => {
        const spec = {
            label: 'A -> r', turtle: '',
            elements: [
                { id: 'q_A', type: 'bgf:ChemicalStorageNode', symbol: 'q', species: 'A', location: 'c', x: 0, y: 0 },
                { id: 'Re_r', type: 'bgf:ChemicalReactionNode', symbol: 'Re', species: 'r', location: 'c', x: 100, y: 0 },
            ],
            connections: [{ id: 'q_A.Re_r', source: 'q_A', target: 'Re_r', count: 1 }]
        }
        const images = new Map([['q_A', { href: 'a', width: 40, height: 20 }], ['Re_r', { href: 'r', width: 60, height: 20 }]])
        const svg = parse(celldlDocument(spec, images))
        const marker = svg.getElementsByTagName('marker')[0]!
        expect(marker.getAttribute('id')).toBe('connection-end-arrow-bondgraph')
        expect(marker.getElementsByTagName('polyline')[0]!.getAttribute('points')).toBe(ARROW_POINTS)
        const bond = svg.getElementsByTagName('path')[0]!
        expect(bond.getAttribute('d')).toBe('M20 0L70 0')            // from q_A's right edge to Re_r's left edge
    })
})
