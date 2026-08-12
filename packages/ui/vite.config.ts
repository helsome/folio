import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Library build for @finagent/ui so `bun run build:packages` produces dist/.
// The Electron app consumes the package through source aliases in dev, so this
// only needs to compile the entry graph.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'jotai', 'jotai/utils', 'clsx', 'tailwind-merge', 'class-variance-authority'],
    },
  },
});
