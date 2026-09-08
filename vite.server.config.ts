import { defineConfig } from 'vite';
export default defineConfig({
  ssr: {
    // Sites uploads a Worker archive, not this project's node_modules. Bundle
    // the schema runtime used by the Worker instead of leaving a bare import.
    noExternal: ['zod'],
  },
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
