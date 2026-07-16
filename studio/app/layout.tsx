import type { Metadata } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bebas.variable}`}>
      <body>{children}</body>
    </html>
  );
}
