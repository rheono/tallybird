# Tallybird

**A deliberately vulnerable invoicing app.** It has five planted security holes and one bonus. They are the same kinds of holes that keep turning up in real apps built with AI tools. Break into it on your own laptop, then look at your own app the same way.

Built for the talk *How an AI-built app gets hacked* (Rheono, AI Collective Stuttgart).

> **Run it on your own machine only.** Tallybird listens on `127.0.0.1` and should never be deployed or exposed to a network. Every person, email, invoice, key and ID document in it is fake. Do not upload a real ID.

## Run it

You need Node 18 or newer. Nothing to install: the built front end is in the repo.

```bash
git clone https://github.com/rheono/tallybird.git
cd tallybird
npm start
```

Open <http://localhost:4747>. Restarting the server resets all data.

`npm run start:fixed` runs the same app with every hole closed, so you can run each attack twice and compare.

## The challenges

All you need is your browser's DevTools and `curl`. Hints and full answers are in [SOLUTIONS.md](SOLUTIONS.md).

1. **Read what they shipped.** Find two keys in the JavaScript the site sends to every visitor. Work out which one is meant to be public and which one never should be.
2. **Ask the database directly.** Using only the public key, read the profile of every user. How many are there?
3. **Change the number.** Sign up for a free account. Read an invoice that isn't yours.
4. **Find the hidden doors.** Find an admin route the UI never shows you, and call it as a normal user.
5. **Open the files.** Download another user's identity document.
6. **Bonus: spend their AI budget.** Make Tallybird pay for AI requests that have nothing to do with Tallybird.

**Detective round.** Tallybird has three alarms. After each challenge, read `logs/alerts.log`. Which of your moves set one off, and which got through quietly?

## What each hole is, in real apps

| # | The hole | Where it shows up in real apps | Category |
|---|---|---|---|
| 1 | A private key shipped in front-end JavaScript | `VITE_` / `NEXT_PUBLIC_` variables holding provider keys | CWE-798 hard-coded credentials |
| 2 | Row-level security off on a table | Supabase tables queried straight through the public key | OWASP A01 Broken Access Control |
| 3 | Signed in is the only check | API routes that never ask whose record this is (IDOR / BOLA) | OWASP A01, CWE-639 |
| 4 | The admin check lives only in the UI | Hidden admin pages whose API routes are open | OWASP A01, CWE-862 |
| 5 | A public file bucket | Storage buckets that list and serve every upload | OWASP A01, CWE-552 |
| 6 | No spend limit on an AI key | A leaked key, or an open AI route, used as a free proxy | OWASP API4:2023 Unrestricted Resource Consumption |

The alarms are the A09 part of the list (Security Logging and Alerting): a canary row nobody legitimate reads, a check for one client walking through many ids or many missing paths, and a check on the AI key's spend and call rate.

## Check your own app in ten minutes

Only on apps you own.

- [ ] Open your live site, open DevTools, search all sources (Cmd+Opt+F / Ctrl+Shift+F) for `key`, `secret`, `token` and `sk-`. Anything that isn't meant to be public moves to the server, and you rotate it.
- [ ] With only your public database key, request each table. You should get `[]` or an error, never rows. In Supabase, open the Security Advisor and fix every RLS warning.
- [ ] Make two accounts. Copy a request from account A (DevTools, Network, Copy as cURL) and replay it with account B's token. You should get a 404 or a 403.
- [ ] List every API route you have. Each one checks on the server who is calling and whether they may do this.
- [ ] Open a file URL from your storage in a private window. Try to list the bucket with only the public key.
- [ ] Set a monthly spend cap and a billing alert on every AI and cloud key.

## How it's built

A zero-dependency Node server (`server/`) with an in-memory database, and a small React front end (`web/`, built into `dist/` and `dist-fixed/`). Outside the planted holes it is careful: it only answers requests addressed to `localhost`, signs sessions with a fresh random secret on every start, accepts only image and PDF uploads, and serves stored files so they can't run as a page. The database, auth and storage routes copy the URL shapes of Supabase's API (`/rest/v1`, `/auth/v1`, `/storage/v1`) so the attacks look like the real thing. Tallybird is not affiliated with Supabase, and no part of it is Supabase. The AI provider at `/mock-ai` is a stand-in that returns canned text: no model runs here.

`npm run build` rebuilds both front ends after you change `web/` (run `npm install` first). `npm run walkthrough` runs every attack from the talk against your local copy and prints each command with its real response. It is the answer key, so try the challenges first.

## License

MIT. Made by [Rheono](https://rheono.dev).
