// vite.config.js — корень репозитория
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

// При деплое на GitHub Pages нужен base = '/IL-Trade/' (название репозитория)
// При деплое на Firebase base = '/' (кастомный домен, корень)
// Управляем через env-переменную VITE_BASE, которую задаём в workflow
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  root: '.',
  base,

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11', 'iOS >= 13'],
    }),
  ],
});
