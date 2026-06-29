import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sermon Guide Studio",
  description: "Turn a sermon into a published study guide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
