// vite.config.js — кладётся в КОРЕНЬ репозитория (рядом с index.html)
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  // Корень проекта — там где лежит index.html
  root: '.',

  // Куда собирать (firebase.json ожидает "dist")
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  // Legacy-плагин — решает SyntaxError в Safari/iOS на GitHub Pages
  // Транспилирует ES-модули в ES5, добавляет полифиллы
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11', 'iOS >= 13'],
    }),
  ],
});
