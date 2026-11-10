# Dispute Desk (working name)

**PayPal AI Hackathon** (paypalaihackathon.devpost.com). Built in Claude Code web from this repo. This file is the
whole brief: read all of it, including the shared rules at the end, before you start.

**Prize targets:** Best Use of PayPal + AI, the grand prizes. Sponsor prize: **Bryntum** (Scheduler). This is
Bryntum's own suggested "dispute triage board" idea, so build it really well. Also eligible for APIMatic.

## The idea

An AI dispute and chargeback desk for small PayPal sellers.

Small online sellers lose disputes they could win, mostly by missing the response deadline or by sending the wrong
evidence. Every lost case costs the sale, the goods and a fee. In PayPal's API, card chargebacks and PayPal buyer claims
both arrive as disputes, so one desk handles both.

**Who it's for:** small PayPal merchants with 1 to 10 staff, such as handmade shops, small DTC brands and plant
shops, where nobody owns disputes full time.

## The flow

1. **Intake.** New disputes arrive through webhooks (`CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`,
   `CUSTOMER.DISPUTE.RESOLVED`) and through polling `GET /v1/customer/disputes`.
   - Each dispute shows its reason, stage (inquiry, chargeback and so on), amount, `seller_response_due_date`, and the
     actions PayPal allows right now (the dispute's `links`).
2. **Triage board** (Bryntum Scheduler, the hero screen).
   - One row per team member, plus a row for Marlow (the agent).
   - Each dispute is a work block sized by expected effort and placed before its deadline. Deadline markers are drawn as
     time ranges or lines. Blocks are colored by evidence readiness: missing, partial or ready.
   - An **Unscheduled** panel highlights disputes that have a deadline but no time booked (exactly Bryntum's example).
     Drag a dispute from it onto the timeline.
   - Marlow auto-schedules new disputes into free time before their deadlines, respecting each person's working hours
     (seed data). It reflows when someone drags a block. Drag to reassign; resize to change effort. Tooltips show the
     amount, deadline and readiness.
3. **Case file** (per dispute).
   - Marlow gathers evidence from PayPal: the order and capture (Orders and Payments), the tracking added at fulfillment
     (`POST /v2/checkout/orders/{id}/track` during seeding), and transaction details.
   - It also gathers the store's own records (seeded): the product page and photos, the return policy, the customer
     message thread, the carrier's delivery photo, and the IP and address match for unauthorized claims.
   - A deterministic **reason to required evidence** table (in the repo, with the PayPal docs it came from) drives a
     checklist of what's present and what's missing.
4. **Recommendation:** fight, offer or accept, with plain-English reasoning that cites the evidence.
   - Win likelihood is a clearly labeled estimate from transparent rules. Example: signed delivery to the matching
     address on a "not received" claim is strong.
   - The economics are shown: the amount at stake, the staff time to respond, the fee.
   - The merchant sets thresholds in Settings, for example "auto-accept under $15 when evidence is weak" or "always ask
     me above $200".
5. **Draft.** Marlow writes the response and assembles an evidence pack: a PDF with a cover letter, timeline, tracking
   and photos (render HTML to PDF with Playwright). The merchant edits or approves.
6. **File.** On approval, it acts through the Disputes API:
   - `provide-evidence`: multipart, a JSON part plus files. Send one evidence type per call, and only the types PayPal
     asked for.
   - `send-message`, `make-offer` (for example a partial refund), `accept-claim`, `acknowledge-return-item`, `appeal`.
   - Only show a button when its action is in the dispute's `links`.
7. **Outcome.**
   - Resolved events update the board, and a "Recovered this month" counter goes up.
   - For the demo lifecycle, the sandbox-only endpoints help. `require-evidence` moves a case to seller response when
     PayPal offers that link. `adjudicate` ("Settle dispute") settles a case after evidence is in.
8. **Prevention.** Marlow looks for patterns across cases and suggests fixes as cards. Examples: one product drawing
   "not as described" means better photos or a size chart. One carrier drawing "not received" means requiring a
   signature over $X. Unauthorized claims from one region mean verifying mismatched addresses.

## Seeding: do this first, day 1
`pnpm seed`:
1. **Orders.** Create 12 to 15 orders from the fictional store "Juniper & Moss" (houseplants, pots, plant care). The
   sandbox buyer pays each with their **PayPal account**: Playwright approves in PayPal's window, then you capture
   through the API. Add tracking to most of them.
2. **Disputes.** Open them as the buyer:
   - Playwright logs in to `https://www.sandbox.paypal.com` as the buyer, opens each transaction under Activity, uses
     "Report a problem", picks a reason (not received, not as described, unauthorized and so on) and submits.
   - Disputes take a few minutes to show up in the API.
   - Escalate some to claims (on the buyer side, or with the `escalate` endpoint) to get later stages.
   - Mix amounts from $12 to $240, with some strong evidence and some weak.
3. **If the buyer site blocks automation** (captcha or similar), write `docs/seed-disputes-by-hand.md` with exact clicks
   for about 10 minutes of manual work. Put it at the top of `docs/needs-user.md`, and build against Replay fixtures in
   the meantime.

**Sandbox notes:**
- Disputes must be enabled on the sandbox app.
- State transitions are strict: PayPal refuses actions the current state doesn't allow
  (`ACTION_NOT_ALLOWED_IN_CURRENT_STATE`), so always read `links`.
- The inquiry stage limits what evidence can be filed.
- `adjudicate` may settle asynchronously, so poll.
- Log what you learn in `docs/build-log.md`.

**The hosted demo uses up disputes:** each one can only be filed once, and reset can't un-resolve a dispute.
- Seed enough that at least 6 untouched disputes are left for judging.
- When the pool runs low, switch the affected cases to Replay and say so in the UI.
- Document how the local session can top up the pool by re-running the seed.

## AI
- Read documents and photos: does the delivery photo show a package at a door? Does the product photo match the
  complaint?
- Write the response, explain the recommendation, and summarize patterns.
- Scheduling is a deterministic algorithm; the AI explains its choices ("booked Sam Tuesday 10:00, the earliest slot
  before Friday's deadline").
- Agent Toolkit tools: `list_disputes`, `get_dispute`, `accept_dispute_claim`. Add your own tools for
  `provide_evidence`, `make_offer`, `send_message` and `schedule_work_block`, each checked in code against the
  dispute's `links` and the merchant's thresholds.

## Bryntum (the sponsor prize)
- Install `@bryntum/scheduler@npm:@bryntum/scheduler-trial@7.3.8` and `@bryntum/scheduler-react@7.3.8` (the public
  trial; no key needed). Load it client-only.
- Resources are people plus Marlow. Events are work blocks. Time ranges show deadlines.
- Use: drag and drop, resize, the event editor, dragging from the unscheduled grid onto the timeline (Bryntum has a
  demo of this pattern), rich tooltips, and a theme that matches the app.
- The agent edits the Scheduler through its store and API, so the changes animate on screen.
- The trial shows a watermark. That's fine.
- If the trial build won't run outside localhost, write that in `docs/build-log.md` and the README.

## Mascot
**Marlow**, a calm capybara clerk with reading glasses and a clipboard. Tagline idea: "Marlow keeps calm when a
chargeback lands." Light touch on the board; more presence in empty and success states.

## The aha
A $184 "never arrived" case goes from new to filed in under a minute:
1. Marlow books time before the deadline.
2. It builds the case from PayPal's own tracking and the carrier's delivery photo.
3. The merchant approves, and the evidence is filed.
4. PayPal settles it: "Won, $184 recovered."

## Video outline
1. Cold open: a dispute lands, and the deadline clock is running.
2. The board fills in, and Marlow schedules the work.
3. The case file and recommendation, then the merchant approves and it's filed through the Disputes API (named on
   screen).
4. The sandbox settles it, and the counter goes up.
5. Second case: the item doesn't match its description. A partial refund offer resolves it.
6. A prevention card.
7. One limitation.
8. End card.

## Keys for this build
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox app `hack-pp-disputedesk`, with Disputes and Transaction search
  enabled), `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same value as the client id), `PAYPAL_ENVIRONMENT=sandbox`.
- `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD`: the buyer who pays and opens disputes.
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_FALLBACK_MODEL`.
- `ELEVENLABS_API_KEY`.
- Generate yourself: `DEMO_ADMIN_TOKEN`.

## Cut first if short on time
Prevention cards, the PDF pack (an HTML evidence page is fine), the appeal flow.

---

## Shared rules (all six PayPal builds)

Six different builds from the same team share these rules. Stay inside this build's idea.

### Deadline and split
- Devpost submissions close **Thu Nov 12 2026, 12:00 PM PT**. Push the finished app, README, screenshots, Devpost
  drafts and the video to `main` by **Wed Nov 11, 9:00 PM PT**. If something isn't done by then, push what works and keep
  going; the local session takes the last push before 6:00 AM PT Thu.
- Suggested order: **Mon Nov 9** the PayPal flow working end to end in the sandbox, the seed script and the AI core;
  **Tue Nov 10** the sponsor tool, the full UI and Replay mode; **Wed Nov 11** polish, tests, screenshots, video, docs.
- You (cloud) build and test everything, record the video and write the docs. The local session deploys to Vercel,
  registers the webhook, uploads the video to YouTube, makes the repo public and submits on Devpost. Don't make the repo
  public, don't deploy and don't submit.
- If you are blocked on something only the user can do (a PayPal dashboard setting, a manual sandbox step), write it at
  the top of `docs/needs-user.md`, mention it in your next message, and carry on with everything else.

### What the hackathon requires
- Meaningful use of at least one PayPal developer technology in the **sandbox**, and meaningful use of AI. A working
  prototype: judges must be able to run or click it (we provide a hosted URL; the README also has full run
  instructions). A design mockup or static prototype doesn't count.
- Public repo with all source, assets and run instructions, and an open-source license GitHub detects. `LICENSE`
  (AGPL-3.0) is already in the repo; add `TRADEMARKS.md` reserving the product name and mascot.
- A demo video under 3 minutes that shows the project working end to end, with no third-party trademarks and no
  copyrighted music. PayPal's own UI is fine (PayPal is the sponsor). Keep other brands' logos out of frame.
- Stage one is pass/fail: the project fits the theme and really uses PayPal. Stage two scores, equally weighted:
  **Technological Implementation** (thorough, skillful, non-trivial use of PayPal and AI), **Design** (a complete,
  coherent product, not a proof of concept), **Potential Impact** (a credible, specific problem for a real audience,
  shown being solved), **Innovation**, and **Presentation** (the video shows it working end to end and says who it's for
  and why it matters).
- A project can win one main prize plus one sponsor prize. Every build also uses APIMatic (below), so it stays eligible
  for that sponsor prize on top of its own.
- Sandbox only. Never use live PayPal credentials or real money, and don't sign up for paid services.

### PayPal, done the way PayPal's judges will look for it
- Before writing PayPal code, read the PayPal AI Toolkit: `git clone https://github.com/paypal/AI-Toolkit
  /tmp/paypal-ai-toolkit` and read its skills, especially `paypal-best-practices` and the SDK v5 and v6 references.
- Install APIMatic's PayPal Context Plugin skills for TypeScript into this repo and use them while building the PayPal
  integration: `npx skills add https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal/skills/typescript`
  (if that fails: `npx context-plugins install paypal`, or clone `context-plugins/plugin-marketplace` and read
  `plugins/paypal`). The APIMatic prize is for builds that used the Context Plugin, so say in the README how you used it.
- Server calls: `@paypal/paypal-server-sdk` (2.5.x, generated by APIMatic) wherever it covers the API; plain REST with
  the same OAuth token helper for anything it doesn't (Disputes, Payouts, Invoicing, Subscriptions, Webhooks as needed).
  Base URL `https://api-m.sandbox.paypal.com`. Send a `PayPal-Request-Id` on every POST.
- The agent's PayPal tools come from `@paypal/agent-toolkit` (1.11.x) where it has them (orders, refunds, invoices,
  disputes, subscriptions, shipment tracking, transactions). Wrap any tool that moves money so it enforces this app's
  rules in code before PayPal is called. Write your own tools for the rest.
