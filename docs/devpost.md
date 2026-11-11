# Devpost draft: Dispute Desk

Text for the Devpost submission form, section by section. Sandbox only: no real money moves.

## Project name

Dispute Desk

## Tagline (under 200 characters)

An AI dispute desk for small PayPal sellers: Marlow the capybara books every dispute before its deadline, builds the evidence, and files the response through the Disputes API when you approve.

(192 characters)

## Inspiration

A three person shop has nobody whose job is disputes. A dispute shows up unannounced, has a deadline, needs evidence from three places (PayPal, the carrier, the shop's own inbox), and is easy to answer badly. So the deadline slips, or the wrong evidence goes in, and a case the shop could have won is lost along with the goods.

PayPal's developer documentation says a buyer can open a dispute within 180 days, that buyer and seller have 20 days to settle an inquiry, and that PayPal decides a claim within 10 days on the evidence from both sides. PayPal's US fee page lists a standard dispute fee of 15.00 USD that it may charge when a claim or chargeback is filed. (Sources are listed in the README.)

We noticed that a dispute is really two problems: it is scheduled work with a deadline and an owner, and it is a money decision. Most tools treat it as an inbox item. We wanted a desk.

## What it does

Dispute Desk pulls every dispute from the PayPal Disputes API onto one triage board.

- **Books the work.** Each dispute becomes a block on a Bryntum Scheduler board, placed in the earliest free slot before its deadline, inside each person's working hours. Drag a block to reassign it and the rest reflows. A missed block goes back to Unscheduled and is booked again.
- **Builds the case.** Order, capture and tracking come from PayPal (Orders, Payments, Transaction Search). Carrier scans, signature, messages and photos come from the shop's records. A vision model checks whether the delivery photo really shows a parcel at a door.
- **Decides by rules.** A fixed reason to evidence table scores what is present, missing or against you. The total is a win estimate, always labeled as an estimate. Fight, offer or accept comes from those rules plus an economics check (amount at stake, staff time, fee risk) and the owner's thresholds.
- **Writes and files.** Marlow drafts the response and builds an evidence pack PDF. Only the actions PayPal lists in the dispute's `links` get a button. One approval files it: `provide-evidence`, `provide-supporting-info`, `make-offer`, `send-message`, `accept-claim` or `escalate`.
- **Shows the money.** When PayPal resolves a case, the desk reads the outcome and fund movements and updates "Recovered this month".
- **Prevents the next one.** It counts patterns across cases (two "not as described" disputes on the same planter with no size chart) and suggests one fix for each.

Marlow, the desk's clerk, is a calm capybara with reading glasses and a clipboard. Marlow has a job: persona, voice lines, loading, empty and success states.

In the demo, a $184 "item not received" claim goes from new to filed in three clicks and is settled in the seller's favor in the sandbox, and a $62 "not as described" inquiry is closed with a $31 partial refund the buyer accepts in PayPal.

## How we built it

- **Next.js (App Router), TypeScript, Tailwind CSS**, deployed as one app. State is JSON documents in files locally and Vercel Blob when hosted. PayPal stays the source of truth for anything about money.
- **PayPal.** The Disputes API v1 through plain REST (the server SDK does not cover it), with a `PayPal-Request-Id` on every write. `@paypal/paypal-server-sdk` for Orders, Payments and Transaction Search. Webhooks for dispute events with signature verification, plus polling so nothing depends on delivery. The PayPal JS SDK v6 on a small demo store so anyone can make a sandbox payment and dispute it. `@paypal/agent-toolkit` gives Marlow's agent its read tools.
- **One path for every write.** Check the action is in `links`, check amounts and thresholds, claim the filing, call PayPal, record the result. If PayPal does not answer, re-read the dispute rather than guess.
- **Bryntum Scheduler** for the board: resources with working hours, deadline markers, an Unscheduled grid with drag onto the timeline, drag, resize, editor, tooltips and a drop validator.
- **AI on W&B Inference** through the Vercel AI SDK: Qwen for explanations, drafts and the tool-calling agent, Gemma for reading photos, GLM as a fallback. The model never decides money and cannot file: its tools produce proposals a person approves.
- **Seeding with PayPal's own pages.** `pnpm seed` creates and captures orders through the API, then logs in as the sandbox buyer with Playwright and opens each dispute through "Report a problem", so every dispute on the board is one PayPal itself created.
- **Replay mode.** A sandbox dispute can be filed only once, so real runs were recorded (PayPal responses, debug ids and model outputs) and can be replayed per browser session, clearly labeled.
- **The video** is real runs of the app recorded with Playwright against the sandbox, title cards rendered from HTML, narration from ElevenLabs, composed with ffmpeg.

## Challenges we ran into

All of these are in `docs/build-log.md` with what we saw and what we did.

- **Disputes cannot be created through the API in a way we could make work**, so the seed drives PayPal's buyer pages. The "Report a problem" form is a wizard that differs by reason (custom radios, a 120 character minimum, a masked date field, saved drafts).
- **"Item not received" on an order that already has tracking skips the inquiry stage.** PayPal moved it straight to a claim under review, with only `provide_supporting_info` offered and no seller deadline. We restructured seeding into flows and gave such cases a desk target date of our own.
- **Time in the sandbox is real.** A dispute takes 3 to 4 minutes to appear in the list. `escalate` returns at once but the claim appears about 11 minutes later. The sandbox settle link appeared about half an hour after evidence was filed. So the desk only shows an action when PayPal lists it, and the video cuts the waits and says so.
- **PayPal rewrites `dispute_amount` after an accepted offer.** Our first outcome screen said $0 kept. The desk now keeps the original amount.
- **Reasoning models that say nothing.** On some prompts both text models spent their whole token budget on hidden reasoning and returned an empty answer. We measured which request option stops that for each model and use it for the writing tasks.
- **Two copies of one HTTP library.** The Agent Toolkit loads the CommonJS build of axios and our server bundle loaded the ES module build, so our logging saw none of the toolkit's calls in production. The drawer now logs both.
- **Turbopack ran out of memory** on the Scheduler bundle, so the app builds with webpack.
- **A test run wiped the working desk**, because the store resolved its folder at import time. The store now resolves it per call and the tests use their own folder.

## Accomplishments that we're proud of

- A full, real loop in the sandbox: a buyer-opened dispute, evidence filed through the API with a PDF attached, PayPal's decision, the hold released, and the money counted, all shown with PayPal-Debug-Ids.
- The money decision is in code and tested. The model explains and writes, and every AI output is tagged with the model that produced it.
- The board is a working schedule, not a picture of one: deadlines, working hours, drag, resize, reflow, and missed work that is booked again.
- An honest demo: Replay is labeled, seeded shop records are labeled, the win estimate is labeled as an estimate, and the limitation is said out loud in the video.

## What we learned

- Read `links` before every action. PayPal's allowed actions change with stage, status and time, and they are the only reliable guide.
- Treat a webhook as a hint and PayPal as the record: re-read before showing or acting.
- Keep the model away from numbers. Rules decide, the model reads and writes.
- Small sellers do not need a dashboard. They need the next piece of work, on a calendar, with the evidence already gathered.

## What's next

- Learn the evidence weights from resolved cases instead of fixed points.
- Connect real order systems and carriers for scans, signatures and photos.
- Card chargebacks and appeals on the same board.
- Sign-in per person, and a daily digest from Marlow.

## Built with

Next.js, React, TypeScript, Tailwind CSS, PayPal Disputes API, PayPal Orders API, PayPal Payments API, PayPal Transaction Search API, PayPal Webhooks, PayPal JS SDK v6, PayPal server SDK (`@paypal/paypal-server-sdk`), PayPal Agent Toolkit, Bryntum Scheduler, APIMatic PayPal Context Plugin, Vercel AI SDK, W&B Inference, Qwen, Gemma, GLM, Vercel Blob, Playwright, pdf-lib, Vitest, ElevenLabs, ffmpeg.

## Tools: which AI models and services were used and how

- **Claude Code**: AI coding agent used to build the app, tests, docs and video pipeline from a written brief, with the APIMatic PayPal Context Plugin skills, working against the PayPal sandbox.
- **Qwen/Qwen3.8-27B** on W&B Inference: in the product, for explaining recommendations, drafting dispute responses, phrasing prevention cards and scheduling notes, and as the tool-calling agent.
- **google/gemma-4-31B-it** on W&B Inference: in the product, reading delivery and damage photos.
- **zai-org/GLM-5.3-Flash** on W&B Inference: in the product, the fallback text model.
- **ElevenLabs** (`eleven_multilingual_v2`, premade voices): the video narration and Marlow's pre-rendered voice lines. 5,325 characters in total. The hosted app never calls ElevenLabs.
- **APIMatic PayPal Context Plugin**: its skills guided the PayPal integration (plan file and contract sheet, facts looked up rather than recalled, durable writes).
- **Vercel AI SDK**: model calls and tool calling.

## PayPal products used

- **Disputes API v1**: list, show, provide evidence, provide supporting info, make offer, send message, accept claim, escalate, and the sandbox-only adjudicate.
- **Orders API v2**: create, capture, show, add tracking.
- **Payments API v2**: show captured payment.
- **Transaction Search API**.
- **Webhooks**: `CUSTOMER.DISPUTE.CREATED`, `UPDATED`, `RESOLVED`, with signature verification.
- **PayPal JS SDK v6**: checkout on the demo store.
- **PayPal server SDK** (`@paypal/paypal-server-sdk`) and **PayPal Agent Toolkit** (`@paypal/agent-toolkit`).
- **PayPal sandbox**, including the buyer's Resolution Center, which the seed drives to open real disputes.

## Sponsor tools used

- **Bryntum Scheduler** (trial build): the triage board, which is the main screen of the product.
- **APIMatic**: the PayPal server SDK it generates, and the PayPal Context Plugin, used as described in the README.

## Links

- Hosted demo: https://hack-pp-disputedesk.vercel.app
- Video: https://youtu.be/dLU-_NTq-0U
- Repository: https://github.com/chinesepowered/hack-pp-disputedesk
