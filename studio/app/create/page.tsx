"use client";

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";

type Stage = "input" | "working" | "review";
type Mode = "audio" | "paste";

type Meta = {
  series: string;
  part: string;
  date: string;
  preacher: string;
  scripture: string;
};

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

type GuideRef = { slug: string; url: string };

type InboxRow = {
  id: string;
  title: string;
  date?: string;
  preacher?: string;
  source?: string;
  receivedAt?: string;
  words?: number;
};

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

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function describeInbox(row: InboxRow): string {
  const parts: string[] = [];
  if (row.date) parts.push(fmtDate(row.date));
  if (row.receivedAt) parts.push(`received ${timeAgo(row.receivedAt)}`);
  if (typeof row.words === "number" && row.words > 0) parts.push(`${row.words.toLocaleString()} words`);
  if (row.preacher) parts.push(row.preacher);
  return parts.join(" · ");
}

export default function Page() {
  const [passcode, setPasscode] = useState("");
  const [mode, setMode] = useState<Mode>("paste");
  const [stage, setStage] = useState<Stage>("input");
  const [meta, setMeta] = useState<Meta>({
    series: "",
    part: "",
    date: "",
    preacher: "",
    scripture: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ liveUrl: string; slug: string } | null>(null);
  const [guides, setGuides] = useState<GuideRef[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [inboxBusy, setInboxBusy] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("studio_passcode");
    if (saved) {
      setPasscode(saved);
      // Silently unlock if the saved passcode is still valid.
      fetch("/api/auth", { headers: { "x-app-passcode": saved } })
        .then((res) => {
          if (res.ok) {
            setAuthed(true);
            void loadGuides(saved);
            void loadInbox(saved);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unlock() {
    const pass = passcode.trim();
    if (!pass) return setError("Enter the passcode.");
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/auth", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        localStorage.setItem("studio_passcode", pass);
        setAuthed(true);
        void loadGuides(pass);
        void loadInbox(pass);
      } else {
        setError("Incorrect passcode.");
      }
    } catch {
      setError("Could not verify the passcode. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function loadGuides(pass: string) {
    try {
      const res = await fetch("/api/guides", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        const data = await res.json();
        setGuides(data.guides || []);
      }
    } catch {
      /* non-critical */
    }
  }

  async function loadInbox(pass: string) {
    try {
      const res = await fetch("/api/inbox", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        const data = await res.json();
        setInbox(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      /* non-critical */
    }
  }

  // Pull a delivered transcript into the form. Fills the transcript box and any
  // metadata that came with it; the leader still sets Series/Part.
  async function useInboxItem(row: InboxRow) {
    setError(null);
    setInboxBusy(row.id);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(row.id)}`, {
        headers: { "x-app-passcode": passcode },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load that transcript");
      setMode("paste");
      setTranscript(typeof data.vtt === "string" ? data.vtt : "");
      const m = (data.meta ?? {}) as { date?: string; preacher?: string };
      setMeta((prev) => ({
        ...prev,
        date: prev.date || m.date || "",
        preacher: prev.preacher || m.preacher || "",
      }));
      setInboxId(row.id);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that transcript");
    } finally {
      setInboxBusy(null);
    }
  }

  // Remove a delivered transcript without publishing it.
  async function dismissInboxItem(row: InboxRow) {
    if (!window.confirm(`Dismiss "${row.title}"? It will be removed from the inbox.`)) return;
    setError(null);
    setInboxBusy(row.id);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "x-app-passcode": passcode },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not dismiss that transcript");
      setInbox((list) => list.filter((it) => it.id !== row.id));
      if (inboxId === row.id) setInboxId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss that transcript");
    } finally {
      setInboxBusy(null);
    }
  }

  const setMetaField = (k: keyof Meta, v: string) => setMeta((m) => ({ ...m, [k]: v }));
  const setDraftField = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  function metaOut() {
    return {
      series: meta.series.trim(),
      part: meta.part.trim() || undefined,
      date: meta.date || undefined,
      preacher: meta.preacher.trim() || undefined,
      scripture_title: meta.scripture.trim() || undefined,
      scripture_ref: meta.scripture.trim() || undefined,
    };
  }

  function contentOut() {
    const dq: Record<string, string[]> = {};
    const add = (name: string, v: string) => {
      const list = lines(v);
      if (list.length) dq[name] = list;
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

  function fillDraft(g: Record<string, unknown>) {
    const dq = (g.discussion_questions || {}) as Record<string, string[]>;
    const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
    setDraft({
      recap: list(g.recap).join("\n\n"),
      one_thing: typeof g.one_thing === "string" ? g.one_thing : "",
      connecting: getCat(dq, "Connecting").join("\n"),
      considering: getCat(dq, "Considering").join("\n"),
      confessing: getCat(dq, "Confessing").join("\n"),
      committing: getCat(dq, "Committing").join("\n"),
      next_steps_intro: typeof g.next_steps_intro === "string" ? g.next_steps_intro : "",
      next_steps_title: typeof g.next_steps_title === "string" ? g.next_steps_title : "",
      next_steps: list(g.next_steps).join("\n"),
    });
  }

  function validate(): string | null {
    if (!passcode) return "Enter the passcode first.";
    if (!meta.series.trim()) return "Series is required.";
    if (mode === "audio" && !file) return "Choose an audio file.";
    if (mode === "paste" && !transcript.trim()) return "Paste a transcript first.";
    return null;
  }

  async function onGenerate() {
    const v = validate();
    if (v) return setError(v);
    setError(null);
    setTranscriptFailed(false);
    setStage("working");

    try {
      let payload: Record<string, unknown>;
      if (mode === "audio" && file) {
        setWorking("Uploading audio…");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: passcode,
          contentType: file.type || "audio/mpeg",
        });
        setWorking("Generating guide and transcript… (this can take a minute)");
        payload = { blobUrl: blob.url, mimeType: file.type || "audio/mp3", meta: metaOut() };
      } else {
        setWorking("Generating the guide…");
        payload = { transcript, meta: metaOut() };
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": passcode },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      fillDraft(data.guide || {});
      if (typeof data.transcript === "string") setTranscript(data.transcript);
      setTranscriptFailed(Boolean(data.transcriptFailed));
      setStage("review");
    } catch (e) {
      setStage("input");
      setError(e instanceof Error ? e.message : "Generation failed");
    }
  }

  async function onPublish(confirmOverwrite = false) {
    setError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": passcode },
        body: JSON.stringify({
          meta: metaOut(),
          content: contentOut(),
          transcript,
          confirmOverwrite,
          inboxId: mode === "paste" ? inboxId ?? undefined : undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsConfirm) {
        const ok = window.confirm(`${data.message} Overwrite it?`);
        setPublishing(false);
        if (ok) await onPublish(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Publish failed");
      setResult({ liveUrl: data.liveUrl, slug: data.slug });
      setInboxId(null);
      void loadGuides(passcode);
      void loadInbox(passcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  function reset() {
    setStage("input");
    setMeta({ series: "", part: "", date: "", preacher: "", scripture: "" });
    setFile(null);
    setTranscript("");
    setTranscriptFailed(false);
    setDraft(EMPTY_DRAFT);
    setResult(null);
    setError(null);
    setInboxId(null);
  }

  const slug = meta.series.trim() ? slugify(`${meta.series} ${meta.part}`.trim()) : "";

  if (!authed) {
    return (
      <div className="wrap">
        <h1>Sermon Guide Studio</h1>
        <p className="sub">Enter the passcode to continue.</p>
        {error && <div className="error">{error}</div>}
        <div className="card">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Passcode</label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlock();
              }}
              placeholder="Shared passcode"
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

  return (
    <div className="wrap">
      <h1>Sermon Guide Studio</h1>
      <p className="sub">Upload a sermon, review the generated guide, and publish it live.</p>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="ok">
          <strong>Published.</strong> <code>{result.slug}</code> will be live shortly at{" "}
          <a href={result.liveUrl} target="_blank" rel="noreferrer">
            {result.liveUrl}
          </a>
          <div style={{ marginTop: 10 }}>
            <button className="secondary" onClick={reset}>
              Start another
            </button>
          </div>
        </div>
      )}

      {!result && stage === "input" && (
        <>
          {inbox.length > 0 && (
            <div className="card">
              <div className="inbox-head">
                <label style={{ margin: 0 }}>Waiting from SermonClipper</label>
                <span className="inbox-count">{inbox.length} available</span>
              </div>
              <div className="inbox-list">
                {inbox.map((row) => (
                  <div
                    key={row.id}
                    className={inboxId === row.id ? "inbox-item current" : "inbox-item"}
                  >
                    <div className="inbox-meta">
                      <div className="t">{row.title}</div>
                      {describeInbox(row) && <div className="d">{describeInbox(row)}</div>}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void dismissInboxItem(row)}
                      disabled={inboxBusy !== null}
                    >
                      Dismiss
                    </button>
                    <button onClick={() => void useInboxItem(row)} disabled={inboxBusy !== null}>
                      {inboxBusy === row.id && <span className="spinner" />}
                      {inboxId === row.id ? "Loaded" : "Use this"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Picking one loads its transcript below and fills the date. Dismiss removes it without
                publishing.
              </p>
            </div>
          )}

          <div className="card">
            <div className="tabs">
              <button
                className={mode === "audio" ? "tab active" : "tab"}
                onClick={() => setMode("audio")}
              >
                Upload audio
              </button>
              <button
                className={mode === "paste" ? "tab active" : "tab"}
                onClick={() => setMode("paste")}
              >
                Paste transcript
                {inbox.length > 0 && <span className="tab-badge">{inbox.length}</span>}
              </button>
            </div>

            <div className="row">
              <div className="field">
                <label>Series *</label>
                <input
                  type="text"
                  value={meta.series}
                  onChange={(e) => setMetaField("series", e.target.value)}
                  placeholder="ADORE"
                />
              </div>
              <div className="field">
                <label>Part</label>
                <input
                  type="text"
                  value={meta.part}
                  onChange={(e) => setMetaField("part", e.target.value)}
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
                  onChange={(e) => setMetaField("date", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Preacher</label>
                <input
                  type="text"
                  value={meta.preacher}
                  onChange={(e) => setMetaField("preacher", e.target.value)}
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
                onChange={(e) => setMetaField("scripture", e.target.value)}
                placeholder="Luke 2:1-20"
              />
            </div>
            {slug && (
              <p className="muted">
                Will publish as <code>content/{slug}.yaml</code>
              </p>
            )}
          </div>

          <div className="card">
            {mode === "audio" ? (
              <div className="field">
                <label>
                  Audio file <span className="hint">— mp3 recommended (also m4a, wav)</span>
                </label>
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="muted">
                    {file.name} — {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </div>
            ) : (
              <div className="field">
                <label>
                  Transcript
                  {inboxId && <span className="hint"> — loaded from the inbox</span>}
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Paste the sermon transcript here…"
                  style={{ minHeight: 220 }}
                />
              </div>
            )}
            <div className="actions">
              <button onClick={onGenerate}>Generate guide</button>
            </div>
          </div>

          {guides.length > 0 && (
            <div className="card">
              <label>Published guides</label>
              <div className="chips">
                {guides.map((g) => (
                  <a key={g.slug} className="chip" href={g.url} target="_blank" rel="noreferrer">
                    {g.slug}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!result && stage === "working" && (
        <div className="card">
          <span className="spinner" />
          {working}
        </div>
      )}

      {!result && stage === "review" && (
        <>
          {transcriptFailed && (
            <div className="warn">
              The transcript couldn&apos;t be generated, but the guide is ready. You can still publish
              (no transcript will be saved), or go back and try again.
            </div>
          )}

          <div className="card">
            <Field label="Recap (paragraphs, blank line between)">
              <textarea
                value={draft.recap}
                onChange={(e) => setDraftField("recap", e.target.value)}
                style={{ minHeight: 140 }}
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

          <Preview meta={meta} draft={draft} />

          {slug && (
            <p className="muted" style={{ marginTop: 12 }}>
              Publishing to <code>content/{slug}.yaml</code>
              {transcript.trim() ? ` and transcripts/${slug}.md` : ""}.
            </p>
          )}

          <div className="actions" style={{ marginTop: 8 }}>
            <button onClick={() => onPublish(false)} disabled={publishing}>
              {publishing && <span className="spinner" />}
              {publishing ? "Publishing…" : "Approve & publish"}
            </button>
            <button className="secondary" onClick={() => setStage("input")} disabled={publishing}>
              Back
            </button>
          </div>
        </>
      )}
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

function Preview({ meta, draft }: { meta: Meta; draft: Draft }) {
  const cats: [string, string][] = [
    ["Connecting", draft.connecting],
    ["Considering", draft.considering],
    ["Confessing", draft.confessing],
    ["Committing", draft.committing],
  ];
  return (
    <div className="preview">
      <p className="series">{meta.series || "Series"}</p>
      {meta.part && <p className="part">{meta.part}</p>}
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
