/** biome-ignore-all lint/style/noNonNullAssertion: <the elements looked up exist> */

// Unit tests of assembling a CellDL document from a generated bond graph (src/utils/celldlDocument.ts):
//
//     bun run test

import { describe, expect, test } from 'bun:test'

import { DOMParser } from '@xmldom/xmldom'

import { boxEdge, type CelldlSpec, celldlDocument, type ElementImage } from '#root/utils/celldlDocument'

const SPEC: CelldlSpec = {
    label: 'A <-> B',
    turtle: '@prefix : <#> .\n<> a <http://celldl.org/ontologies/celldl#Document> .\n',
    elements: [
        { id: 'q_A', type: 'bgf:ChemicalStorageNode', symbol: 'q', species: 'A', location: 'c', x: 0, y: 0 },
        { id: 'Re_r', type: 'bgf:ChemicalReactionNode', symbol: 'Re', species: 'r', location: 'c', x: 100, y: 0 },
        { id: 'q_B', type: 'bgf:ChemicalStorageNode', symbol: 'q', species: 'B', location: 'c', x: 100, y: 80 },
    ],
    connections: [
        { id: 'q_A.Re_r', source: 'q_A', target: 'Re_r', count: 1 },
        { id: 'Re_r.q_B', source: 'Re_r', target: 'q_B', count: 2 },
    ]
}
const IMAGES: Map<string, ElementImage> = new Map([
    ['q_A', { href: 'data:image/svg+xml,a', width: 40, height: 20 }],
    ['Re_r', { href: 'data:image/svg+xml,r', width: 60, height: 20 }],
    ['q_B', { href: 'data:image/svg+xml,b', width: 40, height: 20 }],
])

describe('box edges', () => {
    test('a line leaves a box through the side it points at', () => {
        expect(boxEdge(0, 0, 40, 20, 100, 0)).toEqual([20, 0])
        expect(boxEdge(0, 0, 40, 20, 0, -50)).toEqual([0, -10])
        expect(boxEdge(0, 0, 40, 20, 100, 100)).toEqual([10, 10])     // the top and bottom are nearer
        expect(boxEdge(5, 5, 40, 20, 5, 5)).toEqual([5, 5])
    })
})

describe('the document', () => {
    // a DOM parser outside the browser (MathJax's, which the editor already depends on)
    const root = new DOMParser().parseFromString(celldlDocument(SPEC, IMAGES), 'image/svg+xml').documentElement!
    const all = (tag: string) => [...Array.from(root.getElementsByTagName(tag))]
    const layer = all('g').find(g => g.getAttribute('id') === 'celldl-diagram-layer')!

    test('is SVG with the Turtle in CellDL\'s metadata element', () => {
        expect(root.tagName).toBe('svg')
        const metadata = all('metadata')[0]!
        expect(metadata.getAttribute('id')).toBe('celldl-rdf-metadata')
        expect(metadata.getAttribute('data-content-type')).toBe('text/turtle')
        expect(metadata.textContent).toBe(SPEC.turtle)
    })

    test('has a component per element, its image centred on its position', () => {
        const components = all('g').filter(g => g.getAttribute('class') === 'celldl-Component')
        expect(components.every(c => c.parentNode === layer)).toBe(true)
        expect(components.map(c => c.getAttribute('id'))).toEqual(['q_A', 'Re_r', 'q_B'])
        expect(components[1]!.getAttribute('transform')).toBe('matrix(1,0,0,1,70,-10)')
        expect(components[1]!.getElementsByTagName('image')[0]!.getAttribute('href')).toBe('data:image/svg+xml,r')
    })

    test('has a bond path per connection between the images\' edges, a count beside it when above 1', () => {
        const bonds = all('path').filter(p => p.getAttribute('class') === 'celldl-Connection bondgraph arrow')
        expect(bonds.every(b => b.parentNode === layer)).toBe(true)
        expect(bonds.map(b => b.getAttribute('id'))).toEqual(['q_A.Re_r', 'Re_r.q_B'])
        expect(bonds[0]!.getAttribute('d')).toBe('M20 0L70 0')
        expect(bonds[1]!.getAttribute('d')).toBe('M100 10L100 70')
        expect(all('text').map(t => t.textContent)).toEqual(['2'])
    })
})
