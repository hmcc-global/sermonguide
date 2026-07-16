import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGuide, listGuideParams, versesHtml } from "@/lib/guides";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return listGuideParams();
}

function slugFromParam(param: string): string {
  return param.replace(/\.html$/, "");
}

export async function generateMetadata({
  params,
}: {
  params: { guide: string };
}): Promise<Metadata> {
  const g = await getGuide(slugFromParam(params.guide));
  if (!g) return {};
  return { title: `${g.series} — ${g.part ?? ""}` };
}

export default async function GuidePage({ params }: { params: { guide: string } }) {
  const g = await getGuide(slugFromParam(params.guide));
  if (!g) notFound();

  return (
    <main className="wrap">
      <section className="hero">
        <h1>{g.series}</h1>
        {g.part && <div className="part">{g.part}</div>}
      </section>

      {g.scripture_passage && g.scripture_passage.length > 0 && (
        <section className="block col passage">
          <p className="eyebrow">Scripture</p>
          {g.scripture_title && <h2>{g.scripture_title}</h2>}
          {g.scripture_passage.map((p, i) => (
            <p key={i} dangerouslySetInnerHTML={{ __html: versesHtml(p) }} />
          ))}
          <p className="scripture-credit">
            Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard
            Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by
            permission. All rights reserved.
          </p>
        </section>
      )}

      {g.recap && g.recap.length > 0 && (
        <section className="block col recap">
          <p className="eyebrow">Sermon Recap</p>
          {g.legacy_layout && <h2>The Message</h2>}
          {g.recap.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {g.one_thing && (
            <p className="one-thing">
              <strong>One Thing:</strong> {g.one_thing}
            </p>
          )}
        </section>
      )}

      {g.discussion_questions && Object.keys(g.discussion_questions).length > 0 && (
        <section className="section">
          <h2 className="section-title">
            Discussion
            <br />
            Questions
          </h2>
          <div className="dq">
            {Object.entries(g.discussion_questions).map(([category, questions]) => (
              <div className="cat" key={category}>
                <h3>{category}</h3>
                <ol>
                  {questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {((g.next_steps && g.next_steps.length > 0) || g.next_steps_intro) && (
        <section className="section">
          <h2 className="section-title">Next Steps</h2>
          <div className="col">
            {g.next_steps_intro && <p>{g.next_steps_intro}</p>}
            {g.next_steps_title && <p className="ns-sub">{g.next_steps_title}</p>}
            {g.next_steps && g.next_steps.length > 0 && (
              <ol className="ns-list">
                {g.next_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

      {(g.newer || g.older) && (
        <nav className="guide-nav">
          {g.newer ? (
            <a className="gn gn-prev" href={`/${g.newer.slug}.html`}>
              <span className="gn-dir">← Newer</span>
              <span className="gn-title">
                {g.newer.series} — {g.newer.part}
              </span>
            </a>
          ) : (
            <span></span>
          )}
          {g.older ? (
            <a className="gn gn-next" href={`/${g.older.slug}.html`}>
              <span className="gn-dir">Older →</span>
              <span className="gn-title">
                {g.older.series} — {g.older.part}
              </span>
            </a>
          ) : (
            <span></span>
          )}
        </nav>
      )}
    </main>
  );
}
