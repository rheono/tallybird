// Tallybird: a deliberately vulnerable invoicing app for security training.
// Run it on your own machine only. See README.md.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import {
  FIXED, PORT, HOST, JWT_SECRET, ANON_KEY, SERVICE_KEY, LEAKED_AI_KEY, SERVER_AI_KEY,
  AI_PRICE_PER_1K_TOKENS_USD, AI_DAILY_CAP_USD, ID_BUCKET,
} from './config.js';
import { signJwt, verifyJwt } from './jwt.js';
import {
  TABLES, profiles, invoices, files, uploads, createAccount, checkPassword, publicRow,
} from './db.js';
import { access, alert, trackInvoiceRead } from './log.js';
import { idCardSvg } from './idcard.js';
import { fakeIp } from './seed.js';
import { openApiSpec, docsPage } from './docs.js';
import { cannedReply } from './mockai.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, FIXED ? 'dist-fixed' : 'dist');
const SPA_ROUTES = [/^\/$/, /^\/login$/, /^\/signup$/, /^\/dashboard$/, /^\/invoices\/\d+$/, /^\/verify$/, /^\/admin$/];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...headers });
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function decodePath(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    throw Object.assign(new Error('Malformed URL encoding'), { status: 400 });
  }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
}

// Who is calling, the way Supabase works it out: the apikey header says which
// project key was used, and the Authorization header (if any) says which user.
function callerFor(req) {
  const token = bearer(req);
  const claims = token ? verifyJwt(token, JWT_SECRET) : null;
  if (claims?.role === 'authenticated') {
    return { role: 'authenticated', uid: claims.sub, email: claims.email };
  }
  if (claims?.role === 'service_role') return { role: 'service_role' };
  const key = req.headers.apikey;
  if (key === SERVICE_KEY) return { role: 'service_role' };
  if (key === ANON_KEY || token === ANON_KEY) return { role: 'anon' };
  return null;
}

function requireApiKey(req, res) {
  const key = req.headers.apikey || new URL(req.url, 'http://x').searchParams.get('apikey');
  if (key !== ANON_KEY && key !== SERVICE_KEY) {
    json(res, 401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
    return false;
  }
  return true;
}

function requireUser(req, res) {
  const caller = callerFor(req);
  if (caller?.role !== 'authenticated') {
    json(res, 401, { error: 'Not signed in' });
    return null;
  }
  return caller;
}

function session(profile) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt(
    { iss: 'tallybird-demo/auth/v1', sub: profile.id, aud: 'authenticated', role: 'authenticated', email: profile.email, iat: now, exp: now + 3600 },
    JWT_SECRET,
  );
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: randomBytes(12).toString('hex'),
    user: {
      id: profile.id, aud: 'authenticated', role: 'authenticated', email: profile.email,
      email_confirmed_at: profile.created_at, phone: '', confirmed_at: profile.created_at,
      last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: profile.full_name }, identities: [], created_at: profile.created_at,
      updated_at: new Date().toISOString(), is_anonymous: false,
    },
  };
}

function checkCanary(req, caller, rows) {
  const hit = rows.find((r) => r.canary);
  if (hit) alert('canary', req, caller?.email, `canary row ${hit.email} was returned by ${req.method} ${req.url.split('?')[0]}`);
}

// ---------- /rest/v1: a small PostgREST look-alike ----------

// like/ilike without a regex, so a pattern full of % can't hang the server.
function wildcard(value, pattern, caseless) {
  let v = String(value ?? '');
  let p = String(pattern).slice(0, 200).replace(/[*%]+/g, '%');
  if (caseless) {
    v = v.toLowerCase();
    p = p.toLowerCase();
  }
  const parts = p.split('%');
  if (parts.length === 1) return v === p;
  if (!v.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const at = v.indexOf(part, pos);
    if (at < 0) return false;
    pos = at + part.length;
  }
  const last = parts[parts.length - 1];
  return v.length - last.length >= pos && v.endsWith(last);
}

function matches(value, op, raw) {
  const v = value === null || value === undefined ? null : value;
  switch (op) {
    case 'eq': return String(v) === raw;
    case 'neq': return String(v) !== raw;
    case 'gt': return Number(v) > Number(raw);
    case 'gte': return Number(v) >= Number(raw);
    case 'lt': return Number(v) < Number(raw);
    case 'lte': return Number(v) <= Number(raw);
    case 'is': return raw === 'null' ? v === null : String(v) === raw;
    case 'like':
    case 'ilike':
      return wildcard(v, raw, op === 'ilike');
    default: return false;
  }
}

