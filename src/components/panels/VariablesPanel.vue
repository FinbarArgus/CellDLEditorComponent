<template lang="pug">
    ToolPanel
        template(#title)
            div {{ title }}
        template(#content)
            p.hint
                | How the generated CellML names this model's variables. Choose a convention, change its patterns,
                | or name single variables; patterns use #[code {species}], #[code {location}], #[code {name}],
                | #[code {element}], #[code {label}] and #[code {var}]. Saved with the document.
            p(v-if="elements.length === 0") This diagram has no bond elements yet.
            template(v-else)
                label.field(for="naming-convention") Convention
                select#naming-convention(:value="presetId" @change="choosePreset(inputValue($event))")
                    option(v-for="p in NAMING_PRESETS" :key="p.id" :value="p.id") {{ p.name }}
                    option(v-if="presetId === 'own'" value="own") Your own rules
                p.description(v-if="preset") {{ preset.description }}
                h4.section Rules
                .rule(v-for="row in ruleRows" :key="row.key")
                    span.what {{ row.classLabel }} · #[code {{ row.variable }}]
                    input.pattern(
                        type="text"
                        :value="patternOf(row)"
                        :placeholder="row.example"
                        :aria-label="`Name pattern for ${row.variable} of each ${row.classLabel}`"
                        spellcheck="false"
                        @change="setPattern(row, inputValue($event))"
                    )
                h4.section Names
                details.element(v-for="e in sortedElements" :key="e.id")
                    summary {{ e.identifier }} #[span.sub {{ classLabel(e.elementClass) }}]
                    .name(v-for="v in e.variables" :key="v")
                        span.var #[code {{ v }}]
                        input.override(
                            type="text"
                            :value="overrides.get(`${e.id}|${v}`) ?? ''"
                            :placeholder="preview.get(`${e.id}|${v}`)"
                            :aria-label="`CellML name of ${v} of ${e.identifier}`"
                            spellcheck="false"
                            @change="setOverride(e, v, inputValue($event))"
                        )
                .actions
                    button.apply(type="button" :disabled="!changed" @click="apply") Apply
                    button(type="button" :disabled="!changed" @click="refresh") Revert
                p.status {{ status }}
</template>

<script setup lang="ts">
import * as vue from 'vue'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import {
    bondgraphName, DOMAINS, ELEMENT_CLASSES, elementNames, matchingPreset, NAMING_PRESETS, type NameOverrides, type NamingElement,
    type NamingRule, previewNames
} from '#root/plugins/bondgraph/naming'

import { notifyChanges } from '#editor/editor'

import ToolPanel from './ToolPanel.vue'

//==============================================================================

const props = defineProps<{
    title: string
    toolId: string
}>()

function plugin(): BondgraphPlugin|undefined {
    return componentLibraryPlugin.getPlugin('bondgraph-components') as unknown as BondgraphPlugin|undefined
}

const elements = vue.ref<NamingElement[]>([])
const rules = vue.ref<NamingRule[]>([])
const overrides = vue.ref<NameOverrides>(new Map())
const changed = vue.ref(false)
const status = vue.ref('')

const sortedElements = vue.computed(() => [...elements.value].sort((a, b) => a.identifier.localeCompare(b.identifier)))
const preview = vue.computed(() => previewNames(elements.value, rules.value, overrides.value))
const preset = vue.computed(() => matchingPreset(rules.value))
const presetId = vue.computed(() => preset.value?.id ?? 'own')

// an input's or select's value, from its change event
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function classLabel(uri?: string): string {
    return ELEMENT_CLASSES.find(c => c.uri === uri)?.label ?? 'Element'
}

type RuleRow = { key: string, elementClass?: string, domain?: string, classLabel: string, variable: string, example: string }

const sameRule = (r: NamingRule, row: { elementClass?: string, domain?: string, variable: string }) =>
    r.variable === row.variable && (r.elementClass ?? '') === (row.elementClass ?? '') && (r.domain ?? '') === (row.domain ?? '')

function rowLabel(elementClass?: string, domain?: string): string {
    const what = elementClass ? classLabel(elementClass) : 'Every element'
    return `${what} (${DOMAINS.find(d => d.uri === domain)?.label ?? 'any domain'})`
}

// a row per class, domain and variable the diagram has, and per rule for any class or domain
const ruleRows = vue.computed(() => {
    const rows = new Map<string, RuleRow>()
    for (const e of sortedElements.value) {
        for (const variable of e.variables) {
            const key = `${e.elementClass ?? ''}|${e.domain ?? ''}|${variable}`
            if (!rows.has(key)) {
                rows.set(key, { key, elementClass: e.elementClass, domain: e.domain, variable,
                                classLabel: rowLabel(e.elementClass, e.domain), example: bondgraphName(e, variable) })
            }
        }
    }
    for (const rule of rules.value) {
        const key = `${rule.elementClass ?? ''}|${rule.domain ?? ''}|${rule.variable}`
        if (!rows.has(key)) {
            rows.set(key, { key, elementClass: rule.elementClass, domain: rule.domain, variable: rule.variable,
                            classLabel: rowLabel(rule.elementClass, rule.domain), example: '' })
        }
    }
    const order = (uri?: string) => { const k = ELEMENT_CLASSES.findIndex(c => c.uri === uri); return k < 0 ? 99 : k }
    return [...rows.values()].sort((a, b) => order(a.elementClass) - order(b.elementClass)
                                             || (a.domain ?? '').localeCompare(b.domain ?? '') || a.variable.localeCompare(b.variable))
})

function patternOf(row: RuleRow): string {
    return rules.value.find(r => sameRule(r, row))?.pattern ?? ''
}

function setPattern(row: RuleRow, pattern: string) {
    const others = rules.value.filter(r => !sameRule(r, row))
    rules.value = pattern.trim()
        ? [...others, { elementClass: row.elementClass, domain: row.domain, variable: row.variable, pattern: pattern.trim() }]
        : others
    changed.value = true
}

function setOverride(e: NamingElement, variable: string, name: string) {
    const next = new Map(overrides.value)
    if (name.trim()) next.set(`${e.id}|${variable}`, name.trim())
    else next.delete(`${e.id}|${variable}`)
    overrides.value = next
    changed.value = true
}

function choosePreset(id: string) {
    const chosen = NAMING_PRESETS.find(p => p.id === id)
    if (!chosen) return
    rules.value = chosen.rules.map(r => ({ ...r }))
    changed.value = true
}

function describe(): string {
    const renamed = sortedElements.value.flatMap(e => e.variables.map(v => [e, v] as const))
        .filter(([e, v]) => preview.value.get(`${e.id}|${v}`) !== bondgraphName(e, v, elementNames(elements.value).get(e.id))).length
    return renamed === 0 ? 'The CellML uses the bond graph\'s names.'
         : `${renamed} variable${renamed === 1 ? '' : 's'} named differently from the bond graph. `
           + 'bg2cellml uses these names when it writes the CellML (bgtool --list-variables lists them).'
}

function refresh() {
    const p = plugin()
    elements.value = p?.namingElements() ?? []
    const naming = p?.naming() ?? { rules: [], overrides: new Map() }
    rules.value = naming.rules
    overrides.value = naming.overrides
    changed.value = false
    status.value = describe()
}

function apply() {
    plugin()?.setNaming(rules.value, overrides.value)
    changed.value = false
    notifyChanges()
    status.value = describe()
}

// read the diagram whenever the panel opens, and after it changes unless an edit is pending
function toolbarEvent(event: Event) {
    const detail = (<CustomEvent>event).detail
    if (detail?.type === 'state' && detail.source === props.toolId && detail.value) refresh()
}
function diagramChanged() {
    if (!changed.value) {
        elements.value = plugin()?.namingElements() ?? []
    }
}

vue.onMounted(() => {
    refresh()
    document.addEventListener('toolbar-event', toolbarEvent)
    document.addEventListener('file-edited', diagramChanged)
    document.addEventListener('diagram-opened', refresh)
})
vue.onUnmounted(() => {
    document.removeEventListener('toolbar-event', toolbarEvent)
    document.removeEventListener('file-edited', diagramChanged)
    document.removeEventListener('diagram-opened', refresh)
})
</script>

<style scoped>
.hint, .description, .status {
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    margin: 0 0 10px 0;
}
code {
    font-family: ui-monospace, monospace;
}
.field {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 4px;
}
select, input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
    margin-bottom: 6px;
}
input {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
}
.section {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--p-text-muted-color);
    margin: 12px 0 6px 0;
}
.rule .what, .name .var {
    display: block;
    font-size: 0.8rem;
    margin-bottom: 2px;
}
details.element {
    border-top: 1px solid var(--p-content-border-color);
    padding: 4px 0;
}
details.element summary {
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
}
.sub {
    font-weight: 400;
    color: var(--p-text-muted-color);
    margin-left: 4px;
}
.name {
    padding-left: 10px;
}
.actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
}
.actions button {
    padding: 4px 12px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
    cursor: pointer;
}
.actions button.apply {
    font-weight: 600;
}
.actions button:disabled {
    opacity: 0.6;
    cursor: default;
}
</style>
