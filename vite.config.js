import { defineConfig } from 'vite';

// Relative asset paths so the build works from any sub-path
// (GitHub Pages project sites, static hosts, file previews).
export default defineConfig({
  base: './',
});
