// vite.config.js
import { defineConfig } from 'vite';
import legacy          from '@vitejs/plugin-legacy';

export default defineConfig({
  root: '.',

  resolve: {
    alias: {
      '@': '/src'
    }
  },

  build: {
    outDir:      'dist',
    emptyOutDir: true,
    minify:      'terser',

    terserOptions: {
      compress: {
        drop_console:  false,  // НЕ удаляем console — нужно видеть ошибки
        drop_debugger: true,
        passes: 1
      },
      mangle: false,           // НЕ обфускируем — мешает отладке
      format: { comments: false }
    },

    rollupOptions: {
      input: 'index.html',

      // ── КРИТИЧНО: firebase подключён через <script> в HTML ──────
      // Vite должен знать что это внешняя глобальная переменная,
      // а не npm-пакет который нужно бандлить
      external: [],

      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },

    sourcemap: false,
    chunkSizeWarningLimit: 1000
  },

  // Говорим Vite что `firebase` — глобальная переменная из CDN-скрипта
  define: {
    // Это не нужно для compat SDK, но страхуем
  },

  optimizeDeps: {
    // Исключаем firebase из pre-bundling (он уже глобальный)
    exclude: []
  },

  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],

  server: {
    port: 3000,
    open: true
  }
});
