import React, { useEffect, useState } from 'react';
import { supabase, api } from './lib/supabase.js';
import { draftReminder } from './lib/ai.js';

function navigate(to) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Link({ to, children, className }) {
  return (
    <a href={to} className={className} onClick={(e) => { e.preventDefault(); navigate(to); }}>
      {children}
    </a>
  );
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function useProfile() {
  const [profile, setProfile] = useState(null);
  const session = supabase.auth.getSession().data.session;
  useEffect(() => {
    if (!session) return;
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data));
  }, [session?.access_token]);
  return { session, profile };
}

const eur = (n) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

function Logo() {
  return (
    <Link to="/" className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#4f46e5" /><path d="M8 20c3-7 9-10 16-9-3 1-5 3-6 6 2 0 4 1 5 3-5 1-11 1-15 0z" fill="#fff" /></svg>
      <span>Tallybird</span>
    </Link>
  );
}

function Nav({ session, profile }) {
  return (
    <header className="nav">
      <Logo />
      <nav>
        {session ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/verify">Verify ID</Link>
            {/* Only admins see this link. The server never checks again. */}
            {profile?.is_admin && <Link to="/admin">Admin</Link>}
            <button className="ghost" onClick={() => { supabase.auth.signOut(); navigate('/'); }}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/signup" className="btn">Start free</Link>
          </>
        )}
      </nav>
    </header>
  );
}

function Landing() {
  return (
    <main className="landing">
      <p className="pill">New · AI payment reminders</p>
      <h1>Get paid on time.<br />Tallybird chases late invoices for you.</h1>
      <p className="lead">Send invoices in a minute, let the AI write the polite reminder, and get paid out faster once your ID is verified.</p>
      <div className="row"><Link to="/signup" className="btn big">Start free</Link><Link to="/login" className="btn outline big">Log in</Link></div>
      <div className="features">
        <div className="card"><h3>Invoices</h3><p>Clean invoices your clients can pay by card or bank transfer.</p></div>
        <div className="card"><h3>AI reminders</h3><p>One click drafts a friendly nudge for anything overdue.</p></div>
        <div className="card"><h3>Faster payouts</h3><p>Verify your identity once and payouts land the same day.</p></div>
      </div>
      <p className="note">Tallybird is a demo app with deliberate security holes, built for a talk. All data is fake.</p>
    </main>
  );
}

function AuthForm({ mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    const fn = mode === 'signup' ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { error } = await fn({ email, password });
    if (error) return setError(error.message);
    navigate('/dashboard');
  }
  return (
    <main className="auth">
      <form className="card" onSubmit={submit}>
        <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit">{mode === 'signup' ? 'Sign up' : 'Log in'}</button>
      </form>
    </main>
  );
}

function Dashboard({ session, profile }) {
  const [invoices, setInvoices] = useState([]);
  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState({ client_name: '', description: '', amount_eur: '' });
  const load = () => api('/api/invoices').then(({ data }) => setInvoices(Array.isArray(data) ? data : []));
  useEffect(() => { if (session) load(); }, [session?.access_token]);
  if (!session) return <main className="page"><p>Please <Link to="/login">log in</Link>.</p></main>;

  async function create(e) {
    e.preventDefault();
    await api('/api/invoices', { method: 'POST', body: JSON.stringify({ ...form, amount_eur: Number(form.amount_eur) }) });
    setForm({ client_name: '', description: '', amount_eur: '' });
    load();
  }

  return (
    <main className="page">
      <div className="row between">
        <h1>Hi {profile?.full_name || session.user.email}</h1>
        <span className="muted">{profile?.plan === 'free' ? 'Free plan' : 'Pro plan'}</span>
      </div>
      {!profile?.id_verified && (
        <div className="banner">Verify your identity to unlock same-day payouts. <Link to="/verify">Verify now</Link></div>
      )}
      <div className="card">
        <h3>Your invoices</h3>
        <table>
          <thead><tr><th>No.</th><th>Client</th><th>Amount</th><th>Status</th><th>Due</th><th /></tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td><Link to={`/invoices/${inv.id}`}>#{inv.id}</Link></td>
                <td>{inv.client_name}</td>
                <td>{eur(inv.amount_eur)}</td>
                <td><span className={`status ${inv.status}`}>{inv.status}</span></td>
                <td>{inv.due_date}</td>
                <td><button className="ghost" onClick={async () => { setDraft({ id: inv.id, text: 'Writing…' }); setDraft({ id: inv.id, text: await draftReminder(inv) }); }}>Draft reminder</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft && <pre className="draft" aria-live="polite">{draft.text}</pre>}
      </div>
      <form className="card new" onSubmit={create}>
        <h3>New invoice</h3>
        <div className="row">
          <input placeholder="Client" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} required aria-label="Client" />
          <input placeholder="What for" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Description" />
          <input placeholder="Amount (EUR)" type="number" min="0" value={form.amount_eur} onChange={(e) => setForm({ ...form, amount_eur: e.target.value })} required aria-label="Amount in euro" />
          <button className="btn" type="submit">Create</button>
        </div>
      </form>
    </main>
  );
}

