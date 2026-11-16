"use client";

import { cleanPart, lines, paras, type Draft, type Meta } from "@/lib/studio";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// Whole-guide preview. Used by both Fields and Markdown views, so the editor
// sees the full guide (details included) before publishing from either.
export function GuidePreview({ meta, draft }: { meta: Meta; draft: Draft }) {
  const cats: [string, string][] = [
    ["Connecting", draft.connecting],
    ["Considering", draft.considering],
    ["Confessing", draft.confessing],
    ["Committing", draft.committing],
  ];
  const byline = [fmtDate(meta.date), meta.preacher.trim()].filter(Boolean).join(" · ");
  return (
    <div className="preview">
      <p className="series">{meta.series || "Series"}</p>
      {cleanPart(meta.part) && <p className="part">{cleanPart(meta.part)}</p>}
      {byline && <p className="muted">{byline}</p>}
      {meta.scripture && <p className="muted">{meta.scripture}</p>}

      {paras(draft.recap).length > 0 && (
        <>
          <h2>Sermon Recap</h2>
          {paras(draft.recap).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </>
      )}
      {draft.one_thing.trim() && <p className="one-thing">{draft.one_thing}</p>}

      {cats.some(([, v]) => lines(v).length > 0) && (
        <>
          <h2>Discussion Questions</h2>
          {cats.map(([name, v]) =>
            lines(v).length ? (
              <div key={name}>
                <p className="dq-cat">{name}</p>
                <ul>
                  {lines(v).map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </>
      )}

      {lines(draft.next_steps).length > 0 && (
        <>
          <h2>Next Steps</h2>
          {draft.next_steps_intro.trim() && <p>{draft.next_steps_intro}</p>}
          <ol>
            {lines(draft.next_steps).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
