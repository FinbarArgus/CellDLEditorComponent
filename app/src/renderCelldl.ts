/** biome-ignore-all lint/style/noNonNullAssertion: <the query rows and page elements exist> */

// Draws a CellDL spec (render-celldl.html?spec=<url>) as a CellDL document: each element's image as the editor draws
// it (its template's style and law label, from the BG-RDF templates the editor bundles), see scripts/render-celldl.ts.

import { SPARQL_PREFIXES } from '@celldl/metadata'
import { initialise, RdfStore } from '@celldl/rdf'

import { lengthToPixels } from '#editor/geometry/units'
import { BONDGRAPH_COMPONENT_DEFINITIONS, svgImageData } from '#root/plugins/bondgraph/definitions'
import { elementTemplatesQuery, styleOverrides, templateStyle } from '#root/plugins/bondgraph/laws'
import type { BGComponentDefinition } from '#root/plugins/bondgraph/utils'
import { type CelldlSpec, celldlDocument, type ElementImage } from '#root/utils/celldlDocument'
import { svgFromDataUrl } from '#root/utils/svgUtils'

import ontology from '#root/assets/bg-rdf/ontology.ttl?raw'
import chemical from '#root/assets/bg-rdf/templates/chemical.ttl?raw'
import electrical from '#root/assets/bg-rdf/templates/electrical.ttl?raw'
import hydraulic from '#root/assets/bg-rdf/templates/hydraulic.ttl?raw'
import mechanical from '#root/assets/bg-rdf/templates/mechanical.ttl?raw'

// An element is drawn as the first of these base components its template descends from (a storage composite as
// its Zero Node, a reaction composite as a Reaction)
const BASE_ORDER = ['ZeroStorageNode_q', 'OneResistanceNode', 'Reaction', 'PotentialSource', 'FlowSource',
                    'QuantityStore', 'Resistance', 'FlowStore', 'TransformNode', 'ZeroNode', 'OneNode']

interface TemplateLook {
    defn: BGComponentDefinition
    lawLabel?: string
    overrides: ReturnType<typeof styleOverrides>
}

await initialise()
const store = new RdfStore()
store.load('https://bg-rdf.org/ontologies/bondgraph-framework', ontology)
for (const [name, source] of Object.entries({ chemical, electrical, hydraulic, mechanical })) {
    store.load(`https://bg-rdf.org/templates/${name}.ttl`, source)
}
const looks: Map<string, TemplateLook> = new Map()
for (const id of BASE_ORDER) {
    const defn = BONDGRAPH_COMPONENT_DEFINITIONS.find(d => d.id === id)
    if (!defn) continue
    if (!looks.has(defn.type)) looks.set(defn.type, { defn, overrides: {} })
    for (const r of store.query(`${SPARQL_PREFIXES}${elementTemplatesQuery(defn.type)}`)) {
        const type = r.get('element')!.value
        if (!looks.has(type)) {
            looks.set(type, { defn, lawLabel: r.get('lawLabel')?.value, overrides: styleOverrides(r) })
        }
    }
}

/** A type the editor offers under no base component (e.g. a reaction composite): drawn as its first known
    ancestor, with the law label and style of the nearest template that has them. */
function lookOf(type: string): TemplateLook|undefined {
    if (looks.has(type)) return looks.get(type)
    const ancestors = store.query(`${SPARQL_PREFIXES} SELECT ?base WHERE { <${type}> rdfs:subClassOf+ ?base }`)
                           .map((r: Map<string, { value: string }>) => r.get('base')!.value)
    const known = ancestors.map(looks.get.bind(looks)).filter(l => l !== undefined) as TemplateLook[]
    const base = BASE_ORDER.map(id => BONDGRAPH_COMPONENT_DEFINITIONS.find(d => d.id === id))
                           .find(d => d && ancestors.includes(d.type))
    if (!base) return undefined
    const labelled = known.find(l => l.lawLabel)
    const look = { defn: base, lawLabel: labelled?.lawLabel, overrides: labelled?.overrides ?? {} }
    looks.set(type, look)
    return look
}

const specUrl = new URLSearchParams(window.location.search).get('spec')!
const spec: CelldlSpec = await (await fetch(specUrl)).json()
const images: Map<string, ElementImage> = new Map()
for (const e of spec.elements) {
    const look = lookOf(e.type)
    if (!look) {
        throw new Error(`${e.id}: no template ${e.type}`)
    }
    const href = svgImageData(e.symbol, e.species, e.location, templateStyle(look.defn.style, look.overrides),
                              undefined, look.lawLabel)
    const svg = new DOMParser().parseFromString(svgFromDataUrl(href)!, 'image/svg+xml').documentElement
    images.set(e.id, {
        href,
        width: lengthToPixels(svg.getAttribute('width')) || 40,
        height: lengthToPixels(svg.getAttribute('height')) || 30
    })
}
const document_ = celldlDocument(spec, images)
document.getElementById('diagram')!.innerHTML = document_
document.body.dataset.celldl = btoa(unescape(encodeURIComponent(document_)))
