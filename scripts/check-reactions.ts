// Checks editing a bond graph through its reaction equations (src/CellDL/editor/reactions.ts) in the running editor:
//
//     bun run check-reactions DOCUMENT.celldl.svg [OUT.celldl.svg]
//
// opens DOCUMENT in the editor app (Vite, headless Chrome driven over the DevTools protocol; CHROME, default
// google-chrome), then on its first reaction with a substrate: doubles that substrate's coefficient and adds a
// product with no store (a new store), checks the equation, puts it back, adds a chemostat's species (a copy beside
// the reaction) and removes it again (the copy goes); then adds a new reaction of two new species, and checks every
// reaction's hover text is its equation. Prints what it checked and writes the edited document to OUT. Exits 1 if
// a check fails.

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

    if (${process.env.SAVE_ONLY === '1'}) return { checks, document: await diagram.serialise() }
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
    return { checks, document: await diagram.serialise() }
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
        const { checks, document: edited } = result.result.value
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
        if (out) {
            writeFileSync(out, edited)
            console.log(`edited document: ${out}`)
        }
    }
    socket.close()
} finally {
    browser.kill()
    vite.kill()
}
process.exit(failed ? 1 : 0)
