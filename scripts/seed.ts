/**
 * pnpm seed: creates this build's sandbox data. Idempotent and safe to re-run.
 *
 *   pnpm seed                    create batch A (orders, tracking, disputes, escalations)
 *   pnpm seed --batch B          top up the pool with a fresh batch (B, C, ...)
 *   pnpm seed --only fig-not-received,planter-not-as-described
 *   pnpm seed --status           print what exists, change nothing
 *   pnpm seed --no-disputes      orders and tracking only
 *
 *   pnpm seed --wait 40          keep staging for up to 40 minutes (default 25)
 *
 * Steps per order: create the order (Orders API through the server SDK), approve it as the
 * sandbox buyer in PayPal's own window (Playwright), capture it, add tracking, then open the
 * dispute as the buyer through "Report a problem". After that each dispute is staged into the
 * state its scenario asks for (see `flow` in lib/shop/scenarios.ts): left as an inquiry, sent on
 * as a claim, or taken all the way to "evidence filed, ready to settle".
 *
 * Progress is saved after every step in .data/seed-state.json, and every create uses a stable
 * PayPal-Request-Id, so a re-run picks up where the last one stopped instead of creating
 * duplicates. Staging waits on PayPal (about 11 minutes from "escalate" to "claim"), so if the
 * run ends first, run `pnpm seed` again later to finish it.
 */
import "./_env";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CARRIERS, productBySku, STORE } from "@/lib/shop/catalog";
import { SCENARIOS, type Scenario } from "@/lib/shop/scenarios";
import { addOrderTracking, captureStoreOrder, createStoreOrder } from "@/lib/paypal/sdk";
import { fileAction } from "@/lib/desk/filing";
import { prepareCase } from "@/lib/desk/sync";
import { renderPackPdf } from "@/lib/pack/pdf";
import { escalateDispute, getDispute } from "@/lib/paypal/disputes";
import { isAllowed } from "@/lib/paypal/types";
import { looseCalls } from "@/lib/paypal/log";
import { approveOrder, fileDispute, findBuyerTransaction, openBuyerSession, type BuyerSession } from "./lib/buyer";

type OrderState = {
  invoiceId: string;
  orderId?: string;
  approveUrl?: string | null;
  approved?: boolean;
  captureId?: string;
  capturedAt?: string;
  trackingNumber?: string;
  buyerTransactionId?: string;
  disputeId?: string;
  disputedAt?: string;
  escalated?: boolean;
  evidenceFiled?: boolean;
  error?: string;
};

type SeedState = { batches: Record<string, { createdAt: string; orders: Record<string, OrderState> }> };

const STATE_FILE = path.join(process.cwd(), ".data", "seed-state.json");
const RETURN_URL = "https://example.com/juniper-and-moss/return";
const CANCEL_URL = "https://example.com/juniper-and-moss/cancel";

function loadState(): SeedState {
  if (!existsSync(STATE_FILE)) return { batches: {} };
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SeedState;
}

function saveState(state: SeedState) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function trackingNumber(scenario: Scenario, invoiceId: string): string {
  const prefix = scenario.shipping.carrier ? CARRIERS[scenario.shipping.carrier].prefix : "LTR";
  const digits = invoiceId.replace(/\D/g, "").padStart(4, "0");
  return `${prefix}${digits}${(scenario.key.length * 7919) % 100000}US`.toUpperCase();
}

function tracksLate(scenario: Scenario, withDisputes: boolean): boolean {
  const flow = scenario.dispute?.flow ?? "inquiry";
  return withDisputes && scenario.dispute?.reason === "not_received" && (flow === "claim" || flow === "ready_to_settle");
}

async function addTracking(state: SeedState, st: OrderState, scenario: Scenario) {
  if (!scenario.shipping.addToPayPal || !scenario.shipping.carrier || st.trackingNumber || !st.orderId || !st.captureId) return;
  const number = trackingNumber(scenario, st.invoiceId);
  await addOrderTracking(st.orderId, { captureId: st.captureId, trackingNumber: number, carrierNameOther: CARRIERS[scenario.shipping.carrier].name }, "Seed: add tracking");
  st.trackingNumber = number;
  saveState(state);
  console.log(`  ${st.invoiceId} ${scenario.key}: tracking ${number} added (${CARRIERS[scenario.shipping.carrier].name})`);
}

