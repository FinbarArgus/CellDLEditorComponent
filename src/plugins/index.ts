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
/** biome-ignore-all lint/style/noNonNullAssertion: <keys exist in Map> */

import * as vue from 'vue'

//==============================================================================

import {
    CELLDL_URI,
    fragment,
    type MetadataPropertiesMap,
    type MetadataStore,
    SPARQL_PREFIXES
} from '@celldl/metadata'

import type { SubjectType } from '@celldl/rdf'

//==============================================================================

import type {
    CellDLConnection,
    CellDLObject
} from '#editor/celldlObjects'
import { CELLDL_CLASS_MAP } from '#editor/celldlObjects'
import type {
    ComponentLibrary,
    LibraryComponentTemplate,
    ObjectTemplate,
} from '#editor/components'

import type {
    PANEL_ID,
    PropertyGroup,
    ValueChange
} from '#root/utils/editor-types'
import type { Styling } from '#root/utils/styling'
import type { StepEquation } from './bondgraph/equations'

//==============================================================================

export interface ConnectionStatus {
    alert?: string
}

//==============================================================================

export interface PluginInterface {
    /**
     * A unique indentifier for the plugin.
     */
    id: string

    /**
     * The plugin as a library of component templates.
     */
    componentLibrary: ComponentLibrary

    /**
     * Get CSS style definitions for the plugin.
     */
    styleRules: () => string

    /**
     * Get SVG <defs> elements used by the plugin.
     */
    svgDefinitions: () => string

    /**
     * A CellDL diagram has been opened.
     *
     * @param uri The diagram's URI.
     * @param rdfStore The RDF store with metadata about the diagram.
     */
    openDiagram: (uri: string, rdfStore: MetadataStore) => void

    /**
     * Add statements about the diagram's plugin components to its RDF store.
     *
     * @param rdfStore The RDF store with metadata about the diagram.
     */
    addPluginMetadataToStore: (rdfStore: MetadataStore) => void

    /**
     * Get plugin specific data to store with a CellDL object.
     *
     * @param celldlObject A CellDL object.
     */
    getPluginData: (celldlObject: CellDLObject) => object

    /**
     * Get plugin specific text about the status of a CellDL object.
     *
     * @param celldlObject A CellDL object.
     */
    statusText: (celldlObject: CellDLObject) => string

    /**
     * Text to show beside a CellDL object while the pointer is over it (e.g. a reaction's equation); '' for none.
     *
     * @param celldlObject A CellDL object.
     */
    hoverText?: (celldlObject: CellDLObject) => string

    /**
     * HTML to show beside a CellDL object while the pointer is over it, in place of its hover text (e.g. an
     * element's constitutive law); '' for none.
     *
     * @param celldlObject A CellDL object.
     */
    hoverHtml?: (celldlObject: CellDLObject) => string

    /**
     * The diagram's reactions (and other steps) as equations, for the reaction equations view.
     */
    reactionEquations?: () => StepEquation[]

    /**
     * A CellDL component has been added to the diagram.
     *
     * @param component A CellDL component object.
     */
    addComponent: (component: CellDLObject) => void

    /**
     * A CellDL connection has been added to the diagram.
     *
     * @param connection A CellDL connection object.
     */
    addConnection: (connection: CellDLConnection) => void

    /**
     * Check that two CellDL objects can be connected.
     *
     * If the objects should not be connected then the `alert` field in the result will gives the reason why not.
     *
     * @param sourceObject The source CellDL object for the connection.
     * @param targetObject The target CellDL object for the connection.
     */
    checkConnectionValid: (startObject: CellDLObject, endObject: CellDLObject) => ConnectionStatus|undefined

    /**
     * A CellDL component has been deleted from the diagram.
     *
     * @param component A CellDL component object.
     */
    componentDeleted: (component: CellDLObject) => void

    /**
     * A CellDL connection has been deleted from the diagram.
     *
     * @param connection A CellDL connection object.
     */
    connectionDeleted: (connection: CellDLConnection) => void

    /**
     * Get the maximum number of connections that a CellDL object can have.
     *
     * @param celldlObject A CellDL object.
     */
    getMaxConnections: (celldlObject: CellDLObject) => number

    /**
     * Return the template for an object, given its Id.
     *
     * @param templateId
     */
    getObjectTemplateById: (templateId: string) => ObjectTemplate|undefined

    /**
     * Return property groups describing items to be shown on a panel
     *
     * @param panelID
     */
    getPanelTemplates: (panelID: PANEL_ID) => PropertyGroup[]

    /**
     * Return the name of a template, given its RDF type.
     *
     * @param rdfType
     */
    getTemplateName: (rdfType: string) => string|undefined

    /**
     * Load an object's properties into a component template ready for editing.
     *
     * @param celldlObject A CellDL object.
     * @param componentProperties Properties about the object, ordered by their group.
     */
    loadComponentProperties: (componentProperties: PropertyGroup[], panelId: PANEL_ID,
                              celldlObject: CellDLObject) => void

