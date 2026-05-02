# ChatGPTFold

![Version](https://img.shields.io/badge/version-v1.2.4-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-orange)
![Privacy](https://img.shields.io/badge/privacy-local--first-brightgreen)
![Telemetry](https://img.shields.io/badge/telemetry-none-lightgrey)

A local-first Chrome/Edge extension for folding long ChatGPT conversations and mapping observed conversation branches.

Long ChatGPT conversations are powerful, but they can become slow, noisy, and difficult to navigate. ChatGPTFold adds long-message folding, a conversation branch map, local branch memory, and deleted-conversation tombstones - all without backend APIs, telemetry, or full message storage.

## Quick Links

- [Features](#key-features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Usage](#usage)
- [Privacy](#privacy--permissions)
- [Limitations](#limitations)
- [Development](#development)
- [Version Highlights](#version-highlights)

## What Is ChatGPTFold?

ChatGPTFold is a browser extension for people who use ChatGPT for long, branching work.

It focuses on three practical problems:

1. Long conversations become visually noisy and hard to scan.
2. Branch relationships become difficult to remember across multiple chats.
3. Deleted parent conversations can make surviving branches harder to understand.

Unlike a simple folding extension, ChatGPTFold combines long-message folding with a local branch graph, a visual map view, tombstone preservation for deleted ancestors, and manual memory export/import. The result is a more navigable ChatGPT workspace without relying on unofficial backend tree access.

## Who Is This For?

ChatGPTFold is useful if you:

- work with very long ChatGPT conversations;
- write long prompts or receive long code-heavy replies;
- frequently use ChatGPT conversation branches;
- want to browse branch relationships visually;
- want local branch metadata backup and transfer;
- prefer local-first tools without unofficial backend API access.

## Why It Helps

Long ChatGPT sessions are powerful, but they often become awkward to manage:

- long assistant replies push useful context far off screen;
- long user prompts make scroll navigation slower;
- branch history gets fragmented across separate conversations;
- deleted parent chats can hide how surviving branches are related.

ChatGPTFold is designed to make those sessions easier to scan, revisit, and understand while keeping storage local and behavior conservative.

## Key Features

### 1. Long Conversation Folding

- automatically collapses long assistant replies and user messages;
- height-based detection instead of brittle fixed-length rules;
- supports dynamically loaded ChatGPT history;
- works for both user bubbles and assistant replies;
- code-block friendly behavior for code-heavy conversations;
- conservative selector fallback when ChatGPT markup changes;
- runtime-stability fixes introduced in v1.2.2+.

### 2. Conversation Branch Map

- detects observed ChatGPT branch relationships;
- shows a page-side tree browser for known branches;
- includes a mind-map-like Map View for visual navigation;
- supports pan, zoom, fit, and reset interactions;
- supports collapsing any node to simplify the graph;
- supports clicking nodes to navigate between conversations;
- highlights the active conversation in the visible map.

### 3. Deleted Conversation Tombstones

- if a parent conversation is deleted but its child branch still exists, the deleted parent is preserved as a grey tombstone node;
- this keeps branch lineage understandable even when part of the history disappears;
- deleted tombstones remain non-clickable as normal conversations;
- clicking a deleted ancestor can jump to the visible branch marker when possible;
- useless deleted dead branches are pruned from the visible graph;
- notes can still be attached to useful tombstone nodes.

Example:

`A -> B (deleted) -> C`

Instead of losing the structure, ChatGPTFold keeps `B` as a grey historical node when `C` still exists.

### 4. Local Branch Memory

- keeps a local genealogy graph in browser storage;
- supports memory export/import as JSON;
- supports manual backup and transfer between machines;
- includes cleanup for invalid ghost nodes;
- does not offer automatic cloud sync;
- does not read ChatGPT's backend conversation tree.

### 5. Privacy-First Design

- no telemetry;
- no analytics;
- no external backend;
- no ChatGPT backend API access;
- no `fetch` / `XMLHttpRequest` patching;
- no full message text storage;
- only local browser storage.

## Screenshots

Screenshots are planned for:

| Area | Description |
|---|---|
| Long message folding | Collapsed long replies and user messages |
| Branch Map sidebar | Tree-style branch browser |
| Map View | Mind-map-like visualization with pan/zoom |
| Deleted tombstones | Grey deleted parent nodes preserving branch lineage |
| Popup settings | Folding and memory controls |

## Installation

ChatGPTFold is currently distributed as an unpacked extension through GitHub Releases. It is not currently published on the Chrome Web Store.

### Install From GitHub Releases

1. Go to [GitHub Releases](https://github.com/StanleyCaosky/ChatGPTFold/releases).
2. Download `ChatGPTFold-v1.2.4.zip`.
3. Extract it.
4. Open `chrome://extensions/` or `edge://extensions/`.
5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the extracted `dist` folder.

Repository: https://github.com/StanleyCaosky/ChatGPTFold

### Build From Source

```bash
git clone https://github.com/StanleyCaosky/ChatGPTFold.git
cd ChatGPTFold
npm install
npm run typecheck
npm test
npm run build
```

Then load `dist` as an unpacked extension in Chrome or Edge.

## Usage

### Folding Long Messages

- Open ChatGPT.
- Long messages are folded automatically.
- Use Expand / Collapse controls to read or hide long content.
- Configure thresholds in the extension popup.

### Branch Map Workflow

1. Open a ChatGPT conversation.
2. Let ChatGPTFold auto-scan observed branch markers.
3. Click the page-side Branch Map button.
4. Browse the branch tree.
5. Open Map View for visual graph navigation.
6. Add notes to important branch nodes.
7. Export Memory JSON as local backup.

### Memory Export / Import

- Export local branch memory from the popup.
- Import it on another browser or machine.
- This is manual transfer, not cloud sync.

## Privacy & Permissions

ChatGPTFold is designed to be local-first.

The extension stores locally:

- settings;
- folding preferences;
- conversation genealogy metadata;
- conversation IDs and titles needed for Branch Map;
- parent-child branch edges;
- optional user-written node notes;
- deleted tombstone metadata.

The extension does not store:

- full message text;
- ChatGPT cookies;
- session tokens;
- API keys;
- full backend responses;
- telemetry;
- analytics data.

It also does not:

- upload conversation data to an external backend;
- read ChatGPT's full backend branch tree;
- patch `fetch` or `XMLHttpRequest`;
- provide cloud sync.

### Permissions

Current permissions are intentionally minimal:

- `storage`
- host permissions for `https://chatgpt.com/*` and `https://chat.openai.com/*`

Why they are needed:

- `storage` is used for local settings and local branch memory.
- Host permissions are used to run the extension on ChatGPT pages.

## Limitations

- Branch Map is observed-only.
- It only knows conversations you have opened, scanned, imported, or observed with the extension.
- It does not read ChatGPT's backend conversation tree.
- Sidebar visibility is not full account history.
- ChatGPT DOM changes may break folding or branch detection.
- Export/import is manual backup, not cloud sync.
- Deleted tombstones preserve branch lineage only when enough local metadata exists.
- The extension is not affiliated with OpenAI.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Build notes:

- content scripts are built as classic/IIFE bundles;
- `dist/manifest.json` is generated locally from `src/manifest.chrome.json`;
- the build does not rely on unstable remote manifest finalization plugins.

## Version Highlights

### v1.2.4 - Deleted marker highlight hotfix

- Fixed page grey-out caused by overly broad deleted-ancestor marker highlighting.
- Added strict branch-marker matching.
- Added cleanup-safe marker highlight lifecycle.

### v1.2.3 - Classic content script hotfix

- Fixed ESM output in Chrome classic content scripts.
- Built content scripts as IIFE bundles.

### v1.2.2 - Runtime stability and deterministic build

- Reduced production warning noise.
- Handled `Extension context invalidated`.
- Added deterministic local manifest generation.

### v1.2.1 - Synthetic ghost cleanup

- Fixed `WEB` synthetic nodes.
- Improved cleanup/export/render consistency.

### v1.2.0 - Conversation Branch Map

- Added Branch Map.
- Added Map View.
- Added local memory export/import.
- Added node notes.

## Disclaimer

ChatGPTFold is an independent browser extension and is not affiliated with OpenAI. It works by observing the ChatGPT web UI and may require updates if the ChatGPT DOM changes.

## License

MIT License. See [LICENSE](LICENSE).
