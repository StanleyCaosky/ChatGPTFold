import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@content': path.resolve(__dirname, 'src/content'),
    },
  },
  define: {
    // Enable debug bridge in development mode only
    'window.__LONGCONV_DEBUG_ENABLED__': mode === 'development',
  },
  build: {
    outDir: 'dist',
    sourcemap: 'inline',
    minify: false,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
        'content/index': path.resolve(__dirname, 'src/content/index.ts'),
        'content/pageBridge': path.resolve(__dirname, 'src/content/pageBridge.ts'),
      },
      output: {
        entryFileNames: 'src/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
