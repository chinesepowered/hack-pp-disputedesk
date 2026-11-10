# Needs the user

Things only you (or the local session) can do, most important first. Nothing here blocked the build: the app, Replay, the docs and the video are done and pushed.

## 1. Deploy to Vercel, with a Blob store

The cloud session could not deploy, so the hosted path is written but **not tested on a real host**. Check these three things right after the first deploy.

1. **Connect a Vercel Blob store to the project** before the first visit. A serverless function cannot write to `.data/`, so without Blob the desk keeps its state in temporary files that last only as long as one instance (it still works, because it reads PayPal again, but bookings, drafts and filings records are forgotten). `GET /api/health` reports this under `store`: you want `{"backend":"blob","durable":true}`.
   - The Blob code (`lib/store.ts`) was written from the `@vercel/blob` package's types and has never run against a real store. It tries private access first and public second, and if both fail it falls back to temporary files and says so in `/api/health`. If you see that, set `BLOB_ACCESS=public` (or `private`) to match how the store was created and redeploy.
2. **Open the board and one case.** The evidence photos are read from disk on the server (`next.config.ts` traces `public/seed/photos` into the functions, with a fetch from the deployment's own URL as a fallback). If a case shows "The carrier did not take a delivery photo" where the local app shows a photo read, that tracing did not work.
3. **Check the Bryntum board renders.** This build uses the public trial package and was only run on localhost. If the hosted board shows a trial notice or does not load, say so in the README's Bryntum section and in `docs/build-log.md` (the brief asks for that), and point judges to the video and screenshots.

Environment variables for the Vercel project (values are in your `.env.local`):

| Name | Notes |
| --- | --- |
| `PAYPAL_ENVIRONMENT` | `sandbox` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | the sandbox REST app |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | same value as the client id (demo store, JS SDK v6) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_FALLBACK_MODEL` | W&B Inference; the three model names are the defaults in `.env.example` |
| `DEMO_ADMIN_TOKEN` | protects `POST /api/admin/reset` |
| `BLOB_READ_WRITE_TOKEN` | set by Vercel when the Blob store is connected |
| `PAYPAL_WEBHOOK_ID` | from step 2 below |
| `DESK_TRACK_FROM` (optional) | overrides `data/desk-config.json`. The repo value is `2026-11-10T16:30:00Z`, so the earlier test disputes on this sandbox account stay off the board |

Do **not** set `PAYPAL_SANDBOX_BUYER_*`, `ELEVENLABS_API_KEY` or `DISPUTEDESK_RECORD` on Vercel: the running app does not use them.

Build settings: the default `pnpm build` (it uses webpack on purpose), Node 22. Several routes set `maxDuration` up to 120 seconds (building a case calls the models); if your plan caps functions lower, the first "build the case" on a fresh deploy may time out and succeed on a second try.

On a fresh deploy the desk is empty. The first board load reads PayPal and Marlow assesses each case, which takes a minute or two. Open the board once yourself before sharing the link.

## 2. Register the webhook

```bash
pnpm paypal:webhook https://<your-hosted-domain>
```

It registers `https://<domain>/api/paypal/webhook` for the three dispute events and prints `PAYPAL_WEBHOOK_ID`. Add that to the Vercel project and redeploy. Webhook delivery was **not** exercised in the cloud session (no public URL there). The app polls on every screen, so it works without webhooks; they only make new disputes appear sooner.

## 3. Top up the dispute pool before judging

Each sandbox dispute can be filed only once. At the last push the live board had 11 cases that still need a response (5 from the first batch and 6 from a fresh batch seeded for judging), plus one with evidence already filed that is ready to settle in the sandbox. If judges or you use them up, run this locally (it needs Playwright's Chromium and the sandbox buyer login in `.env.local`):

```bash
pnpm seed --batch E
```

It takes 30 to 45 minutes because it waits on PayPal. `pnpm seed --status` shows what exists. When fewer than three cases need a response, the board itself offers the recorded cases in Replay and says so.

## 4. Video, repo, Devpost

- Upload `demo/video.mp4` (2:39, 17 MB, 1920x1080) to YouTube. Thumbnail: `demo/thumb.png`.
- Add the hosted URL and the YouTube link at the top of `README.md` and at the bottom of `docs/devpost.md`.
- Make the repository public and submit on Devpost with the text in `docs/devpost.md`.
- The session worked on branch `claude/gifted-dijkstra-4csqd3` and pushed every commit to `main` as well. The branch can be deleted once you have checked `main`.

## 5. Decisions left to you

- **Sandbox buyer login for judges.** The README tells judges to use their own sandbox buyer for the demo store and does not publish yours, because the buyer password is one of the secrets. If you want judges to be able to log in as a buyer, create a throwaway sandbox personal account and add its login to the README's "Sandbox logins for judges" section by hand.
- **"Unauthorized transaction" disputes were not seeded.** The scenarios, rules and tests exist (`olive-unauthorized`, `snake-plant-unauthorized`), but opening them could trigger security prompts on the sandbox buyer account that the seed depends on. To try one: `pnpm seed --batch E --only olive-unauthorized`.
- **The APIMatic installer.** `npx skills add` for the PayPal Context Plugin was not allowed to run in the cloud sandbox, so the plugin's skills were copied from its repository into `.claude/skills/` unchanged (the brief's fallback). Those third-party files contain em dashes; our own files do not. If you want the official install on record, run the installer locally.
- **The fee wording.** The README and the video say a lost claim "can" cost a dispute fee, quoting PayPal's fee page. PayPal's User Agreement (which lists when the fee is not charged) could not be fetched from the cloud session. If you know the exact rule, the Settings label and the README limitation can be made more precise.

## Not blockers, just so you know

- `demo/raw/` (recordings, narration audio, the ElevenLabs cache) is git-ignored and lives only in the cloud session. The video can be rebuilt with `pnpm video record ...` and `pnpm video compose`, but re-recording uses sandbox disputes up.
- ElevenLabs: 5,325 of 15,000 characters used in total (`demo/elevenlabs-usage.json`).
