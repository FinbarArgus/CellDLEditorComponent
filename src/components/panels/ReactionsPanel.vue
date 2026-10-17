<template lang="pug">
    ToolPanel
        template(#title)
            div {{ title }}
        template(#content)
            p.hint
                | Edit an equation and press Enter to change the bond graph:
                | coefficients with a space (#[code 2 ADP[c]]), species joined by #[code  + ].
                | A new species gets a new store.
            .layout
                button.reorganise(type="button" :disabled="reorganising || steps.length === 0" @click="reorganiseLayout")
                    | {{ reorganising ? `Reorganising… ${progress}%` : 'Reorganise by region' }}
                button.undo(v-if="canUndo && !reorganising" type="button" @click="undoLayout") Undo reorganise
                p.status(v-if="layoutStatus") {{ layoutStatus }}
            p.note(v-if="needValues.length") New: {{ needValues.join(", ") }}. Set their parameters in Properties.
            p(v-if="steps.length === 0") This diagram has no reactions yet.
            section.region-group(v-for="group in groups" :key="group.key")
                h4.region-heading
                    span.swatch(v-for="r in group.regions" :key="r" :style="{ background: regionColour(r) }")
                    | {{ group.title }}
                .step.reactions-step(v-for="step in group.steps" :key="step.id" :class="step.kind")
                    .heading
                        span.name {{ step.name }}
                        span.kind {{ step.kind === 'reaction' ? 'reaction ⇌' : step.kind === 'transport' ? 'transport ⇄' : 'flow ⇄' }}
                    textarea.equation(
                        v-model="step.text"
                        :rows="Math.max(1, Math.ceil(step.text.length / 24))"
                        :aria-label="`Equation of ${step.name}`"
                        spellcheck="false"
                        @keydown.enter.prevent="apply(step)"
                        @keydown.escape="refresh"
                    )
                    .error(v-if="errors[step.id]") {{ errors[step.id] }}
            .new-step
                .heading
                    span.name New reaction
                input.name(type="text" v-model="newName" placeholder="name, e.g. HK" aria-label="New reaction's name")
                input.equation(
                    type="text"
                    v-model="newText"
                    placeholder="Glc[c] + ATP[c] <=> G6P[c] + ADP[c]"
                    aria-label="New reaction's equation"
                    spellcheck="false"
                    @keydown.enter="add"
                )
                .error(v-if="errors.new") {{ errors.new }}
</template>

<script setup lang="ts">
import * as vue from 'vue'

import { addReaction, applyEquation, takeAddedElements } from '#editor/editor/reactions'
import {
    canUndoReorganise, diagramLayout, REGION_COLOURS, reorganiseDiagram, undoReorganise
} from '#editor/editor/regions'

import { componentLibraryPlugin } from '#root/plugins'
import { equationText, type StepKind } from '#root/plugins/bondgraph/equations'

import ToolPanel from './ToolPanel.vue'

//==============================================================================

const props = defineProps<{
    title: string
    toolId: string
}>()

type StepRow = { id: string, name: string, kind: StepKind, text: string, regions: string[] }

const steps = vue.ref<StepRow[]>([])
const errors = vue.ref<Record<string, string>>({})
const newName = vue.ref('')
const newText = vue.ref('')
const needValues = vue.ref<string[]>([])   // new elements, whose parameters the user sets in Properties
const locations = vue.ref<string[]>([])    // the diagram's regions, sorted, as drawn behind it

function refresh() {
    needValues.value.push(...takeAddedElements())
    steps.value = componentLibraryPlugin.reactionEquations().map(eq => ({
        id: eq.id, name: eq.name, kind: eq.kind, text: equationText(eq), regions: eq.regions
    }))
    locations.value = [...new Set(diagramLayout().nodes.flatMap(n => n.labels))].sort()
    canUndo.value = canUndoReorganise()
}

function regionColour(region: string): string {
    const k = locations.value.indexOf(region)
    return REGION_COLOURS[(k < 0 ? 0 : k) % REGION_COLOURS.length] ?? 'gray'
}

function listed(regions: string[]): string {
    return regions.length < 2 ? regions.join('') : `${regions.slice(0, -1).join(', ')} and ${regions.at(-1)}`
}

// steps by region: those within one region first, then those between regions, then those with none
const groups = vue.computed(() => {
    const byKey = new Map<string, { key: string, regions: string[], title: string, steps: StepRow[] }>()
    for (const step of steps.value) {
        const key = step.regions.join('|')
        let group = byKey.get(key)
        if (!group) {
            const title = step.regions.length === 0 ? 'No compartment'
                        : step.regions.length === 1 ? `In ${step.regions[0]}` : `Between ${listed(step.regions)}`
            group = { key, regions: step.regions, title, steps: [] }
            byKey.set(key, group)
        }
        group.steps.push(step)
    }
    const rank = (g: { regions: string[] }) => g.regions.length === 0 ? 99 : g.regions.length
    return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key))
})

const reorganising = vue.ref(false)
const progress = vue.ref(0)
const layoutStatus = vue.ref('')
const canUndo = vue.ref(false)

function describe(subspaces: number, regions: number): string {
    return subspaces === regions ? `each of ${regions} region${regions === 1 ? '' : 's'} in one piece`
                                 : `${regions} regions in ${subspaces} pieces`
}

async function reorganiseLayout() {
    reorganising.value = true
    progress.value = 0
    layoutStatus.value = ''
    try {
        const result = await reorganiseDiagram((done, of) => { progress.value = Math.round(100 * done / of) })
        if (!result) return
        const { before, after, rings } = result
        const kept = rings ? ` ${rings} cycle${rings === 1 ? '' : 's'} kept as drawn.` : ''
        layoutStatus.value = after.total < before.total
            ? `Complexity ${before.total.toFixed(0)} → ${after.total.toFixed(0)}: ${describe(after.subspaces, after.regions)}, `
              + `${after.crossings} crossing bond${after.crossings === 1 ? '' : 's'} (were ${before.crossings}).${kept}`
            : `No simpler layout found (complexity ${before.total.toFixed(0)}).`
    } finally {
        reorganising.value = false
        canUndo.value = canUndoReorganise()
    }
}

function undoLayout() {
    undoReorganise()
    canUndo.value = false
    layoutStatus.value = 'Layout restored.'
}

async function apply(step: StepRow) {
    errors.value = {}
    needValues.value = []
    try {
        await applyEquation(step.id, step.text)
    } catch (error) {
        errors.value = { [step.id]: (error as Error).message }
        return
    }
    refresh()
}

async function add() {
    errors.value = {}
    needValues.value = []
    try {
        await addReaction(newText.value, newName.value.trim())
    } catch (error) {
        errors.value = { new: (error as Error).message }
        return
    }
    newName.value = ''
    newText.value = ''
    refresh()
}

// follow edits made in the diagram, keeping an equation being typed
function diagramEdited() {
    const editing = document.activeElement?.closest?.('.reactions-step')
    if (!editing) refresh()
}

// the panel is made with the editor, before a diagram is open: read the diagram whenever the panel opens
function toolbarEvent(event: Event) {
    const detail = (<CustomEvent>event).detail
    if (detail?.type === 'state' && detail.source === props.toolId && detail.value) refresh()
}

vue.onMounted(() => {
    refresh()
    document.addEventListener('file-edited', diagramEdited)
    document.addEventListener('toolbar-event', toolbarEvent)
})
vue.onUnmounted(() => {
    document.removeEventListener('file-edited', diagramEdited)
    document.removeEventListener('toolbar-event', toolbarEvent)
})
</script>

<style scoped>
.layout {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}
.layout button {
    padding: 4px 10px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
    cursor: pointer;
}
.layout button.reorganise {
    font-weight: 600;
}
.layout button:disabled {
    cursor: default;
    opacity: 0.6;
}
.layout .status {
    flex-basis: 100%;
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    margin: 0;
}
.region-group {
    margin-bottom: 8px;
}
.region-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--p-text-muted-color);
    margin: 10px 0 6px 0;
}
.swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    opacity: 0.8;
}
.hint {
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    margin: 0 0 12px 0;
}
.hint code {
    font-family: ui-monospace, monospace;
}
.step, .new-step {
    margin-bottom: 12px;
}
.new-step {
    padding-top: 8px;
    border-top: 1px solid var(--p-content-border-color);
}
.heading {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    margin-bottom: 2px;
}
.heading .name {
    font-weight: 600;
}
.heading .kind {
    color: var(--p-text-muted-color);
}
.step.transport .heading .kind, .step.flow .heading .kind {
    color: #2e75b6;
}
input, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
}
.equation {
    resize: vertical;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
}
input.name {
    margin-bottom: 4px;
}
.note {
    font-size: 0.8rem;
    color: #2e75b6;
}
.error {
    color: #c0392b;
    font-size: 0.8rem;
    margin-top: 2px;
}
</style>
