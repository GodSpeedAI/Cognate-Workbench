// Files inspector tab: lazy workspace tree, small file tabs and a read-only CodeView.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, FileIcon, FolderIcon, XIcon } from "../icons.tsx";
import { InspectorEmpty, InspectorTab, useInspector } from "../shell/Inspector.tsx";
import { CodeView } from "./CodeView.tsx";

export type Invoke = (capability: string, input: unknown) => Promise<unknown>;

interface Entry { readonly name: string; readonly path: string; readonly kind: "file" | "directory" | "symlink"; readonly size?: number }
interface DirState { readonly entries?: readonly Entry[]; readonly truncated?: boolean; readonly error?: string; readonly loading?: boolean }
interface FileData { readonly size: number; readonly text?: string; readonly binary: boolean; readonly truncated: boolean; readonly language?: string }
interface OpenFile { readonly path: string; readonly name: string; readonly data?: FileData; readonly error?: string }

const MAX_TABS = 8;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function glyph(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const map: Record<string, string> = { ts: "TS", tsx: "TS", js: "JS", jsx: "JS", json: "{}", md: "M", css: "#", html: "<>", py: "Py", rs: "Rs", go: "Go", sh: "$", yml: "Y", yaml: "Y", toml: "T" };
  return map[ext] ?? "";
}

