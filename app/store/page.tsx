"use client";

/**
 * Demo store: a tiny Juniper & Moss checkout so anyone can create a fresh sandbox payment and
 * then dispute it as the buyer. Checkout uses the PayPal JS SDK v6 (web-sdk/v6/core): one
 * instance, an eligibility check, a one-time payment session and the <paypal-button> web
 * component. Orders are created and captured server-side.
 */
import { createElement, useEffect, useRef, useState } from "react";
import { Marlow } from "@/components/marlow/Marlow";
import { Card, Chip, cx, money } from "@/components/ui/atoms";
import { api, ApiError, toast } from "@/lib/client/store";
import { PRODUCTS, type Product } from "@/lib/shop/catalog";

declare global {
  interface Window {
    paypal?: {
      createInstance: (opts: { clientId: string; components: string[]; pageType?: string; locale?: string }) => Promise<any>;
    };
  }
}

const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";
const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

type Paid = { orderId: string; captureId: string; trackingNumber: string | null; carrier: string; product: Product };

export default function StorePage() {
  const [selected, setSelected] = useState<Product>(PRODUCTS[2]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "ineligible" | "error">(CLIENT_ID ? "loading" : "error");
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const session = useRef<any>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const buttonHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!CLIENT_ID) return;
    const init = async () => {
      try {
        const instance = await window.paypal!.createInstance({ clientId: CLIENT_ID, components: ["paypal-payments"], pageType: "checkout" });
        // Always check eligibility before showing a button.
        const methods = await instance.findEligibleMethods({ currencyCode: "USD" });
        if (cancelled) return;
        if (!methods.isEligible("paypal")) {
          setSdk("ineligible");
          return;
        }
        session.current = instance.createPayPalOneTimePaymentSession({
          onApprove: async (data: { orderId: string }) => {
            try {
              const res = await api<{ orderId: string; captureId: string; trackingNumber: string | null; carrier: string }>(`/api/store/orders/${data.orderId}/capture`, { method: "POST" });
              setPaid({ ...res, product: selectedRef.current });
              toast("success", "Payment captured", `PayPal capture ${res.captureId}.`);
            } catch (err) {
              toast("error", "The payment was approved but could not be captured", err instanceof ApiError ? err.message : undefined);
            } finally {
              setPaying(false);
            }
          },
          onCancel: () => {
            setPaying(false);
            toast("info", "Checkout cancelled", "Nothing was charged.");
          },
          onError: (error: { code?: string; message?: string }) => {
            setPaying(false);
            toast("error", "PayPal checkout failed", error?.code === "ERR_DEV_UNABLE_TO_OPEN_POPUP" ? "Your browser blocked the PayPal window. Allow popups for this site and try again." : (error?.message ?? error?.code));
          },
        });
        setSdk("ready");
      } catch {
        if (!cancelled) setSdk("error");
      }
    };
    if (window.paypal?.createInstance) void init();
    else {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => void init();
      script.onerror = () => !cancelled && setSdk("error");
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const pay = async () => {
    if (!session.current || paying) return;
    setPaying(true);
    setPaid(null);
    // v6 wants the promise itself, already started, resolving to { orderId }.
    const createOrder = api<{ orderId: string }>("/api/store/orders", { method: "POST", body: { sku: selectedRef.current.sku } }).then((r) => ({ orderId: r.orderId }));
    createOrder.catch((err) => {
      setPaying(false);
      toast("error", "Could not create the order", err instanceof ApiError ? err.message : undefined);
    });
    try {
      await session.current.start({ presentationMode: "auto" }, createOrder);
    } catch {
      setPaying(false);
    }
  };

  // The v6 button is a web component. It is attached once and clicks are forwarded.
  useEffect(() => {
    const host = buttonHost.current;
    if (sdk !== "ready" || !host) return;
    const button = host.querySelector("paypal-button");
    const onClick = () => void pay();
    button?.addEventListener("click", onClick);
    return () => button?.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk]);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
        <Marlow mood="calm" size={70} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold tracking-tight">Juniper &amp; Moss demo store</h1>
          <p className="text-[14.5px] text-muted">
            Buy something with a PayPal sandbox buyer account, then open a dispute on it as the buyer. It lands on the board a few minutes later. Sandbox only: no real money.
          </p>
        </div>
        <Chip tone="partial">PayPal sandbox</Chip>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Products">
          {PRODUCTS.slice(0, 9).map((p) => (
            <li key={p.sku}>
              <button
                type="button"
                aria-pressed={selected.sku === p.sku}
                onClick={() => setSelected(p)}
                className={cx("flex h-full w-full flex-col overflow-hidden rounded-[14px] border bg-surface text-left", selected.sku === p.sku ? "border-forest ring-2 ring-forest" : "border-line hover:border-forest")}
                data-testid={`product-${p.sku}`}
              >
                <img src={p.photo} alt="" className="h-36 w-full object-cover" loading="lazy" />
                <span className="flex flex-1 flex-col px-3 py-2.5">
                  <span className="font-bold leading-snug">{p.name}</span>
                  <span className="mt-0.5 text-[13px] text-muted">{p.blurb}</span>
                  <span className="mt-auto pt-2 text-[17px] font-extrabold">{money(p.price)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <Card className="h-fit px-5 py-4" aria-labelledby="checkout-title">
          <h2 id="checkout-title" className="text-[17px] font-bold">Checkout</h2>
          <p className="mt-1 text-[14.5px]">{selected.name}</p>
          <p className="text-[26px] font-extrabold">{money(selected.price)}</p>
          <p className="text-[13px] text-muted">Free tracked shipping. Ships to the address on the buyer&apos;s PayPal account.</p>

          <div ref={buttonHost} className="mt-3 min-h-12" aria-busy={sdk === "loading" || paying}>
            {sdk === "ready" && createElement("paypal-button", { type: "pay", class: "paypal-gold", "data-testid": "paypal-button", style: { width: "100%" } })}
            {sdk === "loading" && <p className="text-[14px] text-muted" role="status">Loading PayPal…</p>}
            {sdk === "ineligible" && <p className="text-[14px] text-missing" role="alert">PayPal is not available for this purchase.</p>}
            {sdk === "error" && <p className="text-[14px] text-missing" role="alert">PayPal checkout could not be loaded. Check that NEXT_PUBLIC_PAYPAL_CLIENT_ID is set.</p>}
          </div>
          {paying && <p className="mt-2 text-[13.5px] text-muted" role="status">Waiting for approval in the PayPal window…</p>}
          <p className="mt-3 font-mono text-[11.5px] text-muted">JS SDK v6 · POST /v2/checkout/orders · POST /v2/checkout/orders/{"{id}"}/capture · POST /v2/checkout/orders/{"{id}"}/track</p>

          {paid && (
            <div className="mt-4 rounded-xl border border-ready-edge bg-ready-tint px-3 py-3" role="status" data-testid="store-paid">
              <div className="flex items-center gap-3">
                <Marlow mood="success" size={56} />
                <p className="font-bold text-ready">Paid. {paid.product.name} is on its way.</p>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                <dt className="text-muted">Order</dt><dd className="font-mono">{paid.orderId}</dd>
                <dt className="text-muted">Capture</dt><dd className="font-mono">{paid.captureId}</dd>
                <dt className="text-muted">Tracking</dt><dd>{paid.trackingNumber ? `${paid.carrier} ${paid.trackingNumber}, added to the PayPal order` : "not added"}</dd>
              </dl>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-3 text-[13.5px]">
            <h3 className="font-bold">Then open a dispute as the buyer</h3>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted">
              <li>Log in at sandbox.paypal.com with the same sandbox buyer.</li>
              <li>Open Activity, pick this payment, choose Report a problem.</li>
              <li>Pick a reason and submit. The dispute reaches the board in 3 to 4 minutes.</li>
            </ol>
          </div>
        </Card>
      </div>
    </div>
  );
}