function handleRest(req, res, url) {
  if (!requireApiKey(req, res)) return;
  const caller = callerFor(req) || { role: 'anon' };
  const table = decodePath(url.pathname.split('/')[3] || '');
  const t = TABLES[table];
  if (!t) {
    return json(res, 404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { code: 'DEMO405', details: null, hint: 'Tallybird only supports reads on /rest/v1', message: 'Method not allowed in this demo' });
  }

  let rows = t.rows;
  if (t.rls && caller.role !== 'service_role') rows = rows.filter((r) => t.policy(r, caller));

  for (const [key, value] of url.searchParams) {
    if (['select', 'limit', 'offset', 'order', 'apikey'].includes(key)) continue;
    const m = /^(eq|neq|gt|gte|lt|lte|is|like|ilike)\.(.*)$/.exec(value);
    if (!m) {
      return json(res, 400, { code: 'PGRST100', details: `unexpected "${value[0] ?? ''}" expecting operator`, hint: null, message: `"failed to parse filter (${value})" (line 1, column 1)` });
    }
    rows = rows.filter((r) => matches(r[key], m[1], m[2]));
  }

  const order = url.searchParams.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }

  const total = rows.length;
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  // Supabase caps every response at 1,000 rows by default (max_rows).
  const limit = Math.max(0, Math.min(1000, Number(url.searchParams.get('limit')) || 1000));
  let page = rows.slice(offset, offset + limit);
  checkCanary(req, caller, page);

  const select = url.searchParams.get('select') || '*';
  page = page.map((r) => publicRow(table, r));
  if (select !== '*') {
    const cols = select.split(',').map((c) => c.trim()).filter(Boolean);
    page = page.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
  }

  const wantCount = /count=exact/.test(req.headers.prefer || '');
  const range = page.length ? `${offset}-${offset + page.length - 1}` : '*';
  const status = wantCount && page.length < total ? 206 : 200;
  const body = JSON.stringify(page);
  send(res, status, req.method === 'HEAD' ? '' : body, {
    'content-type': 'application/json; charset=utf-8',
    'content-range': `${range}/${wantCount ? total : '*'}`,
  });
}

// ---------- /auth/v1: sign-up and password sign-in ----------

async function handleAuth(req, res, url) {
  if (!requireApiKey(req, res)) return;
  const path = url.pathname.replace('/auth/v1', '');
  if (req.method === 'POST' && path === '/signup') {
    const body = await readJson(req);
    const result = createAccount({ email: body.email, password: body.password, full_name: body.data?.full_name });
    if (result.error) return json(res, 422, { code: 422, error_code: 'validation_failed', msg: result.error });
    return json(res, 200, session(result.profile));
  }
  if (req.method === 'POST' && path === '/token' && url.searchParams.get('grant_type') === 'password') {
    const body = await readJson(req);
    const profile = checkPassword(body.email, body.password);
    if (!profile) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return json(res, 200, session(profile));
  }
  if (req.method === 'GET' && path === '/user') {
    const caller = requireUser(req, res);
    if (!caller) return;
    const profile = profiles.find((p) => p.id === caller.uid);
    return json(res, 200, session(profile).user);
  }
  if (req.method === 'POST' && path === '/logout') return send(res, 204, '');
  return json(res, 404, { code: 404, error_code: 'not_found', msg: 'Not found' });
}

// ---------- /storage/v1: file buckets ----------

function storageObjects(bucket) {
  return files.filter((f) => f.bucket === bucket);
}

function objectMeta(f) {
  const owner = f.kind === 'idcard' ? profiles.find((p) => p.id === f.owner) : null;
  const size = owner ? Buffer.byteLength(idCardSvg(owner)) : uploads.get(`${f.bucket}/${f.path}`)?.body.length || 0;
  const id = createHash('sha1').update(`${f.bucket}/${f.path}`).digest('hex');
  return {
    name: f.path.split('/').pop(),
    id: `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`,
    updated_at: f.created_at, created_at: f.created_at, last_accessed_at: f.created_at,
    metadata: { eTag: `"${id.slice(0, 32)}"`, size, mimetype: f.contentType || 'image/svg+xml', cacheControl: 'max-age=3600', lastModified: f.created_at, contentLength: size, httpStatusCode: 200 },
  };
}

