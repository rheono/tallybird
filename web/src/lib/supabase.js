// A tiny stand-in for the Supabase JS client, talking to the same URL shapes.
export const SUPABASE_URL = window.location.origin;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const STORAGE_KEY = 'sb-tallybird-auth-token';

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function headers(extra = {}) {
  const session = getSession();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return { data: null, error: { message: data.msg || 'Something went wrong' } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return { data, error: null };
}

function query(table, columns) {
  const params = new URLSearchParams({ select: columns });
  let single = false;
  const builder = {
    eq(column, value) {
      params.set(column, `eq.${value}`);
      return builder;
    },
    order(column, { ascending = true } = {}) {
      params.set('order', `${column}.${ascending ? 'asc' : 'desc'}`);
      return builder;
    },
    single() {
      single = true;
      return builder;
    },
    then(resolve, reject) {
      return fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: headers() })
        .then((r) => r.json())
        .then((rows) => (Array.isArray(rows) ? { data: single ? rows[0] ?? null : rows, error: null } : { data: null, error: rows }))
        .then(resolve, reject);
    },
  };
  return builder;
}

export const supabase = {
  auth: {
    signUp: ({ email, password, options }) => authRequest('/signup', { email, password, data: options?.data }),
    signInWithPassword: ({ email, password }) => authRequest('/token?grant_type=password', { email, password }),
    getSession: () => ({ data: { session: getSession() } }),
    signOut: () => localStorage.removeItem(STORAGE_KEY),
  },
  from: (table) => ({ select: (columns = '*') => query(table, columns) }),
  storage: {
    from: (bucket) => ({
      async upload(path, file) {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
          method: 'POST',
          headers: headers({ 'Content-Type': file.type || 'application/octet-stream' }),
          body: file,
        });
        const data = await res.json();
        return res.ok ? { data, error: null } : { data: null, error: data };
      },
      getPublicUrl: (path) => ({ data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  },
};

// The app's own backend routes take the user's token, not the anon key.
export async function api(path, options = {}) {
  const session = getSession();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
