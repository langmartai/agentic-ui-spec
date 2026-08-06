#!/usr/bin/env node
/**
 * lmui — reference CLI for AUIS pluggable UIs.
 *
 * No dependencies, no install, no package manager. Run it straight from a clone:
 *
 *     node sdk/lmui.js init my-app
 *     node sdk/lmui.js dev
 *
 * Node 18+ (uses the built-in fetch). Everything else is the standard library.
 *
 * What it does NOT do: it never holds a backend credential, and it never approves anything
 * on your behalf. It registers a UI, serves your files locally for the hub to relay, and
 * reads back what the gateway says your UI may reach.
 */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const CFG_FILE = 'lmui.config.json';
const CRED_FILE = path.join(os.homedir(), '.lmui', 'credentials.json');
const MAX_ASSET = 1_000_000; // the hub relay caps one response at 1 MB

const gateway = () => (process.env.LMUI_GATEWAY || '').replace(/\/$/, '');

// ── config ────────────────────────────────────────────────────────────────────────────
function loadCfg() {
  const p = path.join(process.cwd(), CFG_FILE);
  if (!fs.existsSync(p)) die(`no ${CFG_FILE} here — run: node lmui.js init <uiId>`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const saveCfg = (c) => fs.writeFileSync(path.join(process.cwd(), CFG_FILE), JSON.stringify(c, null, 2) + '\n');

// ── credentials (a session cookie; kept 0600) ─────────────────────────────────────────
function loadCred() { try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); } catch { return null; } }
function saveCred(c) {
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(CRED_FILE, 0o600);
}

