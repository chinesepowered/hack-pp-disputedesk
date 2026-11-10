import type { ReactNode } from "react";
import type { AiTag as AiTagType } from "@/lib/desk/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const money = (n: number | string | null | undefined, currency = "USD") => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const styles = {
    primary: "bg-forest text-white hover:bg-forest-deep disabled:bg-[#8fa59b]",
    secondary: "bg-surface text-ink border border-line hover:bg-sunken disabled:text-muted",
    ghost: "text-forest-deep hover:bg-forest-tint disabled:text-muted",
    danger: "bg-missing-edge text-white hover:bg-missing disabled:bg-[#cf9c93]",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]",
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...rest} className={cx("rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgb(31_42_36/0.06)]", className)}>
      {children}
    </Tag>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
  title,
  ...rest
}: { children: ReactNode; tone?: "neutral" | "ready" | "partial" | "missing" | "slate" | "forest"; className?: string; title?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const tones = {
    neutral: "bg-sunken text-ink",
    ready: "bg-ready-tint text-ready",
    partial: "bg-partial-tint text-partial",
    missing: "bg-missing-tint text-missing",
    slate: "bg-slate-tint text-slate",
    forest: "bg-forest-tint text-forest-deep",
  }[tone];
  return (
    <span {...rest} title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap", tones, className)}>
      {children}
    </span>
  );
}

/** The small "AI" tag that names the model behind every AI-produced output. */
export function AiTag({ ai, className }: { ai: AiTagType | null | undefined; className?: string }) {
  if (!ai) return null;
  const short = ai.model.split("/").pop();
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-md border border-[#c9b8e8] bg-[#f3eefb] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#4a2f86] whitespace-nowrap", className)}
      title={`Written by ${ai.model}${ai.fallback ? " (fallback model)" : ""}${ai.replay ? ", replayed from a recorded response" : ""}. Money decisions come from rules, not from the model.`}
      data-testid="ai-tag"
    >
      <span aria-hidden="true" className="rounded-sm bg-[#4a2f86] px-1 text-[10px] leading-4 text-white">AI</span>
      <span className="sr-only">AI output by </span>
      {short}
      {ai.replay ? " (replay)" : ai.fallback ? " (fallback)" : ""}
    </span>
  );
}

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
};
export const reasonLabel = (r: string) => REASON_LABEL[r] ?? r.replace(/_/g, " ").toLowerCase();

export const STAGE_LABEL: Record<string, string> = {
  INQUIRY: "Inquiry",
  CHARGEBACK: "Claim",
  PRE_ARBITRATION: "Appeal",
  ARBITRATION: "Second appeal",
};
export const stageLabel = (s: string | null | undefined) => (s ? (STAGE_LABEL[s] ?? s) : "Unknown stage");

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Just opened",
  WAITING_FOR_SELLER_RESPONSE: "Waiting for you",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer",
  UNDER_REVIEW: "PayPal is reviewing",
  RESOLVED: "Resolved",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();

export const READINESS_LABEL = { ready: "Evidence ready", partial: "Evidence partial", missing: "Evidence missing" } as const;

export const ACTION_LABEL: Record<string, string> = {
  provide_evidence: "Provide evidence",
  provide_supporting_info: "Provide supporting info",
  send_message: "Send message",
  make_offer: "Make offer",
  accept_claim: "Accept claim",
  acknowledge_return_item: "Acknowledge return",
  appeal: "Appeal",
  escalate: "Escalate to claim",
  adjudicate: "Settle (sandbox)",
  require_evidence: "Require evidence (sandbox)",
};

export function OUTCOME_TEXT(code: string, won: number, amount: number): { title: string; tone: "ready" | "partial" | "missing" } {
  if (won >= amount && amount > 0) return { title: `Won, ${money(won)} recovered`, tone: "ready" };
  if (won > 0) return { title: `Settled, ${money(won)} kept`, tone: "partial" };
  if (code === "ACCEPTED") return { title: `Accepted, ${money(amount)} refunded`, tone: "missing" };
  return { title: `Lost, ${money(amount)} refunded`, tone: "missing" };
}

export function dueText(dueAt: string | null, now = Date.now()): { text: string; urgent: boolean } {
  if (!dueAt) return { text: "No deadline", urgent: false };
  const ms = new Date(dueAt).getTime() - now;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (ms <= 0) return { text: "Overdue", urgent: true };
  if (days === 0) return { text: `Due in ${hours}h`, urgent: true };
  return { text: `Due in ${days}d ${hours}h`, urgent: days < 3 };
}

export function fmtDate(iso: string | null | undefined, tz = "America/Los_Angeles", withTime = true): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(new Date(iso));
}
