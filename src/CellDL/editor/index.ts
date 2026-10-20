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
/** biome-ignore-all lint/style/noNonNullAssertion: values known to be non null */

import * as vue from 'vue'
import { useTippy } from "vue-tippy"

import '#root/assets/svgContent.css'

import type { CellDLObject } from '#editor/celldlObjects'
import { PathMaker, type PathNode } from '#editor/connections/pathmaker'
import type { TemplateEventDetails } from '#editor/components'
import { objectMetadataTemplate, ObjectPropertiesPanel } from '#editor/components/properties'
import type { CellDLDiagram } from '#editor/diagram'
import { SelectionSet } from '#editor/diagram/selectionset'
import { type MoveUndoState, undoRedo } from '#editor/diagram/undoredo'
import { round } from '#editor/utils'

import { isMacOs } from '#root/utils/common'
import { PANEL_ID } from '#root/utils/editor-types'
import { type Point, type PointLike, PointMath } from '#root/utils/points'
import type { StringProperties } from '#root/utils/types'
import { componentLibraryPlugin } from '#root/plugins'

//==============================================================================

import { EditorFrame } from './editorframe'
import { DEFAULT_VIEW_STATE, editGuides, EDITOR_GRID_CLASS } from './editguides'
import PanZoom from './panzoom'
import { BoxMaker } from './boxmaker'

//==============================================================================

// Set the CSS variables that style a compartment as it is being drawn

import {
    COMPARTMENT_BACKGROUND,
    MEMBRANE_COLOUR,
    MEMBRANE_CORNER_RADIUS,
    MEMBRANE_GAP,
    MEMBRANE_STROKE_WIDTH
} from '#root/utils/styling'
document.documentElement.style.setProperty('--editor-compartment-fill', COMPARTMENT_BACKGROUND)
document.documentElement.style.setProperty('--editor-membrane-colour', MEMBRANE_COLOUR)
document.documentElement.style.setProperty('--editor-membrane-gap', String(MEMBRANE_GAP))
document.documentElement.style.setProperty('--editor-membrane-radius', String(MEMBRANE_CORNER_RADIUS))
document.documentElement.style.setProperty('--editor-membrane-width', String(MEMBRANE_STROKE_WIDTH))

//==============================================================================

/****  WIP
const SVG_CLOSE_DISTANCE = 2   // Pointer is close to object in SVG coords
                               // c.f. stroke-width (for connections)??
WIP ****/

//==============================================================================

const MAX_POINTER_CLICK_TIME = 200 // milliseconds

//==============================================================================

// Lookup tables for tracking tool bar state

export enum EDITOR_TOOL_IDS {
    SelectTool = 'editor-select-tool',
    BondgraphTool = 'editor-bondgraph-tool',
    DrawingTool = 'editor-drawing-tool'
}

export const DEFAULT_EDITOR_TOOL_ID = EDITOR_TOOL_IDS.SelectTool

enum EDITOR_MODE {
    Selecting = 'SELECTING',
    PathDrawing = 'DRAW-PATH',
    AddingComponent = 'ADD-COMPONENT',
    DrawCompartment = 'DRAW-COMPARTMENT'
}

const DEFAULT_EDITOR_MODE = EDITOR_MODE.Selecting

//==============================================================================

export enum CONTEXT_MENU {
    DELETE = 'menu-delete',
    EDIT_GROUP = 'menu-edit-group',
    INFO = 'menu-info',
    GROUP_OBJECTS = 'menu-group',
    UNGROUP_OBJECTS = 'menu-ungroup'
}

//==============================================================================

export function notifyChanges() {
    document.dispatchEvent(new CustomEvent('file-edited'))
}

//==============================================================================

export function getElementId(element: SVGGraphicsElement): string {
    return element.dataset.parentId
        ? element.dataset.parentId
        : element.classList.contains('parent-id')
          ? element.parentElement?.id || ''
          : element.id
}

//==============================================================================

const SVG_PANEL_ID = 'svg-panel'
type PointerEventHandler = (eventType: string, svgElement: SVGGraphicsElement, svgCoords: PointLike) => boolean


export class CellDLEditor {
    static instance: CellDLEditor | null = null

    #container: HTMLElement | null = null
    #statusMsg: HTMLElement | null = null
    #statusPos: HTMLElement | null = null
    #statusStyle: string = ''

    #celldlDiagram: CellDLDiagram | null = null
    #svgDiagram: SVGSVGElement | null = null
    #editorFrame: EditorFrame | null = null
    #moveUndoState: MoveUndoState | null = null

    #panning: boolean = false
    #panzoom: PanZoom | null = null
    protected pointerMoved: boolean = false
    protected moving: boolean = false
    protected moved: boolean = false
    #moveSelection: boolean = false

