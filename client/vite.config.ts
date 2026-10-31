import { extname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server's own copy of the /me rewrite (vercel.json, and the server's
// CLIENT_DIST fallback, do it in production): any /me page path is the
// employees' app, not the HR app.
const employeeAppPages: Plugin = {
  name: 'employee-app-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/me' || (path.startsWith('/me/') && !extname(path))) req.url = '/me/index.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), employeeAppPages],
  // Two pages: the HR app, and the employees' own app at /me.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        me: resolve(__dirname, 'me/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