- Browser checkout: PayPal **JS SDK v6** where it supports the flow. If a flow isn't in v6 yet (check the toolkit's
  references), use v5 for that flow and say why in the README.
- Webhooks: `/api/paypal/webhook` with signature verification (`POST /v1/notifications/verify-webhook-signature`) and
  idempotent handlers, plus `pnpm paypal:webhook <public-url>`, which registers the URL and this build's event types
  through the API and prints the webhook id (the local session runs it after deploying). Never depend on delivery
  alone: also poll PayPal whenever a screen needs fresh state, so everything works without a public URL.
- Seed data: `pnpm seed` creates this build's realistic sandbox data through the API (idempotent, safe to re-run) and
  prints what it made. Where a step needs the buyer to approve in PayPal's window, automate it with Playwright using
  the sandbox buyer login. Sandbox facts: transaction search lags up to about 3 hours; authorizations are honored for 3
  days and valid for 29 (reauthorize when capturing after day 3); a payout to an email with no PayPal account stays
  UNCLAIMED.
- Make the PayPal work visible: an **Under the hood** drawer listing every PayPal call the current session made (method,
  path, status, `PayPal-Debug-Id`, which feature triggered it), and a small "AI" tag on every AI-produced output naming
  the model.

### AI
- Free W&B Inference, OpenAI-compatible: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (`Qwen/Qwen3.8-27B`; tool
  calling works), `OPENAI_VISION_MODEL` (`google/gemma-4-31B-it`), and `OPENAI_FALLBACK_MODEL`
  (`zai-org/GLM-5.3-Flash`; it always returns `reasoning`, so budget `max_tokens` and handle `content: null`). Both Chat
  Completions and the Responses API answer. Server-side only, `maxRetries: 4`, 60 s timeout (about 1 call in 20 fails
  without retries); fall back to the fallback model after repeated failures.
