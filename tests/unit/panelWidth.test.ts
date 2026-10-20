import { describe, expect, test } from 'bun:test'

import { clampPanelWidth, MIN_PANEL_WIDTH } from '../../src/components/toolbar/panelWidth'

describe('the right-hand panels\' width', () => {
    test('dragging wider stops short of the window, narrower at the panel\'s own width', () => {
        expect(clampPanelWidth(600, 1600)).toBe(600)
        expect(clampPanelWidth(5000, 1600)).toBe(1480)
        expect(clampPanelWidth(100, 1600)).toBe(MIN_PANEL_WIDTH)
        expect(clampPanelWidth(400.6, 1600)).toBe(401)
    })
})
