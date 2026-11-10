import type { Metadata } from "next";
import CasePage from "@/components/case/CasePage";

export const metadata: Metadata = { title: "Case file" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CasePage id={id} />;
}