    /**
     * Update the diagram's RDF store when the value of a CellDL object property changes.
     *
     * @param celldlObject A CellDL object.
     * @param itemId The full ID (`property_group/var_name`) of the property.
     * @param value The original and new value of the given property.
     * @param componentProperties Properties about the object, ordered by their group.
     */
    updateObjectProperties: (celldlObject: CellDLObject, panelId: PANEL_ID, itemId: string,
                             value: ValueChange, componentProperties: PropertyGroup[]) => Promise<void>

    /**
     * Update the SVG representation of a object when its styling has changed.
     *
     * @param celldlObject A CellDL object.
     * @param objectType The type of object (`node` or `path`).
     * @param styling Styling for the object.
     */
    updatedComponentStyling: (celldlObject: CellDLObject, styling: Styling) =>  Promise<void>
}

//==============================================================================

export class ComponentLibraryPlugin {
    static #instance: ComponentLibraryPlugin | null = null

    #app: vue.App|undefined = undefined
    #registeredPlugins: Map<string, PluginInterface> = new Map()

    #componentLibraries: ComponentLibrary[] = []
    #currentDocumentUri: string = ''

    private constructor() {
        if (ComponentLibraryPlugin.#instance) {
            throw new Error('Use ComponentLibraryPlugin.instance instead of `new`')
        }
        ComponentLibraryPlugin.#instance = this
    }

    static get instance() {
        if (!ComponentLibraryPlugin.#instance) {
            ComponentLibraryPlugin.#instance = new ComponentLibraryPlugin()
        }
        return ComponentLibraryPlugin.#instance
    }

    getPlugin(pluginId: string): PluginInterface|undefined {
        return this.#registeredPlugins.get(pluginId)
    }

    install(app: vue.App, _options: object|undefined=undefined)  {
        if (!this.#app) {
            this.#app = app
        }
    }

    registerPlugin(plugin: PluginInterface) {
        if (!this.#registeredPlugins.has(plugin.id)) {
            this.#componentLibraries.push(plugin.componentLibrary)
            this.#registeredPlugins.set(plugin.id, plugin)
        }
    }

    getSelectedTemplate(): LibraryComponentTemplate|undefined {
        let selectedTemplate: LibraryComponentTemplate|undefined
        if (this.#componentLibraries.length &&
            this.#componentLibraries[0]!.templates.length) {

            // Select the default component template
            selectedTemplate = this.#componentLibraries[0]!.templates[0]
            if (selectedTemplate) {
                selectedTemplate.selected = true
            }
        }
        return selectedTemplate
    }

    //==========================================================================

    openDiagram(uri: string, rdfStore: MetadataStore) {
        this.#currentDocumentUri = uri
        for (const plugin of this.#registeredPlugins.values()) {
            plugin.openDiagram(uri, rdfStore)
        }
    }

    addPluginMetadataToStore(rdfStore: MetadataStore) {
        for (const plugin of this.#registeredPlugins.values()) {
            plugin.addPluginMetadataToStore(rdfStore)
        }
    }

    //==========================================================================

    addComponent(component: CellDLObject) {
        for (const plugin of this.#registeredPlugins.values()) {
            if (Object.keys(component.pluginData(plugin.id)).length) {
                plugin.addComponent(component)
            }
        }
    }

    addConnection(connection: CellDLConnection) {
        for (const plugin of this.#registeredPlugins.values()) {
            if (Object.keys(connection.pluginData(plugin.id)).length) {
                plugin.addConnection(connection)
            }
        }
    }

    checkConnectionValid(startObject: CellDLObject, endObject: CellDLObject): ConnectionStatus|undefined
    {
        for (const plugin of this.#registeredPlugins.values()) {
            if (Object.keys(startObject.pluginData(plugin.id)).length) {
                const status = plugin.checkConnectionValid(startObject, endObject)
                if (status) {
                    return status
                }
            }
        }
    }

    componentDeleted(component: CellDLObject) {
        for (const plugin of this.#registeredPlugins.values()) {
            if (Object.keys(component.pluginData(plugin.id)).length) {
                plugin.componentDeleted(component)
            }
        }
    }

    connectionDeleted(connection: CellDLConnection) {
        for (const plugin of this.#registeredPlugins.values()) {
            if (Object.keys(connection.pluginData(plugin.id)).length) {
                plugin.connectionDeleted(connection)
            }
        }
    }

    getMaxConnections(celldlObject: CellDLObject): number {
        for (const pluginId of celldlObject.pluginIds) {
            const plugin = this.#registeredPlugins.get(pluginId)
            if (plugin && Object.keys(celldlObject.pluginData(pluginId)).length) {
                return plugin.getMaxConnections(celldlObject)
            }
        }
        return Infinity
    }

    //==========================================================================

    getPluginData(celldlObject: CellDLObject): Map<string, object> {
        const pluginDataMap: Map<string, object> = new Map()
        for (const plugin of this.#registeredPlugins.values()) {
            pluginDataMap.set(plugin.id, plugin.getPluginData(celldlObject))
        }
        return pluginDataMap
    }

