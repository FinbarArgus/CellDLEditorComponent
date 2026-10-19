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

import { svgToDataUrl, LatexMathSvg } from '#root/utils/svgUtils'

import { makeLatex } from './laws'
import type {
    BGComponentDefinition,
    BGLibraryComponentTemplate,
    BGElementStyle
} from './utils'

//==============================================================================
//==============================================================================

const ICON_BORDER= '2px'
const ICON_PADDING = '3px'
const ICON_MIN_WIDTH = '3.5ex'
const ICON_MIN_HEIGHT = '4ex'
const ICON_VERTICAL_ALIGN = '-1.5ex'
const ICON_RADIUS = '6px'

const MIN_BORDER = '0.2px'
const MIN_BORDER_COLOUR = 'grey'

//==============================================================================

export const DEFAULT_SPECIES = 'i'
export const DEFAULT_LOCATION = 'j'

//==============================================================================
//==============================================================================

const FLOW_STYLE: BGElementStyle = {
    text: '#00B050',
    background: '#E2F0D9'
}

const POTENTIAL_STYLE: BGElementStyle = {
    text: '#FF0909',
    background: '#FBE4D5'
}

const POTENTIAL_STORAGE_STYLE: BGElementStyle = {
    text: '#00B050',
    background: '#E2F0D9'
}

const KINETIC_STORAGE_STYLE: BGElementStyle = {
    text: 'black',
    background: 'lightgrey'
}

const REACTION_STYLE: BGElementStyle = {
    text: '#72329F',
    background: '#FFD966',
    border: 'black'
}

const RESISTANCE_STYLE: BGElementStyle = {
    text: '#444',
    background: REACTION_STYLE.background
}
const ONE_RESISTANCE_STYLE: BGElementStyle = {
    text: RESISTANCE_STYLE.text,
    background: RESISTANCE_STYLE.background,
    border: 'green'
}

const SCALE_STYLE: BGElementStyle = {
    text: '#7030A0',
    background: '#C1C1FA'
}

const _UNITS_STYLE: BGElementStyle = {
    text: '#444',
    background: '#DDD'
}

const ZERO_STORAGE_STYLE: BGElementStyle = {
    text: FLOW_STYLE.text,
    background: FLOW_STYLE.background,
    border: 'red'
}

//==============================================================================

export const BONDGRAPH_COMPONENT_DEFINITIONS: BGComponentDefinition[] = [
    {
        id: 'QuantityStore',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#QuantityStore',
        name: 'Static energy store',
        numPorts: 1,
        symbol: 'q',
        style: POTENTIAL_STORAGE_STYLE
    },
    {
        id: 'ZeroNode',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#ZeroNode',
        name: 'Zero node',
        numPorts: Infinity,
        symbol: 'u',
        style: POTENTIAL_STYLE
    },
    {
        id: 'OneNode',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#OneNode',
        name: 'One node',
        numPorts: Infinity,
        symbol: 'v',
        style: FLOW_STYLE
    },
    {
        id: 'ZeroStorageNode_q',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#ZeroStorageNode',
        name: 'Zero storage node',
        numPorts: Infinity,
        symbol: 'q',
        style: ZERO_STORAGE_STYLE
    },
    {
        id: 'ZeroStorageNode_u',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#ZeroStorageNode',
        name: 'Zero storage node',
        numPorts: Infinity,
        symbol: 'u',
        style: ZERO_STORAGE_STYLE
    },
    {
        id: 'OneResistanceNode',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#OneResistanceNode',
        name: 'One resistance node',
        numPorts: Infinity,
        symbol: 'v',
        style: ONE_RESISTANCE_STYLE
    },
    {
        id: 'Resistance',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#Resistance',
        name: 'Resistance',
        numPorts: 1,
        symbol: 'R',
        style: RESISTANCE_STYLE
    },
    {
        id: 'Reaction',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#Reaction',
        name: 'Reaction',
        numPorts: 2,
        symbol: 'Rx',
        style: REACTION_STYLE
    },
    {
        id: 'OneReactionNode',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#OneReactionNode',
        name: 'One reaction node',
        numPorts: Infinity,     // a bond for each species (a ChemicalReactionNode)
        symbol: 'Rx',
        style: REACTION_STYLE
    },
    {
        id: 'TransformNode',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#TransformNode',
        name: 'Transform node',
        numPorts: 2,
        symbol: 'k',
        style: SCALE_STYLE,
        noSpeciesLocation: true
    },
    {
        id: 'FlowStore',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#FlowStore',
        name: 'Dynamic energy store',
        numPorts: 1,
        symbol: 'L',
        style: KINETIC_STORAGE_STYLE
    },
    {
        id: 'PotentialSource',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#PotentialSource',
        name: 'Potential source',
        numPorts: 1,
        symbol: 'S',
        style: POTENTIAL_STYLE,
    },
    {
        id: 'FlowSource',
        type: 'https://bg-rdf.org/ontologies/bondgraph-framework#FlowSource',
        name: 'Flow source',
        numPorts: 1,
        symbol: 'S',
        style: FLOW_STYLE,
    }
]

//==============================================================================
//==============================================================================

function typeset(latex: string, style: BGElementStyle, base64: boolean=false): string {
    const svg = LatexMathSvg.svgRect(latex, '', {
            'min-width': ICON_MIN_WIDTH,
            'min-height': ICON_MIN_HEIGHT,
            'vertical-align': ICON_VERTICAL_ALIGN,
            'border-width': style.border ? ICON_BORDER : MIN_BORDER,
            'border-style': style.borderStyle || 'solid',
            padding: ICON_PADDING,
            'corner-radius': ICON_RADIUS,
            background: style.background,
            border: style.border || MIN_BORDER_COLOUR
        }
    )
    return svgToDataUrl(svg, base64)
}

//======================================

export function svgImageData(symbol: string,
                             species: string|undefined,
                             location: string|undefined,
                             elementStyle: BGElementStyle,
                             fillString?: string,
                             lawLabel?: string): string {
    const latex = makeLatex(symbol, species, location, lawLabel)
    const style = fillString ? Object.assign({}, elementStyle, { background: fillString })
                             : elementStyle
    return typeset(latex, style)
}

//==============================================================================

export function definitionToLibraryTemplate(defn: BGComponentDefinition): BGLibraryComponentTemplate {
    const latex = defn.noSpeciesLocation ? defn.symbol : makeLatex(defn.symbol, DEFAULT_SPECIES, DEFAULT_LOCATION)

    return Object.assign({}, defn, {
        imageData: typeset(latex, defn.style)
    })
}

//==============================================================================
//==============================================================================
