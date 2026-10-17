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

// Editing a bond graph through its reaction equations (the Reactions panel). An edited equation becomes bond
// changes (./plugins/bondgraph/equations.ts: planEquationEdit): a changed coefficient sets its bond's bgf:bondCount,
// a removed species deletes its bond (and its chemostat copy, if no other step uses it), and an added species is
// bonded to its store; a species the diagram has no store for gets a new one, a chemostat a new copy beside the
// step, and a new equation a new reaction. New elements are placed beside the step, substrates to its left and
// products to its right.

import { CELLDL, MetadataPropertiesMap } from '@celldl/metadata'
import * as $rdf from '@celldl/rdf'

import { type CellDLConnectedObject, CellDLConnection, type CellDLObject } from '#editor/celldlObjects'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import {
    type EquationEdit, findSpeciesNode, parseEquation, planEquationEdit, type Side, type SpeciesNode
} from '#root/plugins/bondgraph/equations'
import { Point, type PointLike } from '#root/utils/points'
import { CONNECTION_COLOUR, CONNECTION_WIDTH } from '#root/utils/styling'
import { svgPathElement } from '#root/utils/svgUtils'

import { CellDLEditor } from '.'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
export const NEW_STORE_TYPE = `${BGF}ChemicalStorageNode`
export const NEW_REACTION_TYPE = `${BGF}ChemicalReactionNode`

const BESIDE = 120          // from a step to a new participant
const SPACING = 70          // between new participants on one side
const CLEARANCE = 40        // from other components

//==============================================================================

function bondgraphPlugin(): BondgraphPlugin {
    const plugin = componentLibraryPlugin.getPlugin('bondgraph-components')
    if (!plugin) throw new Error('The bond graph plugin is not loaded')
    return plugin as unknown as BondgraphPlugin
}

function editorParts() {
    const editor = CellDLEditor.instance
    const diagram = editor?.celldlDiagram
    const frame = editor?.editorFrame
    if (!editor || !diagram || !frame) throw new Error('No diagram is open')
    return { editor, diagram, frame }
}

function objectByUri(uri: string): CellDLObject|null {
    const { diagram } = editorParts()
    return diagram.objectById(uri.split('#').pop() ?? uri)
}

function centroidOf(object: CellDLObject): Point {
    // biome-ignore lint/style/noNonNullAssertion: a diagram's component has an SVG element
    return object.celldlSvgElement!.centroid
}

function componentCentroids(): Point[] {
    const { diagram } = editorParts()
    const points: Point[] = []
    for (const element of diagram.svgDiagram.querySelectorAll('g.celldl-Component')) {
        const object = diagram.objectById(element.id)
        if (object?.celldlSvgElement) points.push(object.celldlSvgElement.centroid)
    }
    return points
}

/** The first free place beside `centre`, left of it for a substrate and right for a product. */
function placeBeside(centre: PointLike, side: Side|'step', taken: Point[]): Point {
    const dx = side === 'substrate' ? -BESIDE : side === 'product' ? BESIDE : 0
    for (let k = 0; k < 40; k += 1) {
        const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * SPACING
        const point = new Point(centre.x + dx, centre.y + dy)
        if (taken.every(t => Math.hypot(t.x - point.x, t.y - point.y) > CLEARANCE)) {
            taken.push(point)
            return point
        }
    }
    return new Point(centre.x + dx, centre.y)
}

//==============================================================================

async function addElement(elementType: string, centre: PointLike, species?: string, location?: string,
                          value?: $rdf.Literal): Promise<CellDLConnectedObject> {
    const { diagram, frame } = editorParts()
    const plugin = bondgraphPlugin()
    const templateId = plugin.libraryTemplateId(elementType)
    const template = templateId ? componentLibraryPlugin.getObjectTemplateById(templateId) : undefined
    if (!template) throw new Error(`No library template draws a ${$rdf.getFragment(elementType)}`)
    const group = frame.addSvgElementFromTemplate(template, centre)
    const object = diagram.addConnectedObject(group, template)
    if (!object) throw new Error(`Cannot add a ${$rdf.getFragment(elementType)}`)
    await plugin.setElement(object, elementType, species, location, value)
    // centre it where asked: a template is placed by its top left corner
    const at = centroidOf(object)
    object.initialiseMove(group)
    object.reposition(at, centre)
    object.finaliseMove()
    if (!value) {
        added.push(`${elementType === NEW_REACTION_TYPE ? 'reaction' : 'store'} ${species ?? object.id}`
                   + (location ? `[${location}]` : ''))
    }
    return object
}

// The elements added since the last call of takeAddedElements(): their parameters are for the user to set
const added: string[] = []

/** The new elements an edit made (e.g. `store Xnew[c]`), which still need their parameters' values. */
export function takeAddedElements(): string[] {
    return added.splice(0)
}