async function seedOrder(
  state: SeedState,
  batch: string,
  scenario: Scenario,
  index: number,
  session: () => Promise<BuyerSession>,
  withDisputes: boolean,
) {
  const product = productBySku(scenario.sku);
  if (!product) throw new Error(`Unknown SKU ${scenario.sku}`);
  const batchState = state.batches[batch];
  const batchNo = batch.charCodeAt(0) - 64; // A=1, B=2
  const st: OrderState = (batchState.orders[scenario.key] ??= { invoiceId: `JM-${batchNo}${String(41 + index).padStart(3, "0")}` });
  const save = () => saveState(state);
  const label = `${st.invoiceId} ${scenario.key}`;

  if (!st.orderId) {
    const order = await createStoreOrder({
      invoiceId: st.invoiceId,
      customId: scenario.key,
      description: `${STORE.name}: ${product.name}`,
      items: [{ name: product.name, sku: product.sku, quantity: 1, unitPrice: product.price, description: product.blurb }],
      shipTo: scenario.shipTo,
      returnUrl: RETURN_URL,
      cancelUrl: CANCEL_URL,
      requestId: `seed-order-${st.invoiceId}`,
      feature: "Seed: create order",
    });
    st.orderId = order.id;
    st.approveUrl = order.approveUrl;
    save();
    console.log(`  ${label}: order ${order.id} created ($${product.price})`);
  }

  if (!st.captureId) {
    if (!st.approved) {
      if (!st.approveUrl) throw new Error("Order has no payer-action link.");
      await approveOrder(await session(), st.approveUrl, RETURN_URL);
      st.approved = true;
      save();
      console.log(`  ${label}: approved by the sandbox buyer`);
    }
    const capture = await captureStoreOrder(st.orderId, { requestId: `seed-capture-${st.orderId}`, feature: "Seed: capture order" });
    if (!capture.captureId) throw new Error(`Capture returned no capture id (status ${capture.status}).`);
    st.captureId = capture.captureId;
    st.capturedAt = new Date().toISOString();
    save();
    console.log(`  ${label}: captured ${capture.captureId}`);
  }

  // PayPal turns a "not received" dispute into a claim by itself when the order already has
  // tracking (even tracking added seconds after the dispute). For the flows that need the
  // seller to be asked for evidence, tracking goes on later, in the staging pass, once the
  // dispute has settled as an inquiry.
  if (!tracksLate(scenario, withDisputes)) await addTracking(state, st, scenario);

  if (withDisputes && scenario.dispute && !st.disputeId) {
    const s = await session();
    if (!st.buyerTransactionId) {
      st.buyerTransactionId = await findBuyerTransaction(s, { shipToName: scenario.shipTo.fullName, amount: product.price });
      save();
    }
    st.disputeId = await fileDispute(s, {
      buyerTransactionId: st.buyerTransactionId,
      reason: scenario.dispute.reason,
      note: scenario.dispute.note,
      amount: product.price,
    });
    st.disputedAt = new Date().toISOString();
    save();
    console.log(`  ${label}: dispute ${st.disputeId} opened (${scenario.dispute.reason})`);
  }
  delete st.error;
  save();
}

/**
 * Stage disputes into the state their scenario asks for. Everything here waits on PayPal:
 * the escalate link shows up a few minutes after a dispute is opened, and a dispute that was
 * escalated becomes a claim waiting for the seller about 11 minutes later.
 */
async function stagingPass(state: SeedState, batch: string, scenarios: Scenario[], waitMinutes: number) {
  const todo = (s: Scenario) => {
    const st = state.batches[batch].orders[s.key];
    const flow = s.dispute?.flow ?? "inquiry";
    if (!st?.disputeId) return false;
    if ((flow === "claim" || flow === "ready_to_settle") && !st.escalated) return true;
    return flow === "ready_to_settle" && !st.evidenceFiled;
  };
  let left = scenarios.filter(todo);
  if (!left.length) return;
  console.log(`\nStaging ${left.length} disputes (waiting on PayPal, up to ${waitMinutes} minutes)...`);
  const deadline = Date.now() + waitMinutes * 60_000;
  while (left.length && Date.now() < deadline) {
    for (const s of left) {
      const st = state.batches[batch].orders[s.key];
      const flow = s.dispute?.flow ?? "inquiry";
      const tag = `${st.invoiceId} ${s.key}`;
      try {
        const dispute = await getDispute(st.disputeId!, "Seed: read dispute");
        const isClaim = Boolean(dispute.dispute_life_cycle_stage && dispute.dispute_life_cycle_stage !== "INQUIRY");
        if (!st.escalated) {
          if (isClaim) {
            st.escalated = true;
            await addTracking(state, st, s);
            console.log(`  ${tag}: ${st.disputeId} is already a claim (${dispute.status})`);
          } else if (isAllowed(dispute, "escalate")) {
            // The dispute has settled as an inquiry: safe to put the tracking on now.
            await addTracking(state, st, s);
            await escalateDispute(st.disputeId!, "The buyer and seller could not agree. Asking PayPal to decide.", {
              requestId: `seed-escalate-${st.disputeId}`,
              feature: "Seed: escalate to claim",
            });
            st.escalated = true;
            console.log(`  ${tag}: ${st.disputeId} escalated, PayPal will make it a claim in about 11 minutes`);
          }
        } else if (flow === "ready_to_settle" && !st.evidenceFiled) {
          if (dispute.status === "UNDER_REVIEW" && (dispute.evidences ?? []).some((e) => e.source === "SUBMITTED_BY_SELLER" && e.dispute_life_cycle_stage !== "INQUIRY")) {
            st.evidenceFiled = true;
          } else if (isClaim && isAllowed(dispute, "provide_evidence")) {
            // File through the app's own path: build the case, render the pack, provide evidence.
            const { detail } = await prepareCase(st.disputeId!, { explain: false, draft: true });
            const pdf = await renderPackPdf(detail);
            await fileAction({
              disputeId: st.disputeId!,
              action: "provide_evidence",
              by: "person",
              payload: { text: detail.draft?.notes, files: [{ name: `evidence-pack-${st.disputeId}.pdf`, type: "application/pdf", data: pdf.bytes }] },
            });
            st.evidenceFiled = true;
            console.log(`  ${tag}: evidence filed on ${st.disputeId} (${pdf.renderer} PDF). The sandbox offers "settle" in about 25 minutes`);
          }
        }
      } catch (err) {
        console.log(`  ${tag}: not ready (${err instanceof Error ? err.message.slice(0, 120) : err})`);
      }
      saveState(state);
    }
    left = scenarios.filter(todo);
    if (left.length) await sleep(30_000);
  }
  if (left.length) console.log(`  Still waiting on PayPal for: ${left.map((s) => s.key).join(", ")}. Run pnpm seed again in a few minutes to finish.`);
}

