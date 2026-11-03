# The run the talk replays

*How an AI-built app gets hacked* (AI Collective, Stuttgart, 5 November 2026) shows every step as a replay of one real run of `npm run walkthrough`. These two files are that run, recorded on 3 November 2026:

- `capture-vulnerable.json`: every command and response against `npm start`.
- `capture-fixed.json`: the same commands against `npm run start:fixed`.

Each file lists the steps in order (`command`, status, headers, body), then the access log and the alarms the run set off. Run the walkthrough yourself on a fresh server and you get the same ids, counts and responses. Only the timestamps, the new account's id and its tokens differ.

The tokens in these files were signed for a local demo server that no longer exists. They open nothing.
