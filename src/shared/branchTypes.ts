export type NodeRole = 'user' | 'assistant' | 'unknown';

export type Confidence = 'high' | 'medium' | 'low';

export type PathChangeType =
  | 'unchanged'
  | 'tail-extension'
  | 'history-prepend'
  | 'history-expand'
  | 'partial-view'
  | 'divergence';

export type EdgeSource = 'native-marker' | 'path-diff' | 'manual';

export type PathSource =
  | 'root'
  | 'native-marker'
  | 'native-marker-bootstrap'
  | 'path-diff'
  | 'manual';

export interface BranchOrderedItem {
  type: 'turn' | 'marker';
  el: HTMLElement;
  domOrder: number;
  visualTop: number;
  visualCenter: number;
  // turn fields
  nodeId?: string;
  messageId?: string;
  turnKey?: string;
  role?: NodeRole;
  // marker fields
  markerText?: string;
  markerId?: string;
}

export interface BranchMarker {
  markerId: string;
  conversationId: string;
  markerText: string;
  domIndex: number;
  parentAnchorNodeId?: string;
  childStartNodeId?: string;
  confidence: Confidence;
  failReason?: string;
}

export interface BranchRouteStep {
  parentAnchorNodeId: string;
  childStartNodeId: string;
  markerText?: string;
  source: EdgeSource;
  confidence: Confidence;
}

export interface PathNodeSnapshot {
  nodeId: string;
  messageId?: string;
  turnKey?: string;
  role: NodeRole;
  temporary: boolean;
}

export interface PathSnapshot {
  nodeIds: string[];
  nodes: PathNodeSnapshot[];
  temporaryRatio: number;
  isPartial: boolean;
  branchMarkers: BranchMarker[];
}

export interface BranchNode {
  nodeId: string;
  conversationId: string;
  messageId?: string;
  turnKey?: string;
  temporary: boolean;
  role: NodeRole;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface BranchPath {
  pathId: string;
  pathSignature: string;
  conversationId: string;
  nodeIds: string[];
  parentPathId?: string;
  parentAnchorNodeId?: string;
  childStartNodeId?: string;
  divergenceNodeId?: string;
  firstDifferentNodeId?: string;
  markerText?: string;
  source: PathSource;
  routeSteps: BranchRouteStep[];
  confidence: Confidence;
  observedOnly: true;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}

export interface BranchEdge {
  fromPathId: string;
  toPathId: string;
  divergenceNodeId: string;
  firstDifferentNodeId: string;
  source: EdgeSource;
  markerText?: string;
}

export interface BranchGraph {
  schemaVersion: number;
  conversationId: string;
  nodes: Record<string, BranchNode>;
  paths: Record<string, BranchPath>;
  edges: BranchEdge[];
  markers?: Record<string, BranchMarker>;
  activePathId?: string;
  lastObservedPath: string[];
  updatedAt: number;
}

export interface ReconcileOptions {
  manual?: boolean;
  reason?: 'auto' | 'manual' | 'init' | 'mutation';
}

export interface BranchDiagDetail {
  markerText: string;
  parentAnchorNodeId?: string;
  childStartNodeId?: string;
  confidence: Confidence;
  failReason?: string;
}

export interface BranchDiagnostics {
  currentPathLength: number;
  branchMarkerCount: number;
  markers: BranchDiagDetail[];
  pathCount: number;
  edgeCount: number;
  activePathId?: string;
  reconcileErrors: string[];
}
