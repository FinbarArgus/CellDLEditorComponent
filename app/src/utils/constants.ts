export const SHORT_DELAY = 69
export const MEDIUM_DELAY = 169
export const LONG_DELAY = 369

export const TOAST_LIFE = 3000

const crtYear = new Date().getFullYear()

export const COPYRIGHT = crtYear === 2025 ? '2025' : `2025-${String(crtYear)}`

// After the editor reports ready, before opening a file given as ?open=<url> (its component is still mounting)
export const OPEN_URL_DELAY = 500
