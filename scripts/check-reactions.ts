// Checks editing a bond graph through its reaction equations (src/CellDL/editor/reactions.ts) in the running editor:
//
//     bun run check-reactions DOCUMENT.celldl.svg [OUT.celldl.svg]
//
// opens DOCUMENT in the editor app (Vite, headless Chrome driven over the DevTools protocol; CHROME, default
// google-chrome), then on its first reaction with a substrate: doubles that substrate's coefficient and adds a
// product with no store (a new store), checks the equation, puts it back, adds a chemostat's species (a copy beside
// the reaction) and removes it again (the copy goes); then adds a new reaction of two new species, and checks every
// reaction's hover text is its equation. Then, in the Annotations panel, gives the first reaction a Rhea ID and
// the first species a ChEBI ID, checks they are saved as bqbiol triples (and removed when cleared) and shown in the
// hovers, and that an ID of the wrong form is not saved. Prints what it checked, writes the edited document to OUT
// and a screenshot of the Annotations panel to OUT.annotations.png. Exits 1 if a check fails.

import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const [document, out] = process.argv.slice(2)
if (!document) {
    console.error('usage: bun run check-reactions DOCUMENT.celldl.svg [OUT.celldl.svg]')
    process.exit(1)
}
const chrome = process.env.CHROME || 'google-chrome'
const port = Number(process.env.RENDER_PORT || 5199)
const debugPort = port + 1000
const specDir = 'app/render-specs'      // served by Vite (gitignored)
mkdirSync(specDir, { recursive: true })
const name = basename(document)
copyFileSync(document, join(specDir, name))

const vite = spawn('bunx', ['vite', '--config', 'vite.config.ts', 'app', '--base', '/', '--port', String(port), '--strictPort'],
                   { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite did not start')), 60000)
    vite.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('Local:')) {
            clearTimeout(timeout)
            resolve()
        }
    })
    vite.on('exit', code => reject(new Error(`Vite exited (${code})`)))
})
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`,
                               '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })

// The DevTools protocol, over the page's WebSocket
async function pageSocket(): Promise<WebSocket> {
    for (let i = 0; i < 100; i += 1) {
        try {
            const pages = await (await fetch(`http://localhost:${debugPort}/json/list`)).json() as
                { type: string, webSocketDebuggerUrl: string }[]
            const page = pages.find(p => p.type === 'page')
            if (page) {
                const socket = new WebSocket(page.webSocketDebuggerUrl)
                await new Promise(resolve => socket.addEventListener('open', resolve))
                return socket
            }
        } catch { /* not listening yet */ }
        await Bun.sleep(200)
    }
    throw new Error(`${chrome} did not start`)
}

let nextId = 0
// biome-ignore lint/suspicious/noExplicitAny: DevTools protocol results are untyped JSON
function send(socket: WebSocket, method: string, params: object = {}): Promise<any> {
    const id = ++nextId
    return new Promise((resolve, reject) => {
        const listener = (event: MessageEvent) => {
            const message = JSON.parse(String(event.data))
            if (message.id === id) {
                socket.removeEventListener('message', listener)
                if (message.error) reject(new Error(message.error.message))
                else resolve(message.result)
            }
        }
        socket.addEventListener('message', listener)
        socket.send(JSON.stringify({ id, method, params }))
    })
}

