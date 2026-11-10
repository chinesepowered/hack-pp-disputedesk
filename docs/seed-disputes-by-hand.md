# Opening seed disputes by hand

`pnpm seed` opens every dispute automatically by driving PayPal's own sandbox pages as the buyer,
and that works today (see `docs/build-log.md`). This page is the fallback for the day PayPal
changes those pages or starts showing a captcha: about 10 minutes of clicking for a full batch.

You need the sandbox buyer login from `.env.local` (`PAYPAL_SANDBOX_BUYER_EMAIL` and
`PAYPAL_SANDBOX_BUYER_PASSWORD`). Sandbox only: no real money is involved.

## 1. Create the orders without disputes

```bash
pnpm seed --batch D --no-disputes
```

This creates, approves, captures and tracks the orders and prints one line per order with its
invoice number (`JM-4041` and so on). If the approval step is the part that is blocked, open each
printed `payer-action` link in a browser, log in as the buyer and press **Complete Purchase**,
then run the same command again: it continues from where it stopped.

## 2. Open each dispute as the buyer

1. Go to <https://www.sandbox.paypal.com> and log in as the sandbox buyer.
2. Open **Activity**. Each seed payment shows as a payment to the test store.
3. Click a payment to expand it. The **Ship to** name tells you which order it is (the table
   below lists them). Click **Report a problem**.
4. Pick the issue:
   - not received: **I haven't received the item or service**
   - not as described: **I received an item or service that was different or not as described**
   - unauthorized: **I suspect my account is being used by someone else**
5. Work through the form:
   - Item type **Physical product**, category **Home**.
   - Not received: choose **The item hasn't reached me or I refused delivery**, enter the full
     amount as the expected refund, answer the "contacted the seller" question either way.
   - Not as described: the comment must be **at least 120 characters**. Enter today's date as
     the date received, the full amount as the expected refund, and choose **No** for returning
     the item (then give a short reason).
   - Paste the buyer's words from the table as the note.
6. Press **Submit**. PayPal shows a case id that starts with `PP-R-`.

| Ship to | Item | Amount | Issue | Buyer's words |
| --- | --- | --- | --- | --- |
| Priya Raman | Fiddle Leaf Fig | $184 | not received | My fiddle leaf fig never arrived. The seller says it was delivered but I do not have it. |
| Marcus Bell | Speckled Ceramic Planter | $62 | not as described | The planter is much smaller than the photo suggests and the colour is different. I want some of my money back. |
| Dana Whitlock | Mini Succulent | $12 | not received | Ordered almost two weeks ago and nothing has arrived. |
| Tobias Lindqvist | Monstera Deliciosa | $48 | not as described | The plant arrived damaged with broken stems and wilted leaves. |
| Imani Carter | Terracotta Pot Set | $38 | not received | Tracking says delivered but I never got the pots. |
| Gareth Monk | Brass Watering Can | $56 | not received | The watering can never came. |
| Noor Haddad | Calathea Medallion | $42 | not as described | The plant I received is not the one shown in the listing. |
| Lucia Ferreira | Succulent Trio | $24 | not received | Marked as delivered but I have not received it. |
| Wendell Park | Golden Pothos | $28 | not as described | The plant is far smaller than described on the product page. |
| Asha Venkat | Terracotta Pot, 4 inch | $18 | not received | Never received my order. |
| Beatrix Nolan | Speckled Ceramic Planter | $62 | not as described | Colour and finish are not as shown. It also arrived with a crack. |

Leave Colm Ashby's order alone: it is the happy customer with no dispute.

## 3. Stage them and let the desk pick them up

Disputes appear in `GET /v1/customer/disputes` three to four minutes after they are opened. Then
run the seed once more, still without the browser step:

```bash
pnpm seed --batch D --no-disputes --wait 30
```

It finds the disputes you opened by matching PayPal capture ids, adds the tracking that was held
back, and stages each one the way its scenario asks: some stay inquiries, some are escalated to
claims that ask for evidence, and one gets its evidence filed so the sandbox settle action is
available. PayPal takes about 11 minutes to turn an escalated dispute into a claim.

Open the board and press **Check PayPal now**. Each dispute is matched to its store record
through the order's `custom_id`, so nothing else has to be entered.

Why tracking is held back for some orders: a "not received" dispute on an order that already
has tracking is turned into a claim by PayPal itself within minutes, and such a claim cannot be
settled with the sandbox settle action. So for the cases meant to be settled, the dispute is
opened first and tracking goes on afterwards. The seed handles that ordering by itself, by hand
or not.
