import type { Metadata, Viewport } from "next";
import { Inter, Bebas_Neue } from "next/font/google";

// Self-hosted at build time. Exposed as CSS variables that site.css maps onto
// --body / --display, matching the original Google Fonts <link> setup.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});
const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HMCC Sermon Guides",
  description: "Weekly sermon guides for personal study and Life Groups.",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
};

// Next injects a default viewport, but not viewport-fit — without it the
// env(safe-area-inset-*) values the stylesheets rely on are always zero, and
// content runs under the notch in landscape. themeColor is set per segment
// below this, so the reader site and the studio each match their own palette.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bebas.variable}`}>
      <body>{children}</body>
    </html>
  );
}