function stageText(s: Scenario, st: OrderState): string {
  const flow = s.dispute?.flow ?? "inquiry";
  if (!s.dispute || !st.disputeId) return "";
  if (flow === "inquiry") return "inquiry";
  if (flow === "direct_claim") return "claim (PayPal reviewing)";
  if (flow === "claim") return st.escalated ? "claim (evidence wanted)" : "claim (pending)";
  return st.evidenceFiled ? "ready to settle" : st.escalated ? "ready to settle (pending evidence)" : "ready to settle (pending)";
}

function printSummary(state: SeedState) {
  for (const [batch, b] of Object.entries(state.batches)) {
    console.log(`\nBatch ${batch} (created ${b.createdAt.slice(0, 16)}Z)`);
    console.log("  invoice   scenario                           order              capture            tracking         dispute             staged as");
    for (const s of SCENARIOS) {
      const st = b.orders[s.key];
      if (!st) continue;
      console.log(
        "  " +
          [
            st.invoiceId.padEnd(9),
            s.key.padEnd(34),
            (st.orderId ?? "-").padEnd(18),
            (st.captureId ?? "-").padEnd(18),
            (st.trackingNumber ?? "-").padEnd(16),
            (st.disputeId ?? (s.dispute ? "(pending)" : "none")).padEnd(19),
            stageText(s, st),
            st.error ? `ERROR: ${st.error}` : "",
          ].join(" "),
      );
    }
  }
}

async function main() {
  const state = loadState();
  if (arg("status")) {
    printSummary(state);
    return;
  }
  const batch = (arg("batch") ?? "A").toUpperCase().slice(0, 1);
  const only = arg("only")?.split(",").map((s) => s.trim());
  const withDisputes = !arg("no-disputes");
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.key));
  state.batches[batch] ??= { createdAt: new Date().toISOString(), orders: {} };
  saveState(state);

  console.log(`Seeding batch ${batch}: ${scenarios.length} orders for ${STORE.name} in the PayPal sandbox.`);
  let buyer: BuyerSession | null = null;
  const session = async () => (buyer ??= await openBuyerSession());
  let failures = 0;
  try {
    for (const scenario of scenarios) {
      const index = SCENARIOS.indexOf(scenario);
      try {
        await seedOrder(state, batch, scenario, index, session, withDisputes);
      } catch (err) {
        failures++;
        const message = err instanceof Error ? err.message : String(err);
        const st = state.batches[batch].orders[scenario.key];
        if (st) st.error = message.slice(0, 300);
        saveState(state);
        console.log(`  ${scenario.key}: FAILED: ${message.slice(0, 300)}`);
      }
    }
  } finally {
    if (buyer) await (buyer as BuyerSession).close();
  }

  if (withDisputes) await stagingPass(state, batch, scenarios, Number(arg("wait") ?? 25));
  printSummary(state);

  const calls = looseCalls();
  console.log(`\n${calls.length} PayPal API calls made by this run. ${failures ? `${failures} step(s) failed: re-run pnpm seed to retry them.` : "All steps succeeded."}`);
  console.log("Disputes take a few minutes to appear in GET /v1/customer/disputes. Open the board to see them arrive.");
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
