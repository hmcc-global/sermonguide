"use client";

import type { Meta } from "@/lib/studio";

// The five guide details (series, part, date, preacher, scripture). Used on the
// landing screen and again in the review stage so "Write it myself" can fill
// them in without going through Markdown.
export function MetaFields({
  meta,
  onChange,
}: {
  meta: Meta;
  onChange: (k: keyof Meta, v: string) => void;
}) {
  return (
    <>
      <div className="row">
        <div className="field">
          <label>Series *</label>
          <input
            type="text"
            value={meta.series}
            onChange={(e) => onChange("series", e.target.value)}
            placeholder="ADORE"
          />
        </div>
        <div className="field">
          <label>Part</label>
          <input
            type="text"
            value={meta.part}
            onChange={(e) => onChange("part", e.target.value)}
            placeholder="Part 5: Worship With Presence"
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>
            Date <span className="hint">— defaults to today</span>
          </label>
          <input
            type="date"
            value={meta.date}
            onChange={(e) => onChange("date", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Preacher</label>
          <input
            type="text"
            value={meta.preacher}
            onChange={(e) => onChange("preacher", e.target.value)}
            placeholder="Pastor Pete Dahlem"
          />
        </div>
      </div>
      <div className="field">
        <label>
          Scripture reference{" "}
          <span className="hint">— e.g. Luke 2:1-20 (passage text filled by the site)</span>
        </label>
        <input
          type="text"
          value={meta.scripture}
          onChange={(e) => onChange("scripture", e.target.value)}
          placeholder="Luke 2:1-20"
        />
      </div>
    </>
  );
}
