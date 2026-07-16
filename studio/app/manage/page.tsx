"use client";

import { useEffect, useState } from "react";

type Meta = { series: string; part: string; date: string; preacher: string; scripture: string };

type Draft = {
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

type GuideRow = { slug: string; series?: string; part?: string; date?: string; preacher?: string };

const EMPTY_DRAFT: Draft = {
  recap: "",
  one_thing: "",
  connecting: "",
  considering: "",
  confessing: "",
  committing: "",
  next_steps_intro: "",
  next_steps_title: "",
  next_steps: "",
};

function slugify(text: string): string {
  const s = text
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
  return s || "guide";
}

const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const paras = (s: string): string[] =>
  s
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);

function getCat(dq: Record<string, string[]>, name: string): string[] {
  const key = Object.keys(dq).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? dq[key] : [];
}

export default function ManagePage() {
  const [pass, setPass] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [guides, setGuides] = useState<GuideRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>({
    series: "",
    part: "",
    date: "",
    preacher: "",
    scripture: "",
  });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("studio_admin_passcode");
    if (saved) {
      setPass(saved);
      fetch("/api/admin/auth", { headers: { "x-admin-passcode": saved } })
        .then((res) => {
          if (res.ok) {
            setAuthed(true);
            void loadList(saved);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function headers(p = pass) {
    return { "Content-Type": "application/json", "x-admin-passcode": p };
  }

  async function unlock() {
    const p = pass.trim();
    if (!p) return setError("Enter the admin passcode.");
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/admin/auth", { headers: { "x-admin-passcode": p } });
      if (res.ok) {
        localStorage.setItem("studio_admin_passcode", p);
        setAuthed(true);
        void loadList(p);
      } else {
        setError("Incorrect admin passcode.");
      }
    } catch {
      setError("Could not verify the passcode. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function loadList(p = pass) {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/guides", { headers: { "x-admin-passcode": p } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load guides");
      setGuides(data.guides || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load guides");
    } finally {
      setLoadingList(false);
    }
  }

  function fillDraft(content: Record<string, unknown>) {
    const dq = (content.discussion_questions || {}) as Record<string, string[]>;
    const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
    setDraft({
      recap: list(content.recap).join("\n\n"),
      one_thing: typeof content.one_thing === "string" ? content.one_thing : "",
      connecting: getCat(dq, "Connecting").join("\n"),
      considering: getCat(dq, "Considering").join("\n"),
      confessing: getCat(dq, "Confessing").join("\n"),
      committing: getCat(dq, "Committing").join("\n"),
      next_steps_intro: typeof content.next_steps_intro === "string" ? content.next_steps_intro : "",
      next_steps_title: typeof content.next_steps_title === "string" ? content.next_steps_title : "",
      next_steps: list(content.next_steps).join("\n"),
    });
  }

  async function startEdit(slug: string) {
    setError(null);
    setNotice(null);
    setBusySlug(slug);
    try {
      const res = await fetch(`/api/admin/guide?slug=${encodeURIComponent(slug)}`, {
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load guide");
      setMeta({
        series: data.meta.series || "",
        part: data.meta.part || "",
        date: data.meta.date || "",
        preacher: data.meta.preacher || "",
        scripture: data.meta.scripture || "",
      });
      fillDraft(data.content || {});
      setEditing(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load guide");
    } finally {
      setBusySlug(null);
    }
  }

  function metaOut() {
    return {
      series: meta.series.trim(),
      part: meta.part.trim(),
      date: meta.date,
      preacher: meta.preacher.trim(),
      scripture: meta.scripture.trim(),
    };
  }

  function contentOut() {
    const dq: Record<string, string[]> = {};
    const add = (name: string, v: string) => {
      const l = lines(v);
      if (l.length) dq[name] = l;
    };
    add("Connecting", draft.connecting);
    add("Considering", draft.considering);
    add("Confessing", draft.confessing);
    add("Committing", draft.committing);
    return {
      recap: paras(draft.recap),
      one_thing: draft.one_thing.trim(),
      discussion_questions: dq,
      next_steps: lines(draft.next_steps),
      next_steps_intro: draft.next_steps_intro.trim() || undefined,
      next_steps_title: draft.next_steps_title.trim() || undefined,
    };
  }

  async function save(confirmOverwrite = false) {
    if (!editing) return;
    if (!meta.series.trim()) return setError("Series is required.");
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/save", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          originalSlug: editing,
          meta: metaOut(),
          content: contentOut(),
          confirmOverwrite,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsConfirm) {
        const ok = window.confirm(`${data.message} Overwrite it?`);
        setSaving(false);
        if (ok) await save(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Save failed");
      setEditing(null);
      setNotice(
        data.renamed
          ? `Saved and renamed to "${data.slug}". Rebuilding — live shortly.`
          : `Saved "${data.slug}". Rebuilding — live shortly.`,
      );
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function del(slug: string) {
    if (
      !window.confirm(
        `Delete "${slug}"? This removes the guide and its transcript. It can only be recovered via git history.`,
      )
    )
      return;
    setError(null);
    setNotice(null);
    setBusySlug(slug);
    try {
      const res = await fetch("/api/admin/delete", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setNotice(`Deleted "${slug}". Rebuilding — it will drop off the site shortly.`);
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusySlug(null);
    }
  }

  const setMetaField = (k: keyof Meta, v: string) => setMeta((m) => ({ ...m, [k]: v }));
  const setDraftField = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const newSlug = meta.series.trim() ? slugify(`${meta.series} ${meta.part}`.trim()) : "";

  // ---- Gate ----
  if (!authed) {
    return (
      <div className="wrap">
        <h1>Manage Guides</h1>
        <p className="sub">Admin only. Enter the admin passcode to continue.</p>
        {error && <div className="error">{error}</div>}
        <div className="card">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Admin passcode</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlock();
              }}
              placeholder="Admin passcode"
              autoFocus
            />
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button onClick={() => void unlock()} disabled={checking}>
              {checking && <span className="spinner" />}
              {checking ? "Checking…" : "Unlock"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Edit ----
  if (editing) {
    return (
      <div className="wrap">
        <h1>Edit guide</h1>
        <p className="sub">
          Editing <code>{editing}</code>
          {newSlug && newSlug !== editing ? (
            <>
              {" "}
              — will be renamed to <code>{newSlug}</code>
            </>
          ) : null}
          .
        </p>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <div className="row">
            <Field label="Series *">
              <input
                type="text"
                value={meta.series}
                onChange={(e) => setMetaField("series", e.target.value)}
              />
            </Field>
            <Field label="Part">
              <input
                type="text"
                value={meta.part}
                onChange={(e) => setMetaField("part", e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label="Date">
              <input
                type="date"
                value={meta.date}
                onChange={(e) => setMetaField("date", e.target.value)}
              />
            </Field>
            <Field label="Preacher">
              <input
                type="text"
                value={meta.preacher}
                onChange={(e) => setMetaField("preacher", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Scripture reference">
            <input
              type="text"
              value={meta.scripture}
              onChange={(e) => setMetaField("scripture", e.target.value)}
            />
          </Field>
        </div>

        <div className="card">
          <Field label="Recap (paragraphs, blank line between)">
            <textarea
              value={draft.recap}
              onChange={(e) => setDraftField("recap", e.target.value)}
              style={{ minHeight: 160 }}
            />
          </Field>
          <Field label="One thing">
            <input
              type="text"
              value={draft.one_thing}
              onChange={(e) => setDraftField("one_thing", e.target.value)}
            />
          </Field>
        </div>

        <div className="card">
          <label style={{ marginBottom: 12 }}>Discussion questions (one per line)</label>
          <Field label="Connecting">
            <textarea
              value={draft.connecting}
              onChange={(e) => setDraftField("connecting", e.target.value)}
            />
          </Field>
          <Field label="Considering">
            <textarea
              value={draft.considering}
              onChange={(e) => setDraftField("considering", e.target.value)}
            />
          </Field>
          <Field label="Confessing">
            <textarea
              value={draft.confessing}
              onChange={(e) => setDraftField("confessing", e.target.value)}
            />
          </Field>
          <Field label="Committing">
            <textarea
              value={draft.committing}
              onChange={(e) => setDraftField("committing", e.target.value)}
            />
          </Field>
        </div>

        <div className="card">
          <Field label="Next steps intro (optional)">
            <input
              type="text"
              value={draft.next_steps_intro}
              onChange={(e) => setDraftField("next_steps_intro", e.target.value)}
            />
          </Field>
          <Field label="Next steps (one per line)">
            <textarea
              value={draft.next_steps}
              onChange={(e) => setDraftField("next_steps", e.target.value)}
            />
          </Field>
        </div>

        <div className="actions">
          <button onClick={() => void save(false)} disabled={saving}>
            {saving && <span className="spinner" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button className="secondary" onClick={() => setEditing(null)} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ---- List ----
  return (
    <div className="wrap">
      <h1>Manage Guides</h1>
      <p className="sub">Edit or delete published guides.</p>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok">{notice}</div>}

      <div className="card">
        {loadingList && (
          <p className="muted">
            <span className="spinner" />
            Loading…
          </p>
        )}
        {!loadingList && guides.length === 0 && <p className="muted">No guides found.</p>}
        {guides.map((g) => (
          <div
            key={g.slug}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 0",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {g.series || g.slug}
                {g.part ? ` — ${g.part}` : ""}
              </div>
              <div className="muted">
                {[g.date, g.preacher].filter(Boolean).join(" · ")}
                {g.date || g.preacher ? " · " : ""}
                <code>{g.slug}</code>
              </div>
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className="secondary"
                onClick={() => void startEdit(g.slug)}
                disabled={busySlug === g.slug}
              >
                Edit
              </button>
              <button
                className="secondary"
                onClick={() => void del(g.slug)}
                disabled={busySlug === g.slug}
                style={{ color: "var(--danger)", borderColor: "#f0c0c0" }}
              >
                {busySlug === g.slug ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button className="secondary" onClick={() => void loadList()} disabled={loadingList}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
