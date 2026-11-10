/** Dev helper: print the parts of an order and capture the case file uses. */
import "../_env";
import { getCapture, getOrder, searchTransaction } from "@/lib/paypal/sdk";

async function main() {
  const [captureId] = process.argv.slice(2);
  const { capture, raw } = await getCapture(captureId);
  console.log("capture:", { status: capture.status, customId: capture.customId, invoiceId: capture.invoiceId, sellerProtection: capture.sellerProtection, related: capture.supplementaryData?.relatedIds, created: capture.createTime, breakdown: capture.sellerReceivableBreakdown });
  const orderId = capture.supplementaryData?.relatedIds?.orderId;
  if (orderId) {
    const { order, raw: oraw } = await getOrder(orderId);
    const pu = order.purchaseUnits?.[0];
    console.log("order:", order.status, "payer:", order.payer?.name, "| shipping:", JSON.stringify(pu?.shipping).slice(0, 700));
    console.log("raw trackers:", JSON.stringify(oraw?.purchase_units?.[0]?.shipping?.trackers ?? null).slice(0, 600));
    console.log("items:", JSON.stringify(pu?.items).slice(0, 300));
  }
  try {
    const { result } = await searchTransaction(captureId, capture.createTime ?? new Date().toISOString());
    console.log("search:", result.totalItems, JSON.stringify(result.transactionDetails?.[0]?.transactionInfo ?? null).slice(0, 300));
  } catch (e: any) { console.log("search error", e.status, e.message); }
  void raw;
}
main().catch((e) => console.error("FAILED", e.status, e.message));
