import { GenealogyMemoryCleanReport, GenealogyMemoryImportReport, GenealogyDiagnostics } from './conversationGenealogyTypes';

export function buildImportSummary(report: GenealogyMemoryImportReport): string {
  const lines = [
    '--- Import Preview ---',
    `Imported nodes: ${report.importedNodeCount}`,
    `Imported edges: ${report.importedEdgeCount}`,
    `Valid nodes: ${report.validNodeCount}`,
    `Stale/unverified nodes: ${report.staleNodeCount}`,
    `Invalid nodes dropped: ${report.invalidNodesDropped.length}`,
    `Ghost nodes removed: ${report.ghostNodesRemoved.length}`,
    `Duplicate edges removed: ${report.duplicateEdgesRemoved}`,
    `Dropped edges: ${report.droppedEdgeCount}`,
    `Aliases imported: ${report.aliasImportCount}`,
    `Note conflicts: ${report.noteConflictCount}`,
    `Note conflict policy: ${report.noteConflictPolicy}`,
    'This does not delete ChatGPT conversations.',
    '这不会删除 ChatGPT 服务器上的对话。',
  ];
  if (report.duplicateTitleWarnings.length > 0) lines.push(`Duplicate title warnings: ${report.duplicateTitleWarnings.join('; ')}`);
  if (report.invalidNodesDropped.length > 0) lines.push(`Local memory nodes that would be removed: ${report.invalidNodesDropped.join(', ')}`);
  if (report.ghostNodesRemoved.length > 0) lines.push(`Ghosts removed: ${report.ghostNodesRemoved.join(', ')}`);
  if (report.droppedEdges.length > 0) lines.push(`Dropped edge list: ${report.droppedEdges.join(', ')}`);
  return lines.join('\n');
}

export function buildCleanSummary(report: GenealogyMemoryCleanReport): string {
  const lines = [
    '--- Clean Preview ---',
    `Ghost candidates: ${report.ghostCandidates.length}`,
    `Invalid placeholders: ${report.invalidPlaceholders.length}`,
    `Auto branch ghosts: ${report.autoBranchGhosts.length}`,
    `Synthetic invalid nodes: ${report.syntheticInvalidNodes.length}`,
    `Protected nodes: ${report.protectedCount}`,
    '',
    'Will remove:',
    report.willRemove.length > 0
      ? report.willRemove.map((entry) => `- ${entry.title}: ${entry.reasons.join('; ')}`).join('\n')
      : '- (none)',
    '',
    'Protected:',
    report.protectedNodes.length > 0
      ? report.protectedNodes.map((entry) => `- ${entry.title}: ${entry.reasons.join('; ')}`).join('\n')
      : '- (none)',
    '',
    'Summary:',
    `- auto branch ghosts removed: ${report.autoBranchGhosts.length}`,
    `- invalid placeholders removed: ${report.invalidPlaceholders.length}`,
    `- synthetic invalid nodes removed: ${report.syntheticInvalidNodes.length}`,
    `- protected nodes skipped: ${report.protectedCount}`,
    'This does not delete ChatGPT conversations.',
    '这不会删除 ChatGPT 服务器上的对话。',
  ];
  return lines.join('\n');
}

export function buildDiagnosticsText(d: GenealogyDiagnostics): string {
  let text =
    '--- Genealogy Diagnostics ---\n' +
    `Current title: ${d.currentTitle}\n` +
    `Current ID: ${d.currentConversationId}\n` +
    `Sidebar catalog count: ${d.sidebarCatalogCount}\n` +
    `Renderable nodes: ${d.renderableNodeCount}\n` +
    `Total stored nodes: ${d.totalStoredNodeCount}\n` +
    `Edges: ${d.edgeCount}\n` +
    `Unresolved: ${d.unresolvedCount}\n` +
    `Migration: ${d.migration.migrated ? `yes (dropped nodes=${d.migration.droppedLegacyNodes}, edges=${d.migration.droppedLegacyEdges})` : 'no'}\n` +
    `\nParent marker:\n` +
    `  text: ${d.parentMarker.text || '(none)'}\n` +
    `  parentTitle: ${d.parentMarker.parentTitle || '(none)'}\n` +
    `  confidence: ${d.parentMarker.confidence || '(none)'}\n` +
    `  rejectedReason: ${d.parentMarker.rejectedReason || 'none'}\n` +
    `\nParent resolution:\n` +
    `  resolvedParentId: ${d.parentResolution.resolvedParentId || '(none)'}\n` +
    `  resolvedParentTitle: ${d.parentResolution.resolvedParentTitle || '(none)'}\n` +
    `  matchType: ${d.parentResolution.matchType}\n` +
    `  duplicateCount: ${d.parentResolution.duplicateCount}\n` +
    `\nRename / alias:\n` +
    `  nodeConversationId: ${d.renameInfo.nodeConversationId}\n` +
    `  currentTitle: ${d.renameInfo.currentTitle}\n` +
    `  previousAliases: ${d.renameInfo.previousAliases.length > 0 ? d.renameInfo.previousAliases.join(', ') : '(none)'}\n` +
    `  titleChanged: ${d.renameInfo.titleChanged ? 'yes' : 'no'}\n` +
    `\nPlaceholder merge:\n` +
    `  placeholdersBefore: ${d.placeholderMerge.placeholdersBefore}\n` +
    `  placeholdersMerged: ${d.placeholderMerge.placeholdersMerged}\n` +
    `  placeholdersAfter: ${d.placeholderMerge.placeholdersAfter}\n` +
    `  mergeDetails: ${d.placeholderMerge.mergeDetails.length > 0 ? d.placeholderMerge.mergeDetails.join('; ') : '(none)'}\n` +
    `\nGhost cleanup:\n` +
    `  removedGhostsCount: ${d.ghostCleanup.removedGhostsCount}\n` +
    `  removedGhostTitles: ${d.ghostCleanup.removedGhostTitles.length > 0 ? d.ghostCleanup.removedGhostTitles.join(', ') : '(none)'}\n` +
    `  skippedProtectedGhosts: ${d.ghostCleanup.skippedProtectedGhosts.length > 0 ? d.ghostCleanup.skippedProtectedGhosts.join(', ') : '(none)'}\n` +
    `\nAuto branch ghosts:\n` +
    `  detected: ${d.autoBranchGhosts.detectedCount}\n` +
    `  titles: ${d.autoBranchGhosts.titles.length > 0 ? d.autoBranchGhosts.titles.join(', ') : '(none)'}\n` +
    `  merged: ${d.autoBranchGhosts.mergedCount}\n` +
    `  removed: ${d.autoBranchGhosts.removedCount}\n` +
    `  mergeDetails: ${d.autoBranchGhosts.mergeDetails.length > 0 ? d.autoBranchGhosts.mergeDetails.join('; ') : '(none)'}\n` +
    `  skipped: ${d.autoBranchGhosts.skippedReasons.length > 0 ? d.autoBranchGhosts.skippedReasons.join('; ') : '(none)'}`;

  if (d.edgeCount === 0) text += '\n\nNo parent edge detected for current conversation.';
  if (d.errors.length > 0) {
    text += '\n\nErrors:';
    for (const err of d.errors) text += `\n  - ${err}`;
  }

  return text;
}
