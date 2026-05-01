export const LONGCONV_PREFIX = 'longconv-';

export const DATA_ATTRS = {
  checked: 'data-longconv-checked',
  collapsible: 'data-longconv-collapsible',
  collapsed: 'data-longconv-collapsed',
  processing: 'data-longconv-processing',
  content: 'data-longconv-content',
  inserted: 'data-longconv-inserted',
  streaming: 'data-longconv-streaming',
  contained: 'data-longconv-contained',
  skip: 'data-longconv-skip',
} as const;

export const CLASS_NAMES = {
  collapsed: 'longconv-collapsed',
  toggleWrap: 'longconv-toggle-wrap',
  toggleBtn: 'longconv-toggle-btn',
  topToggle: 'longconv-top-toggle',
  bottomToggle: 'longconv-bottom-toggle',
  topToggleBtn: 'longconv-top-toggle-btn',
  bottomToggleBtn: 'longconv-bottom-toggle-btn',
  userBubbleRoot: 'longconv-user-bubble-root',
  userCollapseTarget: 'longconv-user-collapse-target',
  userCollapsed: 'longconv-user-collapsed',
  userInlineToggle: 'longconv-user-inline-toggle',
  userInlineToggleBtn: 'longconv-user-inline-toggle-btn',
  badge: 'longconv-status-badge',
  branchMapBtn: 'longconv-branch-map-btn',
  branchPanel: 'longconv-branch-panel',
  branchPanelHeader: 'longconv-branch-panel-header',
  branchPanelTitle: 'longconv-branch-panel-title',
  branchPanelClose: 'longconv-branch-panel-close',
  branchRecordBtn: 'longconv-branch-record-btn',
  branchTree: 'longconv-branch-tree',
  branchRow: 'longconv-branch-row',
  branchRowActive: 'longconv-branch-row-active',
  branchRowLabel: 'longconv-branch-row-label',
  branchRowMeta: 'longconv-branch-row-meta',
  branchEmpty: 'longconv-branch-empty',
  branchRowContent: 'longconv-branch-row-content',
  branchToggle: 'longconv-branch-toggle',
  branchTreeHint: 'longconv-branch-tree-hint',
  branchMapViewBtn: 'longconv-branch-map-view-btn',
  branchMapModal: 'longconv-branch-map-modal',
  branchMapBackdrop: 'longconv-branch-map-backdrop',
  branchMapCard: 'longconv-branch-map-card',
  branchMapCanvas: 'longconv-branch-map-canvas',
  branchMapNode: 'longconv-branch-map-node',
  branchMapChildren: 'longconv-branch-map-children',
} as const;

export const STYLE_ELEMENT_ID = 'longconv-styles';

export const DEBOUNCE_REINIT_MS = 400;
export const DEBOUNCE_STREAMING_MS = 1500;
export const MAX_CORE_ERRORS = 5;
export const ERROR_WINDOW_MS = 30000;
export const CONTAINMENT_ERROR_THRESHOLD = 3;
export const NEAR_TOP_THRESHOLD_PX = 1200;
export const NEAR_VIEWPORT_MARGIN_PX = 500;
export const DEFAULT_BATCH_SIZE = 5;
export const PAUSED_BATCH_SIZE = 2;
