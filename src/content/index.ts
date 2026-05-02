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

let config: Config | null = null;
let streamingWasActive = false;

async function main(): Promise<void> {
  config = await loadConfig();
  if (!config.enabled) return;

  const state = getState();
  state.enabled = true;

  initScheduler((turnEl) => {
    if (!config) return;
    try {
      processTurn(turnEl, config);
    } catch (err) {
      console.error('[LongConv] Error processing turn:', err);
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
  initGenealogyAutoScan(config, (diagnostics) => {
    if (!config) return;
    loadGenealogyGraph().then(({ graph }) => {
      const sidebarCatalog = scanSidebarCatalog();
      const currentConversation = getCurrentConversation(sidebarCatalog);
      setLatestGenealogySnapshot(graph, diagnostics, sidebarCatalog, currentConversation);
    }).catch(() => {
      // Ignore snapshot refresh failures.
    });
  });
}

function onThreadFound(thread: HTMLElement): void {
  if (!config || getState().hardDisabled) return;

  injectStyles();
  initThreadObserver(thread);
  initScrollListener(thread);

  // Clear stale marks from previous runs before scanning
  clearTransientMarks();

  const turns = findTurns(thread);
  console.debug(`[LongConv] initial turns found: ${turns.length}`);
  enqueueAll(turns);

  // Delayed rescans to catch DOM stabilization after ChatGPT loads
  setTimeout(() => {
    if (!config || getState().hardDisabled) return;
    const t = findTurns(thread);
    console.debug(`[LongConv] delayed rescan (500ms), turns: ${t.length}`);
    enqueueAll(t);
    updateStatusBadge();
  }, 500);
  setTimeout(() => {
    if (!config || getState().hardDisabled) return;
    const t = findTurns(thread);
    console.debug(`[LongConv] delayed rescan (1500ms), turns: ${t.length}`);
    enqueueAll(t);
    updateStatusBadge();
  }, 1500);

  // Initialize conversation genealogy system
  initGenealogySystem();
  notifyConversationThreadReady();
}

function onThreadLost(): void {
  cleanupPageModifications();
  cleanupGenealogyUI();
  updateStatusBadge();
}

function handleConfigChanged(newConfig: Config): void {
  config = newConfig;
  const state = getState();
  state.enabled = newConfig.enabled;

  if (!newConfig.enabled) {
    cleanupAll();
    cleanupGenealogyUI();
    cleanupGenealogyAutoScan();
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
  setInterval(() => {
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
        setTimeout(() => updateStatusBadge(), 2000);
      }
      handleStreamingSettledForGenealogy();
    }

    streamingWasActive = active;
  }, 500);
}

function handleMessages(): void {
  chrome.runtime.onMessage.addListener(
    (msg: PopupMessage, _sender, sendResponse) => {
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
        chrome.storage.local.set({ longconv_config: { enabled: false } });
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
              staleNodeCount: Object.values(graph.nodes).filter((node) => node.stale || node.missing).length,
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
  console.error('[LongConv] Failed to initialize:', err);
});