    #editorMode: EDITOR_MODE = DEFAULT_EDITOR_MODE
    #dirty: boolean = false

    #dragging: boolean = false
    #haveFocus: boolean = true

    #pathMaker: PathMaker | null = null
    #nextPathNode: PathNode | null = null

    #contextMenuActiveItems: Set<CONTEXT_MENU> = new Set()

    #currentTemplateDetails: TemplateEventDetails | null = null
    #drawConnectionSettings: StringProperties = {}

    // Keep:
    // * Current object that the pointer is over
    // * Set of active objects -- either currentObject or set of selectedObjects
    // * set of selected objects.
    #activeObjects: Map<string, CellDLObject> = new Map()
    protected currentObject: CellDLObject | null = null
    protected selectionSet: SelectionSet = new SelectionSet(this)

    // Auto close selection box on pointer up, keeping enclosed objects selected
    #boxMaker: BoxMaker | null = null
    #boxMaking: boolean = false

    #pointerDownTime: number = 0
    #pointerEventHandlers: Map<string, PointerEventHandler> = new Map()

    #openPanel: ObjectPropertiesPanel | undefined = undefined
    #panels: Map<PANEL_ID, ObjectPropertiesPanel> = new Map([
        [
            PANEL_ID.METADATA_PANEL, new ObjectPropertiesPanel(PANEL_ID.METADATA_PANEL, [
                objectMetadataTemplate(),
                ...componentLibraryPlugin.getPanelTemplates(PANEL_ID.METADATA_PANEL)
            ])
        ],
        [
            PANEL_ID.PROPERTIES_PANEL, new ObjectPropertiesPanel(PANEL_ID.PROPERTIES_PANEL,
                componentLibraryPlugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL)
            )
        ],
        [
            PANEL_ID.STYLE_PANEL, new ObjectPropertiesPanel(PANEL_ID.STYLE_PANEL,
                componentLibraryPlugin.getPanelTemplates(PANEL_ID.STYLE_PANEL)
            )
        ]
    ])

    #tooltip: vue.Ref|undefined
    #tooltipElement: HTMLElement|undefined
    #tooltipStyle: string = ''

    constructor() {
        CellDLEditor.instance = this

        // Add a handler for events from toolbar buttons and popovers
        document.addEventListener('toolbar-event', this.#toolBarEvent.bind(this))
        document.addEventListener('component-selected', this.#componentTemplateSelectedEvent.bind(this))
        document.addEventListener('component-drag', this.#componentTemplateDragEvent.bind(this))
        document.addEventListener('connection-style', this.#connectionStyleEvent.bind(this))
        document.addEventListener('celldl-drawing', this.#celldlDrawingEvent.bind(this))

        // Add handler for events from panels
        document.addEventListener('panel-event', this.#panelEvent.bind(this))
        document.addEventListener('style-event', this.#styleEvent.bind(this))

        // Handle click events on control points
        document.addEventListener('select-object', this.#objectClickEvent.bind(this))
    }

    mount(svgContainer: HTMLElement) {
        this.#container = svgContainer
        this.#statusMsg = document.getElementById('status-msg')
        this.#statusPos = document.getElementById('status-pos')

        // Create a panzoom handler
        this.#panzoom = new PanZoom(this.#container)

        // Set up event handlers
        this.#container.addEventListener('click', this.#pointerClickEvent.bind(this))
        this.#container.addEventListener('dblclick', this.#pointerDoubleClickEvent.bind(this))

        this.#container.addEventListener('pointerover', this.#pointerOverEvent.bind(this))
        this.#container.addEventListener('pointerout', this.#pointerOutEvent.bind(this))

        this.#container.addEventListener('pointerdown', this.#pointerDownEvent.bind(this))
        this.#container.addEventListener('pointermove', this.#pointerMoveEvent.bind(this))
        this.#container.addEventListener('pointerup', this.#pointerUpEvent.bind(this))

        // Editor content focus handlers
        document.addEventListener('focusin', this.#focusEvent.bind(this))
        document.addEventListener('focusout', this.#focusEvent.bind(this))

        // Keyboard handlers
        window.addEventListener('keydown', this.#keyDownEvent.bind(this))
        window.addEventListener('keyup', this.#keyUpEvent.bind(this))

        // Add handlers for dropping components on the canvas
        this.#container.addEventListener('dragover', this.#appDragOverEvent.bind(this))
        this.#container.addEventListener('drop', this.#appDropEvent.bind(this))

        // Create a tooltip

        const { tippy } = useTippy(this.#container, {
            content: '',
            animation: 'none',
            duration: [0, 0],
            showOnCreate: false,
            hideOnClick: false,
            trigger: 'manual',
            arrow: true,
            followCursor: true
        })
        if (tippy.value) {
            this.#tooltip = tippy
            this.#tooltipElement = this.#tooltip.value.popper
        }
        // Handle context menu events
        this.#container.addEventListener('contextmenu', (event) => {
            const element = event.target as SVGGraphicsElement
            const clickedObject = this.#celldlDiagram!.objectById(getElementId(element))
            if (clickedObject && clickedObject === this.currentObject) {
                // This is to select the object that's had a right click
                this.setSelectedObject(clickedObject)
            }
            document.dispatchEvent(new CustomEvent('open-context-menu', {
                detail: {
                    state: this.#contextMenuActiveItems,
                    event: event
                }
            }))
        })
        document.addEventListener('context-menu-click', (event: Event) => {
            const targetId = (<CustomEvent>event).detail.id
            if (targetId === CONTEXT_MENU.DELETE) {
                this.#deleteSelectedObjects()
            } else if (targetId === CONTEXT_MENU.INFO) {
// WIP               this.#showSelectedObjectInfo()
            } else if (targetId === CONTEXT_MENU.GROUP_OBJECTS) {
                if (this.#boxMaker) {
                    this.#boxMaker.groupComponents()
                    this.#closeBoxMaker()
                }
            }
        })
    }

    get celldlDiagram() {
        return this.#celldlDiagram
    }

    get dirty() {
        return this.#dirty
    }

    get editorFrame() {
        return this.#editorFrame
    }

    get status(): string {
        return this.#statusMsg ? this.#statusMsg.innerText : ''
    }
    set status(text: string) {
        this.showMessage(text)
    }

    get windowSize(): [number, number] {
        if (this.#container) {
            return [this.#container.clientWidth, this.#container.clientHeight]
        }
        return [0, 0]
    }

    setDirty() {
        if (!this.#dirty) {
            this.#dirty = true
        }
    }

    markClean() {
        if (this.#dirty) {
            this.#dirty = false
        }
    }

    async editDiagram(celldlDiagram: CellDLDiagram) {
        if (this.#celldlDiagram !== null) {
            this.closeDiagram()
        }
        this.#celldlDiagram = celldlDiagram
        this.#svgDiagram = celldlDiagram.svgDiagram

        // Make sure we have a group in which to put selection related objects
        // This MUST remain as the last group in the diagram when new layer groups are added...
        this.#editorFrame = new EditorFrame(celldlDiagram)

        // Initialise alignment guides and grid
        editGuides.newDiagram(celldlDiagram, DEFAULT_VIEW_STATE)

        // e.g. for its regions to be drawn
        document.dispatchEvent(new CustomEvent('diagram-opened'))

        // Show the diagram in the editor's window
        if (this.#container) {
            this.#container.appendChild(this.#svgDiagram!)
        }

        // Allow for the diagram to render
        await vue.nextTick()

        // Rewriting metadata during diagram finishSetup might dirty
        this.markClean()
        undoRedo.clean()

        // Finish setting up the diagram as we now have SVG elements
        celldlDiagram.finishSetup()

        // Enable pan/zoom and toolBars
        this.#panzoom!.enable(this.#svgDiagram!)

        // Set initial mode
        this.#editorMode = DEFAULT_EDITOR_MODE
        this.currentObject = null
        this.pointerMoved = false
        this.#activeObjects.clear()
        this.selectionSet.clear()
    }

    closeDiagram() {
        if (this.#celldlDiagram !== null) {
            this.#editorFrame!.clear()
            this.#editorFrame = null
            //            this.#toolBar.enable(false)
            this.#panzoom!.disable()
            if (this.#container) {
                this.#container.removeChild(this.#svgDiagram as Node)
            }
            this.#svgDiagram = null
            this.#celldlDiagram = null
        }
    }

    resetObjectStates() {
        this.unsetSelectedObjects()
        this.#unsetActiveObjects()
    }

    #setDefaultCursor() {
        if (this.#editorMode === EDITOR_MODE.PathDrawing
         || this.#editorMode === EDITOR_MODE.DrawCompartment) {
            this.#svgDiagram?.style.setProperty('cursor', 'crosshair')
        } else {
            this.#svgDiagram?.style.removeProperty('cursor')
        }
        if (this.#container) {
            this.#container.style.setProperty('cursor', 'default')
        }
    }

    enableContextMenuItem(itemId: CONTEXT_MENU, enable: boolean = true) {
        if (enable) {
            this.#contextMenuActiveItems.add(itemId)
        } else {
            this.#contextMenuActiveItems.delete(itemId)
        }
    }

    #changeMode(editorMode: EDITOR_MODE) {
        this.#editorMode = editorMode
        this.#setDefaultCursor()
        this.unsetSelectedObjects()
        this.#closeBoxMaker()
        if (this.#editorMode !== EDITOR_MODE.PathDrawing) {
            // Remove any partial path from editor frame...
            if (this.#pathMaker) {
                this.#pathMaker.close()
                this.#pathMaker = null
            }
        }
    }

    #toolBarEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        if (detail.type === 'state') {
            if (this.#panels.has(detail.source)) {
                this.#openPanel = this.#panels.get(detail.source)
            } else {
                this.#changeMode(EDITOR_MODE.Selecting)
            }
        }
    }

    async #panelEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        if (detail.source === this.#openPanel?.panelId) {
            if (this.#openPanel && this.selectionSet.size === 1) {
                const values = detail.value
                if (values.oldValue !== values.newValue) {
                    await this.#openPanel.updateObjectProperties(this.selectionSet.objects[0]!, detail.itemId, detail.value)
                    notifyChanges()
                }
            }
        }
    }

    async #styleEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        if (detail.source === this.#openPanel?.panelId) {
            if (this.#openPanel && this.selectionSet.size === 1) {
                await this.#openPanel.updateObjectStyling(this.selectionSet.objects[0]!, detail.styling)
                notifyChanges()
            }
        }
    }

    showMessage(msg: string, style: string = '') {
        if (this.#statusMsg) {
            this.#statusMsg.innerText = msg
            if (this.#statusStyle !== '') {
                this.#statusMsg.classList.remove(this.#statusStyle)
            }
            if (style !== '') {
                this.#statusMsg.classList.add(style)
                this.#statusStyle = style
            }
        }
    }

    #showStatus(pos: PointLike|null, currentObject: CellDLObject|null=null) {
        if (pos === null) {
            this.status = ''
            if (this.#statusPos) {
                const text = this.#statusPos.innerText
                if (!text.startsWith('(')) {
                    if (text.includes('(')) {
                        const parts = text.split('(')
                        this.#statusPos.innerText = `(${parts.slice(1).join('(')}`
                    } else {
                        this.#statusPos.innerText = ''
                    }
                }
            }
        } else {
            const position = `(${round(pos.x, 1)}, ${round(pos.y, 1)})`
            if (currentObject === null) {
                currentObject = this.currentObject
            }
            if (currentObject) {
                let pluginText = componentLibraryPlugin.statusText(currentObject)
                if (pluginText !== '') {
                    pluginText = ` (${pluginText})`
                }
                this.status = (currentObject.name ?? '') + pluginText
                if (this.#statusPos) {
                    this.#statusPos.innerText = `${currentObject.id} ${position}`
                }
            } else {
                this.status = ''
                if (this.#statusPos) {
                    this.#statusPos.innerText = position
                }
            }
        }
    }

    #hideTooltip() {
        if (this.#tooltip) {
            this.#tooltip.value.hide()
        }
    }

    showTooltip(msg: string, style: string = '', html: boolean = false) {
        if (msg === '') {
            this.#hideTooltip()
        } else if (this.#tooltip) {
            // HTML only from plugins (an element's typeset law), never from user text unescaped
            this.#tooltip.value.setProps({ allowHTML: html, maxWidth: html ? 640 : 350 })
            this.#tooltip.value.setContent(msg)
            this.#tooltip.value.show()
            if (this.#tooltipElement) {
                if (this.#tooltipStyle !== '') {
                    this.#tooltipElement.classList.remove(this.#tooltipStyle)
                    this.#tooltipStyle = ''
                }
                if (style !== '') {
                    const tooltipStyle = `tooltip-${style}`
                    this.#tooltipElement.classList.add(tooltipStyle)
                    this.#tooltipStyle = tooltipStyle
                }
            }
        }
    }

    #domToSvgCoords(domCoords: PointLike): DOMPoint {
        return this.#celldlDiagram!.domToSvgCoords(domCoords)
    }

    #highlightAssociatedObjects(object: CellDLObject, highlight: boolean) {
        for (const obj of this.#celldlDiagram!.associatedObjects(object)) {
            obj.highlight(highlight)
        }
    }

    #activateObject(object: CellDLObject, active: boolean) {
        object.activate(active)
        this.#highlightAssociatedObjects(object, active)
    }

    #setActiveObjects(activeObjects: CellDLObject[]) {
        for (const activeObject of activeObjects) {
            if (!this.#activeObjects.has(activeObject.id)) {
                activeObject.drawControlHandles()
                this.#activateObject(activeObject, true)
                this.#activeObjects.set(activeObject.id, activeObject)
            }
        }
    }

    #unsetActiveObjects() {
        for (const activeObject of this.#activeObjects.values()) {
            activeObject.clearControlHandles()
            this.#activateObject(activeObject, false)
        }
        this.#activeObjects.clear()
        this.currentObject = null
    }

    // Used by selection box and diagram undo/redo code
    selectObject(selectedObject: CellDLObject, select: boolean=true) {
        if (select) {
            this.setSelectedObject(selectedObject)
        } else {
            this.#unsetSelectedObject(selectedObject)
        }
    }

    protected setSelectedObject(selectedObject: CellDLObject) {
        if (this.selectionSet.select(selectedObject)) {
            this.enableContextMenuItem(CONTEXT_MENU.DELETE, true)
            this.enableContextMenuItem(CONTEXT_MENU.INFO, true)
        }
    }

    #unsetSelectedObject(selectedObject: CellDLObject|null) {
        if (selectedObject && this.selectionSet.unselect(selectedObject)) {
            this.enableContextMenuItem(CONTEXT_MENU.DELETE, false)
            this.enableContextMenuItem(CONTEXT_MENU.INFO, false)
        }
    }

    protected unsetSelectedObjects() {
        for (const selectedObject of this.selectionSet.objects || []) {
            this.#unsetSelectedObject(selectedObject)
        }
    }

    #deleteSelectedObjects() {
        this.#unsetActiveObjects()
        this.selectionSet.deleteObjects()
        if (this.#boxMaker) {
            this.#boxMaker.close()
            this.#boxMaker = null
        }
        this.#showStatus(null)
    }

    setPropertiesPanelObject(celldlObject: CellDLObject|undefined) {
        for (const panel of this.#panels.values()) {
            panel.setObjectProperties(celldlObject)
        }
    }

    #componentTemplateDragEvent(_event: Event) {
        this.#dragging = true
    }

    #appDragOverEvent(event: DragEvent) {
        if (this.#dragging && event.dataTransfer) {
            event.preventDefault() // Needed to allow drop
            event.dataTransfer.dropEffect = 'copy'
        }
    }

    #componentTemplateSelectedEvent(event: Event) {
        // A component's template has been selected in a tool

        this.#changeMode(EDITOR_MODE.AddingComponent)
        this.#currentTemplateDetails = (<CustomEvent>event).detail
    }

    #connectionStyleEvent(event: Event) {
        // A connection style has been selected in a tool

        this.#changeMode(EDITOR_MODE.PathDrawing)
        this.#drawConnectionSettings.style = (<CustomEvent>event).detail.style
    }

    #celldlDrawingEvent(event: Event) {
        // A drawing tool has been selected

        const tool = (<CustomEvent>event).detail.tool
        if (tool === 'draw-closed-compartment') { // draw-background-region
            this.#changeMode(EDITOR_MODE.DrawCompartment)
        }

    }

    protected addComponentTemplate(eventPosition: PointLike, details: TemplateEventDetails, dragged=false) {
        // Adjust position by offset at component selection
        const zoomScale = this.#panzoom?.scale || 1
        let topLeft = PointMath.subtract(eventPosition, PointMath.scalarScale(details.centre, zoomScale))
        if (dragged) {
            topLeft = topLeft.subtract(PointMath.scalarScale(details.offset, zoomScale))
        }
        const template = componentLibraryPlugin.getObjectTemplateById(details.id)
        if (!template) {
            console.error(`Drop of unknown component template '${details.id}'`)
            return
        }
        const componentGroup = this.#editorFrame!.addSvgElementFromTemplate(template, this.#domToSvgCoords(topLeft))
        const celldlObject = this.#celldlDiagram!.addConnectedObject(componentGroup, template)
        this.#unsetActiveObjects()
        if (celldlObject) {
            // Select newly added object
            this.unsetSelectedObjects()
            this.setSelectedObject(celldlObject)
            this.#showStatus(celldlObject.celldlSvgElement?.centroid as Point, celldlObject)
        }
    }

    #addCompartment() {
        if (this.#boxMaker) {
            const celldlObject = this.#boxMaker.makeCompartment()
            this.#unsetActiveObjects()
            if (celldlObject) {
                // Select newly added object
                this.unsetSelectedObjects()
                this.setSelectedObject(celldlObject)
                this.#showStatus(celldlObject.celldlSvgElement?.centroid as Point, celldlObject)
            }
        }
    }

    #appDropEvent(event: DragEvent) {
        this.#dragging = false
        event.preventDefault();
        if (event.dataTransfer) {
            const itemList = event.dataTransfer!.items
            for (let index = 0; index < itemList.length; ++index) {
                const item = itemList[index]!
                if (item.kind === "string" && item.type.match("^text/plain")) {
                    item.getAsString((s: string) => {
                        this.addComponentTemplate(event, JSON.parse(s), true)
                    })
                }
            }
        }
    }

    #objectClickEvent(event: Event) {
        if (this.#editorMode === EDITOR_MODE.Selecting) {
            const detail = (<CustomEvent>event).detail
            const clickedObject: CellDLObject = detail.clickedObject
            this.#selectionClickEvent(detail.event, clickedObject.svgElement!, clickedObject)
        }
    }

    addPointerEventHandler(handlerId: string, handler: PointerEventHandler) {
        this.#pointerEventHandlers.set(handlerId, handler)
    }

    removePointerEventHandler(handlerId: string) {
        if (this.#pointerEventHandlers.has(handlerId)) {
            this.#pointerEventHandlers.delete(handlerId)
        }
    }

    #handlePointerEvents(event: PointerEvent|MouseEvent): boolean {
        for (const handler of this.#pointerEventHandlers.values()) {
            if (handler(event.type, event.target as SVGGraphicsElement, this.#domToSvgCoords(event))) {
                return true
            }
        }
        return false
    }

    #pointerClickEvent(event: MouseEvent) {
        if (this.#handlePointerEvents(event)) {
            return
        }
        const element = event.target as SVGGraphicsElement
        if (
            this.#celldlDiagram === null ||
            !this.#svgDiagram?.contains(element) ||
            // clickTolerance = 1px ? to set pointerMoved?
            (this.pointerMoved && Date.now() - this.#pointerDownTime > MAX_POINTER_CLICK_TIME)
        ) {
            return
        }
        const clickedObject = this.#celldlDiagram.objectById(getElementId(element))
        if (this.#editorMode === EDITOR_MODE.AddingComponent && clickedObject === null) {
            if (this.#currentTemplateDetails) {
                this.addComponentTemplate(event, this.#currentTemplateDetails)
            }
        } else if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                if (this.currentObject === null) {
                    const svgPoint = this.#domToSvgCoords(event)
                    this.#pathMaker.addPoint(svgPoint, event.shiftKey)
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.Selecting) {
            this.#selectionClickEvent(event, element, clickedObject)
        }
    }

    #selectionClickEvent(event: MouseEvent, _element: SVGGraphicsElement, clickedObject: CellDLObject|null) {
        if (clickedObject === null
         || !event.metaKey
         || !this.selectionSet.firstMoveableObject
         || !clickedObject.isMoveable
        ) {
            // Forget all selected objects
            this.selectionSet.clear(!event.shiftKey)
        }
        // Select when active object is clicked
        if (clickedObject && clickedObject === this.currentObject) {
            if (event.metaKey) {
                if (clickedObject.selected) {
                    this.#unsetSelectedObject(clickedObject)
                } else {
                    this.setSelectedObject(clickedObject)
                }
            } else {
                if (event.shiftKey
                 && clickedObject.isMoveable
                 && this.selectionSet.firstMoveableObject
                 && clickedObject !== this.selectionSet.firstMoveableObject) {
                    const boundingBox = this.selectionSet.firstMoveableObject?.celldlSvgElement?.svgBounds().union(clickedObject.celldlSvgElement!.svgBounds())
                    if (boundingBox) {
                        const selectedObjects = this.celldlDiagram!.objectsContainedIn(boundingBox)
                                                                    .filter(c => c.exact)
                                                                    .map(c => c.object)
                                                                    .filter(c => c.isComponent)
                        for (const selectedObject of selectedObjects) {
                            this.setSelectedObject(selectedObject)
                        }
                    }
                } else {
                    this.setSelectedObject(clickedObject)
                }
            }
        }
    }

    #pointerDoubleClickEvent(event: MouseEvent) {
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                if (this.currentObject === null) {
                    this.#pathMaker.finishPartialPath(this.#celldlDiagram!, event.shiftKey)
                    this.#pathMaker = null
                }
            } else {
                this.#nextPathNode = PathMaker.startPartialPath(this.#domToSvgCoords(event), this.#celldlDiagram!)
                if (this.#nextPathNode != null) {
                    const settings = this.#drawConnectionSettings // settings.type is to come from object's domain...
                    this.#pathMaker = new PathMaker(this.#editorFrame!, this.#nextPathNode, settings.style)
                }
            }
        }
    }

    #notDiagramElement(element: SVGGraphicsElement) {
        return (
            element === this.#svgDiagram ||
            element.id === SVG_PANEL_ID ||
            element.classList.contains(EDITOR_GRID_CLASS) ||
            !this.#svgDiagram?.contains(element)
        )
    }

    #pointerOverEvent(event: PointerEvent) {
        if (this.#celldlDiagram === null || this.#handlePointerEvents(event)) {
            return
        }
        const element = event.target as SVGGraphicsElement
        const currentObject = this.#celldlDiagram.objectById(getElementId(element))
        if (this.moving) {
            // A move finishes with pointer up
            return
        } else if (this.#notDiagramElement(element)) {
            this.#hideTooltip()
            if (this.currentObject && currentObject !== this.currentObject) {
                this.#unsetActiveObjects()
            }
            return
        } else if (this.#boxMaker?.pointerEvent(event, this.#domToSvgCoords(event))) {
            return
        }

        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (
                this.currentObject &&
                currentObject !== this.currentObject &&
                (currentObject !== null || (this.#pathMaker && element !== this.#pathMaker.currentSvgPath))
            ) {
                this.#unsetActiveObjects()
            }
            if (currentObject) {
                element.style.removeProperty('cursor')
                this.currentObject = currentObject
                // Set object active regardless of whether it's valid for the path
                if (this.#pathMaker === null) {
                    this.#nextPathNode = PathMaker.validStartObject(currentObject)
                } else {
                    this.#nextPathNode = this.#pathMaker.validPathNode(currentObject)
                }
                if (this.#nextPathNode) {
                    this.#setActiveObjects([currentObject])
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (currentObject) {
                element.style.removeProperty('cursor')
            }
        } else {
            if (!currentObject || !this.#activeObjects.has(currentObject.id)) {
                this.#unsetActiveObjects()
            }
            if (currentObject) {
                if (this.selectionSet.has(currentObject)) {
                    this.#setActiveObjects(this.selectionSet.objects)
                } else {
                    this.#setActiveObjects([currentObject])
                }
                currentObject.initialiseMove(element)  // will set moveable
                this.currentObject = currentObject
                // e.g. an element's constitutive law, else a reaction's equation
                const hoverHtml = componentLibraryPlugin.hoverHtml(currentObject)
                const hoverText = hoverHtml === '' ? componentLibraryPlugin.hoverText(currentObject) : ''
                if (hoverHtml !== '') {
                    this.showTooltip(hoverHtml, '', true)
                } else if (hoverText !== '') {
                    this.showTooltip(hoverText)
                } else {
                    this.#hideTooltip()
                }
            } else {
                this.#hideTooltip()
            }
        }
    }

    #pointerOutEvent(event: PointerEvent) {
        const element = event.target as SVGGraphicsElement
        if (
            element === this.#svgDiagram ||
            element.classList.contains(EDITOR_GRID_CLASS) ||
            !this.#svgDiagram?.contains(element)
        ) {
            if (this.currentObject && !this.moving) {
                this.currentObject.finaliseMove()
                this.#unsetActiveObjects()
            }
        } else if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker === null) {
                this.#unsetActiveObjects()
            }
        }
    }

    #pointerDownEvent(event: PointerEvent) {
        if (this.#handlePointerEvents(event)) {
            return
        }
        this.pointerMoved = false
        this.#pointerDownTime = Date.now()
        const element = event.target as SVGGraphicsElement
        if (event.button === 2
         || (!event.shiftKey
          && this.#editorMode !== EDITOR_MODE.DrawCompartment
          && this.#notDiagramElement(element))) {
            this.#svgDiagram?.style.removeProperty('cursor')
            this.#container?.style.setProperty('cursor', 'grab')
            this.#panzoom!.pointerDown(event)
            this.#panning = true
            return
        }
        const svgPoint = this.#domToSvgCoords(event)
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.currentObject && this.#nextPathNode) {
                if (this.#pathMaker === null) {
                    const settings = this.#drawConnectionSettings // settings.type is to come from object's domain...
                    this.#pathMaker = new PathMaker(this.#editorFrame!, this.#nextPathNode, settings.style)
                } else if (!this.#pathMaker.empty) {
                    if (this.currentObject.isConduit) {
                        this.#pathMaker.addIntermediate(this.#nextPathNode, event.shiftKey)
                    } else {
                        this.#pathMaker.finishPath(this.#nextPathNode, this.#celldlDiagram!, event.shiftKey)
                        this.#pathMaker = null
                    }
                }
            }
        } else if (this.currentObject?.moveInitialised) {
            // EDITOR_MODE.Selecting or EDITOR_MODE.AddingComponent
            this.#moveSelection = !this.currentObject?.isConnection && this.selectionSet.has(this.currentObject)
            if (this.#moveSelection) {
                // Moving a set of selected components
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint, this.selectionSet)
                this.selectionSet.startMove(svgPoint, this.currentObject)
            } else {
                // Either moving a control point or an active component
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint)
                this.currentObject.startMove(svgPoint)
            }
            this.moving = true
            this.moved = false
        } else if (this.#editorMode === EDITOR_MODE.Selecting) {
            if (this.#boxMaker) {
                this.#boxMaker.pointerEvent(event, svgPoint)
            } else if (event.shiftKey) {
                this.unsetSelectedObjects()
                this.#boxMaker = new BoxMaker(this, svgPoint)
                this.#boxMaking = true
            } else if (this.currentObject?.isConnection) {
                // Check if a linear path and if so, insert a control point and initialise moving it
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint)
                const controlElement = this.currentObject.addControlHandle(svgPoint)
                if (controlElement) {
                    this.currentObject.initialiseMove(controlElement)
                    // this.#activateObject(this.currentObject, true) // should already be active, incl. new handle
                    this.currentObject.startMove(svgPoint)
                    this.moving = true
                    this.moved = false
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (this.#boxMaker) {
                this.#boxMaker.pointerEvent(event, svgPoint)
            } else {
                this.unsetSelectedObjects()
                this.#boxMaker = new BoxMaker(this, svgPoint, true)
                this.#boxMaking = true
            }
        }
    }

    #pointerMoveEvent(event: PointerEvent) {
        if (this.#handlePointerEvents(event)) {
            return
        }
        if (this.#panning) {
            this.pointerMoved = this.#panzoom!.pointerMove(event) || this.pointerMoved
            return
        }
        this.pointerMoved = true
        const svgPoint = this.#domToSvgCoords(event)
        this.#showStatus(svgPoint)
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                this.#pathMaker.drawTo(svgPoint, event.shiftKey)
            }
        } else if (this.currentObject && this.moving) {
            // EDITOR_MODE.Selecting or EDITOR_MODE.AddingComponent
            if (this.#moveSelection) {
                this.selectionSet.move(svgPoint)
            } else {
                this.currentObject.move(svgPoint)
                this.#celldlDiagram?.objectMoved(this.currentObject)
            }
            this.moved = true
            if (this.#boxMaker) {
                this.#boxMaker.updateSelectedObjects()
            }
        } else if (this.#editorMode === EDITOR_MODE.Selecting
                || this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (this.#boxMaker) {
                this.#boxMaker.pointerEvent(event, svgPoint)
            }
        }
    }

    #pointerUpEvent(event: PointerEvent) {
        if (this.#celldlDiagram === null || this.#handlePointerEvents(event)) {
            return
        }
        const svgPoint = this.#domToSvgCoords(event)
        if (this.#panning) {
            this.#panzoom!.pointerUp(event)
            this.#panning = false
            this.#setDefaultCursor()
            if (
                !this.pointerMoved &&
                !this.#boxMaking &&
// WIP                !this.#contextMenu.isOpen &&
                this.#boxMaker &&
                !this.#boxMaker.pointInside(svgPoint)
            ) {
                this.#closeBoxMaker()
            }
            return
        }
        if (this.#editorMode !== EDITOR_MODE.PathDrawing) {
            if (this.currentObject && this.moving) {
                this.moving = false
                if (this.moved) {
                    this.#moveUndoState?.endMove(svgPoint)
                    if (this.#moveSelection) {
                        this.selectionSet.endMove()
                    } else {
                        this.currentObject.endMove()
                        this.currentObject.finaliseMove()
                    }
                } else if (this.#moveUndoState) {
                    undoRedo.resetActiveUndoState()
                    this.#moveUndoState.reposition('backwards')
                    this.#moveUndoState = null
                }
            } else if (this.#editorMode === EDITOR_MODE.Selecting
                    || this.#editorMode === EDITOR_MODE.DrawCompartment) {
                if (this.#boxMaker) {
                    if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
                        this.#boxMaker.pointerEvent(event, svgPoint)
                        this.#addCompartment()
                        this.#closeBoxMaker()
                    } else if (!this.#boxMaker.pointerEvent(event, svgPoint)) {
                        this.#closeBoxMaker()
                    }
                }
                this.#boxMaking = false
            }
        }
    }

    #closeBoxMaker() {
        if (this.#boxMaker) {
            this.#boxMaker.close()
            this.#boxMaker = null
        }
    }

    #focusEvent(event: FocusEvent) {
        // Detect when no input fields have focus
        this.#haveFocus = event.type === 'focusout'
    }

    #keyDownEvent(event: KeyboardEvent) {
        if (this.#editorMode === EDITOR_MODE.PathDrawing
         && (event.key === 'Escape' || event.key === 'Backspace')) {
            if (this.#pathMaker) {
                // Remove any partial path
                this.#pathMaker.close()
                this.#pathMaker = null
            }
        } else if (event.key === 'Backspace') {
            if (this.#haveFocus) {
                this.#deleteSelectedObjects()
            } else if (event.target === document.body) {
                // Prevent the default browser action (navigating back)
                event.preventDefault()
            }
        } else if (this.#editorMode === EDITOR_MODE.Selecting
            && (isMacOs() && event.metaKey
            || !isMacOs() && event.ctrlKey)) {
            if (event.key === 'z' && !event.shiftKey) {
                undoRedo.undo(this.#celldlDiagram!)
            } else if (event.key === 'Z' || event.key === 'z' && event.shiftKey) {
                undoRedo.redo(this.#celldlDiagram!)
            }
        }
    }

    #keyUpEvent(event: KeyboardEvent) {
        if (event.key === 'Shift') {
            this.#setDefaultCursor()
        }
    }

    /* WIP
    #showSelectedObjectInfo() {
        if (this.#selectedObject) {
            //console.log('INFO:', this.#selectedObject.asString())
        }
    } */
}

//==============================================================================
//==============================================================================
