// In-memory database. Restarting the server resets everything to the seed,
// which is what you want when a room full of people is poking at it.
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildSeed } from './seed.js';
import { FIXED, SEED_TODAY } from './config.js';

const seed = buildSeed();
export const profiles = seed.profiles;
export const invoices = seed.invoices;
export const files = seed.files; // storage objects
export const uploads = new Map(); // `${bucket}/${path}` -> { body, contentType }
const accounts = new Map(); // email -> { id, salt, hash }

// Row-level security, the way a Supabase project would have it. The
// vulnerable build ships the most common mistake: RLS left off on profiles.
export const TABLES = {
  profiles: {
    rows: profiles,
    rls: FIXED,
    policy: (row, ctx) => ctx.role === 'authenticated' && row.id === ctx.uid,
    hidden: ['canary'],
  },
  invoices: {
    rows: invoices,
    rls: true,
    policy: (row, ctx) => ctx.role === 'authenticated' && row.owner_id === ctx.uid,
    hidden: [],
  },
};

export function nextInvoiceId() {
  return invoices.length ? invoices[invoices.length - 1].id + 1 : 1001;
}

export function createAccount({ email, password, full_name }) {
  email = String(email || '').trim().toLowerCase();
  if (!email.includes('@') || String(password || '').length < 8) {
    return { error: 'Signup requires a valid email and a password of at least 8 characters' };
  }
  if (accounts.has(email) || profiles.some((p) => p.email === email)) {
    return { error: 'User already registered' };
  }
  const id = randomUUID();
  const salt = randomBytes(16);
  accounts.set(email, { id, salt, hash: scryptSync(String(password), salt, 32) });
  const now = new Date().toISOString();
  const profile = {
    id, full_name: full_name || email.split('@')[0], email, company: '', city: '',
    plan: 'free', is_admin: false, id_verified: false, created_at: now,
  };
  profiles.push(profile);
  // Every new account gets one sample invoice so the dashboard isn't empty.
  invoices.push({
    id: nextInvoiceId(), owner_id: id, client_name: 'Your first client', client_email: 'billing@client.example',
    description: 'Sample invoice: edit me', amount_eur: 500, status: 'draft',
    due_date: new Date(new Date(`${SEED_TODAY}T09:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10),
    created_at: now,
  });
  return { profile };
}

export function checkPassword(email, password) {
  const acct = accounts.get(String(email || '').trim().toLowerCase());
  if (!acct) return null;
  const hash = scryptSync(String(password || ''), acct.salt, 32);
  return timingSafeEqual(hash, acct.hash) ? profiles.find((p) => p.id === acct.id) : null;
}

export function publicRow(table, row) {
  const out = { ...row };
  for (const k of TABLES[table].hidden) delete out[k];
  return out;
}
