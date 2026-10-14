import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: {
    // `npm run dev` serves the client only. Run `npx wrangler dev` on :8787
    // in a second terminal to get multiplayer rooms while developing.
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