- Use the Vercel AI SDK (or the OpenAI SDK) with tool calling. Money decisions stay deterministic: the model proposes,
  code checks the rules, and a person approves wherever this brief says so. Log each agent step so the UI can show its
  reasoning trail.
- Rate-limit AI routes per IP on the hosted demo.

### Hosting and state (the local session deploys to Vercel)
- Next.js (App Router) + TypeScript + **pnpm**, deployable to Vercel as is: no long-running processes, webhooks and jobs
  are API routes, and browser-only components (Bryntum, cameras) load with `dynamic(..., { ssr: false })`.
- Persist app state through one small `lib/store.ts` (JSON documents by key): files under `.data/` in development,
  Vercel Blob (`@vercel/blob`) when `BLOB_READ_WRITE_TOKEN` is set (the local session creates the store when deploying).
  PayPal stays the source of truth for money: store PayPal ids and re-read status from PayPal.
- A protected `POST /api/admin/reset` (header `x-admin-token`, checked against `DEMO_ADMIN_TOKEN`) that restores the
  seeded demo state, so judges land on a clean demo.
- A clearly labeled **Replay** mode that runs the main flow from recorded real sandbox and AI responses (fixtures in the
  repo), for when the sandbox or the model is down. Live is the default.

### Keys (environment variables, never in the repo)
- The keys for this build are listed in its section above. Everything is server-side except `NEXT_PUBLIC_*`. Generate
  any secrets the brief says to generate yourself, and keep them only in `.env.local`.
