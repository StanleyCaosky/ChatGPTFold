import { Config } from '../shared/config';
import { loadConfig, onConfigChanged } from '../shared/storage';
import { findThread, findScrollRoot, findTurns } from './selectors';
import { injectStyles, removeStyles } from './styles';
import { getState } from './state';
import { initScheduler, enqueueAll, cancelAll, resume, getQueueSize, enqueue } from './scheduler';
import { processTurn, handleStreamingEnd, scheduleStreamingEndCheck } from './folding';
import { isStreamingActive, getLastAssistantTurn, markStreaming } from './streaming';
import { initBodyObserver, initThreadObserver, disconnectThreadObserver, getCurrentThread } from './observer';
import { initScrollListener, recordError } from './safety';
import { cleanupAll, cleanupPageModifications, clearTransientMarks } from './cleanup';
import { createStatusBadge, updateStatusBadge, removeStatusBadge, getContentStatus } from './statusBadge';
import { initDebug } from './debug';
import {
  cleanupGenealogyUI,
  getLatestGenealogyDiagnostics,
  initGenealogySystem,
  openBranchMapView,
  refreshGenealogyFromStorage,
  setLatestGenealogySnapshot,
} from './conversationGenealogyPanel';
import {
  cleanupGenealogyAutoScan,
  configureGenealogyAutoScan,
  getLastAutoScanAt,
  handleStreamingSettledForGenealogy,
  initGenealogyAutoScan,
  notifyConversationThreadReady,
  runAutoGenealogyScan,
} from './conversationGenealogyAutoScan';
import { PopupMessage, GenealogyStatsResponse } from '../shared/types';
import { loadGenealogyGraph } from './conversationGenealogyStore';
import { getCurrentConversation, scanSidebarCatalog } from './conversationGenealogyScanner';
import { debugError, debugLog } from './logger';
import { cleanupConversationDeletionObserver, initConversationDeletionObserver } from './conversationDeletionObserver';
import {
  ensureActiveContentScript,
  registerDisposeCallback,
  safeStorageSet,
} from './extensionContext';

let config: Config | null = null;
let streamingWasActive = false;
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
let streamingInterval: ReturnType<typeof setInterval> | null = null;

function trackTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    pendingTimeouts.delete(timer);
    if (!ensureActiveContentScript()) return;
    callback();
  }, delay);
  pendingTimeouts.add(timer);
  return timer;
}

function clearTrackedTimeouts(): void {
  for (const timer of pendingTimeouts) {
    clearTimeout(timer);
  }
  pendingTimeouts.clear();
}

registerDisposeCallback(() => {
  clearTrackedTimeouts();
  if (streamingInterval) {
    clearInterval(streamingInterval);
    streamingInterval = null;
  }
});

async function main(): Promise<void> {
  if (!ensureActiveContentScript()) return;
  config = await loadConfig();
  if (!config.enabled) return;

  const state = getState();
  state.enabled = true;

  initScheduler((turnEl) => {
    if (!ensureActiveContentScript()) return;
    if (!config) return;
    try {
      processTurn(turnEl, config);
    } catch (err) {
      debugError('[LongConv] Error processing turn:', err);
      recordError(err as Error);
    }
    updateStatusBadge();
  });

  initBodyObserver(onThreadFound, onThreadLost);
  onConfigChanged(handleConfigChanged);
  handleStreamingPolling();
  handleMessages();

  if (config.showStatusBadge) {
    createStatusBadge();
  }

  initDebug();
  initConversationDeletionObserver();
  initGenealogyAutoScan(config, (diagnostics) => {
    if (!config) return;
    loadGenealogyGraph().then(({ graph }) => {
      if (!ensureActiveContentScript()) return;
      const sidebarCatalog = scanSidebarCatalog();
      const currentConversation = getCurrentConversation(sidebarCatalog);
      setLatestGenealogySnapshot(graph, diagnostics, sidebarCatalog, currentConversation);
    }).catch((error) => {
      debugLog('[LongConv] snapshot refresh failed', error);
      // Ignore snapshot refresh failures.
    });
  });
}

function onThreadFound(thread: HTMLElement): void {
  if (!ensureActiveContentScript()) return;
  if (!config || getState().hardDisabled) return;

  injectStyles();
  initThreadObserver(thread);
  initScrollListener(thread);

  // Clear stale marks from previous runs before scanning
  clearTransientMarks();

  const turns = findTurns(thread);
  debugLog('[LongConv] initial turns found', () => ({ turns: turns.length }));
  enqueueAll(turns);

  // Delayed rescans to catch DOM stabilization after ChatGPT loads
  trackTimeout(() => {
    if (!config || getState().hardDisabled) return;
    const t = findTurns(thread);
    debugLog('[LongConv] delayed rescan (500ms)', () => ({ turns: t.length }));
    enqueueAll(t);
    updateStatusBadge();
  }, 500);
  trackTimeout(() => {
    if (!config || getState().hardDisabled) return;
    const t = findTurns(thread);
    debugLog('[LongConv] delayed rescan (1500ms)', () => ({ turns: t.length }));
    enqueueAll(t);
    updateStatusBadge();
  }, 1500);

  // Initialize conversation genealogy system
  initGenealogySystem();
  notifyConversationThreadReady();
}