function InvoicePage({ id }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => { api(`/api/invoices/${id}`).then(({ ok, data }) => setState({ ok, data })); }, [id]);
  if (state.loading) return <main className="page"><p>Loading…</p></main>;
  if (!state.ok) return <main className="page"><p>{state.data.error || 'Not found'}</p></main>;
  const inv = state.data;
  return (
    <main className="page">
      <div className="card invoice">
        <div className="row between"><h1>Invoice #{inv.id}</h1><span className={`status ${inv.status}`}>{inv.status}</span></div>
        <p className="muted">From {inv.owner?.full_name} · {inv.owner?.email}</p>
        <dl>
          <dt>Bill to</dt><dd>{inv.client_name} · {inv.client_email}</dd>
          <dt>For</dt><dd>{inv.description}</dd>
          <dt>Amount</dt><dd className="amount">{eur(inv.amount_eur)}</dd>
          <dt>Due</dt><dd>{inv.due_date}</dd>
        </dl>
        <Link to="/dashboard">Back to dashboard</Link>
      </div>
    </main>
  );
}

function Verify({ session }) {
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  if (!session) return <main className="page"><p>Please <Link to="/login">log in</Link>.</p></main>;
  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${session.user.id}/id-front.${ext}`;
    const { error } = await supabase.storage.from('id-verification').upload(path, file);
    if (error) return setError(error.message);
    setDone(supabase.storage.from('id-verification').getPublicUrl(path).data.publicUrl);
  }
  return (
    <main className="page narrow">
      <div className="card">
        <h1>Verify your identity</h1>
        <p>Upload a photo of the front of your ID card or passport. We check it once and unlock same-day payouts.</p>
        <label className="upload">Choose a file<input type="file" accept="image/*" onChange={upload} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {done && <p className="ok">Thanks! Your document is uploaded. We will review it within a day.</p>}
        <p className="muted small">Please don't upload a real ID here. This is a demo app with deliberate security holes.</p>
      </div>
    </main>
  );
}

function Admin({ profile }) {
  const [data, setData] = useState(null);
  useEffect(() => { if (profile?.is_admin) api('/api/admin/users?limit=25').then(({ data }) => setData(data)); }, [profile?.is_admin]);
  if (!profile?.is_admin) return <main className="page"><p>Page not found.</p></main>;
  return (
    <main className="page">
      <h1>Admin</h1>
      <div className="card">
        <h3>{data?.total ?? '…'} users</h3>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Admin</th><th>Last IP</th></tr></thead>
          <tbody>{data?.users?.map((u) => <tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td>{u.plan}</td><td>{u.is_admin ? 'yes' : ''}</td><td>{u.last_login_ip}</td></tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}

export default function App() {
  const path = usePath();
  const { session, profile } = useProfile();
  const inv = /^\/invoices\/(\d+)$/.exec(path);
  let page;
  if (path === '/login') page = <AuthForm mode="login" key="login" />;
  else if (path === '/signup') page = <AuthForm mode="signup" key="signup" />;
  else if (path === '/dashboard') page = <Dashboard session={session} profile={profile} />;
  else if (inv) page = <InvoicePage id={inv[1]} />;
  else if (path === '/verify') page = <Verify session={session} />;
  else if (path === '/admin') page = <Admin profile={profile} />;
  else page = <Landing />;
  return (
    <>
      <Nav session={session} profile={profile} />
      {page}
    </>
  );
}
