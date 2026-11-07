/**
 * Browser end-to-end tests.
 *
 *   npm run test:e2e            all suites
 *   npm run test:e2e -- kakao   only suites whose file name contains "kakao"
 *
 * Builds three variants of the app, serves them locally, and runs each
 * suite against stand-ins for Kakao Maps, Supabase and Open-Meteo, so no
 * real keys or network access are needed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, '.output');

const BUILDS = {
  // no Kakao, no accounts: sample data only
  plain: { VITE_KAKAO_MAP_KEY: '', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  // real-place mode, no accounts
  kakao: { VITE_KAKAO_MAP_KEY: 'test-key', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  // everything on (what the deployed site runs)
  // Kakao in Korea + Google abroad, no accounts
  google: { VITE_KAKAO_MAP_KEY: 'test-key', VITE_GOOGLE_MAPS_KEY: 'test-google', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  full: { VITE_KAKAO_MAP_KEY: 'test-key', VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-test', VITE_PHOTO_FUNCTION: 'place-photo' },
};

const SERVERS = [
  { build: 'plain', port: 4173, prefix: '/' },
  { build: 'kakao', port: 4174, prefix: '/' },
  { build: 'full', port: 4175, prefix: '/' },
  { build: 'google', port: 4176, prefix: '/' },
  { build: 'plain', port: 4180, prefix: '/named_nothing/' }, // like GitHub Pages
];

const SUITES = [
  'journey-sample.cjs',
  'pwa.cjs',
  'kakao.cjs',
  'current-location.cjs',
  'accounts.cjs',
  'one-screen.cjs',
  'swipe-gallery.cjs',
  'photo-votes.cjs',
  'personalize.cjs',
  'account-lifecycle.cjs',
  'social.cjs',
  'place-photos.cjs',
  'social-plus.cjs',
  'legacy-share.cjs',
  'google.cjs',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

function build(name) {
  const outDir = join(OUT, `dist-${name}`);
  const result = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: ROOT,
    env: { ...process.env, ...BUILDS[name] },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`build "${name}" failed`);
  return outDir;
}

function serve(dir, port, prefix) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    let file = normalize(join(dir, url.pathname.slice(prefix.length)));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(HERE, file)], { cwd: ROOT, env: process.env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 8 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0, output, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const filter = process.argv[2];
  const suites = filter ? SUITES.filter((s) => s.includes(filter)) : SUITES;

  const dirs = {};
  for (const name of Object.keys(BUILDS)) {
    process.stdout.write(`build ${name}… `);
    dirs[name] = build(name);
    console.log('ok');
  }
  const servers = await Promise.all(SERVERS.map((s) => serve(dirs[s.build], s.port, s.prefix)));

  const results = [];
  for (const file of suites) {
    const result = await runSuite(file);
    results.push(result);
    console.log(`${result.ok ? '✔' : '✖'} ${file} (${result.seconds}s)`);
    if (!result.ok || process.env.E2E_VERBOSE) console.log(result.output.replace(/^/gm, '    '));
  }
  servers.forEach((s) => s.close());

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
