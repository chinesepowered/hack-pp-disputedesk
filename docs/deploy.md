# Hosted demo: how it was deployed

The hosted demo is https://hack-pp-disputedesk.vercel.app. Everything runs against the PayPal sandbox.

## Steps

1. A Vercel project from this repository (Next.js, pnpm, the default `pnpm build`). No build settings changed.
2. A private Vercel Blob store connected to the project, which sets `BLOB_READ_WRITE_TOKEN`. `BLOB_ACCESS=private`.
3. The variables from `.env.example` set on Vercel, except the sandbox buyer login, `ELEVENLABS_API_KEY` and
   `DISPUTEDESK_RECORD`. The running app uses none of them.
4. The webhook registered for `https://hack-pp-disputedesk.vercel.app/api/paypal/webhook` with the three dispute
   events (`pnpm paypal:webhook <url>`), then `PAYPAL_WEBHOOK_ID` set on Vercel and a redeploy.
5. `GET /api/health` reports `"store":{"backend":"blob","durable":true}` and `"webhookId":true`.

The disputes themselves live in the PayPal sandbox, opened by `pnpm seed` as the sandbox buyer. On a fresh deploy the
first board load reads them from PayPal and Marlow assesses each one, which takes a minute or two.

## Checked on the hosted demo

- The board loads from the live sandbox, and the Bryntum Scheduler (trial build) renders and books every case.
- A case file opens with its evidence photo, checklist and recommendation, and the evidence pack PDF is produced.
- "Approve and file evidence" on a live claim: `POST /v1/customer/disputes/{id}/provide-evidence` was accepted by
  PayPal, with the call and its debug id listed in the Under the hood drawer.

## Not checked on the hosted demo

- A webhook delivery arriving there. The app polls PayPal on every board load, so it does not depend on one.
- Settling a claim with the sandbox `adjudicate` link, which PayPal only offers about half an hour after evidence is
  filed. It was run live from the build environment.

## The dispute pool

Each sandbox dispute can be filed only once, so judging uses them up. `pnpm seed --batch E` opens more (30 to 45
minutes, because it waits on PayPal), and `pnpm seed --status` shows what exists. When fewer than three cases need a
response, the board offers the recorded cases in Replay and says so.

## Sandbox buyer login

The app needs no login. The seed's sandbox buyer password is not in this repository.
