/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

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

import type {
    ComponentLibrary,
    LibraryComponentTemplate
} from '#editor/components'

import type { BorderStyle } from '#root/utils/borders'

import type { BGBaseComponent } from '.'

//==============================================================================

export interface BGElementStyle {
    text: string
    background: string
    border?: string
    borderStyle?: BorderStyle
}

export interface BGComponentDefinition {
    id: string
    type: string
    name: string
    symbol: string
    style: BGElementStyle,
    noSpeciesLocation?: boolean,
    numPorts: number
}

export type BGLibraryComponentTemplate = LibraryComponentTemplate & {
    type: string
    symbol: string
    noSpeciesLocation?: boolean
    numPorts: number
    style: BGElementStyle
    component?: BGBaseComponent
}

export type BGComponentLibrary = ComponentLibrary & {
    templates: BGLibraryComponentTemplate[]
}

//==============================================================================
//==============================================================================
