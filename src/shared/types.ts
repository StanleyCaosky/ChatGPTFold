export type PerformanceMode = 'safe' | 'balanced' | 'aggressive';

export interface OriginalStyleSnapshot {
  contain?: string;
  contentVisibility?: string;
  containIntrinsicSize?: string;
  maxHeight?: string;
  overflow?: string;
  customProperty?: string;
}

export interface ContentStatus {
  enabled: boolean;
  foldedCount: number;
  checkedCount: number;
  paused: boolean;
  pauseReason: string | null;
  failSafeLevel: 0 | 1 | 2;
  errors: number;
}

export type PopupMessage =
  | { type: 'GET_STATUS' }
  | { type: 'CLEANUP_ALL' }
  | { type: 'REINITIALIZE' }
  | { type: 'DISABLE_PLUGIN' };

export type FailSafeLevel = 0 | 1 | 2;

export interface RuntimeState {
  enabled: boolean;
  foldedCount: number;
  checkedCount: number;
  paused: boolean;
  pauseReason: string | null;
  failSafeLevel: FailSafeLevel;
  hardDisabled: boolean;
  manualExpanded: Set<string>;
  coreErrorCount: number;
  recentCoreErrors: number[];
  containmentErrorCount: number;
}
