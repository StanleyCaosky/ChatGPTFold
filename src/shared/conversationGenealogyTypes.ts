export type Confidence = 'high' | 'medium' | 'low';

export type ConversationIdSource =
  | 'current-url'
  | 'sidebar-url'
  | 'placeholder'
  | 'synthetic'
  | 'unknown';

export interface ConversationNode {
  conversationId: string;
  idSource?: ConversationIdSource;
  title: string;
  url: string;
  normalizedTitle: string;
  aliases?: string[];
  parentConversationId?: string;
  parentTitleFromMarker?: string;
  source: 'current-page' | 'sidebar' | 'native-marker' | 'manual' | 'placeholder' | 'metadata';
  firstSeenAt: number;
  lastSeenAt: number;
  isCurrent?: boolean;
  connected?: boolean;
  unresolved?: boolean;
  stale?: boolean;
  missing?: boolean;
  invalid?: boolean;
  label?: string;
  note?: string;
}

export interface ConversationEdge {
  fromConversationId: string;
  toConversationId: string;
  fromTitle?: string;
  toTitle?: string;
  source: 'native-marker' | 'manual' | 'inferred-title-match';
  markerText?: string;
  confidence: Confidence;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationGenealogyGraph {
  schemaVersion: number;
  nodes: Record<string, ConversationNode>;
  edges: ConversationEdge[];
  currentConversationId?: string;
  updatedAt: number;
}

export interface SidebarCatalogEntry {
  conversationId: string;
  title: string;
  url: string;
  normalizedTitle: string;
  lastSeenAt: number;
  idSource: 'sidebar-url';
  isCurrent: boolean;
}

export interface CurrentConversation {
  valid: boolean;
  conversationId: string;
  title: string;
  url: string;
  normalizedTitle: string;
  idSource: 'current-url' | 'unknown';
}

export interface ParentMarker {
  parentTitle: string;
  markerText: string;
  confidence: Confidence;
  elementTag?: string;
  elementClass?: string;
}

export interface HydratedConversationNode {
  conversationId: string;
  title: string;
  normalizedTitle: string;
  url: string;
  idSource: ConversationIdSource;
  aliases: string[];
  source: ConversationNode['source'];
  firstSeenAt: number;
  lastSeenAt: number;
  isCurrent: boolean;
  unresolved: boolean;
  stale: boolean;
  missing: boolean;
  invalid: boolean;
  label?: string;
  note?: string;
}

export interface GenealogyDiagnostics {
  currentConversationId: string;
  currentTitle: string;
  sidebarCatalogCount: number;
  renderableNodeCount: number;
  totalStoredNodeCount: number;
  edgeCount: number;
  unresolvedCount: number;
  parentMarker: {
    text: string;
    parentTitle: string;
    confidence: string;
    rejectedReason: string;
  };
  parentResolution: {
    resolvedParentId: string;
    resolvedParentTitle: string;
    matchType: string;
    duplicateCount: number;
  };
  renameInfo: {
    nodeConversationId: string;
    currentTitle: string;
    previousAliases: string[];
    titleChanged: boolean;
  };
  placeholderMerge: {
    placeholdersBefore: number;
    placeholdersMerged: number;
    placeholdersAfter: number;
    mergeDetails: string[];
  };
  ghostCleanup: {
    removedGhostsCount: number;
    removedGhostTitles: string[];
    skippedProtectedGhosts: string[];
  };
  autoBranchGhosts: {
    detectedCount: number;
    titles: string[];
    mergedCount: number;
    removedCount: number;
    mergeDetails: string[];
    skippedReasons: string[];
  };
  migration: {
    migrated: boolean;
    droppedLegacyNodes: number;
    droppedLegacyEdges: number;
  };
  errors: string[];
}

export interface GenealogyUpdateResult {
  graph: ConversationGenealogyGraph;
  diagnostics: GenealogyDiagnostics;
  sidebarCatalog: SidebarCatalogEntry[];
  currentConversation: CurrentConversation;
}
