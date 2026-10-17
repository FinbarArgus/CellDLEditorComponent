<template lang="pug">
    ToolPanel
        template(#title)
            div {{ title }}
        template(#content)
            p.hint
                | Edit an equation and press Enter to change the bond graph:
                | coefficients with a space (#[code 2 ADP[c]]), species joined by #[code  + ].
                | A new species gets a new store.
            p.note(v-if="needValues.length") New: {{ needValues.join(", ") }}. Set their parameters in Properties.
            p(v-if="steps.length === 0") This diagram has no reactions yet.
            .step.reactions-step(v-for="step in steps" :key="step.id" :class="step.kind")
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

import { componentLibraryPlugin } from '#root/plugins'
import { equationText, type StepKind } from '#root/plugins/bondgraph/equations'

import ToolPanel from './ToolPanel.vue'

//==============================================================================

const props = defineProps<{
    title: string
    toolId: string
}>()

type StepRow = { id: string, name: string, kind: StepKind, text: string }

const steps = vue.ref<StepRow[]>([])
const errors = vue.ref<Record<string, string>>({})
const newName = vue.ref('')
const newText = vue.ref('')
const needValues = vue.ref<string[]>([])   // new elements, whose parameters the user sets in Properties

function refresh() {
    needValues.value.push(...takeAddedElements())
    steps.value = componentLibraryPlugin.reactionEquations().map(eq => ({
        id: eq.id, name: eq.name, kind: eq.kind, text: equationText(eq)
    }))
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
