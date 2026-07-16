import type { Metadata } from "next";
import { loadAllGuides, humandate } from "@/lib/guides";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Sermon Guides" };

export default async function IndexPage() {
  const guides = await loadAllGuides();
  return (
    <main className="wrap">
      <section className="index-hero">
        <h1>Sermon Guides</h1>
        <div className="tag">Weekly guides for personal study &amp; Life Groups</div>
      </section>

      <ul className="guide-list">
        {guides.map((g) => (
          <li key={g.slug}>
            <a href={`/${g.slug}.html`}>
              <span className="g-date">{g.date ? humandate(g.date) : ""}</span>
              <span className="g-body">
                <span className="g-head">
                  <span className="g-series">{g.series}</span>
                  {g.scripture_title && <span className="g-scripture">{g.scripture_title}</span>}
                </span>
                <span className="g-meta">
                  <span className="g-part">{g.part}</span>
                  {g.preacher && <span className="g-preacher">{g.preacher}</span>}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
