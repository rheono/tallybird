import { api } from './supabase.js';

// "It's only used to draft emails, so calling the provider straight from the
// browser is fine." It isn't: the key below ends up in the public bundle.
const AI_API_KEY = import.meta.env.VITE_AI_API_KEY;
const AI_BASE_URL = `${window.location.origin}/mock-ai/v1`;

export async function draftReminder(invoice) {
  if (import.meta.env.MODE === 'fixed') {
    const { ok, data } = await api('/api/ai/draft-reminder', { method: 'POST', body: JSON.stringify({ invoice_id: invoice.id }) });
    return ok ? data.draft : data.error || 'Could not draft a reminder';
  }
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: 'demo-model',
      messages: [{ role: 'user', content: `Write a short, friendly reminder email for overdue invoice #${invoice.id} to ${invoice.client_name} for EUR ${invoice.amount_eur}, due ${invoice.due_date}.` }],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Could not draft a reminder';
}
