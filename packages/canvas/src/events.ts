// Centralized event names for the window event bus between Canvas components.
// Using constants prevents typos and makes event usage grep-friendly.

export const CANVAS_EVENTS = {
  CONTEXT_MENU: 'canvasContextMenu',
  OPEN_NODE_CONFIG: 'openNodeConfig',
  VIEW_UPDATED: 'canvasViewUpdated',
  SAVE: 'canvasSave',
  GENERATE: 'canvasGenerate',
  OPEN_FILE: 'openFile',
} as const;