export function FilesTab({ invoke, workspaceId, workspaceName }: { readonly invoke: Invoke; readonly workspaceId: string | undefined; readonly workspaceName?: string | undefined }) {
  const [dirs, setDirs] = useState<Readonly<Record<string, DirState>>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<readonly OpenFile[]>([]);
  const [current, setCurrent] = useState<string | undefined>(undefined); // undefined => tree view
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const wsRef = useRef(workspaceId);
  // List only while this tab is actually on screen, so a hidden tab never calls the server (a workspace
  // that is not ready, or whose world is not connected, would answer 400 into the console).
  const inspector = useInspector();
  const shown = inspector.open && inspector.tab === "files";
  const rootLoadedFor = useRef<string | undefined>(undefined);

  const loadDir = useCallback(async (path: string) => {
    if (!workspaceId) return;
    setDirs((d) => ({ ...d, [path]: { ...d[path], loading: true } }));
    try {
      const r = (await invoke("workspace.files.list", path ? { workspaceId, path } : { workspaceId })) as { entries: Entry[]; truncated: boolean };
      if (wsRef.current !== workspaceId) return;
      setDirs((d) => ({ ...d, [path]: { entries: r.entries, truncated: r.truncated } }));
    } catch (e) {
      setDirs((d) => ({ ...d, [path]: { error: errText(e) } }));
    }
  }, [invoke, workspaceId]);

  useEffect(() => {
    wsRef.current = workspaceId;
    rootLoadedFor.current = undefined;
    setDirs({}); setExpanded(new Set()); setOpen([]); setCurrent(undefined); setFilter(""); setActive(0);
  }, [workspaceId]);

  useEffect(() => {
    if (!shown || !workspaceId || rootLoadedFor.current === workspaceId) return;
    rootLoadedFor.current = workspaceId;
    void loadDir("");
  }, [shown, workspaceId, loadDir]);

  const refresh = () => {
    const paths = ["", ...expanded];
    setDirs({});
    for (const p of paths) void loadDir(p);
  };

  const rows = useMemo(() => {
    const out: { entry: Entry; depth: number }[] = [];
    const q = filter.trim().toLowerCase();
    const walk = (path: string, depth: number) => {
      for (const entry of dirs[path]?.entries ?? []) {
        if (!q || entry.name.toLowerCase().includes(q)) out.push({ entry, depth: q ? 0 : depth });
        if (entry.kind === "directory" && expanded.has(entry.path) && (!q || true)) walk(entry.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [dirs, expanded, filter]);

  const toggleDir = (p: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else { n.add(p); if (!dirs[p]?.entries) void loadDir(p); }
      return n;
    });
  };

  const openFile = async (entry: Entry) => {
    if (!workspaceId) return;
    setCurrent(entry.path);
    if (open.some((f) => f.path === entry.path)) return;
    setOpen((o) => [...(o.length >= MAX_TABS ? o.slice(1) : o), { path: entry.path, name: entry.name }]);
    try {
      const data = (await invoke("workspace.file.read", { workspaceId, path: entry.path })) as FileData;
      setOpen((o) => o.map((f) => (f.path === entry.path ? { ...f, data } : f)));
    } catch (e) {
      setOpen((o) => o.map((f) => (f.path === entry.path ? { ...f, error: errText(e) } : f)));
    }
  };

  const closeFile = (path: string) => {
    setOpen((o) => o.filter((f) => f.path !== path));
    setCurrent((c) => {
      if (c !== path) return c;
      const i = open.findIndex((f) => f.path === path);
      const next = open.filter((f) => f.path !== path);
      return next[Math.min(i, next.length - 1)]?.path;
    });
  };

  const activate = (r: { entry: Entry }) => (r.entry.kind === "directory" ? toggleDir(r.entry.path) : void openFile(r.entry));
  const onTreeKey = (e: KeyboardEvent) => {
    const row = rows[active];
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "ArrowRight" && row?.entry.kind === "directory") { e.preventDefault(); if (!expanded.has(row.entry.path)) toggleDir(row.entry.path); else setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === "ArrowLeft" && row) {
      e.preventDefault();
      if (row.entry.kind === "directory" && expanded.has(row.entry.path)) toggleDir(row.entry.path);
      else { const parent = row.entry.path.includes("/") ? row.entry.path.slice(0, row.entry.path.lastIndexOf("/")) : ""; const i = rows.findIndex((r) => r.entry.path === parent); if (i >= 0) setActive(i); }
    }
    else if ((e.key === "Enter" || e.key === " ") && row) { e.preventDefault(); activate(row); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(Math.max(0, rows.length - 1)); }
  };

  const cur = open.find((f) => f.path === current);
  const copy = async () => {
    if (!cur?.data?.text) return;
    try { await navigator.clipboard.writeText(cur.data.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  let body;
  if (!workspaceId) {
    body = <InspectorEmpty title="No workspace selected" hint="Pick a workspace to browse its files." />;
  } else {
    const root = dirs[""];
    body = (
      <div className="ft">
        <div className="ft-tabs" role="tablist" aria-label="Open files">
          <button type="button" role="tab" aria-selected={!cur} className="ft-tab ft-tab-tree" onClick={() => setCurrent(undefined)}>
            <FolderIcon width="13" height="13" /> {workspaceName ?? "Files"}
          </button>
          {open.map((f) => (
            <div key={f.path} className={`ft-tab${f.path === current ? " ft-tab-on" : ""}`} role="presentation" onAuxClick={(e: MouseEvent) => { if (e.button === 1) closeFile(f.path); }}>
              <button type="button" role="tab" aria-selected={f.path === current} title={f.path} className="ft-tab-main" onClick={() => setCurrent(f.path)} onKeyDown={(e) => { if (e.key === "Delete") closeFile(f.path); }}>
                {f.name}
              </button>
              <button type="button" className="ft-tab-x" aria-label={`Close ${f.name}`} onClick={() => closeFile(f.path)}><XIcon width="10" height="10" /></button>
            </div>
          ))}
        </div>
        <div className={cur ? "ft-body ft-split" : "ft-body"}>
        {(
          <div className="ft-tree-pane">
            <div className="ft-bar">
              <input className="ft-filter" type="search" placeholder="Filter loaded files" aria-label="Filter files" value={filter} onChange={(e) => { setFilter(e.target.value); setActive(0); }} />
              <button type="button" className="icon-btn" aria-label="Refresh files" title="Refresh" onClick={refresh}>↻</button>
            </div>
            {root?.error ? (
              <div className="ci-callout ci-danger" role="alert">{root.error} <button type="button" className="ci-link" onClick={() => void loadDir("")}>Retry</button></div>
            ) : !root?.entries ? (
              <p className="ci-note">Loading files…</p>
            ) : rows.length === 0 ? (
              <InspectorEmpty title={filter ? "No loaded file matches" : "This workspace folder is empty"} />
            ) : (
              <div className="ft-tree" role="tree" aria-label="Workspace files" tabIndex={0} onKeyDown={onTreeKey} aria-activedescendant={rows[active] ? `ft-${rows[active]!.entry.path}` : undefined}>
                {rows.map((r, i) => {
                  const dir = r.entry.kind === "directory";
                  const isOpen = dir && expanded.has(r.entry.path);
                  const state = dir ? dirs[r.entry.path] : undefined;
                  return (
                    <div key={r.entry.path}>
                      <div
                        id={`ft-${r.entry.path}`}
                        role="treeitem"
                        aria-level={r.depth + 1}
                        aria-selected={r.entry.path === current}
                        {...(dir ? { "aria-expanded": isOpen } : {})}
                        className={`ft-row${i === active ? " ft-row-active" : ""}`}
                        style={{ paddingLeft: 6 + r.depth * 14 }}
                        onClick={() => { setActive(i); activate(r); }}
                      >
                        <span className="ft-chev">{dir ? (isOpen ? <ChevronDownIcon width="12" height="12" /> : <ChevronRightIcon width="12" height="12" />) : null}</span>
                        <span className="ft-ico">{dir ? <FolderIcon width="14" height="14" /> : glyph(r.entry.name) ? <span className="ft-glyph">{glyph(r.entry.name)}</span> : <FileIcon width="14" height="14" />}</span>
                        <span className="ft-name">{r.entry.name}</span>
                      </div>
                      {isOpen && state?.loading && !state.entries && <div className="ft-hint" style={{ paddingLeft: 34 + r.depth * 14 }}>Loading…</div>}
                      {isOpen && state?.error && <div className="ft-hint ci-danger-text" role="alert" style={{ paddingLeft: 34 + r.depth * 14 }}>{state.error} <button type="button" className="ci-link" onClick={() => void loadDir(r.entry.path)}>Retry</button></div>}
                      {isOpen && state?.entries && state.entries.length === 0 && <div className="ft-hint" style={{ paddingLeft: 34 + r.depth * 14 }}>Empty folder</div>}
                    </div>
                  );
                })}
                {root.truncated && <div className="ft-hint">Listing truncated</div>}
              </div>
            )}
          </div>
        )}
        {cur && (
          <div className="ft-viewer">
            <div className="ft-vbar">
              <span className="ft-lang">{cur.data?.language ?? "text"}</span>
              <span className="ft-path" title={cur.path}>{cur.path}</span>
              <label className="ft-wrap"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap</label>
              <button type="button" className="icon-btn" aria-label="Copy file contents" title={copied ? "Copied" : "Copy"} disabled={!cur.data?.text} onClick={() => void copy()}><CopyIcon width="14" height="14" /></button>
            </div>
            {cur.error ? (
              <div className="ci-callout ci-danger" role="alert">{cur.error}</div>
            ) : !cur.data ? (
              <p className="ci-note">Loading…</p>
            ) : cur.data.binary ? (
              <InspectorEmpty title="Binary file" hint={`${cur.data.size.toLocaleString()} bytes, not shown.`} />
            ) : (
              <>
                {cur.data.truncated && <p className="ci-note ci-warn">Truncated at 512 KiB</p>}
                <CodeView text={cur.data.text ?? ""} language={cur.data.language} wrap={wrap} label={`Contents of ${cur.name}`} />
              </>
            )}
          </div>
        )}
        </div>
      </div>
    );
  }
  return <InspectorTab id="files" label="Files" icon={<FolderIcon />} order={40}>{body}</InspectorTab>;
}