- `.env*` is git-ignored; `.env.example` lists the names only, with a comment on where each comes from.
- Before the last push, check the whole history for every key value in your environment:
  `for v in $(env | grep -E '^(PAYPAL_CLIENT_SECRET|PAYPAL_SANDBOX_BUYER_PASSWORD|OPENAI_API_KEY|ELEVENLABS_API_KEY|CHANNEL3_API_KEY|AG_STUDIO_LICENSE)=' | cut -d= -f2-); do git grep -nF "$v" $(git rev-list --all) && echo LEAK; done`
  must print nothing.

### Git
- Before the first commit: `git config user.name "chinesepowered"` and
  `git config user.email "22500229+chinesepowered@users.noreply.github.com"`. No `Co-Authored-By` or other AI
  attribution lines in commit messages.
- Commit to `main` and push to `origin main` at least every couple of hours. If the session makes you work on a
  `claude/*` branch, merge it into `main` at the end and delete the branch.

### Writing and quality
- **No em dashes** anywhere: UI, README, docs, commit messages, narration.
- Statistics only with a fetched, cited source (list the sources in the README). All people, businesses and products are
  fictional; stock photos only with a license that allows it, credited in `docs/CREDITS.md`.
- Mobile-first and responsive. Accessible to WCAG 2.2 AA (contrast, focus states, labels, keyboard use, live regions
  for async updates); say what you did in the README.