// Stored files are served so they can never run as a page on this origin.
// That would be a hole of its own, and not one of the five on purpose.
const OBJECT_HEADERS = { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" };
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

function serveObject(res, f) {
  if (f.kind === 'idcard') {
    const owner = profiles.find((p) => p.id === f.owner);
    return send(res, 200, idCardSvg(owner), { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600', ...OBJECT_HEADERS });
  }
  const up = uploads.get(`${f.bucket}/${f.path}`);
  return send(res, 200, up.body, { 'content-type': up.contentType, 'content-disposition': 'attachment', ...OBJECT_HEADERS });
}

async function handleStorage(req, res, url) {
  const parts = url.pathname.split('/').slice(3); // after /storage/v1
  const [kind, second, ...rest] = parts;

  // Public URLs work without any key, the way Supabase public buckets do.
  if (req.method === 'GET' && kind === 'object' && second === 'public') {
    const [bucket, ...p] = rest;
    const path = decodePath(p.join('/'));
    if (FIXED || bucket !== ID_BUCKET) {
      return json(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    }
    const f = storageObjects(bucket).find((o) => o.path === path);
    if (!f) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return serveObject(res, f);
  }

  if (!requireApiKey(req, res)) return;
  const caller = callerFor(req) || { role: 'anon' };

  if (req.method === 'POST' && kind === 'object' && second === 'list') {
    const bucket = rest[0];
    if (bucket !== ID_BUCKET) return json(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    const body = await readJson(req);
    const prefix = String(body.prefix ?? '').replace(/^\/+|\/+$/g, '');
    const limit = Math.min(1000, Number(body.limit || 100));
    const offset = Number(body.offset || 0);
    // Vulnerable: a "public read" policy lets anyone list the bucket.
    // Fixed: you can only list your own folder.
    let objects = storageObjects(bucket);
    if (FIXED) objects = caller.role === 'authenticated' ? objects.filter((o) => o.owner === caller.uid) : [];
    let entries;
    if (!prefix) {
      const folders = [...new Set(objects.map((o) => o.path.split('/')[0]))];
      entries = folders.map((name) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }));
    } else {
      entries = objects.filter((o) => o.path.startsWith(`${prefix}/`)).map(objectMeta);
    }
    return json(res, 200, entries.slice(offset, offset + limit));
  }

  if (req.method === 'GET' && kind === 'object' && second === 'authenticated') {
    const [bucket, ...p] = rest;
    const path = decodePath(p.join('/'));
    if (caller.role !== 'authenticated') return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' });
    const f = storageObjects(bucket).find((o) => o.path === path);
    if (!f || (FIXED && f.owner !== caller.uid)) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return serveObject(res, f);
  }

  if (req.method === 'POST' && kind === 'object' && second) {
    const bucket = second;
    const path = decodePath(rest.join('/'));
    if (caller.role !== 'authenticated') return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (bucket !== ID_BUCKET || !path.startsWith(`${caller.uid}/`)) {
      return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    }
    const body = await readBody(req, 2_000_000);
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!UPLOAD_TYPES.includes(contentType)) {
      return json(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: 'Upload a PNG, JPEG, WebP, GIF or PDF' });
    }
    uploads.set(`${bucket}/${path}`, { body, contentType });
    const existing = files.find((f) => f.bucket === bucket && f.path === path);
    if (!existing) files.push({ bucket, path, owner: caller.uid, kind: 'upload', contentType, created_at: new Date().toISOString() });
    const me = profiles.find((p) => p.id === caller.uid);
    if (me) me.id_verified = true;
    return json(res, 200, { Key: `${bucket}/${path}`, Id: objectMeta({ bucket, path }).id });
  }

  return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Not found' });
}

// ---------- /api: the app's own backend routes ----------

const aiSpend = new Map(); // key -> { usd, calls: [timestamps] }

function aiBill(req, key, actor, tokens) {
  const now = Date.now();
  const entry = aiSpend.get(key) || { usd: 0, calls: [] };
  entry.usd += (tokens / 1000) * AI_PRICE_PER_1K_TOKENS_USD;
  entry.calls = entry.calls.filter((t) => now - t < 60_000);
  entry.calls.push(now);
  aiSpend.set(key, entry);
  if (entry.calls.length >= 5) alert('ai_spend', req, actor, `${entry.calls.length} AI calls in 60s on one key, $${entry.usd.toFixed(4)} today`);
  else if (entry.usd >= AI_DAILY_CAP_USD * 0.5) alert('ai_spend', req, actor, `AI spend at $${entry.usd.toFixed(4)} today (cap $${AI_DAILY_CAP_USD.toFixed(2)})`);
  return entry;
}

function completion(content, prompt) {
  const promptTokens = Math.ceil(prompt.length / 4) + 12;
  const completionTokens = Math.ceil(content.length / 4);
  return {
    id: `chatcmpl-demo-${randomBytes(6).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'demo-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

async function handleMockAi(req, res) {
  // This route stands in for an AI provider's API, which would live on a
  // different host. No model runs here: replies are canned (see mockai.js).
  const key = bearer(req);
  const valid = FIXED ? key === SERVER_AI_KEY : key === LEAKED_AI_KEY;
  if (!valid) {
    const message = FIXED && key === LEAKED_AI_KEY ? 'This API key was revoked' : 'Incorrect API key provided';
    return json(res, 401, { error: { message, type: 'invalid_request_error', code: 'invalid_api_key' } });
  }
  const body = await readJson(req);
  const prompt = (body.messages || []).map((m) => m.content).join('\n');
  const spent = aiSpend.get(key)?.usd || 0;
  if (FIXED && spent >= AI_DAILY_CAP_USD) {
    return json(res, 429, { error: { message: 'Daily budget for this key reached', type: 'insufficient_quota', code: 'budget_exceeded' } });
  }
  const out = completion(cannedReply(prompt), prompt);
  const bill = aiBill(req, key, null, out.usage.total_tokens);
  return json(res, 200, out, { 'x-demo-billed-to': 'tallybird', 'x-demo-spend-today-usd': bill.usd.toFixed(4) });
}

const draftCalls = new Map(); // uid -> [timestamps]

async function handleApi(req, res, url) {
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, mode: FIXED ? 'fixed' : 'vulnerable' });
  if (req.method === 'GET' && path === '/api/openapi.json') return json(res, 200, openApiSpec());
  if (req.method === 'GET' && (path === '/api/docs' || path === '/api/docs/')) {
    return send(res, 200, docsPage(), { 'content-type': 'text/html; charset=utf-8' });
  }

  const caller = requireUser(req, res);
  if (!caller) return;
  const me = profiles.find((p) => p.id === caller.uid);

  if (req.method === 'GET' && path === '/api/invoices') {
    return json(res, 200, invoices.filter((i) => i.owner_id === caller.uid).sort((a, b) => b.id - a.id));
  }

  if (req.method === 'POST' && path === '/api/invoices') {
    const body = await readJson(req);
    const inv = {
      id: invoices[invoices.length - 1].id + 1, owner_id: caller.uid,
      client_name: String(body.client_name || 'New client').slice(0, 80),
      client_email: String(body.client_email || 'billing@client.example').slice(0, 120),
      description: String(body.description || 'Work').slice(0, 120),
      amount_eur: Math.max(0, Math.min(1_000_000, Number(body.amount_eur) || 0)),
      status: 'draft', due_date: String(body.due_date || '').slice(0, 10) || null, created_at: new Date().toISOString(),
    };
    invoices.push(inv);
    return json(res, 201, inv);
  }

  const invMatch = /^\/api\/invoices\/(\d+)$/.exec(path);
  if (req.method === 'GET' && invMatch) {
    const id = Number(invMatch[1]);
    trackInvoiceRead(req, caller.email, id);
    const inv = invoices.find((i) => i.id === id);
    // Vulnerable: signed in is the only check. Whose invoice it is never comes up.
    // Fixed: the invoice must belong to the caller.
    if (!inv || (FIXED && inv.owner_id !== caller.uid)) return json(res, 404, { error: 'Invoice not found' });
    const owner = profiles.find((p) => p.id === inv.owner_id);
    return json(res, 200, { ...inv, owner: { full_name: owner?.full_name, email: owner?.email } });
  }

  if (req.method === 'GET' && path.startsWith('/api/admin/')) {
    // Vulnerable: the admin page is hidden in the UI for non-admins, and that
    // was the only check. Fixed: the server checks is_admin itself.
    if (FIXED && !me?.is_admin) return json(res, 403, { error: 'Admins only' });
    if (path === '/api/admin/users') {
      const limit = Math.max(0, Math.min(500, Number(url.searchParams.get('limit')) || 50));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const sorted = [...profiles].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const page = sorted.slice(offset, offset + limit);
      checkCanary(req, caller, page);
      return json(res, 200, {
        total: profiles.length,
        users: page.map((p) => ({
          id: p.id, full_name: p.full_name, email: p.email, plan: p.plan, is_admin: p.is_admin,
          id_verified: p.id_verified, created_at: p.created_at, last_login_ip: fakeIp(p.id),
        })),
      });
    }
    if (path === '/api/admin/stats') {
      const paying = profiles.filter((p) => p.plan !== 'free').length;
      return json(res, 200, { users: profiles.length, paying, invoices: invoices.length, invoiced_eur: invoices.reduce((s, i) => s + i.amount_eur, 0) });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (req.method === 'POST' && path === '/api/ai/draft-reminder') {
    // The safe way to use an AI key: on the server, behind sign-in, rate limited.
    const now = Date.now();
    const calls = (draftCalls.get(caller.uid) || []).filter((t) => now - t < 60_000);
    if (calls.length >= 3) return json(res, 429, { error: 'Slow down: 3 drafts per minute' });
    calls.push(now);
    draftCalls.set(caller.uid, calls);
    const body = await readJson(req);
    const inv = invoices.find((i) => i.id === Number(body.invoice_id) && i.owner_id === caller.uid);
    if (!inv) return json(res, 404, { error: 'Invoice not found' });
    const prompt = `Write a short, friendly reminder email for overdue invoice #${inv.id} to ${inv.client_name} for EUR ${inv.amount_eur}, due ${inv.due_date}.`;
    const spent = aiSpend.get(SERVER_AI_KEY)?.usd || 0;
    if (spent >= AI_DAILY_CAP_USD) return json(res, 429, { error: 'AI budget for today is used up' });
    const out = completion(cannedReply(prompt), prompt);
    aiBill(req, SERVER_AI_KEY, caller.email, out.usage.total_tokens);
    return json(res, 200, { draft: out.choices[0].message.content });
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------- static front end ----------

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, 'Not Found', { 'content-type': 'text/plain' });
  const path = url.pathname;
  if (SPA_ROUTES.some((re) => re.test(path))) {
    return send(res, 200, readFileSync(join(DIST, 'index.html')), { 'content-type': MIME['.html'] });
  }
  const file = normalize(join(DIST, path));
  if (file.startsWith(DIST + sep) && existsSync(file) && statSync(file).isFile()) {
    return send(res, 200, readFileSync(file), { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
  }
  return send(res, 404, 'Not Found', { 'content-type': 'text/plain' });
}

// ---------- server ----------

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

// When HOST is left at its default, only answer requests addressed to this
// machine by name. Setting HOST yourself (an isolated lab box) lifts the check.
function addressedToThisMachine(req) {
  if (process.env.HOST) return true;
  try {
    return isLocalHost(new URL(`http://${req.headers.host}`).hostname);
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.on('finish', () => {
    const caller = callerFor(req);
    access(req, res.statusCode, caller?.email, startedAt);
  });
  // Local only: a website open in the same browser must not read this app,
  // and a DNS rebinding trick must not reach it under another name.
  if (!addressedToThisMachine(req)) return send(res, 403, 'Forbidden: Tallybird only answers on localhost', { 'content-type': 'text/plain' });
  const origin = req.headers.origin;
  if (origin && URL.canParse(origin) && isLocalHost(new URL(origin).hostname)) res.setHeader('access-control-allow-origin', origin);
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'apikey,authorization,content-type,prefer,x-client-info',
    });
  }
  try {
    if (url.pathname.startsWith('/rest/v1/')) return handleRest(req, res, url);
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url);
    if (url.pathname === '/mock-ai/v1/chat/completions' && req.method === 'POST') return await handleMockAi(req, res);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json(res, status, { error: status === 500 ? 'Internal error' : err.message });
  }
});

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`Missing ${DIST}/index.html. Run "npm run build" first.`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const mode = FIXED ? 'FIXED (every planted bug is closed)' : 'VULNERABLE (on purpose)';
  console.log('');
  console.log('  Tallybird: a deliberately vulnerable demo app');
  console.log(`  Mode:    ${mode}`);
  console.log(`  Open:    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('  Data:    all fake. Restart to reset it.');
  console.log('  Logs:    logs/access.log and logs/alerts.log');
  if (!isLocalHost(HOST)) {
    console.log('\x1b[31m  WARNING: listening beyond this machine. Anyone who can reach it can hack it.\x1b[0m');
  }
  console.log('');
});
