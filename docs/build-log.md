# Build log

Dated notes of what surprised us in the PayPal sandbox and the sponsor tools, the walls we hit and
how we got around them. Times are UTC.

## Tue Nov 10

### Setup

- **APIMatic Context Plugin installer.** `npx skills add .../plugins/paypal/skills/typescript` was
  not allowed to run in the build sandbox (it executes downloaded code). Used the brief's fallback:
  cloned `context-plugins/plugin-marketplace`, read `plugins/paypal`, and copied the nine
  `typescript-*` skills into `.claude/skills/` unchanged.
- **The plugin documents a different package than the brief pins.** Its skills describe APIMatic's
  newer generated SDK (`paypal`, `PaypalClient`, v2.29, installed from git, with an `sdk-map.md`
  inside the package). The brief pins the published `@paypal/paypal-server-sdk` 2.5.0. We kept the
  published package and applied the plugin's method to it: a plan file with a contract sheet
  (`paypal-plan.md`), contract facts looked up in the installed package's type declarations
  rather than recalled, claim then call then record for writes, re-read on unknown outcomes, and
  one error mapping at the API boundary.
- **Bryntum trial postinstall.** `@bryntum/scheduler-trial` and `@bryntum/scheduler-trial-lib`
  ship obfuscated `postinstall` scripts. pnpm 10 does not run dependency build scripts unless they
  are allow-listed, so they never ran. The Scheduler works without them.
- **Versions.** `@paypal/agent-toolkit` 1.11.0 depends on `ai` v4 and `zod` v3, so the app uses the
  Vercel AI SDK v4 (4.3.19) and zod v3 to share tool objects with the toolkit instead of the
  newest majors.

### Seeding through PayPal's own buyer pages

- **No captcha on the sandbox buyer login** from headless Chromium, on both the checkout
  approval page and `sandbox.paypal.com/myaccount`. Approving an order with a saved session takes
  about six seconds.
- **Buyer and seller transaction ids differ.** The Disputes filing page needs the buyer-side id
  (`/resolutioncenter/filing/<buyer txn id>/create?type=PAYMENT`). The seed finds it by opening
  recent Activity rows and matching the ship-to name, which each seed order sets uniquely.
- **The "Report a problem" form is a wizard that differs by reason.** What tripped the automation:
  - A half-finished filing is saved as a draft and offered again next time ("Continue reporting"
    or "Start over").
  - Radios and dropdowns are custom controls: click the label, or use the hidden native `select`.
  - "Not as described" needs a comment of **at least 120 characters**, a received date, and a
    second comment when the buyer keeps the item.
  - The date field's untouched value is its mask (`MM/DD/YYYY`), so "is it empty" has to mean
    "has no digits".
- **Creating disputes through the API did not work for us.** `POST /v1/customer/disputes` is not in
  PayPal's public OpenAPI document. With the seller's capture id it answers
  `TRANSACTION_NOT_ELIGIBLE`; with the buyer's transaction id it answers
  `MISSING_OR_INVALID_REQUEST_BODY` for every body shape we tried. The seed uses the buyer pages.

### Disputes API behaviour (all observed in the sandbox)

- **A new dispute is readable by id at once but takes 3 to 4 minutes to appear in
  `GET /v1/customer/disputes`.** It starts as `OPEN` / `UNDER_PAYPAL_REVIEW` with only a `self`
  link, then becomes `WAITING_FOR_SELLER_RESPONSE` with its real links.
- **"Item not received" on an order that already has tracking skips the inquiry stage.** PayPal
  moves it to the claim stage (`CHARGEBACK`) with status `UNDER_REVIEW` within about three minutes
  and places a hold (`fund_movements`: `HOLD_PLACED`). The seller is offered only
  `provide_supporting_info` at first; `accept_claim` joins about 20 minutes later. There is no
  `seller_response_due_date` in this state, so the desk sets its own target date.
- **"Not as described" inquiries do not offer `provide_evidence`.** Links are `send_message`,
  `make_offer`, `accept_claim` and `escalate`. "Not received" inquiries without tracking do offer
  it, with `PROOF_OF_FULFILLMENT` requested.
- **`provide-evidence` is multipart:** a part named `input` holding
  `{"evidences":[{...}]}` as `application/json`, followed by the files. It worked first time with a
  PDF. After it, an inquiry moves to `WAITING_FOR_BUYER_RESPONSE`; a claim moves to `UNDER_REVIEW`.
