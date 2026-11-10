/**
 * The evidence pack as one self-contained HTML document: cover letter, timeline, tracking and
 * photos. It is shown in the app, printed to PDF with Playwright where Chromium is available,
 * and its content drives the pdf-lib fallback (lib/pack/pdf.ts).
 */
import type { CaseDetail } from "@/lib/desk/types";
import { readPublicFile } from "@/lib/public-file";
import { reasonTitle } from "@/lib/rules/evidence-table";
import { STORE } from "@/lib/shop/catalog";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const when = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: STORE.timezone, month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
    : "";

export type PackPhoto = { title: string; caption: string; file: string };

export type PackModel = {
  disputeId: string;
  title: string;
  amount: string;
  stage: string;
  letter: string;
  facts: { label: string; value: string }[];
  timeline: { at: string; text: string; source: string }[];
  tracking: { carrier: string; service: string; number: string; scans: { at: string; text: string }[]; signature: string | null } | null;
  checklist: { label: string; detail: string; source: string }[];
  thread: { from: string; at: string; text: string }[];
  photos: PackPhoto[];
  policy: string[];
};

/** Only evidence that helps is put in the pack: nothing marked missing or against. */
export function packModel(detail: CaseDetail): PackModel {
  const d = detail.dispute;
  const e = detail.evidence;
  const present = detail.checklist.filter((c) => c.status === "present");
  const presentKeys = new Set(present.map((c) => c.key));
  const timeline: PackModel["timeline"] = [];
  if (e?.store.orderPlacedAt) timeline.push({ at: e.store.orderPlacedAt, text: `Order ${e.paypal.invoiceId ?? ""} placed`, source: "Store records" });
  for (const s of e?.store.carrier?.scans ?? []) timeline.push({ at: s.at, text: `${s.status}, ${s.location}`, source: e?.store.carrier?.name ?? "Carrier" });
  for (const m of e?.store.thread ?? []) timeline.push({ at: m.at, text: `${m.from === "store" ? STORE.name : "Customer"}: ${m.text}`, source: "Messages" });
  if (e?.paypal.capturedAt) timeline.push({ at: e.paypal.capturedAt, text: `PayPal capture ${e.paypal.captureId ?? ""} for $${e.paypal.amount ?? d.dispute_amount.value}`, source: "PayPal" });
  timeline.push({ at: d.create_time, text: `Dispute ${d.dispute_id} opened: ${reasonTitle(d.reason).toLowerCase()}`, source: "PayPal" });
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const photos: PackPhoto[] = [];
  const deliveryRead = e?.photoReads.find((r) => r.photo === e.store.carrier?.photo);
  if (e?.store.carrier?.photo && presentKeys.has("delivery_photo")) {
    photos.push({ title: "Carrier delivery photo", caption: deliveryRead?.summary ?? "Photo taken by the carrier at delivery.", file: e.store.carrier.photo });
  }
  if (e?.store.packingPhoto && (presentKeys.has("packing_photo") || d.reason !== "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")) {
    photos.push({ title: "Item as packed", caption: `${e.store.product?.name ?? "Item"} photographed before it was boxed.`, file: e.store.packingPhoto });
  }
  if (e?.store.product?.photo && presentKeys.has("listing_specific")) {
    photos.push({ title: "Product page photo", caption: (e.store.product.pageFacts ?? []).join(". "), file: e.store.product.photo });
  }

  const ship = e?.paypal.shipTo;
  return {
    disputeId: d.dispute_id,
    title: `${reasonTitle(d.reason)}: seller response`,
    amount: `$${d.dispute_amount.value} ${d.dispute_amount.currency_code}`,
    // PayPal names the claim stage CHARGEBACK. The pack uses the word PayPal's own screens use.
    stage: d.dispute_life_cycle_stage === "CHARGEBACK" ? "claim" : (d.dispute_life_cycle_stage ?? "").replace(/_/g, " ").toLowerCase(),
    letter: detail.draft?.letter ?? "",
    facts: [
      { label: "PayPal case", value: d.dispute_id },
      { label: "Invoice", value: e?.paypal.invoiceId ?? "" },
      { label: "PayPal order", value: e?.paypal.orderId ?? "" },
      { label: "PayPal capture", value: e?.paypal.captureId ?? "" },
      { label: "Item", value: e?.paypal.items.map((i) => `${i.quantity} x ${i.name}`).join(", ") ?? "" },
      { label: "Ship to", value: ship ? `${ship.name}, ${ship.line1}, ${ship.city}, ${ship.state} ${ship.postalCode}` : "" },
      { label: "Seller protection", value: e?.paypal.sellerProtection ? e.paypal.sellerProtection.toLowerCase() : "" },
    ].filter((f) => f.value),
    timeline: timeline.map((t) => ({ at: when(t.at), text: t.text, source: t.source })),
    tracking:
      e?.store.carrier && e.store.carrier.trackingNumber && presentKeys.has("tracking_on_paypal")
        ? {
            carrier: e.store.carrier.name,
            service: e.store.carrier.service,
            number: e.store.carrier.trackingNumber,
            scans: e.store.carrier.scans.map((s) => ({ at: when(s.at), text: `${s.status}, ${s.location}` })),
            signature: e.store.carrier.signature,
          }
        : null,
    checklist: present.map((c) => ({ label: c.label, detail: c.detail, source: c.source })),
    thread: presentKeys.has("customer_thread") || presentKeys.has("seller_replied") ? (e?.store.thread ?? []).map((m) => ({ from: m.from === "store" ? STORE.name : "Customer", at: when(m.at), text: m.text })) : [],
    photos,
    policy: presentKeys.has("return_policy") ? (e?.store.returnPolicy ?? []) : [],
  };
}

