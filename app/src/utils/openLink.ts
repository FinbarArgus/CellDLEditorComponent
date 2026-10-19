// Opening a document given in the editor's URL: `?open=<keyword>#<data>`, where <keyword> names the kind of data in the
// hash. `?open=celldl#<base64>` is a CellDL document, as the base64 (standard or base64url) of its UTF-8 bytes.

export type OpenLinkHandler = (data: string) => void | Promise<void>

export type OpenLinkHandlers = Record<string, OpenLinkHandler>

// The parts of `window.location` and `window.history` that loading from a link uses
export type LinkLocation = Pick<Location, 'hash' | 'pathname' | 'search'>
export type LinkHistory = Pick<History, 'replaceState'>

// The UTF-8 text whose bytes `encoded` is the base64 (or base64url) of; throws an Error if it is not
export function decodeBase64Text(encoded: string): string {
    let base64 = decodeURIComponent(encoded).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.replace(/=+$/, '').length % 4 === 1) {
        throw new Error('the link is not base64')
    }
    base64 = base64.replace(/=+$/, '')
    base64 += '='.repeat((4 - (base64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        throw new Error('the link is not UTF-8 text')
    }
}

// The CellDL document in a `?open=celldl` link's hash; throws an Error if it is not one
export function decodeCellDLLink(encoded: string): string {
    const celldl = decodeBase64Text(encoded)
    if (!/<svg[\s>]/.test(celldl)) {
        throw new Error('the link is not a CellDL document')
    }
    return celldl
}

function normaliseKeyword(open: string | null): string {
    return open?.replace(/\/+$/, '').toLowerCase() ?? ''
}

// Opens the document in the URL's hash with the handler named by its `open` parameter, then clears the hash (so
// reloading does not open it again; a link that fails to open is left to retry). Does nothing when the URL has no
// hash or no `open` parameter. An unknown keyword, or a handler that throws, is reported to `onError`. Returns
// whether a document was opened.
export async function loadFromLink(
    handlers: OpenLinkHandlers,
    onError: (message: string) => void,
    location: LinkLocation = window.location,
    history: LinkHistory = window.history
): Promise<boolean> {
    const open = new URLSearchParams(location.search).get('open')
    const data = location.hash.slice(1)
    if (open === null || !data) {
        return false
    }
    const handler = handlers[normaliseKeyword(open)]
    if (!handler) {
        onError(`Don't know how to open "${open}".`)
        return false
    }
    try {
        await handler(data)
    } catch (err) {
        onError(`Cannot open the document in the link: ${err instanceof Error ? err.message : String(err)}`)
        return false
    }
    history.replaceState(null, '', location.pathname)
    return true
}