- `pnpm build`, `pnpm lint` and `pnpm test` (Vitest, covering the deterministic money rules) must pass.
- Keep `docs/build-log.md`: dated notes of PayPal and sponsor-tool surprises, walls and workarounds. It feeds the
  Devpost "challenges" section.

### Mascot
- An original capybara character, drawn as SVG by you. No third-party art, and nothing resembling Kapibara-san or any
  other existing character. It has a job in the product (persona, voice, empty, loading and success states) and its
  own name and look, described in this build's section. On business screens, keep it a light touch.

### Deliverables
1. The working app, live against the sandbox, plus Replay mode.
2. `README.md` for judges: a one-line pitch; the problem and who it's for; the aha; a 60-second tour with screenshots;
   how it works (a Mermaid architecture diagram); **every PayPal API and feature used, endpoint by endpoint, and where
   in the code**; the AI: which models, for what, and the guardrails; the sponsor tools (APIMatic plus this build's
   sponsor tool, if any) and how they were used; how to run it locally (sandbox app setup, env vars, `pnpm seed`);
   sandbox test logins for judges (sandbox only, no real money); limitations and what's next; credits; license.
3. `docs/screenshots/*.png`: 6 or more real app states at 1440x960.
4. `docs/devpost.md`: project name; a tagline under 200 characters; inspiration; what it does; how we built it;
   challenges; accomplishments; what we learned; what's next; a built-with list; "Tools: which AI models and services
   were used and how"; PayPal products used; sponsor tools used.
5. **The video:** `demo/video.mp4` (1920x1080 H.264, under 3:00, aim for 2:20 to 2:45, under 50 MB) plus
   `demo/thumb.png` (1200x800) and `demo/narration.txt`.
   - Record real runs of the app with Playwright (headless Chromium, `recordVideo`). Render title and caption cards
     from HTML. Compose with ffmpeg.
   - Narrate with ElevenLabs (`ELEVENLABS_API_KEY`, model `eleven_multilingual_v2` or newer, narrator voice
     `cgSgspJ2msm6clMCkdW9`). The mascot may speak short lines in a different premade voice.
   - Structure: a 10-second cold open on the problem; who it's for; the flow end to end with money visibly moving in
     PayPal; the AI doing work a person would otherwise do; PayPal APIs named on screen as they're used; the sponsor
     tool on screen; one honest limitation; an end card with the name.
   - No music, unless you generate it with ElevenLabs on this key; keep any music quiet under the voice.
   - Budget: **under 15,000 ElevenLabs characters for this build in total**. Pre-render the mascot's in-product voice
     lines into `public/audio/`, so the hosted demo never calls ElevenLabs.
   - If you can't produce the video, write `docs/demo-script.md` instead (scenes, exact clicks, narration per scene)
     and put stable `data-testid` attributes on everything it touches.
6. Your last message: what works and what doesn't; how to deploy (env vars, Blob, `pnpm seed`, `pnpm paypal:webhook`);
   which sandbox accounts the seed uses; ElevenLabs characters used; where the video is.
