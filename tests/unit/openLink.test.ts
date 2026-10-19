import { describe, expect, test } from 'bun:test'

import { decodeBase64Text, decodeCellDLLink, loadFromLink } from '../../app/src/utils/openLink'

const CELLDL = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><title>Na⁺ ⇌ K⁺</title></svg>'

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')
const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

describe('decodeBase64Text', () => {
    test('decodes the UTF-8 bytes of standard base64', () => {
        expect(decodeBase64Text(base64(CELLDL))).toBe(CELLDL)
    })

    test('decodes base64url, without its padding', () => {
        const text = `${CELLDL}??>>`   // bytes whose base64 has + and /
        expect(base64(text)).toMatch(/[+/]/)
        expect(decodeBase64Text(base64url(text))).toBe(text)
    })

    test('decodes percent-encoded base64', () => {
        expect(decodeBase64Text(encodeURIComponent(base64(`${CELLDL}??>>`)))).toBe(`${CELLDL}??>>`)
    })

    test('rejects text that is not base64', () => {
        expect(() => decodeBase64Text('not base64!')).toThrow('not base64')
        expect(() => decodeBase64Text('abcde')).toThrow('not base64')
    })

    test('rejects bytes that are not UTF-8', () => {
        expect(() => decodeBase64Text(Buffer.from([0xff, 0xfe, 0x00]).toString('base64'))).toThrow('not UTF-8')
    })
})

describe('decodeCellDLLink', () => {
    test('returns the CellDL document', () => {
        expect(decodeCellDLLink(base64(CELLDL))).toBe(CELLDL)
    })

    test('rejects text that is not an SVG document', () => {
        expect(() => decodeCellDLLink(base64('hello'))).toThrow('not a CellDL document')
    })
})

function page(search: string, hash: string) {
    const replaced: string[] = []
    return {
        location: { search, hash, pathname: '/CellDLEditorComponent/' },
        history: { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
            replaced.push(String(url))
        } },
        replaced
    }
}

describe('loadFromLink', () => {
    test('opens a celldl link with its handler and clears the hash', async () => {
        const { location, history, replaced } = page('?open=celldl', `#${base64(CELLDL)}`)
        const opened: string[] = []
        const errors: string[] = []
        const handlers = { celldl: (data: string) => { opened.push(decodeCellDLLink(data)) } }
        expect(await loadFromLink(handlers, e => errors.push(e), location, history)).toBe(true)
        expect(opened).toEqual([CELLDL])
        expect(errors).toEqual([])
        expect(replaced).toEqual(['/CellDLEditorComponent/'])
    })

    test('accepts the keyword in any case, with a trailing slash', async () => {
        const { location, history } = page('?open=CellDL/', `#${base64(CELLDL)}`)
        const opened: string[] = []
        expect(await loadFromLink({ celldl: d => { opened.push(d) } }, () => {}, location, history)).toBe(true)
        expect(opened.length).toBe(1)
    })

    test('reports an unknown keyword and keeps the hash', async () => {
        const { location, history, replaced } = page('?open=omex', `#${base64(CELLDL)}`)
        const errors: string[] = []
        expect(await loadFromLink({ celldl: () => {} }, e => errors.push(e), location, history)).toBe(false)
        expect(errors).toEqual(['Don\'t know how to open "omex".'])
        expect(replaced).toEqual([])
    })

    test('reports bad data and keeps the hash', async () => {
        const { location, history, replaced } = page('?open=celldl', '#%%%')
        const errors: string[] = []
        const handlers = { celldl: (data: string) => { decodeCellDLLink(data) } }
        expect(await loadFromLink(handlers, e => errors.push(e), location, history)).toBe(false)
        expect(errors.length).toBe(1)
        expect(errors[0]).toStartWith('Cannot open the document in the link: ')
        expect(replaced).toEqual([])
    })

    test('does nothing without an open parameter or a hash', async () => {
        const errors: string[] = []
        let called = false
        const handlers = { celldl: () => { called = true } }
        for (const [search, hash] of [['', `#${base64(CELLDL)}`], ['?open=celldl', ''], ['?open=celldl', '#']]) {
            const { location, history } = page(search, hash)
            expect(await loadFromLink(handlers, e => errors.push(e), location, history)).toBe(false)
        }
        expect(called).toBe(false)
        expect(errors).toEqual([])
    })
})
