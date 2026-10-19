<template lang="pug">
    ToolPanel
        template(#title)
            div {{ title }}
        template(#content)
            p.hint
                | Identify each reaction by its Rhea reaction (or the Rhea reactions a lumped step combines) and each
                | species by its ChEBI entity and GO compartment. Saved with the document as #[code bqbiol] and
                | #[code semsim] terms on its elements; bg2cellml exports them as OMEX metadata.
            p(v-if="reactions.length === 0 && species.length === 0") This diagram has no reactions or species yet.
            template(v-else)
                h4.section(v-if="reactions.length") Reactions
                .annotation.reaction-annotation(v-for="r in reactions" :key="r.id" :data-element="r.id")
                    .heading
                        span.name {{ r.name }}
                        span.kind {{ r.kind }}
                    .equation.math(v-html="r.equationSvg" :data-text="r.equation")
                    label.check
                        input.lumped(type="checkbox" :checked="r.lumped" @change="setLumped(r, checked($event))")
                        | Lumped: parts
                    template(v-if="!r.lumped")
                        .row
                            label(:for="`rhea-${r.key}`") Rhea
                            input.rhea(:id="`rhea-${r.key}`" type="text" :value="r.rhea" placeholder="e.g. 17825"
                                       :aria-label="`Rhea ID of ${r.name}`" spellcheck="false"
                                       @change="edit(r, 'rhea', inputValue($event))")
                            a.link(v-if="r.rhea && !rheaError(r.rhea)" :href="identifierLink('rhea', clean('rhea', r.rhea))"
                                   target="_blank" rel="noopener") view
                        .error(v-if="rheaError(r.rhea)") {{ rheaError(r.rhea) }}
                    template(v-else)
                        .row
                            label(:for="`parts-${r.key}`") Parts
                            input.parts(:id="`parts-${r.key}`" type="text" :value="r.parts" placeholder="17825, 15437"
                                        :aria-label="`Rhea IDs of the parts of ${r.name}`" spellcheck="false"
                                        @change="edit(r, 'parts', inputValue($event))")
                        .links(v-if="partIds(r.parts).length")
                            a.link(v-for="id in partIds(r.parts)" :key="id" :href="identifierLink('rhea', id)"
                                   target="_blank" rel="noopener") {{ id }}
                        .error(v-if="partsError(r.parts)") {{ partsError(r.parts) }}
                        .combination(v-if="combinations[r.id]" :data-element="r.id")
                            p.note(v-if="combinations[r.id].message") {{ combinations[r.id].message }}
                            template(v-else)
                                .part(v-for="part in combinations[r.id].parts" :key="part.id")
                                    .part-id {{ part.id }}
                                    .math(v-html="part.svg")
                                .part.net
                                    .part-id net
                                    .math(v-html="combinations[r.id].net")
                                p.verdict(:class="combinations[r.id].matches ? 'matches' : 'differs'") {{ combinations[r.id].verdict }}
                    .row
                        label(:for="`sbo-${r.key}`") Type
                        select.sbo(:id="`sbo-${r.key}`" :value="r.sbo" :aria-label="`SBO type of ${r.name}`"
                                   @change="edit(r, 'sbo', inputValue($event))")
                            option(value="") none
                            option(v-for="t in SBO_TYPES" :key="t.id" :value="t.id") {{ t.label }} (SBO:{{ t.id }})
                    .row
                        label(:for="`uniprot-${r.key}`") UniProt
                        input.uniprot(:id="`uniprot-${r.key}`" type="text" :value="r.uniprot" placeholder="mediator (optional)"
                                      :aria-label="`UniProt mediator of ${r.name}`" spellcheck="false"
                                      @change="edit(r, 'uniprot', inputValue($event))")
                    .error(v-if="idError('uniprot', clean('uniprot', r.uniprot))") {{ idError('uniprot', clean('uniprot', r.uniprot)) }}
                h4.section(v-if="species.length") Species
                template(v-for="location in locations" :key="location")
                    .location-default
                        span.where [{{ location || 'no location' }}]
                        input.go-default(type="text" v-model="goDefaults[location]" placeholder="GO for every species here"
                                         :aria-label="`GO compartment of every species in ${location}`" spellcheck="false")
                        button.fill(type="button" :disabled="!goDefaults[location] || !!idError('GO', clean('GO', goDefaults[location] ?? ''))"
                                    @click="fillLocation(location)") Fill
                    .error(v-if="goDefaults[location] && idError('GO', clean('GO', goDefaults[location] ?? ''))")
                        | {{ idError('GO', clean('GO', goDefaults[location] ?? '')) }}
                    .annotation.species-annotation(v-for="s in species.filter(s => (s.location ?? '') === location)"
                                                   :key="s.key" :data-species="s.key")
                        .heading
                            span.name {{ s.key }}
                            span.kind {{ s.elements.length === 1 ? '1 element' : `${s.elements.length} elements` }}
                        .row
                            label(:for="`chebi-${s.key}`") ChEBI
                            input.chebi(:id="`chebi-${s.key}`" type="text" :value="s.chebi" placeholder="e.g. 4167"
                                        :aria-label="`ChEBI ID of ${s.key}`" spellcheck="false"
                                        @change="editSpecies(s, 'chebi', inputValue($event))")
                            a.link(v-if="s.chebi && !idError('CHEBI', clean('CHEBI', s.chebi))"
                                   :href="identifierLink('CHEBI', clean('CHEBI', s.chebi))" target="_blank" rel="noopener") view
                        .error(v-if="idError('CHEBI', clean('CHEBI', s.chebi))") {{ idError('CHEBI', clean('CHEBI', s.chebi)) }}
                        .row
                            label(:for="`go-${s.key}`") GO
                            input.go(:id="`go-${s.key}`" type="text" :value="s.go" placeholder="e.g. 0005829"
                                     :aria-label="`GO compartment of ${s.key}`" spellcheck="false"
                                     @change="editSpecies(s, 'go', inputValue($event))")
                            a.link(v-if="s.go && !idError('GO', clean('GO', s.go))"
                                   :href="identifierLink('GO', clean('GO', s.go))" target="_blank" rel="noopener") view
                        .error(v-if="idError('GO', clean('GO', s.go))") {{ idError('GO', clean('GO', s.go)) }}
                        .note(v-if="s.differ") Its elements are annotated differently; Apply gives them all these terms.
                .actions
                    button.apply.apply-annotations(type="button" :disabled="!changed" @click="apply") Apply
                    button.revert-annotations(type="button" :disabled="!changed" @click="refresh") Revert
                p.status {{ status }}
</template>

<script setup lang="ts">
import * as vue from 'vue'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import {
    type Annotation, emptyAnnotation, type IdKind, idError, identifierLink, normaliseId, SBO_TYPES, speciesAnnotations,
    speciesGroups
} from '#root/plugins/bondgraph/annotations'
import { equationLatex, equationText } from '#root/plugins/bondgraph/equations'
import {
    combineParts, fetchAncestors, fetchRhea, netDifferences, netLatex, partLatex, relatedBy
} from '#root/plugins/bondgraph/rhea'
import { latexAsSvgString } from '#root/mathjax'

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

// the fields as typed
type ReactionRow = {
    id: string, key: string, name: string, kind: string, equation: string, equationSvg: string,
    lumped: boolean, rhea: string, parts: string, sbo: string, uniprot: string
}
type SpeciesRow = {
    key: string, species: string, location?: string, elements: string[], chebi: string, go: string, differ: boolean
}

const reactions = vue.ref<ReactionRow[]>([])
const species = vue.ref<SpeciesRow[]>([])
const goDefaults = vue.ref<Record<string, string>>({})
const changed = vue.ref(false)
const status = vue.ref('')
let current = new Map<string, Annotation>()

const locations = vue.computed(() => [...new Set(species.value.map(s => s.location ?? ''))])

function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value
}
function checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked
}

