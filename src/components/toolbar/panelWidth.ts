/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

// The width of the right-hand panels (Reactions, Annotations, ...): one width for all of them, set by dragging a
// panel's left edge and kept in the browser's storage.

import * as vue from 'vue'

export const MIN_PANEL_WIDTH = 250
const LEFT_MARGIN = 120             // of the diagram left showing beside the widest panel
const STORAGE_KEY = 'celldl-panel-width'

/** A width kept between the narrowest panel and the window, less a margin of diagram. */
export function clampPanelWidth(width: number, windowWidth: number): number {
    return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(width, windowWidth - LEFT_MARGIN)))
}

function storedWidth(): number {
    try {
        const width = Number(localStorage.getItem(STORAGE_KEY))
        return width >= MIN_PANEL_WIDTH ? width : MIN_PANEL_WIDTH
    } catch {
        return MIN_PANEL_WIDTH
    }
}

export const panelWidth = vue.ref(storedWidth())

export function savePanelWidth(width: number) {
    try {
        localStorage.setItem(STORAGE_KEY, String(width))
    } catch {}
}
