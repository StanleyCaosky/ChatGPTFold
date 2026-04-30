export interface Config {
  enabled: boolean;
  autoCollapseEnabled: boolean;
  collapsedLines: number;

  // Height-first rules (primary)
  minViewportRatioToCollapse: number;
  minRenderedHeightToCollapsePx: number;
  minCodeBlockViewportRatioToCollapse: number;
  minTotalCodeBlockViewportRatioToCollapse: number;

  // Text fallback (secondary)
  minCharsToCollapse: number;

  recentCount: number;
  pauseNearTop: boolean;
  showStatusBadge: boolean;
  experimentalContainmentEnabled: boolean;
}

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  autoCollapseEnabled: true,
  collapsedLines: 3,
  minViewportRatioToCollapse: 0.65,
  minRenderedHeightToCollapsePx: 700,
  minCodeBlockViewportRatioToCollapse: 0.50,
  minTotalCodeBlockViewportRatioToCollapse: 0.75,
  minCharsToCollapse: 3000,
  recentCount: 20,
  pauseNearTop: true,
  showStatusBadge: true,
  experimentalContainmentEnabled: false,
};
