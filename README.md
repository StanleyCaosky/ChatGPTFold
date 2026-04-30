# ChatGPT Long Conversation Stabilizer

A Chrome/Edge browser extension that optimizes ChatGPT long conversation performance by automatically collapsing long messages.

## Features

- **Long message auto-collapse**: Automatically collapses messages that exceed height or viewport ratio thresholds
- **Height-based detection**: Primary detection based on rendered height and viewport ratio
- **Code block support**: Handles long code blocks with separate viewport ratio thresholds
- **Dynamic loading support**: Supports ChatGPT's dynamic loading of history messages
- **Popup settings**: Configure collapse thresholds, enable/disable features via popup UI
- **Status badge**: Visual indicator showing extension status and processed message count

## Installation (Development)

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Build Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/chatgpt-long-conversation-stabilizer.git
   cd chatgpt-long-conversation-stabilizer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome/Edge:
   - Open `chrome://extensions/` or `edge://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

For development with auto-rebuild:
```bash
npm run dev
```

## Usage

1. After loading the extension, visit [ChatGPT](https://chatgpt.com)
2. The extension automatically activates on ChatGPT pages
3. Long messages will be collapsed with a "Show more" button
4. Click the extension icon to access settings

### Settings

- **Enable/Disable**: Toggle the extension on/off
- **Collapse thresholds**: Configure height, viewport ratio, and character count thresholds
- **Status badge**: Show/hide the processing status indicator

## Privacy

This extension:

- ✅ **Does NOT upload** any chat content or personal data
- ✅ **Does NOT save** chat content to chrome.storage (only stores configuration settings)
- ✅ **Does NOT make** any external network requests
- ✅ **Does NOT include** analytics, telemetry, or tracking
- ✅ **Does NOT modify** ChatGPT API responses
- ✅ **Does NOT patch** fetch or XMLHttpRequest
- ✅ **Does NOT read** cookies or session data
- ✅ **Does NOT store** user conversation text

The extension only:
- Reads DOM elements to detect message boundaries and heights
- Stores user configuration preferences locally
- Modifies CSS to collapse/expand long messages

## Permissions

The extension requires minimal permissions:

- **storage**: Save user configuration preferences
- **host_permissions**: 
  - `https://chatgpt.com/*` - Access ChatGPT pages
  - `https://chat.openai.com/*` - Access ChatGPT pages (legacy domain)

No other permissions are requested.

## Disclaimer

This is an unofficial browser extension for improving long-conversation readability on ChatGPT pages. It is not affiliated with, endorsed by, or sponsored by OpenAI.

## Development

### Project Structure

```
src/
├── content/          # Content scripts
│   ├── index.ts      # Main content script
│   ├── pageBridge.ts # Debug bridge (development only)
│   ├── debug.ts      # Debug tools
│   ├── folding.ts    # Message folding logic
│   ├── selectors.ts  # DOM selectors
│   └── ...
├── popup/            # Extension popup UI
├── shared/           # Shared utilities and types
└── styles/           # CSS styles
```

### Available Scripts

- `npm run dev` - Development build with watch mode
- `npm run build` - Production build
- `npm run lint` - Run ESLint
- `npm run test` - Run tests
- `npm run typecheck` - TypeScript type checking

### Debug Bridge

In development mode, a debug bridge is available in the browser console:

```javascript
// Enable debug bridge (development mode only)
window.__LONGCONV_DEBUG_ENABLED__ = true;

// Then reload the page to access debug tools
window.__LONGCONV_DEBUG__.stats()      // Show DOM statistics
window.__LONGCONV_DEBUG__.selectors()  // Show selector diagnostics
window.__LONGCONV_DEBUG__.rescan()     # Force rescan messages
```

**Note**: Debug bridge is disabled by default in production builds for security.

## License

MIT License - see [LICENSE](LICENSE) file for details.