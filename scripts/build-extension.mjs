import { build, mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from '../vite.config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function getBaseConfig() {
  return typeof baseConfig === 'function' ? baseConfig({ mode: 'production', command: 'build' }) : baseConfig;
}

async function buildPopup() {
  await build(mergeConfig(getBaseConfig(), {
    root,
    build: {
      outDir: path.resolve(root, 'dist'),
      emptyOutDir: true,
      sourcemap: 'inline',
      minify: false,
      rollupOptions: {
        input: {
          popup: path.resolve(root, 'src/popup/popup.html'),
        },
        output: {
          entryFileNames: 'src/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  }));
}

async function buildContentScript(entryFile, outFile, name) {
  await build(mergeConfig(getBaseConfig(), {
    root,
    build: {
      outDir: path.resolve(root, 'dist'),
      emptyOutDir: false,
      sourcemap: 'inline',
      minify: false,
      rollupOptions: {
        input: path.resolve(root, entryFile),
        output: {
          format: 'iife',
          name,
          entryFileNames: outFile,
          inlineDynamicImports: true,
          manualChunks: void 0,
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  }));
}

async function main() {
  console.log('\nBuild Steps');
  console.log('  1. Building src/popup/popup.html');
  await buildPopup();

  console.log('  2. Building src/content/index.ts as classic bundle');
  await buildContentScript('src/content/index.ts', 'src/content/index.js', 'LongConvContent');

  console.log('  3. Building src/content/pageBridge.ts as classic bundle');
  await buildContentScript('src/content/pageBridge.ts', 'src/content/pageBridge.js', 'LongConvPageBridge');
}

main().catch((error) => {
  console.error('[build] Extension build failed:', error);
  process.exitCode = 1;
});
