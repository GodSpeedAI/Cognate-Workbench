// Config inspector tab: edit the Cognate configuration file with a JSON pre-check and versioned apply.
import { useCallback, useEffect, useState } from "react";
import { GearIcon } from "../icons.tsx";
import { InspectorTab } from "../shell/Inspector.tsx";
import { CodeView } from "./CodeView.tsx";
import type { Invoke } from "./FilesTab.tsx";

interface ConfigFile { readonly path: string; readonly exists: boolean; readonly text: string; readonly version: string; readonly readOnlyKeys: readonly string[] }
interface Notice { readonly kind: "ok" | "error"; readonly message: string; readonly line?: number; readonly conflict?: boolean }

/** Parse the message out of `invocation of X failed: {"kind":...,"message":"..."}`. */
export function refusalMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const i = raw.indexOf("{");
  if (i >= 0) {
    try {
      const m = (JSON.parse(raw.slice(i)) as { message?: unknown }).message;
      if (typeof m === "string") return m;
    } catch { /* not JSON */ }
  }
  return raw;
}

/** Locate a JSON syntax error as line/column, or undefined when the text parses. */
export function jsonProblem(text: string): { message: string; line: number; column: number } | undefined {
  try { JSON.parse(text); return undefined; } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let line = 1, column = 1;
    const lc = /line (\d+) column (\d+)/i.exec(msg);
    const pos = /position (\d+)/.exec(msg);
    if (lc) { line = Number(lc[1]); column = Number(lc[2]); }
    else if (pos) {
      const before = text.slice(0, Number(pos[1]));
      line = before.split("\n").length; column = Number(pos[1]) - before.lastIndexOf("\n");
    } else { const lines = text.split("\n"); line = lines.length; column = (lines[lines.length - 1]?.length ?? 0) + 1; }
    return { message: msg, line, column };
  }
}

export function ConfigTab({ invoke }: { readonly invoke: Invoke }) {
  const [file, setFile] = useState<ConfigFile | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (keepNotice = false) => {
    setLoadError(undefined);
    try {
      const r = (await invoke("config.file.read", {})) as ConfigFile;
      setFile(r); setDraft(r.text);
      if (!keepNotice) setNotice(undefined);
    } catch (e) { setLoadError(refusalMessage(e)); }
  }, [invoke]);
  useEffect(() => { void load(); }, [load]);

  const dirty = file !== undefined && draft !== file.text;
  const save = async () => {
    if (!file || saving || !dirty) return;
    const bad = jsonProblem(draft);
    if (bad) { setNotice({ kind: "error", message: `Invalid JSON at line ${bad.line}, column ${bad.column}: ${bad.message}`, line: bad.line }); return; }
    setSaving(true);
    try {
      const r = (await invoke("config.file.apply", { text: draft, expectedVersion: file.version })) as { applied: string[]; ignored: string[] };
      await load(true);
      const ignored = r.ignored?.length ? `. Ignored: ${r.ignored.join(", ")}` : "";
      setNotice({ kind: "ok", message: `Saved. Applied: ${r.applied?.length ? r.applied.join(", ") : "nothing changed"}${ignored}` });
    } catch (e) {
      const message = refusalMessage(e);
      const m = /line (\d+),? column (\d+)/i.exec(message);
      setNotice({ kind: "error", message, ...(m ? { line: Number(m[1]) } : {}), conflict: /version|changed|conflict|stale/i.test(message) });
    } finally { setSaving(false); }
  };

  let body;
  if (loadError) {
    body = <div className="ci-callout ci-danger" role="alert">{loadError} <button type="button" className="ci-link" onClick={() => void load()}>Retry</button></div>;
  } else if (!file) {
    body = <p className="ci-note">Loading configuration…</p>;
  } else {
    body = (
      <div className="cfg">
        <div className="cfg-head">
          <span className="cfg-path" title={file.path}>{file.path}</span>
          <span className={`cfg-status${file.exists ? "" : " cfg-status-new"}`}>{file.exists ? "exists" : "not yet written"}</span>
        </div>
        <CodeView label="Configuration JSON" text={draft} onChange={(t) => { setDraft(t); if (notice?.kind === "error") setNotice(undefined); }} onSave={() => void save()} errorLine={notice?.kind === "error" ? notice.line : undefined} />
        {notice && (
          <div className={`ci-callout ${notice.kind === "ok" ? "ci-ok" : "ci-danger"}`} role={notice.kind === "ok" ? "status" : "alert"}>
            {notice.message}
            {notice.line !== undefined && notice.kind === "error" && <span> (line {notice.line})</span>}
            {notice.conflict && <button type="button" className="ci-link" onClick={() => void load()}>Reload (discards edits)</button>}
          </div>
        )}
        <div className="cfg-actions">
          <span className="cfg-dirty" aria-live="polite">{dirty ? "Unsaved changes" : ""}</span>
          <button type="button" className="cfg-btn" disabled={!dirty || saving} onClick={() => { setDraft(file.text); setNotice(undefined); }}>Revert</button>
          <button type="button" className="cfg-btn cfg-btn-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
        <p className="ci-note">{file.readOnlyKeys.length ? `${file.readOnlyKeys.join(", ")} are informational and not applied.` : ""} Ctrl/Cmd+S saves.</p>
      </div>
    );
  }
  return <InspectorTab id="config" label="Config" icon={<GearIcon />} order={50}>{body}</InspectorTab>;
}
