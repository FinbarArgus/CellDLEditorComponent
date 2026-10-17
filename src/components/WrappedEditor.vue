<template lang="pug">
    .flex.flex-col.h-full
        main.editor-pane.relative.flex.grow
            EditorToolbar.editor-bar(
                :buttons="toolButtons"
                type="popover"
                @button-event="buttonEvent"
            )
            div#svg-container(ref="svgContainer")
                EditorContextMenu(
                    :contextMenuProps="contextMenuProps"
                )
                <!-- context-menu(id="context-menu")  -->
            EditorToolbar.editor-bar(
                :buttons="panelButtons"
                type="panel"
                @button-event="buttonEvent"
            )
        footer.status-bar
            span#status-msg
            span#status-pos
</template>

<script setup lang="ts">
/** biome-ignore-all lint/correctness/noUnusedVariables: Vue components and properties arte in fact used */

import * as vue from 'vue'

import primeVueAuraTheme from '@primeuix/themes/aura'
import primeVueConfig from 'primevue/config'

import vueTippy from 'vue-tippy'
import 'tippy.js/dist/tippy.css'

//==============================================================================

import '#root/assets/style.css'
import '#root/assets/icons.css'

import * as vueCommon from '#root/utils/vueCommon'

import { CellDLDiagram } from '#editor/diagram'
import { CellDLEditor } from '#editor/editor'
import { DEFAULT_EDITOR_TOOL_ID, EDITOR_TOOL_IDS } from '#editor/editor'
import { editGuides } from '#editor/editor/editguides'
import { undoRedo } from '#editor/diagram/undoredo'

import { type EditorToolButton, PANEL_ID } from '#root/utils/editor-types'

import { componentLibraryPlugin } from '#root/plugins'

import { BondgraphPlugin } from '#root/plugins/bondgraph'
import BondgraphPopover from '#root/plugins/bondgraph/bondgraph.vue'

import { DrawingPlugin } from '#root/plugins/drawing'
import DrawingPopover from '#root/plugins/drawing/drawing.vue'

// WIP import { ElectricalPlugin } from '#root/plugins/electrical'
import type { PopoverEventData, ViewState } from '#root/utils/editor-types'

//import { TestCellDLEditor, testEditor } from '../../tests/editor'

import PropertiesPanel from './panels/PropertiesPanel.vue'
import ReactionsPanel from './panels/ReactionsPanel.vue'
import VariablesPanel from './panels/VariablesPanel.vue'
import StylingPanel from './panels/StylingPanel.vue'

import EditorToolbar from './toolbar/EditorToolbar.vue'
import EditorContextMenu from './widgets/EditorContextMenu.vue'
import type { ContextMenuProps } from './widgets/EditorContextMenu.vue'

//==============================================================================

export type Theme = 'light' | 'dark' | 'system';

//==============================================================================

export type EditorEditCommand = {
    command: 'edit'
    options: {
        action: string
    }
}

export type EditorExportCommand = {
    command: 'export'
    options: {
        action: string
    }
}

export type EditorFileCommand = {
    command: 'file'
    options: {
        action: string
        data?: string
        kind?: string   // export,
        name?: string
        type?: string   // For export: `cellml`, `omex`
    }
}

export type EditorSetStateCommand = {
    command: 'set-state'
    options: {
        action: string
    }
}

export type EditorViewCommand = {
    command: 'view'
    options: ViewState
}

export type CellDLEditorCommand = EditorEditCommand
                                | EditorExportCommand
                                | EditorFileCommand
                                | EditorSetStateCommand
                                | EditorViewCommand

//==============================================================================

export interface CellDLEditorProps {
    editorCommand?: CellDLEditorCommand
    theme?: Theme
}
export type EditorData = {
    data: string
    kind?: string
}

//==============================================================================
//==============================================================================

// Setup PrimeVue's theme, vue-tippy, and our plugins

const crtInstance = vue.getCurrentInstance();

if (crtInstance) {
    const app = crtInstance.appContext.app

    if (!app.config.globalProperties.$primevue) {
        app.use(primeVueConfig as unknown as vue.Plugin, {
            theme: {
                preset: primeVueAuraTheme,
                options: {
                    darkModeSelector: '.celldl-dark-mode'
                }
            }
        })
    }

    app.use(vueTippy)

    // Install our component library manager with the Bondgraph plugin

    componentLibraryPlugin.install(app)
    componentLibraryPlugin.registerPlugin(new BondgraphPlugin())
    componentLibraryPlugin.registerPlugin(new DrawingPlugin())
// WIP    componentLibraryPlugin.registerPlugin(new ElectricalPlugin())
}

//==============================================================================
//==============================================================================

const svgContainer = vue.ref(null)

let celldlDiagram: CellDLDiagram|undefined

// Plugins need to be initialised before creating the editor

const celldlEditor: CellDLEditor = new CellDLEditor()
//const celldlEditor: TestCellDLEditor = new TestCellDLEditor()


//==============================================================================

const props = defineProps<CellDLEditorProps>()

const emit = defineEmits<{
    'editor-data': [data: EditorData],
    'editor-state': [state: {
        error: string
    }]
}>()

//==============================================================================

vueCommon.useTheme().setTheme(props.theme)

vue.watch(
    () => props.theme,
    () => {
        vueCommon.useTheme().setTheme(props.theme)
    }
)

//==============================================================================

// Set the default component from the component library

// biome-ignore lint/style/noNonNullAssertion: some plugin has a selected template
const defaultComponent = componentLibraryPlugin.getSelectedTemplate()!

//==============================================================================

function despatchToolbarEvent(type: string, source: string, value: boolean|string) {
    document.dispatchEvent(
        new CustomEvent('toolbar-event', {
            detail: {
                type,
                source,
                value
            }
        })
    )
}

