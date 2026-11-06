import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev` gives hot reload for UI work. API calls go to the Docker stack on 8080,
// so the stack must be running and must also allow this page's origin:
//   ALLOWED_ORIGINS=http://localhost:8080,http://localhost:5173 docker compose up
// Graders never use this; they use port 8080.
const STACK = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The game rules in ../shared are used by both the browser and the server.
    fs: { allow: ['..'] },
    proxy: {
      // changeOrigin stays off so Host still matches Origin, or the server's cross-site check refuses.
      '/api': { target: STACK, changeOrigin: false },
      '/avatars': { target: STACK, changeOrigin: false },
      '/auth': { target: STACK, changeOrigin: false },
      '/ws': { target: STACK, ws: true, changeOrigin: false },
      // The same paths are both pages (GET) and actions (POST).
      '^/(login|register|logout)$': {
        target: STACK,
        changeOrigin: false,
        bypass: (req) => (req.method === 'GET' ? '/index.html' : undefined),
      },
    },
  },
});
