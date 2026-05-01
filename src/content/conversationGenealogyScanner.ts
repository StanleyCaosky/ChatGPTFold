import {
  ConversationNode,
  CurrentConversation,
  GenealogyDiagnostics,
  GenealogyUpdateResult,
  ParentMarker,
  SidebarCatalogEntry,
} from '../shared/conversationGenealogyTypes';
import {
  cleanupGenealogyGraph,
  createEmptyGenealogyGraph,
  hydrateNode,
  isValidConversationUrl,
  loadGenealogyGraph,
  makePlaceholderId,
  normalizeTitle,
  resolveParentTitle,
  resolvePlaceholders,
  saveGenealogyGraph,
  upsertConversationEdge,
  upsertConversationNode,
  type ConversationGenealogyGraph,
} from './conversationGenealogyStore';

export function extractCurrentConversationId(): string {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

export function extractCurrentTitle(): string {
  const current = getCurrentConversation();
  return current.title;
}

export function scanSidebarCatalog(): SidebarCatalogEntry[] {
  const links: SidebarCatalogEntry[] = [];
  const seen = new Set<string>();
  const currentId = extractCurrentConversationId();
  const now = Date.now();
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]');

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') ?? '';
    const match = href.match(/\/c\/([^/?#]+)/);
    if (!match) continue;

    const conversationId = match[1];
    if (seen.has(conversationId)) continue;
    seen.add(conversationId);

    const title = cleanLinkText(anchor);
    if (!title) continue;

    const url = normalizeUrl(href);
    if (!isValidConversationUrl(url)) continue;

    links.push({
      conversationId,
      title,
      url,
      normalizedTitle: normalizeTitle(title),
      lastSeenAt: now,
      idSource: 'sidebar-url',
      isCurrent: conversationId === currentId,
    });
  }

  return links;
}

export function scanSidebarConversations(): SidebarCatalogEntry[] {
  return scanSidebarCatalog();
}

export function getCurrentConversation(catalog: SidebarCatalogEntry[] = scanSidebarCatalog()): CurrentConversation {
  const conversationId = extractCurrentConversationId();
  const valid = conversationId !== 'unknown';
  const sidebarCurrent = catalog.find((entry) => entry.conversationId === conversationId);
  const docTitle = document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
  const title = sidebarCurrent?.title || (docTitle && docTitle !== 'ChatGPT' ? docTitle : conversationId);
  const url = valid ? `${location.origin}/c/${conversationId}` : '';

  return {
    valid,
    conversationId,
    title,
    url,
    normalizedTitle: normalizeTitle(title),
    idSource: valid ? 'current-url' : 'unknown',
  };
}

function cleanLinkText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('svg, button, [class*="icon"]').forEach((entry) => entry.remove());
  const text = clone.textContent?.trim() ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeUrl(href: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `${location.origin}${href}`;
  return `${location.origin}/${href}`;
}

const MARKER_RE_ZH = /^从\s*(.+?)\s*(建立|创建|分出)的分支\s*$/;
const MARKER_RE_EN = /^(?:branch\s+created\s+from|created\s+from|forked\s+from|branched\s+from)\s+(.+?)\s*$/i;

export function extractConversationParentMarker(): ParentMarker | null {
  const main = document.getElementById('thread') ?? document.querySelector('main') ?? document.body;
  if (!main) return null;

  const allElements = main.querySelectorAll<HTMLElement>('div, span, p, h1, h2, h3, h4, h5, h6, li, td, th, section, article, aside, header, footer');
  let bestCandidate: ParentMarker | null = null;

  for (const el of allElements) {
    if (el.hasAttribute('data-longconv-inserted')) continue;
    if (el.children.length > 3) continue;

    const rawText = el.textContent?.trim() ?? '';
    if (!rawText || rawText.length > 150 || rawText.length < 5) continue;
    if (el.closest('pre, code')) continue;
    if (el.querySelector('pre, code')) continue;

    const match = rawText.match(MARKER_RE_ZH) ?? rawText.match(MARKER_RE_EN);
    if (!match) continue;

    const parentTitle = match[1].trim();
    if (!parentTitle) continue;

    const inTurn = !!el.closest('[data-testid^="conversation-turn-"]');
    const separatorLike = isSeparatorElement(el);
    if (!inTurn || separatorLike) {
      return {
        parentTitle,
        markerText: rawText,
        confidence: inTurn ? 'medium' : 'high',
        elementTag: el.tagName,
        elementClass: el.className?.substring(0, 60) ?? '',
      };
    }

    if (!bestCandidate) {
      bestCandidate = {
        parentTitle,
        markerText: rawText,
        confidence: 'low',
        elementTag: el.tagName,
        elementClass: el.className?.substring(0, 60) ?? '',
      };
    }
  }

  return bestCandidate;
}

function isSeparatorElement(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height > 0 && rect.height < 80 && rect.width > 200) return true;
  const text = el.textContent?.trim() ?? '';
  if (text.length < 60) return true;
  const cls = el.className?.toLowerCase() ?? '';
  return cls.includes('separator') || cls.includes('divider') || cls.includes('branch') || cls.includes('fork') || cls.includes('indicator');
}

export async function updateConversationGenealogy(): Promise<GenealogyUpdateResult> {
  const loaded = await loadGenealogyGraph();
  const graph = loaded.graph;
  const migration = loaded.migration;
  const errors: string[] = [];
  const sidebarCatalog = scanSidebarCatalog();
  const currentConversation = getCurrentConversation(sidebarCatalog);

  if (!graph.schemaVersion) {
    Object.assign(graph, createEmptyGenealogyGraph());
  }

  for (const node of Object.values(graph.nodes)) {
    node.isCurrent = false;
    if (node.idSource === 'sidebar-url') {
      node.missing = true;
      node.stale = true;
    }
  }

  for (const entry of sidebarCatalog) {
    const existing = graph.nodes[entry.conversationId];
    upsertConversationNode(graph, {
      conversationId: entry.conversationId,
      idSource: 'sidebar-url',
      title: entry.title,
      url: entry.url,
      normalizedTitle: entry.normalizedTitle,
      source: entry.isCurrent ? 'current-page' : 'sidebar',
      firstSeenAt: existing?.firstSeenAt ?? Date.now(),
      lastSeenAt: entry.lastSeenAt,
      aliases: existing?.aliases ?? [],
      label: existing?.label,
      note: existing?.note,
      parentConversationId: existing?.parentConversationId,
      parentTitleFromMarker: existing?.parentTitleFromMarker,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: false,
    });

    const merged = resolvePlaceholders(graph, entry.conversationId, entry.title);
    if (merged) errors.push(`Resolved placeholder for "${entry.title}" -> ${entry.conversationId}`);
  }

  const previousNode = currentConversation.valid ? graph.nodes[currentConversation.conversationId] : undefined;
  const previousTitle = previousNode?.title ?? '';
  const previousAliases = previousNode?.aliases ?? [];

  if (currentConversation.valid) {
    graph.currentConversationId = currentConversation.conversationId;
    upsertConversationNode(graph, {
      conversationId: currentConversation.conversationId,
      idSource: 'current-url',
      title: currentConversation.title,
      url: currentConversation.url,
      normalizedTitle: currentConversation.normalizedTitle,
      source: 'current-page',
      firstSeenAt: previousNode?.firstSeenAt ?? Date.now(),
      lastSeenAt: Date.now(),
      aliases: previousAliases,
      parentConversationId: previousNode?.parentConversationId,
      parentTitleFromMarker: previousNode?.parentTitleFromMarker,
      label: previousNode?.label,
      note: previousNode?.note,
      isCurrent: true,
      unresolved: false,
      stale: false,
      missing: false,
      invalid: false,
    });
  } else {
    graph.currentConversationId = undefined;
  }

  const marker = extractConversationParentMarker();
  let parentTitleFromMarker = '';
  let resolvedParentId = '';
  let resolvedParentTitle = '';
  let matchType = 'none';
  let duplicateCount = 0;
  let markerRejectedReason = '';

  if (marker && currentConversation.valid) {
    parentTitleFromMarker = marker.parentTitle;
    const currentNode = graph.nodes[currentConversation.conversationId];
    currentNode.parentTitleFromMarker = marker.parentTitle;

    if (marker.confidence === 'low') {
      markerRejectedReason = 'marker rejected because inside conversation content and not separator-like';
      errors.push(markerRejectedReason);
    } else {
      const resolution = resolveParentTitle(graph, marker.parentTitle, sidebarCatalog);
      resolvedParentId = resolution.conversationId ?? '';
      matchType = resolution.matchType ?? 'none';
      duplicateCount = resolution.duplicateCount ?? 0;
      if (resolution.error) errors.push(resolution.error);

      if (resolution.conversationId) {
        currentNode.parentConversationId = resolution.conversationId;
        resolvedParentTitle = graph.nodes[resolution.conversationId]?.title ?? marker.parentTitle;
        upsertConversationEdge(graph, {
          fromConversationId: resolution.conversationId,
          toConversationId: currentConversation.conversationId,
          fromTitle: resolvedParentTitle,
          toTitle: currentConversation.title,
          source: 'native-marker',
          markerText: marker.markerText,
          confidence: marker.confidence,
        });
      } else {
        const placeholderId = makePlaceholderId(normalizeTitle(marker.parentTitle));
        upsertConversationNode(graph, {
          conversationId: placeholderId,
          idSource: 'placeholder',
          title: marker.parentTitle,
          url: '',
          normalizedTitle: normalizeTitle(marker.parentTitle),
          source: 'placeholder',
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          aliases: [],
          unresolved: true,
          missing: false,
          stale: false,
          invalid: false,
        });
        currentNode.parentConversationId = placeholderId;
        resolvedParentId = placeholderId;
        resolvedParentTitle = marker.parentTitle;
        matchType = 'placeholder';
        upsertConversationEdge(graph, {
          fromConversationId: placeholderId,
          toConversationId: currentConversation.conversationId,
          fromTitle: marker.parentTitle,
          toTitle: currentConversation.title,
          source: 'native-marker',
          markerText: marker.markerText,
          confidence: marker.confidence,
        });
      }
    }
  } else if (!marker) {
    markerRejectedReason = 'no strict marker found';
  }

  const cleanup = cleanupGenealogyGraph(graph, {
    catalog: sidebarCatalog,
    currentConversation,
  });

  await saveGenealogyGraph(graph);

  const renderableNodeCount = getRenderableNodes(graph, sidebarCatalog, currentConversation).length;
  const unresolvedCount = Object.values(graph.nodes).filter((node) => node.unresolved).length;
  const currentNode = currentConversation.valid ? hydrateNode(currentConversation.conversationId, { catalog: sidebarCatalog, currentConversation }, graph) : null;

  const diagnostics: GenealogyDiagnostics = {
    currentConversationId: currentConversation.conversationId,
    currentTitle: currentConversation.title,
    sidebarCatalogCount: sidebarCatalog.length,
    renderableNodeCount,
    totalStoredNodeCount: Object.keys(graph.nodes).length,
    edgeCount: graph.edges.length,
    unresolvedCount,
    parentMarker: {
      text: marker?.markerText ?? '',
      parentTitle: parentTitleFromMarker,
      confidence: marker?.confidence ?? '',
      rejectedReason: markerRejectedReason,
    },
    parentResolution: {
      resolvedParentId,
      resolvedParentTitle,
      matchType,
      duplicateCount,
    },
    renameInfo: {
      nodeConversationId: currentConversation.conversationId,
      currentTitle: currentNode?.title ?? currentConversation.title,
      previousAliases: currentNode?.aliases ?? [],
      titleChanged: !!previousTitle && previousTitle !== (currentNode?.title ?? currentConversation.title),
    },
    placeholderMerge: {
      placeholdersBefore: cleanup.placeholdersBefore,
      placeholdersMerged: cleanup.placeholdersMerged,
      placeholdersAfter: cleanup.placeholdersAfter,
      mergeDetails: cleanup.mergeDetails,
    },
    ghostCleanup: {
      removedGhostsCount: cleanup.removedGhostsCount,
      removedGhostTitles: cleanup.removedGhostTitles,
      skippedProtectedGhosts: cleanup.skippedProtectedGhosts,
    },
    autoBranchGhosts: {
      detectedCount: cleanup.autoBranchGhostDetected.length,
      titles: cleanup.autoBranchGhostDetected,
      mergedCount: cleanup.autoBranchGhostMerged.length,
      removedCount: cleanup.autoBranchGhostRemoved.length,
      mergeDetails: cleanup.autoBranchGhostMerged,
      skippedReasons: cleanup.autoBranchGhostSkipped,
    },
    migration,
    errors,
  };

  return {
    graph,
    diagnostics,
    sidebarCatalog,
    currentConversation,
  };
}

export function getRenderableNodes(
  graph: ConversationGenealogyGraph,
  sidebarCatalog: SidebarCatalogEntry[] = scanSidebarCatalog(),
  currentConversation: CurrentConversation = getCurrentConversation(sidebarCatalog)
): ConversationNode[] {
  const involved = new Set<string>();
  for (const edge of graph.edges) {
    involved.add(edge.fromConversationId);
    involved.add(edge.toConversationId);
  }

  const nodes: ConversationNode[] = [];
  for (const id of involved) {
    const hydrated = hydrateNode(id, { catalog: sidebarCatalog, currentConversation }, graph);
    if (!hydrated || hydrated.invalid) continue;
    if (!hydrated.unresolved && !isValidConversationUrl(hydrated.url) && hydrated.idSource !== 'current-url' && hydrated.idSource !== 'sidebar-url') {
      continue;
    }
    const metadata = graph.nodes[id];
    if (metadata) nodes.push(metadata);
  }
  return nodes;
}
