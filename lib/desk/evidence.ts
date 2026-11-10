/**
 * Builds the case file: what PayPal knows (capture, order, tracking, transaction search) plus
 * the store's own records for the same order, plus AI reads of the photos.
 */
import { getDoc, setDoc } from "@/lib/store";
import { readPhoto } from "@/lib/ai/tasks";
import { AiUnavailableError } from "@/lib/ai/client";
import { getCapture, getOrder, searchTransaction } from "@/lib/paypal/sdk";
import { currentMode, withFeature } from "@/lib/paypal/log";
import type { Dispute } from "@/lib/paypal/types";
import { CARRIERS, productBySku, RETURN_POLICY } from "@/lib/shop/catalog";
import { scenarioByKey, type Scenario } from "@/lib/shop/scenarios";
import type { EvidenceBundle, PhotoRead } from "./types";

const DAY = 24 * 3600 * 1000;

export function storeRecords(scenario: Scenario | undefined, capturedAt: string | null, trackingNumber: string | null): EvidenceBundle["store"] {
  if (!scenario) {
    return { found: false, orderPlacedAt: null, product: null, carrier: null, thread: [], risk: null, packingPhoto: null, buyerPhoto: null, returnPolicy: RETURN_POLICY.points };
  }
  const product = productBySku(scenario.sku);
  // The store's order date sits orderAgeDays before the PayPal capture (see scenarios.ts).
  const placed = new Date(capturedAt ?? Date.now()).getTime() - scenario.orderAgeDays * DAY;
  const at = (days: number) => new Date(placed + days * DAY).toISOString();
  const carrierDef = scenario.shipping.carrier ? CARRIERS[scenario.shipping.carrier] : null;
  return {
    found: true,
    orderPlacedAt: new Date(placed).toISOString(),
    product: product ? { sku: product.sku, name: product.name, photo: product.photo, pageFacts: product.pageFacts, sizeChart: product.sizeChart } : null,
    carrier: {
      name: carrierDef?.name ?? "Letter post",
      service: scenario.shipping.service,
      trackingNumber,
      outcome: scenario.shipping.outcome,
      scans: scenario.shipping.events.map((e) => ({ at: at(e.atDays), status: e.status, location: e.location })),
      signature: scenario.shipping.signature ?? null,
      photo: scenario.shipping.photo ?? null,
      deliveredToOrderAddress: scenario.shipping.deliveredToOrderAddress ?? null,
    },
    thread: scenario.thread.map((m) => ({ from: m.from, at: at(m.atDays), text: m.text })),
    risk: { ...scenario.risk, priorOrders: scenario.customer.priorOrders, accountAgeDays: scenario.customer.accountAgeDays },
    packingPhoto: scenario.packingPhoto ?? null,
    buyerPhoto: scenario.buyerPhoto ?? null,
    returnPolicy: RETURN_POLICY.points,
  };
}

/** Photo reads are cached by photo: the same picture gets the same answer without a new call. */
async function cachedPhotoRead(photo: string, kind: "delivery" | "damage"): Promise<PhotoRead | null> {
  if (currentMode() === "replay") {
    try {
      return await readPhoto(photo, kind);
    } catch {
      return null;
    }
  }
  const key = `${kind}:${photo}`;
  const cache = (await getDoc<Record<string, PhotoRead>>("photo-reads")) ?? {};
  if (cache[key]) return cache[key];
  try {
    const read = await readPhoto(photo, kind);
    const latest = (await getDoc<Record<string, PhotoRead>>("photo-reads")) ?? {};
    latest[key] = read;
    await setDoc("photo-reads", latest);
    return read;
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    return null;
  }
}

