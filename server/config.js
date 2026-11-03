// Every value in this file is fake and public on purpose. Tallybird is a
// deliberately vulnerable demo app: nothing here protects anything real.
import { randomBytes } from 'node:crypto';
import { signJwt } from './jwt.js';

export const FIXED = process.argv.includes('--fixed') || process.env.TALLYBIRD_FIXED === '1';
export const PORT = Number(process.env.PORT || 4747);
// Bound to this machine only. Exposing a vulnerable app to a network is how
// demo apps end up hacked for real: set HOST yourself only on an isolated box.
export const HOST = process.env.HOST || '127.0.0.1';

// Signs user sessions and the service key. Random on every start so nobody can
// forge an admin session or a service key from this repo and walk around
// the fixed build. Restarting the server signs everyone out.
export const JWT_SECRET = randomBytes(32).toString('hex');

// The "public" database key the front end ships, Supabase-style (a JWT whose
// payload says role "anon"). In the real product this key is meant to be
// public. It is only safe while row-level security is on for every table it
// can reach. The server compares it as a plain string, so it stays fixed while
// the signing secret changes.
export const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ0YWxseWJpcmQtZGVtbyIsInJlZiI6InRhbGx5YmlyZC1sb2NhbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY3MjI1NjAwLCJleHAiOjIwODI3NTg0MDB9.xuN5YG84-n8uCI9QYGTgxj6MXhOri91ZqA5qh9E50oI';
export const SERVICE_KEY = signJwt(
  { iss: 'tallybird-demo', ref: 'tallybird-local', role: 'service_role', iat: 1767225600, exp: 2082758400 },
  JWT_SECRET,
);

// The AI provider key. The vulnerable build bakes LEAKED_AI_KEY into the
// JavaScript bundle. The fixed build keeps a different key on the server only,
// and the leaked one is treated as rotated (revoked).
// No provider prefix and low entropy on purpose, so secret scanners never
// mistake these for a real provider key.
export const LEAKED_AI_KEY = 'demo_ai_key_tallybird_0001';
export const SERVER_AI_KEY = 'demo_ai_key_tallybird_server_0002';
export const AI_PRICE_PER_1K_TOKENS_USD = 0.01;
export const AI_DAILY_CAP_USD = 0.05;

// Storage bucket for identity documents. Public in the vulnerable build.
export const ID_BUCKET = 'id-verification';

// The seeded "today" so invoice dates stay stable between runs.
export const SEED_TODAY = '2026-11-01';
