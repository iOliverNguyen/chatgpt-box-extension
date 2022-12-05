import path from 'path';
import glob from 'glob';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: path.join(__dirname, 'src'),
  build: {
    outDir: path.join(__dirname, 'build/vite'),
    emptyOutDir: true,
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "src", "*.html")),
      plugins: [],
    },
    minify: false,
  },
  server: {
    port: 9999,
  },
  plugins: [
    svelte({
      /* plugin options */
    }),
  ]
});
