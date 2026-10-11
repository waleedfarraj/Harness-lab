import { notFound } from "next/navigation";
import { devRoutesEnabled } from "@/lib/dev-routes";

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return children;
}