export async function photoBytes(file: string): Promise<Uint8Array | null> {
  return readPublicFile(file);
}

export async function packHtml(detail: CaseDetail): Promise<string> {
  const m = packModel(detail);
  const images = await Promise.all(
    m.photos.map(async (p) => {
      const bytes = await photoBytes(p.file);
      return bytes ? `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` : null;
    }),
  );
  const letter = esc(m.letter).replace(/\n/g, "<br>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Evidence pack ${esc(m.disputeId)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.5 Georgia, "Times New Roman", serif; color: #1f2a24; margin: 0; padding: 24px; max-width: 820px; margin-inline: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2f5d4a; padding-bottom: 10px; margin-bottom: 18px; }
  header .brand { font: 700 18pt/1.1 Georgia, serif; color: #2f5d4a; }
  header .meta { font: 9pt/1.4 Arial, sans-serif; color: #4a5a52; text-align: right; }
  h1 { font: 700 15pt/1.2 Georgia, serif; margin: 0 0 4px; }
  h2 { font: 700 10pt/1.2 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #2f5d4a; margin: 22px 0 8px; break-after: avoid; }
  .letter { background: #f6f4ee; border-left: 3px solid #2f5d4a; padding: 12px 16px; }
  table { width: 100%; border-collapse: collapse; font: 9.5pt/1.45 Arial, sans-serif; }
  td, th { text-align: left; vertical-align: top; padding: 5px 8px; border-bottom: 1px solid #e3e0d6; }
  th { width: 150px; color: #4a5a52; font-weight: 600; }
  .src { color: #6b776f; white-space: nowrap; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  figure { margin: 0; break-inside: avoid; }
  figure img { width: 100%; height: 230px; object-fit: cover; border: 1px solid #d9d5c8; border-radius: 4px; }
  figcaption { font: 9pt/1.4 Arial, sans-serif; color: #4a5a52; margin-top: 4px; }
  figcaption b { color: #1f2a24; }
  ul { margin: 0; padding-left: 18px; font: 9.5pt/1.5 Arial, sans-serif; }
  footer { margin-top: 26px; font: 8.5pt/1.4 Arial, sans-serif; color: #6b776f; border-top: 1px solid #e3e0d6; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <div class="brand">${esc(STORE.name)}</div>
  <div class="meta">Evidence pack<br>PayPal case ${esc(m.disputeId)}<br>${esc(m.amount)}, ${esc(m.stage)} stage</div>
</header>
<h1>${esc(m.title)}</h1>
<h2>Cover letter</h2>
<div class="letter">${letter || "No response drafted yet."}</div>
<h2>Order</h2>
<table>${m.facts.map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(f.value)}</td></tr>`).join("")}</table>
<h2>Evidence summary</h2>
<table>${m.checklist.map((c) => `<tr><th>${esc(c.label)}</th><td>${esc(c.detail)}</td><td class="src">${esc(c.source)}</td></tr>`).join("")}</table>
<h2>Timeline</h2>
<table>${m.timeline.map((t) => `<tr><th>${esc(t.at)}</th><td>${esc(t.text)}</td><td class="src">${esc(t.source)}</td></tr>`).join("")}</table>
${
  m.tracking
    ? `<h2>Tracking</h2>
<table>
<tr><th>Carrier</th><td>${esc(m.tracking.carrier)}, ${esc(m.tracking.service)}</td></tr>
<tr><th>Tracking number</th><td>${esc(m.tracking.number)} (on the PayPal order)</td></tr>
${m.tracking.signature ? `<tr><th>Signed for by</th><td>${esc(m.tracking.signature)}</td></tr>` : ""}
${m.tracking.scans.map((s) => `<tr><th>${esc(s.at)}</th><td>${esc(s.text)}</td></tr>`).join("")}
</table>`
    : ""
}
${
  m.photos.length
    ? `<h2>Photos</h2>
<div class="photos">${m.photos
        .map((p, i) => `<figure>${images[i] ? `<img src="${images[i]}" alt="${esc(p.title)}">` : ""}<figcaption><b>${esc(p.title)}.</b> ${esc(p.caption)}</figcaption></figure>`)
        .join("")}</div>`
    : ""
}
${m.thread.length ? `<h2>Messages with the customer</h2><table>${m.thread.map((t) => `<tr><th>${esc(t.at)}<br>${esc(t.from)}</th><td>${esc(t.text)}</td></tr>`).join("")}</table>` : ""}
${m.policy.length ? `<h2>Return policy</h2><ul>${m.policy.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<footer>Prepared by Dispute Desk for ${esc(STORE.name)}, ${esc(STORE.city)}. Sandbox demonstration: the shop, its customers and its carriers are fictional.</footer>
</body>
</html>`;
}