const clean = (kind: IdKind, value: string) => normaliseId(kind, value)
const partIds = (parts: string) => parts.split(/[\s,;+]+/).map(p => normaliseId('rhea', p)).filter(Boolean)
const rheaError = (value: string) => idError('rhea', clean('rhea', value))
function partsError(parts: string): string|undefined {
    const bad = partIds(parts).filter(id => idError('rhea', id))
    return bad.length ? `${bad.join(', ')}: ${idError('rhea', bad[0]!)}` : undefined
}

// a lumped step's parts added up (./rhea.ts): each typeset with what cancels struck through, then the net equation
type CombinationView = { message?: string, parts: { id: string, svg: string }[], net: string, verdict: string, matches: boolean }
const combinations = vue.ref<Record<string, CombinationView>>({})

// each piece typeset on its own, so the browser wraps the equation at the panel's width
function typeset(pieces: string[]): string {
    return pieces.map(latex => {
        try { return latexAsSvgString(latex) } catch (error) { return String(error) }
    }).join(' ')
}

async function combine(row: ReactionRow) {
    const ids = row.lumped ? partIds(row.parts).filter(id => !idError('rhea', id)) : []
    const parts = row.parts
    if (ids.length < 2) {
        delete combinations.value[row.id]
        return
    }
    combinations.value[row.id] = { message: `Fetching ${ids.length} Rhea reactions…`, parts: [], net: '', verdict: '', matches: false }
    let view: CombinationView
    try {
        const reactions = await Promise.all(ids.map(id => fetchRhea(id)))
        const step = plugin()?.reactionEquations().find(eq => eq.id === row.id)
        const chebiOf = (node: string) => current.get(node)?.chebi
        const chebis = [...new Set([...reactions.flatMap(r => r.participants.map(p => p.chebi)),
                                    ...[...(step?.substrates ?? []), ...(step?.products ?? [])].map(p => p.node && chebiOf(p.node))]
                                   .filter((c): c is string => !!c))]
        // without the ancestors (the lookup service down), only identical IDs are the same entity
        const ancestors = new Map(await Promise.all(chebis.map(async c => [c, await fetchAncestors(c).catch(() => [])] as const)))
        const related = relatedBy(ancestors)
        const combined = combineParts(reactions, related)
        const differences = step ? netDifferences(combined.net, step, chebiOf, related) : undefined
        view = {
            parts: combined.parts.map(p => ({ id: `RHEA:${p.id}`, svg: typeset(partLatex(p.terms)) })),
            net: typeset(netLatex(combined.net)),
            matches: differences?.length === 0,
            verdict: differences === undefined ? 'Not compared with the step: give each of its species a ChEBI ID.'
                   : differences.length === 0 ? 'The net equation is the step\'s.'
                   : `The net equation differs from the step's: ${differences.join('; ')}.`
        }
    } catch (error) {
        view = { message: `Could not add up the parts: ${(error as Error).message}`, parts: [], net: '', verdict: '', matches: false }
    }
    if (row.parts === parts) combinations.value[row.id] = view    // unless they were edited meanwhile
}

