// J-WS-directory-discovery: the shared, accessible directory type-ahead every path-input uses —
// the Add-workspace dialog's local tab, the SSH/WSL folder step and the first-run chooser all wrap
// this one component instead of duplicating filesystem code. Suggestions come from the validated,
// read-only `workspace.directory.suggest` capability against the *selected execution world*;
// this component never touches the browser machine's filesystem, and the server owns all path
// interpretation (`~`, bare fragments, fuzzy matching) — this component just sends what was typed.
//
// Interaction contract (see the journey's settlement):
// - typing debounces (120ms) a bounded query for ANY input, including an empty focused field
//   (which lists the user home); stale or out-of-order responses are discarded, so typing stays
//   responsive even when a slow SSH world is still answering an earlier fragment;
// - suggestions show a home-relative `display`, a dim full path and the matched characters;
// - ArrowUp/ArrowDown move the active option; Tab or Enter completes it to the folder path with a
//   trailing separator and immediately re-queries its children so the operator can keep drilling
//   down; Enter with no active option still submits the form as before; Escape dismisses the list;
// - pointer selection works the same way; the field is an ARIA combobox over a real listbox
//   (aria-activedescendant), keyboard completion never moves focus away from the field;
// - an empty result is an inline row (never a silent close), a loading row shows only after 300ms,
//   and errors are shown in place with live-region semantics;
// - optional `recent` paths are offered (labelled "Recent") when the field is empty and focused.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface DirectorySuggestOption {
  readonly name: string;
  readonly path: string;
  readonly display?: string;
  readonly matchIndices?: readonly number[];
  readonly recent?: boolean;
}

type SuggestStatus = "idle" | "loading" | "done" | "error";

export interface DirectoryFieldProps {
  /** The execution world whose folders these are ("local" for this machine). */
  readonly worldId: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (path: string) => void;
  /** `invoke` seam (the client's capability invoke); keeps this component transport-agnostic. */
  readonly invoke: (capability: string, input: unknown) => Promise<unknown>;
  /** Called when Enter should submit the surrounding form (no active suggestion). */
  readonly onSubmit?: () => void;
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly suggestedLabel?: string;
  /** Recently opened folders, offered above the home folders when the field is empty and focused. */
  readonly recent?: readonly string[];
}

interface SuggestResponse {
  readonly suggestions?: readonly DirectorySuggestOption[];
  readonly resolvedParentDisplay?: string;
  readonly notice?: string;
}

const DEBOUNCE_MS = 120;
const LOADING_AFTER_MS = 300;
const SUGGEST_LIMIT = 12;
const MAX_RECENT = 5;

const TRAILING_SEP = /[\\/]+$/;

function lastSegment(path: string): string {
  return path.replace(TRAILING_SEP, "").replace(/^.*[\\/]/, "");
}

function Highlighted({ text, indices }: { readonly text: string; readonly indices?: readonly number[] }) {
  if (!indices || indices.length === 0) return <>{text}</>;
  const hit = new Set(indices);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        hit.has(i) ? (
          <mark key={i} className="dir-suggest-match">
            {ch}
          </mark>
        ) : (
          ch
        ),
      )}
    </>
  );
}

