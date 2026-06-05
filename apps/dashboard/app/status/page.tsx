import type { Metadata } from "next";
import { StatusPageContent } from "@/features/status/ui/status-page-content";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return <StatusPageContent />;
}
