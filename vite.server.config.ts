import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