function onThreadLost(): void {
  if (!ensureActiveContentScript()) return;
  cleanupPageModifications();
  cleanupGenealogyUI();
  updateStatusBadge();
}

function handleConfigChanged(newConfig: Config): void {
  if (!ensureActiveContentScript()) return;
  config = newConfig;
  const state = getState();
  state.enabled = newConfig.enabled;

  if (!newConfig.enabled) {
    cleanupAll();
    cleanupGenealogyUI();
    cleanupGenealogyAutoScan();
    cleanupConversationDeletionObserver();
    removeStyles();
    removeStatusBadge();
    return;
  }

  configureGenealogyAutoScan(newConfig);

  if (newConfig.showStatusBadge) {
    createStatusBadge();
  } else {
    removeStatusBadge();
  }

  const thread = getCurrentThread();
  if (thread) {
    const turns = findTurns(thread);
    enqueueAll(turns);
  }

  updateStatusBadge();
}

function handleStreamingPolling(): void {
  streamingInterval = setInterval(() => {
    if (!ensureActiveContentScript()) return;
    if (!config || getState().hardDisabled) return;

    const active = isStreamingActive();

    if (active && !streamingWasActive) {
      const lastTurn = getLastAssistantTurn();
      if (lastTurn) markStreaming(lastTurn);
    }

    if (!active && streamingWasActive) {
      const lastTurn = getLastAssistantTurn();
      if (lastTurn) {
        scheduleStreamingEndCheck(lastTurn, config);
        // Update badge after streaming end check completes
        trackTimeout(() => updateStatusBadge(), 2000);
      }
      handleStreamingSettledForGenealogy();
    }

    streamingWasActive = active;
  }, 500);
}

function handleMessages(): void {
  chrome.runtime.onMessage.addListener(
    (msg: PopupMessage, _sender, sendResponse) => {
      if (!ensureActiveContentScript()) {
        sendResponse({ ok: false, error: 'Extension context invalidated.' });
        return false;
      }

      if (msg.type === 'GET_STATUS') {
        sendResponse(getContentStatus());
        return true;
      }

      if (msg.type === 'CLEANUP_ALL') {
        cleanupAll();
        updateStatusBadge();
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'REINITIALIZE') {
        cleanupAll({ keepBodyObserver: true });
        const thread = findThread();
        if (thread) onThreadFound(thread);
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'DISABLE_PLUGIN') {
        cleanupAll();
        const state = getState();
        state.enabled = false;
        void safeStorageSet({ longconv_config: { enabled: false } });
        updateStatusBadge();
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'OPEN_BRANCH_MAP') {
        openBranchMapView()
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed to open Branch Map.' }));
        return true;
      }

      if (msg.type === 'RUN_GENEALOGY_SCAN') {
        runAutoGenealogyScan('manual')
          .then(async (result) => {
            const diagnostics = result?.diagnostics ?? getLatestGenealogyDiagnostics();
            const graph = result?.graph ?? (await loadGenealogyGraph()).graph;
            sendResponse({
              currentConversationId: diagnostics?.currentConversationId ?? getCurrentConversation(scanSidebarCatalog()).conversationId,
              markerFound: !!diagnostics?.parentMarker.text,
              graphChanged: !!result?.graphChanged,
              edgeCount: graph.edges.length,
            });
          })
          .catch((error) => {
            sendResponse({
              currentConversationId: getCurrentConversation(scanSidebarCatalog()).conversationId,
              markerFound: false,
              graphChanged: false,
              edgeCount: 0,
              error: error instanceof Error ? error.message : 'Scan failed.',
            });
          });
        return true;
      }

      if (msg.type === 'GET_GENEALOGY_STATS') {
        loadGenealogyGraph()
          .then(({ graph }) => {
            const response: GenealogyStatsResponse = {
              nodeCount: Object.keys(graph.nodes).length,
              edgeCount: graph.edges.length,
              staleNodeCount: Object.values(graph.nodes).filter((node) => !node.deletedAt && (node.stale || node.missing)).length,
              deletedNodeCount: Object.values(graph.nodes).filter((node) => !!node.deletedAt).length,
              unresolvedNodeCount: Object.values(graph.nodes).filter((node) => node.unresolved).length,
              currentConversationId: graph.currentConversationId ?? 'unknown',
              lastAutoScanAt: getLastAutoScanAt(),
            };
            sendResponse(response);
          })
          .catch(() => {
            sendResponse({
              nodeCount: 0,
              edgeCount: 0,
              staleNodeCount: 0,
              deletedNodeCount: 0,
              unresolvedNodeCount: 0,
              currentConversationId: 'unknown',
              lastAutoScanAt: getLastAutoScanAt(),
            } as GenealogyStatsResponse);
          });
        return true;
      }

      if (msg.type === 'GET_GENEALOGY_DIAGNOSTICS') {
        sendResponse(getLatestGenealogyDiagnostics());
        return true;
      }

      if (msg.type === 'GENEALOGY_STORAGE_UPDATED') {
        refreshGenealogyFromStorage()
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      return false;
    }
  );
}

main().catch((err) => {
  debugError('[LongConv] Failed to initialize:', err);
});
