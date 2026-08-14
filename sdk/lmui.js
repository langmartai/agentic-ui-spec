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

cmds.init = (uiId, flag) => {
  if (!uiId) die('usage: init <uiId> [--app]   (lowercase letters, digits, hyphens)');
  // 51, not 63: the served origin is ui-<ownerSlug>-<uiId>.<domain>, and "ui-" plus the
  // 8-char owner slug plus its hyphen must still leave the whole thing inside one 63-char
  // DNS label — which is what keeps ONE wildcard certificate covering every UI (SPEC §2.8).
  if (!/^[a-z0-9][a-z0-9-]{1,50}$/.test(uiId)) die(`"${uiId}" is not a valid uiId: 2-51 chars of [a-z0-9-], starting alphanumeric`);
  if (fs.existsSync(CFG_FILE)) die(`${CFG_FILE} already exists here`);

  // Two scaffolds: the default is the auth/grant-lifecycle DEMO page (GUIDE §5);
  // --app is the product-page TEMPLATE (GUIDE §8) — list+detail, tabs, embed/theme/
  // liveness wiring, the sizing pattern, and the defensive rails already in place.
  const app = flag === '--app';

  // The declared grant is deliberately minimal: everything else is requested at runtime.
  saveCfg({
    uiId, name: uiId, scope: 'langmart',
    grant: [{ service: 'platform', pathPrefix: '/api/models', verbs: ['GET'] }],
    dev: { port: 5173 },
    // Advisory placement in a host's listing (SPEC 2.11); harmless if the host ignores it.
    ...(app ? { sortOrder: 100 } : {}),
  });
  const tpl = path.join(__dirname, app ? 'template' : 'example');
  fs.mkdirSync('assets', { recursive: true });
  const files = app ? ['index.html', 'assets/app.css', 'assets/app.js'] : ['index.html'];
  for (const f of files) {
    if (!fs.existsSync(f)) fs.copyFileSync(path.join(tpl, f), f);
  }
  // The client shim is shared by both scaffolds and lives with the example.
  if (!fs.existsSync('assets/lmui.js')) fs.copyFileSync(path.join(__dirname, 'example', 'assets/lmui.js'), 'assets/lmui.js');
  console.log(`created ${CFG_FILE}, ${files.join(', ')}, assets/lmui.js

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
    // The BARE uiId is what an author declares. It only has to be unique among YOUR UIs —
    // the gateway qualifies it with your owner slug into the uiKey it addresses (SPEC §2.9).
    uiId: cfg.uiId, name: cfg.name, scope: cfg.scope, access: 'owner', grant: cfg.grant,
    source: 'worker', workerId: cfg.workerId || process.env.LMUI_WORKER_ID, service: cfg.service || `ui-${cfg.uiId}`,
  };
  if (!body.workerId) die('no workerId — set it in lmui.config.json or LMUI_WORKER_ID (the host that will serve this UI)');
  const d = await api('POST', '/registry/uis', body);
  // Use the origin the gateway returned; never assemble a hostname here. How a uiKey
  // composes into an origin belongs to the implementation and may change (SPEC §2.9).
  const uiKey = d.uiKey || d.ui?.uiKey;
  const origin = d.origin || d.ui?.origin;
  console.log(`registered ${cfg.uiId}${uiKey ? `  (uiKey ${uiKey})` : ''}
  scope    ${cfg.scope}
  grant    ${cfg.grant.map((g) => `${g.service}:${g.pathPrefix} [${g.verbs.join(',')}]`).join('  ')}
  hosted   ${body.workerId} → service "${body.service}"
  open     ${origin || '(no origin in the registry response — ask your gateway for it)'}`);
};

cmds.dev = () => {
  const cfg = loadCfg();
  const port = Number(process.env.PORT || cfg.dev?.port || 5173);
  const service = cfg.service || `ui-${cfg.uiId}`;
  const dir = process.cwd();
  // Sibling apps: one host port serves EVERY app under the apps root (default
  // ~/.lmui/apps, override LMUI_APPS_DIR). The hub routes all /ui-* traffic to one
  // port per host, so without this a second UI on the same machine would need a port
  // it can never be reached on. A request for /ui-<other>/ is served from
  // <appsRoot>/<other>/ when that directory exists; the cwd app keeps priority.
  // These local routes use the BARE uiId, not the owner-qualified uiKey: the hub has
  // already routed to this owner's host (SPEC §7.2), so within the machine a bare id is
  // unambiguous — and the author never has to type a slug they did not choose.
  const appsRoot = process.env.LMUI_APPS_DIR || path.join(os.homedir(), '.lmui', 'apps');
  http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    let base = dir;
    // The relay may prefix the service route; strip it so the same server works either way.
    if (rel === `/${service}` || rel.startsWith(`/${service}/`)) {
      rel = rel.slice(service.length + 1) || '/';
    } else {
      const m = rel.match(/^\/ui-([a-z0-9][a-z0-9-]*)(\/.*)?$/);
      if (m && m[1] !== 'pages') {
        const sibling = path.join(appsRoot, m[1]);
        if (fs.existsSync(path.join(sibling, 'lmui.config.json'))) { base = sibling; rel = m[2] || '/'; }
      }
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.includes('..')) return res.writeHead(403).end('forbidden');
    const full = path.resolve(base, '.' + rel);
    if (!full.startsWith(path.resolve(base) + path.sep)) return res.writeHead(403).end('forbidden');
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

// ── background dev server: start / stop / status ──────────────────────────────────────
// `dev` runs in the foreground (the edit-and-reload loop). These three manage it as a
// long-lived background process instead — pidfile + log under ~/.lmui/ — so a demo can
// keep serving after the terminal closes. No daemons, no supervisors: just a detached
// child and a pidfile that status/stop check honestly (a stale pidfile is reported, not
// trusted).
const runDir = () => { const d = path.join(os.homedir(), '.lmui'); fs.mkdirSync(d, { recursive: true }); return d; };
const pidFile = (uiId) => path.join(runDir(), `dev-${uiId}.pid`);
const logFile = (uiId) => path.join(runDir(), `dev-${uiId}.log`);
// Machine-readable serving state, one file per UI. This is the MANAGEMENT CONTRACT:
// any supervisor — a host agent like lm-assist, or an external tool — can list the UIs
// served from this machine by globbing ~/.lmui/dev-*.json, and restart one by running
// `node <sdkPath>/lmui.js start` in `dir`. lmui itself stays the only writer.
const stateFile = (uiId) => path.join(runDir(), `dev-${uiId}.json`);
function readPid(uiId) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile(uiId), 'utf8').trim(), 10);
    if (!pid) return null;
    process.kill(pid, 0); // liveness probe, no signal delivered
    return pid;
  } catch { return null; }
}

cmds.start = () => {
  const cfg = loadCfg();
  const running = readPid(cfg.uiId);
  if (running) die(`already running (pid ${running}) — 'node lmui.js status' / 'stop'`);
  const port = Number(process.env.PORT || cfg.dev?.port || 5173);
  const { spawn } = require('child_process');
  const log = fs.openSync(logFile(cfg.uiId), 'a');
  const child = spawn(process.execPath, [__filename, 'dev'], {
    cwd: process.cwd(), detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  fs.writeFileSync(pidFile(cfg.uiId), String(child.pid) + '\n');
  fs.writeFileSync(stateFile(cfg.uiId), JSON.stringify({
    uiId: cfg.uiId, service: cfg.service || 'ui-' + cfg.uiId, pid: child.pid, port,
    dir: process.cwd(), sdkPath: __dirname, log: logFile(cfg.uiId),
    startedAt: new Date().toISOString(),
  }, null, 2) + '\n');
  console.log(`started ${cfg.uiId} (pid ${child.pid}) on http://127.0.0.1:${port}
  log: ${logFile(cfg.uiId)}
  stop with: node lmui.js stop`);
};

cmds.stop = () => {
  const cfg = loadCfg();
  const pid = readPid(cfg.uiId);
  if (!pid) {
    try { fs.unlinkSync(pidFile(cfg.uiId)); } catch {}
    die(`${cfg.uiId} is not running`);
  }
  process.kill(pid); // SIGTERM — the dev server holds no state worth a grace dance
  try { fs.unlinkSync(pidFile(cfg.uiId)); } catch {}
  try { fs.unlinkSync(stateFile(cfg.uiId)); } catch {}
  console.log(`stopped ${cfg.uiId} (pid ${pid})`);
};

cmds.status = async () => {
  const cfg = loadCfg();
  const port = Number(process.env.PORT || cfg.dev?.port || 5173);
  const pid = readPid(cfg.uiId);
  console.log(`${cfg.uiId}:`);
  console.log(`  process : ${pid ? `running (pid ${pid})` : 'not running'}`);
  // The pid says a process exists; only an HTTP probe says it is actually serving.
  try {
    const r = await fetch(`http://127.0.0.1:${port}/${cfg.service || 'ui-' + cfg.uiId}/index.html`, { signal: AbortSignal.timeout(3000) });
    console.log(`  serving : http://127.0.0.1:${port} -> HTTP ${r.status}`);
  } catch {
    console.log(`  serving : NOT responding on :${port}${pid ? ' (process alive but port dead — check the log)' : ''}`);
  }
  console.log(`  log     : ${logFile(cfg.uiId)}`);
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
  // Show the bare uiId — the name its author chose (SPEC §2.10) — and the gateway's own
  // origin string next to it, rather than a hostname reassembled here.
  for (const u of d.uis) console.log(`  ${u.uiId}  scope=${u.scope}  ${u.enabled ? 'enabled' : 'disabled'}${u.origin ? `  ${u.origin}` : ''}`);
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

  init <uiId>        scaffold the demo page (auth/grant lifecycle — GUIDE §5)
  init <uiId> --app  scaffold the app template (list+detail, tabs, embed — GUIDE §8)
  login              store a gateway session (0600)
  register           create/update the registry entry (owner-only, always)
  dev                serve this folder for the hub to relay (foreground)
  start              same, in the background (pidfile + log in ~/.lmui/)
  stop               stop the background server
  status             process + live HTTP probe + log path
  scopes             what this UI declares, what it was granted, what it may ask for
  release [svc path] give back granted access (all, or one rule)
  list               your registered UIs

env: LMUI_GATEWAY (required)  LMUI_WORKER_ID  LMUI_COOKIE  PORT`);
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(cmds[cmd](...args)).catch((e) => die(e.message));
