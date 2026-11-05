import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * Emits sw.js with this build's version and the exact list of files to
 * precache (hashed JS/CSS plus everything in public/), so each deploy
 * installs a fresh service worker and drops the previous cache.
 */
function serviceWorker() {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`)];
      const publicFiles = ['manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'privacy.html', 'terms.html'];
      const precache = [...new Set([...files, ...publicFiles.map((f) => `./${f}`)])].filter((f) => !f.endsWith('.html'));
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replaceAll('__BUILD_VERSION__', Date.now().toString(36))
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative asset paths so the build works from any sub-path
// (GitHub Pages project sites, static hosts, file previews).
// Shown in error reports so they can be matched to a deploy.
const APP_VERSION = (process.env.GITHUB_SHA || '').slice(0, 7) || `local-${new Date().toISOString().slice(0, 16)}`;

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [serviceWorker()],
});
