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

export const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export const paras = (s: string): string[] =>
  s
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);