export function DirectoryField({
  worldId,
  label,
  placeholder,
  value,
  onChange,
  invoke,
  onSubmit,
  autoFocus,
  disabled,
  hint,
  suggestedLabel = "Suggested folders",
  recent,
}: DirectoryFieldProps) {
  const [options, setOptions] = useState<readonly DirectorySuggestOption[]>([]);
  const [status, setStatus] = useState<SuggestStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [slow, setSlow] = useState(false);
  const [emptyNote, setEmptyNote] = useState<{ readonly parent?: string; readonly notice?: string }>({});
  const seq = useRef(0);
  const dismissed = useRef(false);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Debounced suggest: a monotonic sequence number discards stale/out-of-order responses (slow
  // SSH listings answer an older fragment; the newest keystroke always wins). An empty field only
  // queries while focused, asking for the home folders (`~/`).
  useEffect(() => {
    const typed = value.trim();
    if (disabled || (typed === "" && !focused)) {
      seq.current += 1;
      setStatus("idle");
      setOpen(false);
      setOptions([]);
      setSlow(false);
      return;
    }
    const mySeq = ++seq.current;
    setStatus("loading");
    const slowTimer = setTimeout(() => {
      if (seq.current === mySeq) setSlow(true);
    }, DEBOUNCE_MS + LOADING_AFTER_MS);
    const timer = setTimeout(() => {
      void invoke("workspace.directory.suggest", { worldId, typedPath: typed === "" ? "~/" : value, limit: SUGGEST_LIMIT })
        .then((raw) => {
          if (seq.current !== mySeq) return;
          const result = (raw ?? {}) as SuggestResponse;
          setOptions(result.suggestions ?? []);
          setEmptyNote({ parent: result.resolvedParentDisplay, notice: result.notice });
          setStatus("done");
          setError(undefined);
          setSlow(false);
          setOpen(!dismissed.current);
          setActiveIndex(-1);
        })
        .catch((e: unknown) => {
          if (seq.current !== mySeq) return;
          // Readable reasons only — the server never sends stack traces or inventory with them.
          const msg = e instanceof Error ? e.message : String(e);
          const message = /failed: \{"kind":"[^"]+","message":"(.*?)"\}/s.exec(msg)?.[1] ?? msg.replace(/^Invocation of [^ ]+ failed: /, "");
          setError(message);
          setStatus("error");
          setSlow(false);
          setOpen(false);
          setOptions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
  }, [value, worldId, invoke, disabled, focused]);

  const recentOptions: readonly DirectorySuggestOption[] =
    value.trim() === ""
      ? (recent ?? []).slice(0, MAX_RECENT).map((path) => ({ name: lastSegment(path) || path, path, display: path, recent: true }))
      : [];
  const homeOptions = options.filter((o) => !recentOptions.some((r) => r.path === o.path));
  const shown: readonly DirectorySuggestOption[] = [...recentOptions, ...homeOptions];
  const showList = open && !disabled && (status === "done" || (status === "loading" && shown.length > 0));
  const showLoading = slow && status === "loading";

  // Completing a folder appends a separator; the effect above then queries its children, so the
  // operator keeps drilling down without retyping.
  const choose = useCallback(
    (option: DirectorySuggestOption) => {
      const sep = option.path.includes("\\") && !option.path.includes("/") ? "\\" : "/";
      dismissed.current = false;
      setActiveIndex(-1);
      onChange(TRAILING_SEP.test(option.path) ? option.path : option.path + sep);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          dismissed.current = true;
          setOpen(false);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (shown.length === 0 || status !== "done") return;
        e.preventDefault();
        dismissed.current = false;
        setOpen(true);
        setActiveIndex((prev) => {
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return prev === -1 && e.key === "ArrowUp" ? shown.length - 1 : (prev + delta + shown.length) % shown.length;
        });
        return;
      }
      if (e.key === "Tab") {
        if (open && activeIndex >= 0 && activeIndex < shown.length) {
          e.preventDefault();
          choose(shown[activeIndex]!);
        } else if (open && !e.shiftKey && shown.length > 0 && value.trim() !== "" && !TRAILING_SEP.test(value.trim())) {
          // Tab with nothing highlighted completes the best (first) match.
          e.preventDefault();
          choose(shown[0]!);
        }
        return;
      }
      if (e.key === "Enter") {
        // Enter with an active suggestion completes it (the visible intent); with the list
        // closed or nothing active it falls through to the form's own submit behavior.
        if (open && activeIndex >= 0 && activeIndex < shown.length) {
          e.preventDefault();
          choose(shown[activeIndex]!);
          return;
        }
        if (open) {
          e.preventDefault();
          dismissed.current = true;
          setOpen(false);
          return;
        }
      }
    },
    [open, shown, status, activeIndex, choose, value],
  );

  const fragmentLabel = lastSegment(value.trim());
  const emptyText = emptyNote.notice
    ? emptyNote.notice
    : fragmentLabel
      ? `No folders match "${fragmentLabel}"${emptyNote.parent ? ` in ${emptyNote.parent}` : ""}`
      : `No folders${emptyNote.parent ? ` in ${emptyNote.parent}` : ""}`;

  const renderOption = (option: DirectorySuggestOption, index: number) => (
    <li
      key={`${option.recent ? "r" : "s"}:${option.path}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === activeIndex}
      className={index === activeIndex ? "dir-suggest-option active" : "dir-suggest-option"}
      onMouseDown={(e) => {
        // mousedown (not click) so focus never leaves the field before the value lands.
        e.preventDefault();
        choose(option);
      }}
      onMouseEnter={() => setActiveIndex(index)}
      title={option.path}
    >
      <span className="dir-suggest-name">
        <Highlighted text={option.recent ? (option.display ?? option.name) : option.name} indices={option.matchIndices} />
      </span>
      <span className="dir-suggest-path">{option.recent ? "" : (option.display ?? option.path) === option.name ? option.path : (option.display ?? option.path)}</span>
    </li>
  );

  return (
    <div className="dir-field">
      <input
        role="combobox"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={showList && activeIndex >= 0 && activeIndex < shown.length ? optionId(activeIndex) : undefined}
        aria-describedby={hint ? "dir-field-hint" : undefined}
        onFocus={() => {
          dismissed.current = false;
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onChange={(e) => {
          dismissed.current = false;
          onChange(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          onKeyDown(e);
          if (e.key === "Enter" && !e.defaultPrevented && onSubmit) onSubmit();
        }}
      />
      {hint ? (
        <span id="dir-field-hint" className="dir-field-hint">
          {hint}
        </span>
      ) : null}
      {(showList || showLoading) && (
        <ul id={listId} role="listbox" aria-label={suggestedLabel} className="dir-suggest-list">
          {showLoading && shown.length === 0 && (
            <li className="dir-suggest-empty" role="presentation">
              Searching folders…
            </li>
          )}
          {recentOptions.length > 0 && (
            <li role="presentation" className="dir-suggest-heading">
              Recent
            </li>
          )}
          {recentOptions.map((o, i) => renderOption(o, i))}
          {recentOptions.length > 0 && homeOptions.length > 0 && (
            <li role="presentation" className="dir-suggest-heading">
              Home folders
            </li>
          )}
          {homeOptions.map((o, i) => renderOption(o, recentOptions.length + i))}
          {shown.length === 0 && status === "done" && (
            <li className="dir-suggest-empty" role="presentation">
              {emptyText}
            </li>
          )}
        </ul>
      )}
      {status === "error" && error && (
        // Rendered only with content: an idle field announces nothing (and never competes with
        // other live regions on the same surface for the "status" role).
        <span className="dir-field-status" role="status" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