- **`escalate` is asynchronous.** The call returns 200 at once; about 11 minutes later the case is
  at the claim stage, `WAITING_FOR_SELLER_RESPONSE`, with a new, nearer due date (10 days) and
  `PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND` and `OTHER` requested.
- **The sandbox-only links arrive late.** After evidence was filed on a claim, `adjudicate` and
  `require_evidence` were refused with `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` for about 27
  minutes, then appeared in `links`, and `adjudicate` (`SELLER_FAVOR`) succeeded. Calling them
  before they are listed fails, so the desk only shows "Settle in sandbox" when the link is there.
- **`adjudicate` settles asynchronously.** The call returns a `self` link; about two minutes later
  the dispute is `RESOLVED` with `RESOLVED_SELLER_FAVOUR`, an `adjudications` entry and a
  `HOLD_RELEASED` fund movement.
- **The sandbox-only endpoints accept JSON only.** A multipart `adjudicate` gets
  `UNSUPPORTED_MEDIA_TYPE`, although the OpenAPI document lists multipart for it.
- **A disputed capture reads as `PENDING`** in `GET /v2/payments/captures/{id}` while the hold is on.
- **Transaction Search had nothing for a payment made an hour earlier** (the documented lag), so
  the case file treats an empty result as "not indexed yet".

### More Disputes API behaviour (later the same day)

- **"Not received" plus tracking is escalated by PayPal, even when the tracking is added
  seconds after the dispute.** Within about three minutes the case is at the claim stage
  (`CHARGEBACK`), `UNDER_REVIEW`, and it cannot be settled in the sandbox (`adjudicate` and
  `require-evidence` answer 422 `EVIDENCE_TYPE_IS_NOT_ALLOWED`). Tracking added to an inquiry that
  has already settled into `WAITING_FOR_SELLER_RESPONSE` does not trigger this. The seed was
  restructured into flows (`inquiry`, `claim`, `direct_claim`, `ready_to_settle`) and adds
  tracking in a later staging pass where the scenario needs a clean claim.
- **An escalation shows up as seller evidence.** After `escalate`, the dispute's `evidences`
  holds an entry with `source: SUBMITTED_BY_SELLER`, `evidence_type: OTHER` and
  `action_info.action: ESCALATE`. Our stepper counted that as "Approved and filed" on a claim
  nobody had answered yet. Escalation entries are now ignored when deciding whether the seller
  has responded.
- **An accepted partial refund offer resolves as `RESOLVED_BUYER_FAVOUR`** with
  `outcome_reason: INQUIRY_OFFER_PARTIAL_REFUND` and `amount_refunded`, and PayPal rewrites
  `dispute_amount` to the refunded amount. Our first outcome banner said "$0 kept" on a $62 case
  settled for $31. The desk now keeps the original amount (from the disputed transaction) and
  reports what was kept.
- **An accepted claim resolves as `RESOLVED_BUYER_FAVOUR` / `SELLER_ISSUED_REFUND`** about a
  minute after `accept-claim` returns.
- **Right after `send-message` an inquiry reads `UNDER_REVIEW` with no actions listed.** A few
  minutes later it is `WAITING_FOR_BUYER_RESPONSE` with `accept_claim`, `send_message` and
  `escalate` (no `make_offer`). `provide-supporting-info` on a claim PayPal is reviewing keeps
  `provide_supporting_info` and `accept_claim` in `links`, so it can be sent more than once.
- **Timings we measured for one claim:** evidence filed at 17:08:50 UTC; `adjudicate` first
  listed in `links` between 17:36:40 and 17:37:29 (about 28 minutes); settled 152 seconds after
  the `adjudicate` call. The video cuts both waits and says so.
- **PayPal's fee page and User Agreement.** The merchant fees page could be fetched (standard
  dispute fee 15.00 USD, high volume 30.00 USD, "We may charge a Dispute Fee when a buyer files a
  dispute claim or chargeback"). The User Agreement, which lists when the fee is not charged,
  returned no body text to our fetcher, and the Seller Protection page returned 403. So the
  video and README say a lost claim "can" cost a fee, and the economics treat the fee as a
  setting.

- **The buyer's "Report a problem" page can stop offering item disputes.** After the sandbox
  buyer had opened about 26 disputes in one day, the page for its two newest payments listed only
  "Billing errors or issues with subscriptions" and "Unauthorized activity". The "item not
  received" and "not as described" options were gone, for payments that were otherwise the same
  as ones disputed minutes earlier. We did not find the rule. The seed reports the step as
  failed and can be re-run; a second buyer account is the fallback.
