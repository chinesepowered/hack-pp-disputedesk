/**
 * pnpm paypal:webhook <public-url>
 *
 * Registers <public-url>/api/paypal/webhook for this build's event types through the Webhooks
 * API and prints the webhook id to put in PAYPAL_WEBHOOK_ID. Safe to re-run: an existing
 * webhook for the same URL is reused.
 *
 *   pnpm paypal:webhook https://your-app.vercel.app
 *   pnpm paypal:webhook --list
 *   pnpm paypal:webhook --delete <webhook-id>
 */
import "./_env";
import { createWebhook, deleteWebhook, DISPUTE_EVENT_TYPES, listWebhooks } from "@/lib/paypal/webhooks";

async function main() {
  const [arg, value] = process.argv.slice(2);
  if (!arg) {
    console.log("Usage: pnpm paypal:webhook <public-url> | --list | --delete <webhook-id>");
    process.exit(1);
  }
  if (arg === "--list") {
    const hooks = await listWebhooks();
    if (!hooks.length) console.log("No webhooks registered for this sandbox app.");
    for (const h of hooks) console.log(`${h.id}  ${h.url}  [${h.event_types.map((e) => e.name).join(", ")}]`);
    return;
  }
  if (arg === "--delete") {
    if (!value) throw new Error("Which webhook id?");
    await deleteWebhook(value);
    console.log(`Deleted ${value}.`);
    return;
  }
  const base = arg.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("PayPal only delivers webhooks to https URLs.");
  const url = `${base}/api/paypal/webhook`;
  const existing = (await listWebhooks()).find((h) => h.url === url);
  const hook = existing ?? (await createWebhook(url));
  console.log(existing ? "Webhook already registered:" : "Webhook registered:");
  console.log(`  url:    ${hook.url}`);
  console.log(`  events: ${DISPUTE_EVENT_TYPES.join(", ")}`);
  console.log(`  id:     ${hook.id}`);
  console.log("\nSet this on the deployment and redeploy:");
  console.log(`  PAYPAL_WEBHOOK_ID=${hook.id}`);
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
