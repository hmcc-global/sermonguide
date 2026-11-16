// Shared types and tiny helpers for the Studio create flow.

export type Meta = {
  series: string;
  part: string;
  date: string;
  preacher: string;
  scripture: string;
};

export type Draft = {
  recap: string;
  one_thing: string;
  connecting: string;
  considering: string;
  confessing: string;
  committing: string;
  next_steps_intro: string;
  next_steps_title: string;
  next_steps: string;
};

// ---- Defaults for the details form ----

export const SERIES_OPTIONS = ["Higher Calling", "Sunday Celebration", "Advent"];
export const PREACHER_OPTIONS = [
  "Pastor Pete Dahlem",
  "Pastor Josh Yang",
  "Pastor Sam Beck",
  "Josh Cheng",
  "Dr. Ron White",
  "Danny Bang",
  "Dennis Kim",
];

// Local calendar date as YYYY-MM-DD (what <input type="date"> expects).
export function todayLocal(): string {
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${day}`;
}

// The Part box starts as "Part " so the editor only types the number/title.
export const PART_PREFIX = "Part ";

export function defaultMeta(): Meta {
  return {
    series: SERIES_OPTIONS[0],
    part: PART_PREFIX,
    date: todayLocal(),
    preacher: PREACHER_OPTIONS[0],
    scripture: "",
  };
}

// An untouched "Part " (or "Part:") means no part. Everything downstream (slug,
// preview, markdown, publish) goes through this so a bare "Part" never ships.
export function cleanPart(part: string): string {
  const p = part.trim();
  return /^part\s*:?$/i.test(p) ? "" : p;
}

export function tidyMeta(m: Meta): Meta {
  return { ...m, part: cleanPart(m.part) };
}

export const lines =(s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export const paras = (s: string): string[] =>
  s
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);
