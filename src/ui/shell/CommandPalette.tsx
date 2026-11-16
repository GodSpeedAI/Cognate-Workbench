// "Go to anything" (Ctrl/Cmd+K): one fuzzy-searchable list over actions, Settings sections,
// workspaces and sessions. Pure presentation over items the App assembles — running an item calls
// the same handlers the rest of the UI uses, so the palette never owns a mutation of its own.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SearchIcon } from "../icons.tsx";
import { CloseButton } from "./DialogHeader.tsx";
import { Kbd } from "./Kbd.tsx";
import { useModalFocus } from "./useModalFocus.ts";

export type PaletteGroup = "Actions" | "Settings" | "Workspaces" | "Sessions";
const GROUP_ORDER: readonly PaletteGroup[] = ["Actions", "Settings", "Workspaces", "Sessions"];
/** Without a query the Sessions group would swamp the list; show only the most recent few. */
const EMPTY_QUERY_SESSION_LIMIT = 6;
const MAX_RESULTS = 40;

export interface PaletteItem {
  readonly id: string;
  readonly group: PaletteGroup;
  readonly label: string;
  /** Secondary text (a workspace path, a session's workspace). */
  readonly detail?: string;
  /** Extra search terms that are not shown. */
  readonly keywords?: string;
  /** Canonical chord ("Ctrl+,") shown as <kbd> hints. */
  readonly chord?: string | undefined;
  readonly icon?: ReactNode;
  readonly run: () => void;
}

/**
 * Fuzzy match score, higher is better, `undefined` when the query is not a subsequence of the text.
 * Substring hits beat scattered subsequences; word-start and early hits beat late ones.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s/\-_.]/.test(t[at - 1] ?? "");
    return 1000 - at + (wordStart ? 200 : 0) - Math.min(t.length - q.length, 100) / 10;
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    const idx = t.indexOf(ch, from);
    if (idx < 0) return undefined;
    score += 10 - Math.min(idx - from, 8);
    if (idx === previous + 1) score += 6;
    if (idx === 0 || /[\s/\-_.]/.test(t[idx - 1] ?? "")) score += 8;
    previous = idx;
    from = idx + 1;
  }
  return score;
}

export function searchPalette(items: readonly PaletteItem[], query: string): readonly PaletteItem[] {
  const q = query.trim();
  if (q.length === 0) {
    let sessions = 0;
    return items.filter((item) => item.group !== "Sessions" || ++sessions <= EMPTY_QUERY_SESSION_LIMIT);
  }
  const scored: { readonly item: PaletteItem; readonly score: number; readonly order: number }[] = [];
  items.forEach((item, order) => {
    const onLabel = fuzzyScore(q, item.label);
    const onAny = fuzzyScore(q, `${item.label} ${item.detail ?? ""} ${item.keywords ?? ""}`);
    // A label hit outranks a hit that only exists in the detail or hidden keywords.
    const score = onLabel ?? (onAny === undefined ? undefined : onAny - 150);
    if (score !== undefined) scored.push({ item, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, MAX_RESULTS).map((s) => s.item);
}

export function CommandPalette({ items, onClose }: { readonly items: readonly PaletteItem[]; readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);

  const results = useMemo(() => searchPalette(items, query), [items, query]);
  // Keep results grouped in a fixed order; within a group the (scored) order is preserved.
  const grouped = useMemo(() => {
    const searching = query.trim().length > 0;
    const groups = GROUP_ORDER.map((group) => ({ group, items: results.filter((r) => r.group === group) })).filter((g) => g.items.length > 0);
    if (searching) groups.sort((a, b) => results.indexOf(a.items[0]!) - results.indexOf(b.items[0]!));
    return groups;
  }, [results, query]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    // After the dialog unmounts, so focus return does not fight the destination's own focus.
    setTimeout(item.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(flat.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[active]);
    }
  };

  const activeId = flat[active] ? `palette-opt-${flat[active]!.id}` : undefined;
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command palette" tabIndex={-1} ref={dialogRef} onKeyDown={onKeyDown}>
        <div className="dialog-banner modal-header">
          <div className="modal-header-text">
            <h2 id="palette-heading">Go to anything</h2>
          </div>
          <CloseButton label="command palette" onClick={onClose} />
        </div>
        <div className="palette-search">
          <SearchIcon />
          <input
            type="text"
            role="combobox"
            aria-label="Search actions, workspaces and sessions"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-autocomplete="list"
            {...(activeId ? { "aria-activedescendant": activeId } : {})}
            placeholder="Search actions, workspaces and sessions…"
            value={query}
            data-autofocus=""
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <div className="palette-list" id="palette-listbox" role="listbox" aria-label="Results" ref={listRef}>
          {flat.length === 0 ? (
            <p className="palette-empty" role="status">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            grouped.map((g) => (
              <div key={g.group} role="group" aria-label={g.group} className="palette-group">
                <div className="palette-group-title" aria-hidden="true">
                  {g.group}
                </div>
                {g.items.map((item) => {
                  const index = flat.indexOf(item);
                  return (
                    <div
                      key={item.id}
                      id={`palette-opt-${item.id}`}
                      role="option"
                      aria-selected={index === active}
                      className={index === active ? "palette-item active" : "palette-item"}
                      onMouseMove={() => index !== active && setActive(index)}
                      onClick={() => run(item)}
                    >
                      <span className="palette-item-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="palette-item-label">{item.label}</span>
                      {item.detail && <span className="palette-item-detail">{item.detail}</span>}
                      <Kbd chord={item.chord} />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
