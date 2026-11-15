import type { Metadata, Viewport } from "next";
import "./studio.css";

export const metadata: Metadata = {
  title: "Sermon Guide Studio",
  description: "Turn a sermon into a published study guide.",
};

// The studio's own warm ground, not the reader site's navy.
export const viewport: Viewport = { themeColor: "#faf9f5" };

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