    statusText(celldlObject: CellDLObject): string {
        return [...this.#registeredPlugins.values().map(plugin => plugin.statusText(celldlObject))].filter(t => t !== '').join(' ')
    }

    hoverText(celldlObject: CellDLObject): string {
        return [...this.#registeredPlugins.values().map(plugin => plugin.hoverText?.(celldlObject) ?? '')]
                .filter(t => t !== '').join('\n')
    }

    hoverHtml(celldlObject: CellDLObject): string {
        return [...this.#registeredPlugins.values().map(plugin => plugin.hoverHtml?.(celldlObject) ?? '')]
                .filter(t => t !== '').join('')
    }

    reactionEquations(): StepEquation[] {
        return [...this.#registeredPlugins.values()].flatMap(plugin => plugin.reactionEquations?.() ?? [])
    }

    getObjectTemplate(uri: SubjectType, metadata: MetadataPropertiesMap, rdfStore: MetadataStore): ObjectTemplate|undefined {
        let CellDLClass: typeof CellDLObject | undefined
        const rdfTypes: string[] = []
        const rows = rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            SELECT ?type WHERE {
                ${uri.toString()} a ?type
            }`
        )
        for (const r of rows) {
            const rdfType = r.get('type')!.value
            if (rdfType.startsWith(CELLDL_URI) && CELLDL_CLASS_MAP.has(fragment(rdfType))) {
                if (CellDLClass === undefined) {
                    CellDLClass = CELLDL_CLASS_MAP.get(fragment(rdfType))
                }
            } else {
                rdfTypes.push(rdfType)
            }
        }
        if (CellDLClass) {
            const objectTemplate: ObjectTemplate = {
                CellDLClass: CellDLClass,
                metadataProperties: metadata
            }
            for (const plugin of this.#registeredPlugins.values()) {
                for (const rdfType of rdfTypes) {
                    const name = plugin.getTemplateName(rdfType)
                    if (name) {
                        objectTemplate.name = name
                        return objectTemplate
                    }
                }
            }
            return objectTemplate
        }
    }
    getPanelTemplates(panelID: PANEL_ID): PropertyGroup[]
    {
        const panelTemplates: PropertyGroup[] = []
        for (const plugin of this.#registeredPlugins.values()) {
            panelTemplates.push(...plugin.getPanelTemplates(panelID))
        }
        return panelTemplates
    }

    getObjectTemplateById(templateId: string): ObjectTemplate|undefined {
        const pluginTemplateId = templateId.split('/')
        if (pluginTemplateId.length > 1) {
            const plugin = this.#registeredPlugins.get(pluginTemplateId[0]!)
            if (plugin) {
                return plugin.getObjectTemplateById(pluginTemplateId.slice(1).join('/'))
            }
        }
    }

    //==========================================================================

    loadComponentProperties(componentProperties: PropertyGroup[], panelId: PANEL_ID,
                            celldlObject: CellDLObject): void {
        for (const pluginId of celldlObject.pluginIds) {
            const plugin = this.#registeredPlugins.get(pluginId)
            if (plugin && Object.keys(celldlObject.pluginData(pluginId)).length) {
                plugin.loadComponentProperties(componentProperties, panelId, celldlObject)
            }
        }
    }

    async updatedComponentStyling(celldlObject: CellDLObject, styling: Styling) {
        for (const pluginId of celldlObject.pluginIds) {
            const plugin = this.#registeredPlugins.get(pluginId)
            if (plugin && Object.keys(celldlObject.pluginData(pluginId)).length) {
                await plugin.updatedComponentStyling(celldlObject, styling)
            }
        }
    }

    async updateObjectProperties(celldlObject: CellDLObject, panelId: PANEL_ID, itemId: string, value: ValueChange,
                                 componentProperties: PropertyGroup[]) {
        for (const pluginId of celldlObject.pluginIds) {
            const plugin = this.#registeredPlugins.get(pluginId)
            if (plugin && Object.keys(celldlObject.pluginData(pluginId)).length) {
                await plugin.updateObjectProperties(celldlObject, panelId, itemId, value, componentProperties)
            }
        }
    }

    //==========================================================================

    // Global style rules and definitions added to the diagram's SVG

    styleRules(): string {
        const styling: string[] = []
        for (const plugin of this.#registeredPlugins.values()) {
            styling.push(plugin.styleRules())
        }
        return styling.join('\n')
    }

    svgDefinitions(): string {
        const definitions: string[] = []
        for (const plugin of this.#registeredPlugins.values()) {
            definitions.push(plugin.svgDefinitions())
        }
        return definitions.join('\n')
    }
}

//==============================================================================

// Instantiate our plugin components. This will load the BondgraphPlugin
// and hence BG template definitions from the BG-RDF framework

export const componentLibraryPlugin = ComponentLibraryPlugin.instance

//==============================================================================
//==============================================================================