export async function gatherEvidence(dispute: Dispute): Promise<EvidenceBundle> {
  const txn = dispute.disputed_transactions?.[0];
  const captureId = txn?.seller_transaction_id ?? null;
  const paypal: EvidenceBundle["paypal"] = {
    captureId,
    orderId: null,
    invoiceId: txn?.invoice_number ?? null,
    captureStatus: null,
    capturedAt: txn?.create_time ?? null,
    amount: txn?.gross_amount?.value ?? null,
    sellerProtection: null,
    sellerProtectionCategories: [],
    items: (txn?.items ?? []).map((i) => ({ name: i.item_name ?? "Item", quantity: i.item_quantity ?? "1", unitAmount: "" })),
    shipTo: null,
    trackers: [],
    transactionSearch: "skipped",
    payerName: txn?.buyer?.name ?? null,
  };
  let scenarioKey: string | null = txn?.custom ?? null;

  if (captureId) {
    await withFeature("Case file: capture, order and tracking", async () => {
      const { capture } = await getCapture(captureId);
      paypal.captureStatus = capture.status ?? null;
      paypal.capturedAt = capture.createTime ?? paypal.capturedAt;
      paypal.amount = capture.amount?.value ?? paypal.amount;
      paypal.invoiceId = capture.invoiceId ?? paypal.invoiceId;
      paypal.sellerProtection = capture.sellerProtection?.status ?? null;
      paypal.sellerProtectionCategories = (capture.sellerProtection?.disputeCategories ?? []) as string[];
      scenarioKey = capture.customId ?? scenarioKey;
      paypal.orderId = capture.supplementaryData?.relatedIds?.orderId ?? null;

      if (paypal.orderId) {
        const { order } = await getOrder(paypal.orderId);
        const unit = order.purchaseUnits?.[0];
        if (unit?.items?.length) {
          paypal.items = unit.items.map((i) => ({ name: i.name ?? "Item", sku: i.sku, quantity: i.quantity ?? "1", unitAmount: i.unitAmount?.value ?? "" }));
        }
        const ship = unit?.shipping;
        if (ship?.address) {
          paypal.shipTo = {
            name: ship.name?.fullName ?? "",
            line1: ship.address.addressLine1 ?? "",
            city: ship.address.adminArea2 ?? "",
            state: ship.address.adminArea1 ?? "",
            postalCode: ship.address.postalCode ?? "",
            country: ship.address.countryCode ?? "",
          };
        }
        const scenario = scenarioByKey(scenarioKey);
        const carrierName = scenario?.shipping.carrier ? CARRIERS[scenario.shipping.carrier].name : "Carrier";
        paypal.trackers = (ship?.trackers ?? []).map((t) => ({
          id: t.id,
          // PayPal's tracker id is "<capture id>-<tracking number>".
          number: (t.id ?? "").split("-").slice(1).join("-") || (t.id ?? ""),
          carrier: carrierName,
          status: t.status,
        }));
        const payer = order.payer?.name;
        if (payer) paypal.payerName = [payer.givenName, payer.surname].filter(Boolean).join(" ");
      }

      // Transaction search lags by up to about three hours in the sandbox: empty is not an error.
      try {
        const { result } = await searchTransaction(captureId, paypal.capturedAt ?? new Date().toISOString());
        paypal.transactionSearch = (result.transactionDetails?.length ?? 0) > 0 ? "found" : "not_indexed_yet";
      } catch {
        paypal.transactionSearch = "not_indexed_yet";
      }
    });
  }

  const scenario = scenarioByKey(scenarioKey);
  const store = storeRecords(scenario, paypal.capturedAt, paypal.trackers[0]?.number ?? null);

  const photoReads: PhotoRead[] = [];
  const jobs: Promise<PhotoRead | null>[] = [];
  if (store.carrier?.photo) jobs.push(cachedPhotoRead(store.carrier.photo, "delivery"));
  if (store.buyerPhoto) jobs.push(cachedPhotoRead(store.buyerPhoto, "damage"));
  for (const read of await Promise.all(jobs)) if (read) photoReads.push(read);

  return { gatheredAt: new Date().toISOString(), scenarioKey, paypal, store, photoReads };
}
