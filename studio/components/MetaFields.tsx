"use client";

import { useEffect, useState } from "react";
import { PART_PREFIX, PREACHER_OPTIONS, SERIES_OPTIONS, type Meta } from "@/lib/studio";

const OTHER = "__other__";

// A dropdown of known values plus "Other…", which reveals a text box. The value
// stays a plain string, so anything not in the list (e.g. from an inbox item or
// pasted markdown) simply shows up under Other with its text intact.
function Choice({
  label,
  required,
  value,
  options,
  otherPlaceholder,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  options: string[];
  otherPlaceholder: string;
  onChange: (v: string) => void;
}) {
  const [otherMode, setOtherMode] = useState(() => value !== "" && !options.includes(value));

  // An outside change to a listed value (reset, markdown apply) leaves Other mode.
  useEffect(() => {
    if (options.includes(value)) setOtherMode(false);
    else if (value !== "") setOtherMode(true);
  }, [value, options]);

  const showOther = otherMode;
  return (
    <div className="field">
      <label>
        {label}
        {required ? " *" : ""}
      </label>
      <select
        value={showOther ? OTHER : options.includes(value) ? value : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) {
            setOtherMode(true);
            onChange("");
          } else {
            setOtherMode(false);
            onChange(v);
          }
        }}
      >
        {!showOther && !options.includes(value) && <option value="">Choose…</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {showOther && (
        <input
          type="text"
          style={{ marginTop: 8 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          autoFocus={value === ""}
        />
      )}
    </div>
  );
}

// The five guide details. Used on the landing screen and again in the review
// stage so "Write it myself" can fill them in without going through Markdown.
export function MetaFields({
  meta,
  onChange,
  scriptureNote,
}: {
  meta: Meta;
  onChange: (k: keyof Meta, v: string) => void;
  // Shown next to the scripture label, e.g. when the AI picked the passage.
  scriptureNote?: string;
}) {
  return (
    <>
      <div className="row">
        <Choice
          label="Series"
          required
          value={meta.series}
          options={SERIES_OPTIONS}
          otherPlaceholder="Series name"
          onChange={(v) => onChange("series", v)}
        />
        <div className="field">
          <label>
            Part <span className="hint">— add the number, and a title if you like</span>
          </label>
          <input
            type="text"
            value={meta.part}
            onChange={(e) => onChange("part", e.target.value)}
            onFocus={(e) => {
              // Land the cursor after "Part " so typing goes straight to the number.
              const el = e.currentTarget;
              if (el.value === PART_PREFIX) {
                requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
              }
            }}
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
        <Choice
          label="Preacher"
          value={meta.preacher}
          options={PREACHER_OPTIONS}
          otherPlaceholder="Preacher's name"
          onChange={(v) => onChange("preacher", v)}
        />
      </div>
      <div className="field">
        <label>
          Scripture reference{" "}
          <span className="hint">
            — e.g. Luke 2:1-20 (passage text filled by the site)
            {scriptureNote ? ` · ${scriptureNote}` : ""}
          </span>
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
