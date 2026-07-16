import type { Metadata } from "next";
import "./studio.css";

export const metadata: Metadata = {
  title: "Sermon Guide Studio",
  description: "Turn a sermon into a published study guide.",
};

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
