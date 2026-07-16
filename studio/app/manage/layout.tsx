import type { Metadata } from "next";
import "../create/studio.css";

export const metadata: Metadata = {
  title: "Manage Guides",
  description: "Edit and delete published sermon guides.",
};

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
