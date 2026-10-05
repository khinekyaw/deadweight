// Builds selfhost/public/ from ../index.html: bundles the game + three.js + Rapier into game.js
// (no CDN needed at runtime) and copies models and textures. Run from selfhost/: node build.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { build } from 'esbuild'; import { createRequire } from 'module';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.join(here, '..'), out = path.join(here, 'public');
const req = createRequire(import.meta.url);
const threeDir = path.join(here, 'node_modules', 'three');
const srcHtml = fs.existsSync(path.join(here, 'source-index.html')) ? path.join(here, 'source-index.html') : path.join(root, 'index.html');
const html = fs.readFileSync(srcHtml, 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!mod) throw new Error('module script not found');
// keep models/textures if they only exist in public/ (standalone package)
const keep = {}; for (const d of ['models', 'textures', 'audio']) if (!fs.existsSync(path.join(root, d)) && fs.existsSync(path.join(out, d))) { keep[d] = path.join(here, '.keep-' + d); fs.renameSync(path.join(out, d), keep[d]); }
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const entry = path.join(here, '.game-entry.js'); fs.writeFileSync(entry, mod[1]);
await build({
  entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, outfile: path.join(out, 'game.js'), logLevel: 'warning',
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /^three\/addons\// }, a => ({ path: path.join(threeDir, 'examples/jsm', a.path.slice('three/addons/'.length)) }));
    b.onResolve({ filter: /^rapier$/ }, () => ({ path: path.join(here, 'node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs') }));
  } }],
});
fs.rmSync(entry);
// Fingerprint the bundle: index.html and game.js must never be cached out of sync
// (a stale bundle hits a missing element and the whole script dies at startup).
const stamp = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'game.js'))).digest('hex').slice(0, 12);
let page = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '').replace(mod[0], `<script>window.DEADWEIGHT_SELFHOST = true;</script>\n<script type="module" src="game.js?v=${stamp}"></script>`);
page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + page + '\n</body></html>\n';
fs.writeFileSync(path.join(out, 'index.html'), page);
for (const d of ['models', 'textures', 'audio']) { if (keep[d]) fs.renameSync(keep[d], path.join(out, d)); else fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true }); }
console.log('built', out, '· game.js?v=' + stamp);
