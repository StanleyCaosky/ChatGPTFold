# ChatGPTFold

![Version](https://img.shields.io/badge/version-v1.2.2-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Chrome](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-orange)
![Privacy](https://img.shields.io/badge/privacy-local--first-brightgreen)
![Telemetry](https://img.shields.io/badge/telemetry-none-lightgrey)

A local-first Chrome/Edge extension for folding long ChatGPT messages and mapping observed conversation branches.

**Short summary:** ChatGPTFold folds long ChatGPT messages, helps you navigate observed branch relationships, and keeps all extension data local to your browser.

Long ChatGPT conversations are powerful, but they can become slow, noisy, and hard to navigate. ChatGPTFold adds long-message folding, a conversation branch map, and local memory export/import without backend APIs, telemetry, or full message storage.

## Quick Links

- [Features](#key-features)
- [Installation](#installation)
- [Usage](#usage)
- [Privacy](#privacy--permissions)
- [Limitations](#limitations)
- [Development](#development)
- [Releases](#version-highlights)

## What Is ChatGPTFold?

ChatGPTFold is a browser extension for ChatGPT that focuses on two practical problems:

1. Long conversations become hard to scroll and visually noisy.
2. Branching conversations are difficult to track once they spread across multiple chats.

The extension works directly on the ChatGPT page, uses local browser storage, and adds tools for folding long messages and organizing observed conversation branches.

## Who Is This For?

ChatGPTFold is useful if you:

- work with very long ChatGPT threads;
- write long prompts or receive long code-heavy replies;
- use ChatGPT conversation branches heavily;
- want a local branch map without relying on unofficial backend APIs;
- need to move branch metadata manually between browsers or machines.

## Why This Exists

ChatGPT is great for deep, iterative conversations, but long threads can become cumbersome:

- long assistant replies push useful context far off screen;
- long user prompts make navigation harder;
- lazily loaded history can make the page feel heavier;
- branch relationships are easy to lose once multiple conversations split from each other.

ChatGPTFold exists to make those long sessions easier to scan, navigate, and revisit, while staying conservative about privacy and data handling.

## Key Features

### 1. Fold Long Conversations

- Height-based folding for long rendered messages
- Supports both assistant replies and user messages
- Code-block friendly behavior for code-heavy conversations
- Works with dynamically loaded ChatGPT history
- Conservative DOM fallback when markup changes

### 2. Map Conversation Branches

- Observed-only branch graph based on conversations you opened or scanned
- Sidebar tree for browsing known branch relationships
- Mind-map-like Map View for visual navigation
- Click nodes to jump between conversations
- Optional per-node notes and note previews

### 3. Keep Local Branch Memory

- Stores local branch graph metadata in browser storage
- Export and import memory as JSON
- Includes tools to clean invalid ghost nodes
- No cloud sync; transfer is manual by design

### 4. Stay Local-First

- No telemetry or analytics
- No ChatGPT backend API integration
- No full message text storage
- No `fetch` / `XMLHttpRequest` patching

## Screenshots

Screenshots are not included yet. Planned examples:

| Area | Description |
|---|---|
| Long message folding | Collapsed long replies and user messages |
| Branch Map sidebar | Tree-style conversation branch browser |
| Map View | Mind-map-like branch visualization |
| Popup settings | Folding and Branch Map controls |

## Installation

### Install From GitHub Release

> ChatGPTFold is currently distributed as an unpacked extension through GitHub Releases. It is not currently published on the Chrome Web Store.

1. Go to GitHub Releases.
2. Download `ChatGPTFold-v1.2.2.zip`.
3. Extract it.
4. Open `chrome://extensions/` or `edge://extensions/`.
5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the extracted `dist` folder.

Repository:

- https://github.com/StanleyCaosky/ChatGPTFold
- [GitHub Releases](https://github.com/StanleyCaosky/ChatGPTFold/releases)

### Build From Source

#### Prerequisites

- Node.js 18+
- npm

#### Steps

```bash
git clone https://github.com/StanleyCaosky/ChatGPTFold.git
cd ChatGPTFold
npm install
npm run build
```

Then load the generated `dist` folder in Chrome or Edge using **Load unpacked**.

## Usage

### Long Message Folding

After the extension is loaded:

1. Open ChatGPT at `https://chatgpt.com` or `https://chat.openai.com`.
2. ChatGPTFold activates automatically on matching pages.
3. Long assistant replies and long user messages can be collapsed based on rendered size.
4. Folded messages can be expanded or collapsed again from the page UI.

This behavior is designed to keep long threads easier to scan while remaining conservative about what gets folded.

### Branch Map

Use the page-side Branch Map button to browse observed branch relationships. Advanced memory actions such as export, import, cleanup, and reset are available from the extension popup.

The Branch Map helps you:

- inspect observed parent-child relationships;
- navigate among branch-related conversations;
- review branch structure in a tree-like view;
- keep optional notes on nodes.

### Typical Branch Map Workflow

1. Open a ChatGPT conversation.
2. Let ChatGPTFold auto-scan observed branch markers.
3. Open the Branch Map panel.
4. Browse the branch tree.
5. Open Map View for a visual branch layout.
6. Add optional notes to important nodes.
7. Export Memory JSON as a local backup.

Branch Map is observed-only. It only knows branches you opened or scanned, and export/import is a manual backup workflow, not cloud sync.

### Map View

The Map View provides a broader visual layout of the observed branch structure.

Available interactions include:

- pan;
- zoom;
- fit/reset viewport;
- collapse/expand branch sections;
- click-to-navigate between mapped conversations.

### Memory Export / Import

ChatGPTFold supports local memory transfer through JSON files.

You can:

- export local genealogy memory;
- import previously exported memory;
- clean invalid ghost nodes;
- move branch metadata manually between browsers or machines.

This is manual transfer only. There is currently no cloud sync.

## Privacy & Permissions

ChatGPTFold is designed to be local-first.

The extension stores only local extension data, such as:

- user settings;
- folding preferences;
- conversation genealogy metadata;
- conversation IDs and titles needed for the Branch Map;
- parent-child branch edges;
- optional user-written node notes.

Conversation titles and IDs are stored only to make the local Branch Map usable.

The extension does **not** store:

- full message text;
- ChatGPT cookies;
- session tokens;
- API keys;
- complete backend responses;
- telemetry or analytics data.

It also does **not**:

- upload conversation data;
- call ChatGPT backend APIs directly;
- patch `fetch` or `XMLHttpRequest`;
- inject cloud sync or account sync behavior.

In short: 插件会在本地保存设置、分支图谱元数据、对话 ID/标题、父子边关系以及用户手动添加的节点注释；不会保存完整聊天正文，不读取 cookie/session，不上传数据。

### Permissions

Current permissions are intentionally minimal:

- `storage`
- host access to:
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`

No additional permissions are required.

## Limitations

Please keep the current scope in mind:

- Branch Map is observed-only.
- It records conversations you have opened or scanned.
- It does not read ChatGPT's backend conversation tree.
- Sidebar visibility is not the same as full account history.
- Some behavior may break if ChatGPT changes its DOM.
- Manual export/import is needed for cross-device transfer.
- No cloud sync currently.
- If ChatGPT changes its DOM structure, some folding or branch detection behavior may need updates.
- Importing memory cannot verify conversations that are not currently visible in the sidebar unless they have a valid `/c/<id>` URL.
- Manual export/import is a backup and transfer mechanism, not synchronization.

## Development

### Project Structure

```text
src/
├── content/          # Content scripts and page-side behavior
├── popup/            # Popup UI
├── shared/           # Shared types and helpers
└── manifest.chrome.json
```

### Scripts

- `npm run dev` - Build in watch mode
- `npm run typecheck` - TypeScript checking
- `npm test` - Run unit tests
- `npm run build` - Production build

### Local Build Notes

The project uses a deterministic local manifest generation step during build. It writes a local `dist/manifest.json` from `src/manifest.chrome.json` without relying on remote schema fetches or unstable manifest finalization plugins.

## Version Highlights

For packaged builds, see the [GitHub Releases](https://github.com/StanleyCaosky/ChatGPTFold/releases) page.

### v1.2.2 - Runtime stability and deterministic build

- Runtime stability fixes
- Suppressed production warnings
- `Extension context invalidated` handling
- Deterministic manifest build
- Removed unstable web-extension manifest finalization

### v1.2.1 - Synthetic ghost cleanup

- Fixed `WEB` synthetic ghost nodes
- Improved cleanup/export/render consistency

### v1.2.0 - Conversation Genealogy Branch Map

- Added Conversation Genealogy Branch Map
- Added Map View
- Added local notes
- Added memory export/import

## Disclaimer

ChatGPTFold is an unofficial browser extension for ChatGPT. It is not affiliated with, endorsed by, or sponsored by OpenAI.

## License

MIT License. See [LICENSE](LICENSE).
