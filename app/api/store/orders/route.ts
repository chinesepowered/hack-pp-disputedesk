import { randomUUID } from "node:crypto";
import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { createStoreOrder } from "@/lib/paypal/sdk";
import { productBySku, STORE } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

/**
 * Demo store checkout, step 1: create the order server-side (Orders API through the server
 * SDK). The price comes from the catalog, never from the browser.
 */
export const POST = route("Demo store: create order", async (req) => {
  const body = (await req.json().catch(() => null)) as { sku?: string } | null;
  const product = body?.sku ? productBySku(body.sku) : undefined;
  if (!product) throw new DeskError(422, "UNKNOWN_PRODUCT", "That product is not in the catalog.");
  const origin = new URL(req.url).origin;
  const invoiceId = `JM-W${Date.now().toString(36).toUpperCase()}`;
  const order = await createStoreOrder({
    invoiceId,
    customId: `web:${product.sku}`,
    description: `${STORE.name}: ${product.name}`,
    items: [{ name: product.name, sku: product.sku, quantity: 1, unitPrice: product.price, description: product.blurb }],
    returnUrl: `${origin}/store?paid=1`,
    cancelUrl: `${origin}/store?cancelled=1`,
    requestId: randomUUID(),
    feature: "Demo store: create order",
  });
  return { orderId: order.id, invoiceId, status: order.status };
});