function addBond(source: CellDLConnectedObject, target: CellDLConnectedObject, count: number): CellDLConnection {
    const { diagram } = editorParts()
    const from = centroidOf(source)
    const to = centroidOf(target)
    const start = source.celldlSvgElement?.boundaryIntersections(to)[0] ?? from
    const end = target.celldlSvgElement?.boundaryIntersections(from)[0] ?? to
    const path = svgPathElement([start, end], {
        class: 'bondgraph linear arrow',
        stroke: CONNECTION_COLOUR,
        'stroke-width': String(CONNECTION_WIDTH)
    })
    const connection = diagram.addNewConnection(path, {
        CellDLClass: CellDLConnection,
        metadataProperties: MetadataPropertiesMap.fromProperties([
            [$rdf.RDF.uri('type'), CELLDL.uri('Connection')],
            [CELLDL.uri('hasSource'), source.uri],
            [CELLDL.uri('hasTarget'), target.uri],
            [CELLDL.uri('hasIntermediate'), []]
        ])
    })
    bondgraphPlugin().setBondCount(connection, count)
    return connection
}

/** A potential source's type and value, to copy it beside another step. */
function sourceCopy(node: SpeciesNode): { type: string, value?: $rdf.Literal } {
    const object = objectByUri(node.id)
    const type = object ? bondgraphPlugin().elementType(object) : undefined
    const value = object?.rdfStore.query(`
        SELECT ?value WHERE { <${node.id}> <${BGF}hasValue> ?value }`)[0]?.get('value') as $rdf.Literal|undefined
    return { type: type ?? `${BGF}ChemicalPotential`, value }
}

async function applyEdit(step: CellDLConnectedObject, edit: EquationEdit, taken: Point[]) {
    const plugin = bondgraphPlugin()
    if (edit.op === 'count') {
        const bond = objectByUri(edit.bond)
        if (bond?.isConnection) plugin.setBondCount(bond as CellDLConnection, edit.count)
    } else if (edit.op === 'remove') {
        const { diagram } = editorParts()
        const bond = objectByUri(edit.bond)
        if (bond) diagram.removeObject(bond)
        // a chemostat copy no other step uses goes too
        const node = edit.node ? objectByUri(edit.node) : null
        const isSource = plugin.speciesNodes().some(n => n.id === edit.node && n.isSource)
        if (node && isSource && (node as CellDLConnectedObject).connections.length === 0) {
            diagram.removeObject(node)
        }
    } else {
        const found = findSpeciesNode(plugin.speciesNodes(), edit.species, edit.location)
        const location = edit.location ?? found?.location
        let node: CellDLConnectedObject|null = null
        if (found && !found.isSource) {
            node = objectByUri(found.id) as CellDLConnectedObject|null
        }
        if (!node) {
            const place = placeBeside(centroidOf(step), edit.side, taken)
            if (found) {
                const copy = sourceCopy(found)
                node = await addElement(copy.type, place, edit.species, location, copy.value)
            } else {
                node = await addElement(NEW_STORE_TYPE, place, edit.species, location ?? stepLocation(step))
            }
        }
        if (edit.side === 'substrate') addBond(node, step, edit.count)
        else addBond(step, node, edit.count)
    }
}

function stepLocation(step: CellDLObject): string|undefined {
    const location = step.rdfStore.query(`
        SELECT ?location WHERE { <${step.uri.value}> <${BGF}hasLocation> ?location }`)[0]?.get('location')
    return location?.value
}

//==============================================================================

/**
 * Make the step `stepUri` follow the equation `text`; returns the number of bond changes. Throws an Error with a
 * message for the user when the equation cannot be read or placed.
 */
export async function applyEquation(stepUri: string, text: string): Promise<number> {
    const current = bondgraphPlugin().reactionEquations().find(eq => eq.id === stepUri)
    const step = objectByUri(stepUri) as CellDLConnectedObject|null
    if (!current || !step) throw new Error('That step is no longer in the diagram')
    const edits = planEquationEdit(current, parseEquation(text))
    // check every added species can be placed before changing anything
    for (const edit of edits) {
        if (edit.op === 'add') findSpeciesNode(bondgraphPlugin().speciesNodes(), edit.species, edit.location)
    }
    const taken = componentCentroids()
    for (const edit of edits) {
        await applyEdit(step, edit, taken)
    }
    return edits.length
}

/**
 * Add a reaction following the equation `text`, named `name` (its species label), below the diagram's other
 * components; returns its URI.
 */
export async function addReaction(text: string, name: string, location?: string): Promise<string> {
    const parsed = parseEquation(text)
    for (const p of [...parsed.substrates, ...parsed.products]) {
        findSpeciesNode(bondgraphPlugin().speciesNodes(), p.species, p.location)
    }
    const taken = componentCentroids()
    const below = taken.length ? Math.max(...taken.map(p => p.y)) + 2 * BESIDE : 100
    const middle = taken.length ? taken.reduce((x, p) => x + p.x, 0) / taken.length : 200
    const step = await addElement(NEW_REACTION_TYPE, placeBeside(new Point(middle, below), 'step', taken),
                                  name || 'Re', location ?? parsed.substrates[0]?.location)
    await applyEquation(step.uri.value, text)
    return step.uri.value
}

//==============================================================================
//==============================================================================
