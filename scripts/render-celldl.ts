// Renders CellDL specs (a generated bond graph's Turtle, elements and connections with positions; see
// src/utils/celldlDocument.ts) to CellDL documents, drawing each element as the editor draws it:
//
//     bun run render-celldl OUT_DIR SPEC.json [SPEC.json ...]
//
// writes OUT_DIR/<spec name>.celldl.svg. It serves app/render-celldl.html with Vite and loads it in headless Chrome
// (CHROME, default google-chrome).

import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const [outDir, ...specs] = process.argv.slice(2)
if (!outDir || specs.length === 0) {
    console.error('usage: bun run render-celldl OUT_DIR SPEC.json [SPEC.json ...]')
    process.exit(1)
}
const chrome = process.env.CHROME || 'google-chrome'
const port = Number(process.env.RENDER_PORT || 5198)
const specDir = 'app/render-specs'      // served by Vite (gitignored)

mkdirSync(outDir, { recursive: true })
mkdirSync(specDir, { recursive: true })

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

function dumpDom(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=60000',
                                     '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'] })
        let dom = ''
        child.stdout.on('data', (data: Buffer) => { dom += data.toString() })
        child.on('exit', code => code === 0 ? resolve(dom) : reject(new Error(`${chrome} exited (${code})`)))
    })
}

let failed = 0
try {
    for (const spec of specs) {
        const name = basename(spec, '.json')
        copyFileSync(spec, join(specDir, `${name}.json`))
        const dom = await dumpDom(`http://localhost:${port}/render-celldl.html?spec=/render-specs/${name}.json`)
        const encoded = dom.match(/<body[^>]*\sdata-celldl="([A-Za-z0-9+/=]+)"/)
        if (!encoded?.[1]) {
            console.error(`${name}: not rendered (see the page's console)`)
            failed += 1
            continue
        }
        const out = join(outDir, `${name}.celldl.svg`)
        writeFileSync(out, Buffer.from(encoded[1], 'base64').toString('utf8'))
        console.log(`${name}: ${out}`)
    }
} finally {
    vite.kill()
    rmSync(specDir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