function edit(row: ReactionRow, field: 'rhea'|'parts'|'sbo'|'uniprot', value: string) {
    row[field] = value
    changed.value = true
    if (field === 'parts') combine(row)
}
function setLumped(row: ReactionRow, lumped: boolean) {
    row.lumped = lumped
    changed.value = true
    combine(row)
}
function editSpecies(row: SpeciesRow, field: 'chebi'|'go', value: string) {
    row[field] = value
    changed.value = true
}
function fillLocation(location: string) {
    const go = goDefaults.value[location] ?? ''
    for (const s of species.value) {
        if ((s.location ?? '') === location) s.go = go
    }
    changed.value = true
}

function refresh() {
    const p = plugin()
    current = p?.annotations() ?? new Map()
    reactions.value = (p?.reactionEquations() ?? []).filter(eq => eq.kind !== 'flow').map((eq, k) => {
        const a = current.get(eq.id) ?? emptyAnnotation()
        return {
            id: eq.id, key: `r${k}`, name: eq.name, kind: eq.kind, equation: equationText(eq), equationSvg: typeset([equationLatex(eq)]),
            lumped: a.parts.length > 0, rhea: a.rhea ?? '', parts: a.parts.join(', '), sbo: a.sbo ?? '', uniprot: a.uniprot ?? ''
        }
    })
    species.value = speciesGroups(p?.speciesNodes() ?? [], current).map(g => ({
        key: g.key, species: g.species, location: g.location, elements: g.elements,
        chebi: g.chebi ?? '', go: g.go ?? '', differ: g.differ
    }))
    changed.value = false
    status.value = describe()
    combinations.value = {}
    for (const r of reactions.value) combine(r)
}

