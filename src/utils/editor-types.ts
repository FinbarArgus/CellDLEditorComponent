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

import type * as vue from 'vue'

//==============================================================================

import type * as locApi from '#root/libopencor/locUIJsonApi'
import type { Styling } from './styling'

//==============================================================================

export enum PANEL_ID {
    METADATA_PANEL = 'metadata-property-panel',
    PROPERTIES_PANEL = 'properties-property-panel',
    REACTIONS_PANEL = 'reactions-panel',
    VARIABLES_PANEL = 'variables-panel',
    ANNOTATIONS_PANEL = 'annotations-panel',
    STYLE_PANEL = 'style-property-panel'
}

//==============================================================================

export type ItemDetails = locApi.IUiJsonInput & {
    itemId: string
    property: string
    possibleValues?: locApi.IUiJsonDiscreteInputPossibleValue[]
    units?: string
    optional?: boolean
    numeric?: boolean
}

export interface PropertyGroup {
    groupId: string
    items: ItemDetails[]
    styling?: Styling
    title?: string
}

export interface ValueChange {
    oldValue: string
    newValue: string
}

//==============================================================================

export type ComponentProperties = {
    objectId?: string
    panelId: string
    groups: PropertyGroup[]
}

//==============================================================================

export type EditorState = {
    msg?: string
    state: string
}

//==============================================================================

export class EditorStatus {
    #canPaste: boolean = false
    #canRedo: boolean = false
    #fileModified: boolean = false
    #objectSelected: boolean = false

    get canPaste(): boolean {
        return this.#canPaste
    }
    set canPaste(value: boolean) {
        this.#canPaste = value
    }

    get canRedo(): boolean {
        return this.#canRedo
    }
    set canRedo(value: boolean) {
        this.#canRedo = value
    }

    get fileModified(): boolean {
        return this.#fileModified
    }
    set fileModified(value: boolean) {
        this.#fileModified = value
    }

    get objectSelected(): boolean {
        return this.#objectSelected
    }
    set objectSelected(value: boolean) {
        this.#objectSelected = value
    }
}

//==============================================================================

export type EditorToolButton = {
    toolId: string
    prompt: string
    active?: boolean
    icon?: string
    image?: string
    panel?: vue.Raw<vue.Component>
    props?: vue.Ref<PropertyGroup[]>
}

//==============================================================================

export type PopoverEventData = {
    icon?: string
    id: string
    imageData: string
    name: string
}

//==============================================================================

export type FileStatus = {
    haveData: boolean
    modified: boolean
}
//==============================================================================

export type ViewState = {
    showGrid?: boolean
    gridSpacing?: number
    snapToGrid?: number
    alignmentGuides?: boolean
}

//==============================================================================
//==============================================================================
