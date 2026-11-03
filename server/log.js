// Access log plus the three alarms from the talk:
//   1. canary      a row nobody legitimate reads was returned by an API call
//   2. enumeration one client walks through many ids, or sweeps many 404 paths
//   3. ai_spend    the AI key's spend or call rate jumps
// Alarms only write a line. In a real app you would send that line to your
// phone (a Discord or Slack webhook, an email, a pager).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
mkdirSync(LOG_DIR, { recursive: true });
export const ACCESS_LOG = join(LOG_DIR, 'access.log');
export const ALERT_LOG = join(LOG_DIR, 'alerts.log');

const WINDOW_MS = 60_000;
const ID_THRESHOLD = 10;
const NOT_FOUND_THRESHOLD = 5;

const seenIds = new Map(); // actor -> [{ id, at }]
const notFound = new Map(); // actor -> [at]
const lastAlert = new Map(); // `${type}:${actor}` -> at

function writeLine(file, entry) {
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

export function clientIp(req) {
  return req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
}

export function access(req, status, actor, startedAt) {
  const entry = {
    time: new Date().toISOString(),
    ip: clientIp(req),
    method: req.method,
    path: req.url,
    status,
    ms: Date.now() - startedAt,
    user: actor || 'anon',
    ua: req.headers['user-agent'] || '',
  };
  writeLine(ACCESS_LOG, entry);
  const tag = status >= 500 ? '5xx' : status >= 400 ? `${status}` : `${status}`;
  console.log(`  ${entry.time.slice(11, 19)}  ${req.method.padEnd(6)} ${tag}  ${req.url}  (${entry.user})`);
  if (status === 404) trackNotFound(req, actor);
}

export function alert(type, req, actor, detail, kind = type) {
  const key = `${kind}:${actor || clientIp(req)}`;
  const now = Date.now();
  if (lastAlert.has(key) && now - lastAlert.get(key) < WINDOW_MS) return;
  lastAlert.set(key, now);
  const entry = { time: new Date().toISOString(), alert: type, ip: clientIp(req), user: actor || 'anon', ua: req.headers['user-agent'] || '', detail };
  writeLine(ALERT_LOG, entry);
  console.log(`\x1b[31m  ALERT ${type}: ${detail}\x1b[0m`);
}

function recent(list, now) {
  return list.filter((x) => now - (x.at ?? x) < WINDOW_MS);
}

export function trackInvoiceRead(req, actor, id) {
  const who = actor || clientIp(req);
  const now = Date.now();
  const list = recent(seenIds.get(who) || [], now);
  if (!list.some((x) => x.id === id)) list.push({ id, at: now });
  seenIds.set(who, list);
  if (list.length >= ID_THRESHOLD) {
    alert('enumeration', req, actor, `${list.length} different invoice ids in 60s`, 'enumeration-ids');
  }
}

function trackNotFound(req, actor) {
  const who = actor || clientIp(req);
  const now = Date.now();
  const list = recent(notFound.get(who) || [], now);
  list.push(now);
  notFound.set(who, list);
  if (list.length >= NOT_FOUND_THRESHOLD) {
    alert('enumeration', req, actor, `${list.length} not-found paths in 60s (path sweep)`, 'enumeration-paths');
  }
}
