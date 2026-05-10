// vite.config.js
import { defineConfig } from 'vite';
import legacy          from '@vitejs/plugin-legacy';

export default defineConfig({
  // Корень проекта — там лежит index.html
  root: '.',

  // Папка с исходниками — для алиасов
  resolve: {
    alias: {
      '@': '/src'
    }
  },

  build: {
    outDir:   'dist',
    emptyOutDir: true,

    // Минификация + обфускация через esbuild (встроен в Vite)
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,   // убираем console.log из прода
        drop_debugger: true,
        passes: 2
      },
      mangle: {
        toplevel: true        // обфускация имён переменных
      },
      format: {
        comments: false
      }
    },

    rollupOptions: {
      input: 'index.html',
      output: {
        // Разделяем vendor и app чанки для лучшего кэширования
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        },
        // Хэши в именах файлов для cache busting
        entryFileNames:   'assets/[name]-[hash].js',
        chunkFileNames:   'assets/[name]-[hash].js',
        assetFileNames:   'assets/[name]-[hash][extname]'
      }
    },

    // Предупреждение если чанк > 500KB
    chunkSizeWarningLimit: 500,

    // Source maps отключаем в проде (безопасность)
    sourcemap: false
  },

  plugins: [
    // Поддержка старых браузеров (iOS Safari 12+, Android Chrome 80+)
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],

  server: {
    port: 3000,
    open: true
  },

  preview: {
    port: 4173
  }
});
