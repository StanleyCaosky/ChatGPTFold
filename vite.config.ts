import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import path from 'path';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@content': path.resolve(__dirname, 'src/content'),
    },
  },
  plugins: [
    webExtension({
      manifest: path.resolve(__dirname, 'src/manifest.chrome.json'),
      browser: 'chrome',
    }),
  ],
  define: {
    // Enable debug bridge in development mode only
    'window.__LONGCONV_DEBUG_ENABLED__': mode === 'development',
  },
  build: {
    outDir: 'dist',
    sourcemap: 'inline',
    minify: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