- **Evidence arrives after the dispute.** The desk gathered a case's evidence once, when the
  dispute first appeared. Tracking added a few minutes later (which is what our own seed does
  for claim cases) never reached the checklist, so a strong case read 75% with "no tracking on
  the PayPal order". Evidence is now read again when it is more than five minutes old and the
  seller can still act, and a draft that was written from the older evidence is replaced unless
  a person edited it.

### Models (W&B Inference)

- **Both text models reason before they answer, and the reasoning counts against
  `max_tokens`.** A 260 token budget came back empty with `finish_reason: length`. We first
  added 3,000 tokens of headroom to every call.
- **Headroom was not enough for some prompts.** Drafts for "offer" and "accept" cases came back
  empty from both models after 45 seconds: 3,420 completion tokens, zero characters of content.
  The template letter was being used without anyone noticing, because the error was swallowed.
  The error now reports the finish reason and token count.
- **What stops the reasoning differs by model** (`scripts/dev/reasoning-probe.ts`, same prompt):
  Qwen answered in 2 seconds with `chat_template_kwargs: {"enable_thinking": false}` (195
  completion tokens instead of 1,613) and ignored `reasoning_effort`; GLM answered in 1.5
  seconds with `reasoning_effort: "low"` and ignored the chat template switch; `/no_think` in
  the prompt did nothing for either. The writing tasks now send the right field for each model.
  A case builds in 4 to 8 seconds instead of 45 or more. The tool-calling agent keeps its
  reasoning.
- **A model asked for "the most urgent booking" will pick one.** The scheduling note named the
  wrong case as most urgent because nothing in its input said which was. The list is now sorted
  by deadline in code and the prompt says the first line is the nearest deadline.
- **The model called a PayPal claim a "chargeback"** because PayPal's stage name is
  `CHARGEBACK`. Prompts and the evidence pack now translate the stage to "claim".

### Agent Toolkit

- **Two builds of axios.** `@paypal/agent-toolkit` is CommonJS and loads `axios` with
  `require`, which resolves to `dist/node/axios.cjs`. Our server bundle imported the ES module
  build. They are separate instances with separate interceptors, so the logging we attached saw
  every toolkit call under `tsx` and none in the production build. The logger now attaches to
  both builds (the second one through `process.getBuiltinModule("node:module").createRequire`,
  because webpack rewrites a plain `createRequire` import).
- **The toolkit's `accept_dispute_claim` moves money**, so the agent is given a guarded tool
  with the same name instead: links, thresholds, then the same filing path as a person's click.
  Run live: a $12 "not received" inquiry with no tracking was accepted by Marlow under the
  owner's under $15 rule.

### Bryntum Scheduler

- **Turbopack ran out of memory** compiling the Scheduler module (the dev server was killed at
  12 GB). `pnpm dev` and `pnpm build` use webpack.
- **The event editor's `items` and `editorConfig` threw** "Cannot destructure property
  'startDateField'" in 7.3.8 when customized, so the default editor is used.
  `createEventOnDblClick` is not a prop in 7.x.
- **Timeline rows are as wide as the whole time span**, so a row's bounding box starts far to
  the left of the visible area once the timeline is scrolled. Aim drags at the Scheduler's own
  box, not the row's.
- **A calendar board goes stale.** Blocks booked this morning are in the past by lunch, and a
  judge opening the board a day later would see an empty week. Blocks whose time has passed with
  no response now go back to Unscheduled and are booked again, and the timeline opens at the
  next booked block.
- The trial package was only run on localhost in the build environment. After deploying, the
  hosted board loads and works the same way, with the trial watermark (see `docs/deploy.md`).

### Our own mistakes

- **A test run wiped the working desk.** The store resolved its folder when the module was
  imported, before the test set its own folder, so `pnpm test` wrote an empty desk over
  `.data/desk.json`. The store now resolves the folder on every call and Vitest sets it in its
  config. The desk was rebuilt by reading PayPal again (which is the design: PayPal is the
  record).
- **Two writes of one document in the same millisecond shared a temp file**, and one rename
  failed. In Replay that silently dropped three of seven cases from the first board load. Temp
  files are now unique, and read, change, write on one document runs under a lock, which also
  makes the filing claim atomic within a server instance.
- **The first narration overstated two things** ("under a minute", "about twenty minutes").
  Both were replaced with what we measured ("three clicks", "almost half an hour").