function describe(): string {
    const reactionsDone = reactions.value.filter(r => current.get(r.id)?.rhea || current.get(r.id)?.parts.length).length
    const speciesDone = species.value.filter(s => s.chebi && s.go).length
    return `${reactionsDone} of ${reactions.value.length} reactions have a Rhea ID; `
         + `${speciesDone} of ${species.value.length} species have ChEBI and GO terms.`
}

// a typed ID, or the saved one when what was typed is not an ID
function valid(kind: IdKind, typed: string, saved: string|undefined, skipped: string[]): string|undefined {
    const id = clean(kind, typed)
    if (idError(kind, id)) {
        skipped.push(id)
        return saved
    }
    return id || undefined
}

function apply() {
    const skipped: string[] = []
    const wanted = new Map<string, Annotation>()
    for (const r of reactions.value) {
        const now = current.get(r.id) ?? emptyAnnotation()
        const parts = r.lumped ? partIds(r.parts) : []
        const goodParts = parts.filter(id => !idError('rhea', id))
        skipped.push(...parts.filter(id => idError('rhea', id)))
        wanted.set(r.id, {
            ...now,
            rhea: r.lumped ? undefined : valid('rhea', r.rhea, now.rhea, skipped),
            parts: goodParts,
            sbo: r.sbo || undefined,
            uniprot: valid('uniprot', r.uniprot, now.uniprot, skipped)
        })
    }
    const groups = species.value.map(s => {
        const saved = current.get(s.elements[0]!) ?? emptyAnnotation()
        return { elements: s.elements, chebi: valid('CHEBI', s.chebi, saved.chebi, skipped), go: valid('GO', s.go, saved.go, skipped) }
    })
    for (const [id, a] of speciesAnnotations(groups, current)) wanted.set(id, a)
    plugin()?.setAnnotations(wanted)
    notifyChanges()
    refresh()
    if (skipped.length) {
        status.value = `Not saved, as not IDs: ${skipped.join(', ')}. ${status.value}`
    }
}

// read the diagram whenever the panel opens, and after it changes unless an edit is pending
function toolbarEvent(event: Event) {
    const detail = (<CustomEvent>event).detail
    if (detail?.type === 'state' && detail.source === props.toolId && detail.value) refresh()
}
function diagramChanged() {
    if (!changed.value) refresh()
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
.hint, .status, .note {
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    margin: 0 0 10px 0;
}
code {
    font-family: ui-monospace, monospace;
}
.section {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--p-text-muted-color);
    margin: 12px 0 6px 0;
}
.annotation {
    border-top: 1px solid var(--p-content-border-color);
    padding: 6px 0;
}
.heading {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
}
.heading .name {
    font-weight: 600;
}
.heading .kind {
    color: var(--p-text-muted-color);
    font-size: 0.75rem;
}
.equation {
    font-size: 0.8rem;
    margin: 2px 0 4px 0;
    overflow-wrap: anywhere;
}
.row, .location-default {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
}
.row label, .location-default .where {
    flex: 0 0 52px;
    font-size: 0.8rem;
}
.check {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
    margin-bottom: 4px;
}
input[type="text"], select {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 3px 6px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
}
.combination {
    margin: 2px 0 6px 0;
}
.part {
    margin-bottom: 4px;
}
.part-id {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--p-text-muted-color);
}
.part.net {
    border-top: 1px solid var(--p-content-border-color);
    padding-top: 2px;
}
.math {
    line-height: 1.6;
}
.math :deep(svg) {
    display: inline;
    max-width: 100%;
    height: auto;
}
.verdict {
    font-size: 0.78rem;
    margin: 2px 0 0 0;
}
.verdict.matches {
    color: var(--p-green-600, #2e7d32);
}
.verdict.differs {
    color: var(--p-orange-600, #c05600);
}
.links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 4px 58px;
}
.link {
    font-size: 0.75rem;
}
.error {
    font-size: 0.75rem;
    color: var(--p-red-500, #c62828);
    margin: 0 0 4px 58px;
}
.location-default {
    margin-top: 8px;
}
.actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
}
button {
    padding: 3px 10px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    background: var(--p-content-background);
    color: var(--p-text-color);
    cursor: pointer;
}
.actions button.apply {
    font-weight: 600;
}
button:disabled {
    opacity: 0.6;
    cursor: default;
}
</style>