// Runs in the page: the modules are the app's own, by their /@fs URLs
const scenario = (src: string) => `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const { CellDLEditor } = await import('${src}/CellDL/editor/index.ts')
    for (let i = 0; i < 300; i += 1) {
        if (CellDLEditor.instance?.celldlDiagram?.svgDiagram?.querySelector('g.celldl-Component')) break
        await wait(100)
    }
    const { componentLibraryPlugin } = await import('${src}/plugins/index.ts')
    const { addReaction, applyEquation } = await import('${src}/CellDL/editor/reactions.ts')
    const { equationText } = await import('${src}/plugins/bondgraph/equations.ts')
    const diagram = CellDLEditor.instance.celldlDiagram
    const plugin = componentLibraryPlugin.getPlugin('bondgraph-components')
    const steps = () => plugin.reactionEquations()
    const text = id => equationText(steps().find(e => e.id === id))
    const term = p => (p.count === 1 ? '' : p.count + ' ') + p.species + (p.location ? '[' + p.location + ']' : '')
    const components = () => diagram.svgDiagram.querySelectorAll('g.celldl-Component').length
    const checks = []
    const check = (what, ok, detail) => checks.push({ what, ok: !!ok, detail })

    // the variables' names as the document stands, before any edit (to compare with bgtool --list-variables)
    const namingModule = await import('${src}/plugins/bondgraph/naming.ts')
    const asOpened = Object.fromEntries([...namingModule.previewNames(plugin.namingElements(), [], new Map())]
        .map(([key, name]) => [key.split('#').pop(), name]))
    if (${process.env.SAVE_ONLY === '1'}) return { checks, document: await diagram.serialise(), asOpened }

    // the panel itself: opened with its button, a row per step; typing an equation and Enter edits the bond graph
    document.getElementById('reactions-panel').click()
    await wait(500)
    const rows = () => [...document.querySelectorAll('.reactions-step .equation')]
    check('the panel shows every step', rows().length === steps().length && rows().length > 0,
          rows().length + ' rows, ' + steps().length + ' steps')
    const shown = steps().find(e => e.substrates.length)
    const rowOf = eq => rows().find(r => r.getAttribute('aria-label') === 'Equation of ' + eq.name)
    const row = shown && rowOf(shown)
    if (row && shown) {
        const typed = row.value.replace(term(shown.substrates[0]), term({ ...shown.substrates[0], count: 3 * shown.substrates[0].count }))
        row.value = typed
        row.dispatchEvent(new Event('input'))
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await wait(500)
        const edited = steps().find(e => e.id === shown.id)
        check('typing an equation edits the bond graph', text(shown.id) !== equationText(shown)
              && edited.substrates[0].count === 3 * shown.substrates[0].count, text(shown.id))
        await applyEquation(shown.id, equationText(shown))
        await wait(300)
        check('the panel follows the diagram', rowOf(shown).value === equationText(shown), rowOf(shown).value)
    }
    const step = steps().find(e => e.kind === 'reaction' && e.substrates.length && e.products.length)
    const original = text(step.id)
    const location = step.substrates[0].location
    const first = step.substrates[0]
    const doubled = { ...first, count: 2 * first.count }
    const edited = [doubled, ...step.substrates.slice(1)].map(term).join(' + ') + ' <=> '
                 + [...step.products, { species: 'Xnew', location, count: 1 }].map(term).join(' + ')
    const before = components()
    await applyEquation(step.id, edited)
    const after = steps().find(e => e.id === step.id)
    check('coefficient doubled', after.substrates.find(p => p.species === first.species)?.count === 2 * first.count,
          text(step.id))
    check('new product has a new store', components() === before + 1
          && plugin.speciesNodes().some(n => n.species === 'Xnew' && !n.isSource), components() - before)
    await applyEquation(step.id, original)
    check('equation put back', text(step.id) === original, text(step.id))

    const source = plugin.speciesNodes().find(n => n.isSource
        && ![...step.substrates, ...step.products].some(p => p.species === n.species && p.location === n.location))
    if (source) {
        const copies = () => plugin.speciesNodes().filter(n => n.isSource && n.species === source.species).length
        const was = copies()
        await applyEquation(step.id, original.replace(' ⇌ ', ' + ' + source.species + '[' + source.location + '] ⇌ '))
        check('a chemostat species gets a copy beside the reaction', copies() === was + 1, source.species)
        await applyEquation(step.id, original)
        check('its copy goes when it is removed', copies() === was && text(step.id) === original, copies() - was)
    }

    const added = await addReaction('2 Anew[' + location + '] <=> Xnew[' + location + ']', 'Rnew')
    const reaction = steps().find(e => e.id === added)
    check('new reaction', reaction && reaction.name === 'Rnew'
          && text(added) === '2 Anew[' + location + '] ⇌ Xnew[' + location + ']', reaction && text(added))
    check('it joins the existing store', plugin.speciesNodes().filter(n => n.species === 'Xnew').length === 1)

    const hovers = steps().filter(e => componentLibraryPlugin.hoverText(diagram.objectById(e.id.split('#').pop()))
                                       !== equationText(e))
    check('hover text is each reaction\\'s equation', hovers.length === 0, hovers.map(e => e.name))

    // regions: drawn behind the diagram, one per location; the panel's groups; reorganising keeps bonds attached
    const regions = await import('${src}/CellDL/editor/regions.ts')
    const drawn = regions.drawRegions()
    const locations = [...new Set(regions.diagramLayout().nodes.flatMap(n => n.labels))].sort()
    const shaded = [...document.querySelectorAll('#celldl-region-layer path')].map(p => p.dataset.region).sort()
    check('a shaded region per location', JSON.stringify(shaded) === JSON.stringify(locations) && locations.length > 0,
          shaded)
    const keys = new Set(steps().map(e => e.regions.join('|')))
    check('the panel groups steps by region', document.querySelectorAll('.region-heading').length === keys.size,
          [...document.querySelectorAll('.region-heading')].map(h => h.textContent))
    const attached = () => {
        const loose = []
        for (const b of regions.diagramLayout().bonds) {
            const bond = b.id && diagram.objectById(b.id.split('#').pop())
            const path = bond?.celldlSvgElement?.svgElement
            const line = path instanceof SVGPathElement ? path : path?.querySelector('path')
            if (!line) continue
            const ends = [line.getPointAtLength(0), line.getPointAtLength(line.getTotalLength())]
            const near = (id, p) => {
                const s = diagram.objectById(id.split('#').pop()).celldlSvgElement
                return Math.abs(p.x - s.centroid.x) <= s.width / 2 + 15 && Math.abs(p.y - s.centroid.y) <= s.height / 2 + 15
            }
            if (!(near(b.a, ends[0]) || near(b.a, ends[1])) || !(near(b.b, ends[0]) || near(b.b, ends[1]))) loose.push(b.id)
        }
        return loose
    }
    const where = () => regions.diagramLayout().nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)].join())
    const placed = where()
    const result = await regions.reorganiseDiagram(undefined, { forceSteps: 150, steps: 600 })
    check('reorganising lowers the complexity, or leaves the layout', result.after.total <= result.before.total
          && (result.after.total < result.before.total) === (JSON.stringify(where()) !== JSON.stringify(placed)),
          Math.round(result.before.total) + ' -> ' + Math.round(result.after.total) + ', '
          + result.before.subspaces + ' -> ' + result.after.subspaces + ' pieces of ' + result.after.regions + ' regions')
    check('bonds stay attached to their nodes', attached().length === 0, attached().slice(0, 3))
    const counted = regions.diagramLayout().bonds.filter(b => b.count > 1).length
    check('bond counts are redrawn', regions.drawBondCounts() === counted, counted)
    if (regions.canUndoReorganise()) {
        regions.undoReorganise()
        await wait(300)
        const differ = where().filter((p, k) => p !== placed[k])
        check('undo reorganise puts the nodes back', differ.length === 0,
              differ.slice(0, 3).map(p => p + ' was ' + placed[where().indexOf(p)]))
    }
    // an element's hover: its typeset law, and its symbols' CellML names with what the bonds make them
    const naming = await import('${src}/plugins/bondgraph/naming.ts')
    const named = () => { const n = plugin.naming(); return naming.previewNames(plugin.namingElements(), n.rules, n.overrides) }
    const hoverOf = id => componentLibraryPlugin.hoverHtml(diagram.objectById(id.split('#').pop()))
    const reactionStep = steps().find(e => e.kind === 'reaction' && e.substrates.some(p => p.node))
    const reactionHover = hoverOf(reactionStep.id)
    const substrateNames = reactionStep.substrates.filter(p => p.node).map(p => named().get(p.node + '|u'))
    const forward = (reactionHover.match(/data-text="u_f = [^"]*/) ?? [''])[0]
    check('a reaction\\'s hover shows its law and the potentials bonded to its forward side',
          reactionHover.includes('<svg') && substrateNames.every(n => forward.includes(n)), forward)
    const storeNode = plugin.speciesNodes().find(n => !n.isSource)
    const storeHover = storeNode ? hoverOf(storeNode.id) : ''
    const feeding = steps().filter(e => [...e.substrates, ...e.products].some(p => p.node === storeNode?.id))
                           .map(e => named().get(e.id + '|v'))
    const flowLine = (storeHover.match(/data-text="v = [^"]*/) ?? [''])[0]
    check('a store\\'s hover shows its law and the flows of its reactions', storeHover.includes('<svg') && feeding.length > 0
          && feeding.every(n => flowLine.includes(n)), flowLine)
    const hoverLines = new DOMParser().parseFromString(reactionHover, 'text/html').querySelectorAll('.bg-law-line')
    check('a reaction\\'s equation and symbols are typeset in the hover, as its law is',
          hoverLines.length > 1 && [...hoverLines].every(l => l.querySelector('svg')), hoverLines.length)

    // the Variables panel: choose a convention and apply it; it is saved with the document
    document.getElementById('variables-panel').click()
    await wait(500)
    const shownElements = document.querySelectorAll('details.element').length
    check('the Variables panel lists every bond element', shownElements === plugin.namingElements().length
          && shownElements > 0, shownElements)
    const convention = document.getElementById('naming-convention')
    convention.value = 'chemistry'
    convention.dispatchEvent(new Event('change'))
    await wait(200)
    document.querySelector('.actions button.apply').click()
    await wait(300)
    const saved = plugin.naming()
    const chemistry = naming.NAMING_PRESETS.find(p => p.id === 'chemistry')
    check('the chosen convention is saved with the document', naming.matchingPreset(saved.rules)?.id === 'chemistry'
          && saved.rules.length === chemistry.rules.length, saved.rules.length)
    const preview = naming.previewNames(plugin.namingElements(), saved.rules, saved.overrides)
    const names = Object.fromEntries([...preview].map(([key, name]) => [key.split('#').pop(), name]))

    // the Annotations panel: a Rhea ID and a ChEBI ID typed, applied, saved as bqbiol triples and shown in the hovers;
    // the panel is left open for the screenshot
    document.getElementById('annotations-panel').click()
    await wait(500)
    const reactionRows = () => [...document.querySelectorAll('.reaction-annotation')]
    const speciesRows = () => [...document.querySelectorAll('.species-annotation')]
    const reactionSteps = steps().filter(e => e.kind !== 'flow')
    const speciesKeys = new Set(plugin.speciesNodes().map(n => n.species + '[' + (n.location ?? '') + ']'))
    check('the Annotations panel lists every reaction and species', reactionRows().length === reactionSteps.length
          && speciesRows().length === speciesKeys.size && reactionRows().length > 0,
          reactionRows().length + ' reactions, ' + speciesRows().length + ' species')
    const type = (row, selector, value) => {
        const input = row.querySelector(selector)
        input.value = value
        input.dispatchEvent(new Event('change'))
    }
    const applyAnnotations = async () => {
        await wait(100)
        document.querySelector('button.apply-annotations').click()
        await wait(300)
    }
    const annotatedStep = reactionSteps[0]
    const annotatedRow = () => reactionRows().find(r => r.dataset.element === annotatedStep.id)
    const speciesRow = () => speciesRows()[0]
    const speciesKey = speciesRow().dataset.species
    const speciesElements = plugin.speciesNodes().filter(n => n.species + '[' + (n.location ?? '') + ']' === speciesKey)
    type(annotatedRow(), 'input.rhea', '17825')
    type(speciesRow(), 'input.chebi', 'CHEBI:4167')
    type(speciesRow(), 'input.go', '5829')
    await wait(100)
    check('an ID of the wrong form is shown as an error', !!speciesRow().querySelector('.error'),
          speciesRow().querySelector('.error')?.textContent)
    await applyAnnotations()
    const RHEA = '<http://biomodels.net/biology-qualifiers/isVersionOf> <https://identifiers.org/rhea:17825>'
    const CHEBI = '<http://biomodels.net/biology-qualifiers/is> <https://identifiers.org/CHEBI:4167>'
    const savedAnnotations = plugin.annotations()
    check('the Rhea ID is saved on the reaction', savedAnnotations.get(annotatedStep.id)?.rhea === '17825',
          savedAnnotations.get(annotatedStep.id))
    check('the ChEBI ID is saved on every element of the species, the bad GO ID is not',
          speciesElements.length > 0 && speciesElements.every(n => savedAnnotations.get(n.id)?.chebi === '4167'
                                                                   && !savedAnnotations.get(n.id)?.go),
          speciesKey + ': ' + speciesElements.map(n => n.id.split('#').pop()).join(', '))
    const tripleRows = () => diagram.rdfStore.query(
        'SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER (STRSTARTS(STR(?o), "https://identifiers.org/")) }')
        .map(r => '<' + r.get('s').value + '> <' + r.get('p').value + '> <' + r.get('o').value + '>')
    const savedTriples = tripleRows()
    check('they are the spec\\'s triples in the document', savedTriples.includes('<' + annotatedStep.id + '> ' + RHEA)
          && speciesElements.every(n => savedTriples.includes('<' + n.id + '> ' + CHEBI)), savedTriples)
    const serialised = await diagram.serialise()
    check('and in the saved document', serialised.includes('identifiers.org/rhea:17825')
          && serialised.includes('identifiers.org/CHEBI:4167'))
    const reactionHoverNow = hoverOf(annotatedStep.id)
    check('the reaction\\'s hover shows its Rhea ID', reactionHoverNow.includes('Rhea 17825'),
          (reactionHoverNow.match(/bg-law-annotation">[^<]*/) ?? [''])[0])
    const speciesHover = hoverOf(speciesElements[0].id)
    check('the species\\' hover shows its ChEBI ID', speciesHover.includes('CHEBI:4167'),
          (speciesHover.match(/bg-law-annotation">[^<]*/) ?? [''])[0])
    type(annotatedRow(), 'input.rhea', '')
    await applyAnnotations()
    check('clearing an ID removes its triple', !tripleRows().some(t => t.includes('rhea:17825'))
          && !hoverOf(annotatedStep.id).includes('Rhea 17825'))
    type(annotatedRow(), 'input.rhea', '17825')
    type(speciesRow(), 'input.go', '0005829')
    await applyAnnotations()
    const annotationTriples = tripleRows()
    return { checks, document: await diagram.serialise(), names, asOpened, annotationTriples }
})()`