//==============================================================================

// Pass 'context-menu' events from the editor to the context menu's component

const contextMenuProps = vue.ref<ContextMenuProps>({
    state: new Set()
})

document.addEventListener('open-context-menu', (event: Event) => {
    contextMenuProps.value = (<CustomEvent>event).detail
})

//==============================================================================
//==============================================================================

const toolButtons = vue.ref<EditorToolButton[]>([
    {
        toolId: EDITOR_TOOL_IDS.SelectTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.SelectTool,
        prompt: 'Selection tool',
        icon: 'lucide-MousePointer'
    },
    {
        toolId: EDITOR_TOOL_IDS.BondgraphTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.BondgraphTool,
        prompt: 'Bond graph tools',
        icon: 'lucide-Network',
        panel: vue.markRaw(BondgraphPopover)
    },
    {
        toolId: EDITOR_TOOL_IDS.DrawingTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.DrawingTool,
        prompt: 'Drawing tools',
        icon: 'lucide-SquarePen',
        panel: vue.markRaw(DrawingPopover)
    }
])

//==============================================================================

const panelButtons = vue.ref<EditorToolButton[]>([
    {
        toolId: PANEL_ID.PROPERTIES_PANEL,
        prompt: 'Properties',
        icon: 'lucide-Settings',
        panel: vue.markRaw(PropertiesPanel)
    },
    {
        toolId: PANEL_ID.METADATA_PANEL,
        prompt: 'Metadata',
        icon: 'lucide-FileCode',
        panel: vue.markRaw(PropertiesPanel)
    },
    {
        toolId: PANEL_ID.STYLE_PANEL,
        prompt: 'Style',
        icon: 'lucide-Paintbrush',
        panel: vue.markRaw(StylingPanel)
    },
    {
        toolId: PANEL_ID.REACTIONS_PANEL,
        prompt: 'Reactions',
        icon: 'lucide-FlaskConical',
        panel: vue.markRaw(ReactionsPanel)
    },
    {
        toolId: PANEL_ID.VARIABLES_PANEL,
        prompt: 'Variables',
        icon: 'lucide-Tags',
        panel: vue.markRaw(VariablesPanel)
    }
])

//==============================================================================

function resetToolBars() {
    // Set the toolbar to its default tool

    for (const toolButton of toolButtons.value) {
        toolButton.active = (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === toolButton.toolId
    }

    // Hide any open panel
    // FUTURE: reset to default panel tool
}

//==============================================================================

function buttonEvent(toolId: PANEL_ID, active: boolean) {

    // Tell the editor that a tool has changed

    despatchToolbarEvent('state', toolId, active)
}

//==============================================================================
//==============================================================================

vue.watch(
    () => props.editorCommand,
    async () => {
        if (props.editorCommand?.command === 'file') {
            const command = props.editorCommand as EditorFileCommand
            const options = command.options
            if  (options.action === 'close') {
                resetToolBars()
                celldlDiagram = new CellDLDiagram('', '', celldlEditor)
                await celldlEditor.editDiagram(celldlDiagram)
            } else if (options.action === 'open') {
                resetToolBars()
                if (options.data !== undefined) {
                    try {
                        celldlDiagram = new CellDLDiagram(options?.name || '', options.data, celldlEditor)
                        await celldlEditor.editDiagram(celldlDiagram)
                    } catch(err) {
                        emit('editor-state', {
                            error: `Cannot open ${options?.name} -- invalid CellDL file?\n\n${err}`
                        })
                    }
                }
            } else if (options.action === 'data') {
                const celldl = await celldlDiagram?.serialise()
                emit('editor-data', {
                    data: celldl,
                    kind: options.kind
                } as EditorData)
            }
        } else if (props.editorCommand?.command === 'edit') {
            const command = props.editorCommand as EditorEditCommand
            const options = command.options
            if (options.action === 'clean') {
                undoRedo.clean()
            } else if (options.action === 'map-variables') {
                // open the Variables panel
                const button = document.getElementById(PANEL_ID.VARIABLES_PANEL)
                if (button && !button.classList.contains('active')) button.click()
            }
        } else if (props.editorCommand?.command === 'set-state') {
            const command = props.editorCommand as EditorSetStateCommand
            const options = command.options
            if (options.action === 'reset-tools') {
                resetToolBars()
            }
        } else if (props.editorCommand?.command === 'view') {
            const command = props.editorCommand as EditorViewCommand
            editGuides.setState(command.options)
        }
    }
)

//==============================================================================

vue.onMounted(async () => {
    if (svgContainer.value) {
        const svgContainerElement: HTMLElement = svgContainer.value
        window.setTimeout(async () => {
            if (svgContainerElement.clientWidth === 0 || svgContainerElement.clientHeight === 0) {
                console.error('zero sized container!!')
            }
            celldlEditor.mount(svgContainerElement)

            // Create a new diagram in the editor's window
            celldlDiagram = new CellDLDiagram('', '', celldlEditor)
            await celldlDiagram.edit()

//            testEditor(celldlEditor)
        })
    }
})

//==============================================================================
//==============================================================================
</script>

<style scoped>
.editor-pane {
    min-height: calc(100% - 1.6em);
}
.editor-bar {
    width: 40px;
    overflow: auto;
}
#svg-container {
    margin:  0;
    border: 2px solid var(--editor-border-color);
    flex: 1;
    overflow: hidden;
}
.hidden {
    display: none;
}
.status-bar {
    min-height: 1.6em;
    border-top: 1px solid var(--editor-border-color);
    padding-left: 16px;
    padding-right: 16px;
    background-color: var(--editor-statusbar-background);
}
#status-msg.error {
    color: red;
}
#status-msg.warn {
   color: blue;
}
#status-pos {
    float: right;
}
</style>
