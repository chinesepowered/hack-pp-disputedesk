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
