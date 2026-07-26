import type { Metadata, Viewport } from "next";
import "../create/studio.css";

export const metadata: Metadata = {
  title: "Manage Guides",
  description: "Edit and delete published sermon guides.",
};

// The studio's own warm ground, not the reader site's navy.
export const viewport: Viewport = { themeColor: "#faf9f5" };

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
