import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/shell/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dispute Desk", template: "%s | Dispute Desk" },
  description: "An AI dispute and chargeback desk for small PayPal sellers. Marlow books the work before the deadline, builds the case and files it through the PayPal Disputes API.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f5d4a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