let failed = false
try {
    const socket = await pageSocket()
    await send(socket, 'Runtime.enable')
    await send(socket, 'Page.navigate', { url: `http://localhost:${port}/?open=/render-specs/${name}` })
    const src = `/@fs${resolve('src')}`
    const result = await send(socket, 'Runtime.evaluate', { expression: scenario(src), awaitPromise: true,
                                                            returnByValue: true, timeout: 240000 })
    if (result.exceptionDetails) {
        console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
        failed = true
    } else {
        const { checks, document: edited, names, asOpened, annotationTriples } = result.result.value
        for (const c of checks) {
            console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.what}${c.detail !== undefined ? `: ${JSON.stringify(c.detail)}` : ''}`)
            failed ||= !c.ok
        }
        // bg2cellml makes a composite's junction itself: a component listed as both is a junction without a domain
        const list = (predicate: string) => new Set((edited.match(new RegExp(`bgf:${predicate} ([^;.]*)`))?.[1] ?? '')
                                                   .split(',').map((s: string) => s.trim()).filter(Boolean))
        const elements = list('hasBondElement')
        const both = [...list('hasJunctionStructure')].filter(j => elements.has(j))
        console.log(`${both.length === 0 ? 'ok  ' : 'FAIL'} the saved document lists no component as both a bond`
                    + ` element and a junction${both.length ? `: ${both.join(', ')}` : ''}`)
        failed ||= both.length > 0
        if (annotationTriples) {
            console.log('annotation triples:')
            for (const t of annotationTriples) console.log(`    ${t} .`)
        }
        if (out) {
            writeFileSync(out, edited)
            console.log(`edited document: ${out}`)
            const shot = await send(socket, 'Page.captureScreenshot', { format: 'png' })
            writeFileSync(`${out}.annotations.png`, Buffer.from(shot.data, 'base64'))
            console.log(`the Annotations panel: ${out}.annotations.png`)
            if (names) {
                // the Variables panel's names, element|variable -> name, to compare with bgtool --list-variables
                writeFileSync(`${out}.names.json`, JSON.stringify(names, null, 1))
                writeFileSync(`${out}.opened-names.json`, JSON.stringify(asOpened, null, 1))
                console.log(`its variable names: ${out}.names.json`)
            }
        }
    }
    socket.close()
} finally {
    browser.kill()
    vite.kill()
}
process.exit(failed ? 1 : 0)
