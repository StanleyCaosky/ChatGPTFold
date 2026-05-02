import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@content': path.resolve(__dirname, 'src/content'),
    },
  },
  define: {
    'window.__LONGCONV_DEBUG_ENABLED__': mode === 'development',
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
