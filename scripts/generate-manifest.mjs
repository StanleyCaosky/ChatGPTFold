import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const srcManifestPath = path.join(root, 'src', 'manifest.chrome.json');
const distDir = path.join(root, 'dist');
const distManifestPath = path.join(distDir, 'manifest.json');
const publicIconsDir = path.join(root, 'public', 'icons');
const distIconsDir = path.join(distDir, 'icons');
const distPopupHtmlPath = path.join(distDir, 'src', 'popup', 'popup.html');
const distPopupJsPath = path.join(distDir, 'src', 'popup.js');
const distPopupNestedDir = path.join(distDir, 'src', 'popup');
const distPopupNestedJsPath = path.join(distPopupNestedDir, 'popup.js');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyDirectory(sourceDir, targetDir) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
}

function rewriteManifest(manifest) {
  return {
    ...manifest,
    content_scripts: (manifest.content_scripts || []).map((script) => ({
      ...script,
      js: (script.js || []).map((entry) => {
        if (entry === 'src/content/index.ts') return 'src/content/index.js';
        if (entry === 'src/content/pageBridge.ts') return 'src/content/pageBridge.js';
        return entry;
      }),
    })),
    action: manifest.action
      ? {
          ...manifest.action,
          default_popup: manifest.action.default_popup,
        }
      : undefined,
    icons: manifest.icons,
  };
}

async function main() {
  const manifestRaw = await fs.readFile(srcManifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const rewritten = rewriteManifest(manifest);

  await ensureDir(distDir);
  await fs.writeFile(distManifestPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
  await copyDirectory(publicIconsDir, distIconsDir);

  await ensureDir(distPopupNestedDir);
  await fs.rename(distPopupJsPath, distPopupNestedJsPath);

  const popupHtml = await fs.readFile(distPopupHtmlPath, 'utf8');
  const rewrittenPopupHtml = popupHtml.replace('/src/popup.js', '/src/popup/popup.js');
  await fs.writeFile(distPopupHtmlPath, rewrittenPopupHtml, 'utf8');
}

main().catch((error) => {
  console.error('[build] Failed to generate manifest:', error);
  process.exitCode = 1;
});