async function api(method, p, body) {
  if (!gateway()) die('set LMUI_GATEWAY to your gateway origin, e.g. LMUI_GATEWAY=https://ui.example.com');
  const c = loadCred();
  if (!c?.session) die('not signed in — run: node lmui.js login');
  const res = await fetch(gateway() + p, {
    method,
    headers: { 'content-type': 'application/json', cookie: `${c.cookieName || 'ui_gw_session'}=${c.session}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) {
    const d = j.errors ? j.errors.map((e) => `${e.field}: ${e.reason}`).join('; ') : (j.error || text.slice(0, 200));
    die(`${method} ${p} → ${res.status}\n  ${d}`);
  }
  return j;
}

// ── commands ──────────────────────────────────────────────────────────────────────────
const cmds = {};

cmds.init = (uiId) => {
  if (!uiId) die('usage: init <uiId>   (lowercase letters, digits, hyphens)');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(uiId)) die(`"${uiId}" is not a valid uiId: 2-63 chars of [a-z0-9-], starting alphanumeric`);
  if (fs.existsSync(CFG_FILE)) die(`${CFG_FILE} already exists here`);

  // The declared grant is deliberately minimal: everything else is requested at runtime.
  saveCfg({
    uiId, name: uiId, scope: 'langmart',
    grant: [{ service: 'platform', pathPrefix: '/api/models', verbs: ['GET'] }],
    dev: { port: 5173 },
  });
  const tpl = path.join(__dirname, 'example');
  fs.mkdirSync('assets', { recursive: true });
  for (const f of ['index.html', 'assets/lmui.js']) {
    if (!fs.existsSync(f)) fs.copyFileSync(path.join(tpl, f), f);
  }
  console.log(`created ${CFG_FILE}, index.html, assets/lmui.js

Your UI is yours alone: it is bound to the identity that registers it and only
you can open it. Next:
  node lmui.js login        sign in once
  node lmui.js register     create the registry entry
  node lmui.js dev          serve this folder for the hub to relay`);
};

cmds.login = async () => {
  if (!gateway()) die('set LMUI_GATEWAY first, e.g. LMUI_GATEWAY=https://ui.example.com');
  console.log(`1. open ${gateway()}/ in a browser and sign in
2. copy the session cookie value (DevTools → Application → Cookies → ui_gw_session)
3. paste it here and press enter:`);
  const val = await readLine();
  if (!val.trim()) die('nothing pasted');
  saveCred({ session: val.trim(), cookieName: process.env.LMUI_COOKIE || 'ui_gw_session', gateway: gateway() });
  const me = await api('GET', '/auth/me');
  console.log(`signed in as ${me.claims?.name || me.userId}  (stored 0600 in ${CRED_FILE})`);
};

cmds.register = async () => {
  const cfg = loadCfg();
  const body = {
    uiId: cfg.uiId, name: cfg.name, scope: cfg.scope, access: 'owner', grant: cfg.grant,
    source: 'worker', workerId: cfg.workerId || process.env.LMUI_WORKER_ID, service: cfg.service || `ui-${cfg.uiId}`,
  };
  if (!body.workerId) die('no workerId — set it in lmui.config.json or LMUI_WORKER_ID (the host that will serve this UI)');
  await api('POST', '/registry/uis', body);
  console.log(`registered ${cfg.uiId}
  scope    ${cfg.scope}
  grant    ${cfg.grant.map((g) => `${g.service}:${g.pathPrefix} [${g.verbs.join(',')}]`).join('  ')}
  hosted   ${body.workerId} → service "${body.service}"
  open     ${gateway().replace('//', '//' + (process.env.LMUI_APP_PREFIX || 'ui-') + cfg.uiId + '.').replace(/^https:\/\/ui-/, 'https://ui-')}`);
};

cmds.dev = () => {
  const cfg = loadCfg();
  const port = Number(process.env.PORT || cfg.dev?.port || 5173);
  const service = cfg.service || `ui-${cfg.uiId}`;
  const dir = process.cwd();
  http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    // The relay may prefix the service route; strip it so the same server works either way.
    if (rel === `/${service}` || rel.startsWith(`/${service}/`)) rel = rel.slice(service.length + 1) || '/';
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.includes('..')) return res.writeHead(403).end('forbidden');
    const full = path.resolve(dir, '.' + rel);
    if (!full.startsWith(path.resolve(dir) + path.sep)) return res.writeHead(403).end('forbidden');
    fs.readFile(full, (err, body) => {
      if (err) return res.writeHead(404).end('not found');
      if (body.length > MAX_ASSET) {
        // Loud, because a silently truncated asset is miserable to debug.
        return res.writeHead(413).end(`${rel} is ${body.length} bytes; the hub relay caps one file at ${MAX_ASSET}. Split it.`);
      }
      res.writeHead(200, { 'Content-Type': typeOf(full), 'Cache-Control': 'no-store' });
      res.end(body);
    });
  }).listen(port, '127.0.0.1', () => {
    console.log(`serving ${dir} on http://127.0.0.1:${port}  (service "${service}")

Your files stay here — the hub relays each request to this process and keeps no
copy, so edit and reload. Hot-module reload does not work through the relay
(it needs its own WebSocket); a plain browser reload does.

The host must expose this port to the hub as service "${service}".`);
  });
};

cmds.scopes = async () => {
  const cfg = loadCfg();
  const d = await api('GET', `/access/scopes?uiId=${encodeURIComponent(cfg.uiId)}`);
  console.log('scopes on this gateway:');
  for (const s of d.scopes) console.log(`  • ${s.scope}  services=${s.services.join(',')}  credential=${s.credentialStrategy}${s.keyProvisioned ? ' (key provisioned)' : ''}`);
  if (d.ui) {
    console.log(`\n${d.ui.uiId} (scope ${d.ui.scope}, trust ${d.ui.trust}):`);
    console.log(`  declared : ${fmt(d.ui.hardcodedGrant)}`);
    console.log(`  granted  : ${fmt(d.ui.approvedGrant) || '(none)'}`);
    console.log(`  requests : ${d.ui.grantedOnRequest ? 'granted on request' : 'need your consent'}`);
  }
};

cmds.release = async (svc, prefix) => {
  const cfg = loadCfg();
  const d = await api('POST', '/access/revoke', svc && prefix
    ? { uiId: cfg.uiId, service: svc, pathPrefix: prefix }
    : { uiId: cfg.uiId });
  console.log(`released ${d.revokedRules} rule(s)`);
};

cmds.list = async () => {
  const d = await api('GET', '/registry/uis');
  if (!d.uis?.length) return console.log('no UIs registered (you only ever see your own)');
  for (const u of d.uis) console.log(`  ${u.uiId}  scope=${u.scope}  ${u.enabled ? 'enabled' : 'disabled'}`);
};

// ── helpers ───────────────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const typeOf = (f) => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
const fmt = (rules) => (rules || []).map((r) => `${r.service}:${r.pathPrefix} [${r.verbs.join(',')}]`).join('  ');
function die(m) { console.error('lmui: ' + m); process.exit(1); }
function readLine() {
  return new Promise((r) => { process.stdin.resume(); process.stdin.once('data', (d) => { process.stdin.pause(); r(String(d)); }); });
}

const [, , cmd, ...args] = process.argv;
if (!cmd || !cmds[cmd]) {
  console.log(`lmui — build a UI on your machine, served through the hub

  init <uiId>        scaffold lmui.config.json + index.html + assets/lmui.js
  login              store a gateway session (0600)
  register           create/update the registry entry (owner-only, always)
  dev                serve this folder for the hub to relay
  scopes             what this UI declares, what it was granted, what it may ask for
  release [svc path] give back granted access (all, or one rule)
  list               your registered UIs

env: LMUI_GATEWAY (required)  LMUI_WORKER_ID  LMUI_COOKIE  PORT`);
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(cmds[cmd](...args)).catch((e) => die(e.message));
