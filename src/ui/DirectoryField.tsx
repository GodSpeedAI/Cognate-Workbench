// J-WS-directory-discovery: the shared, accessible directory type-ahead every path-input uses —
// the Add-workspace dialog's local tab, the SSH/WSL folder step and the first-run chooser all wrap
// this one component instead of duplicating filesystem code. Suggestions come from the validated,
// read-only `workspace.directory.suggest` capability against the *selected execution world*;
// this component never touches the browser machine's filesystem.
//
// Interaction contract (see the journey's settlement):
// - typing debounces a bounded query; stale or out-of-order responses are discarded, so typing
//   stays responsive even when a slow SSH world is still answering an earlier prefix;
// - ArrowUp/ArrowDown move the active option, Tab completes it, Enter completes it too (the
//   visible intent) — but Enter with no active option still submits the form as before, so
//   pasting a full path and pressing Enter keeps working; Escape dismisses the list;
// - pointer selection works the same way; the list is a real listbox (role/option/aria-selected)
//   with an accessible name, keyboard completion never moves focus away from the field;
// - loading, empty and error states are shown in place, succinctly, with live-region semantics.
import { useCallback, useEffect, useRef, useState } from "react";

export interface DirectorySuggestOption {
  readonly name: string;
  readonly path: string;
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
}

const DEBOUNCE_MS = 180;
const SUGGEST_LIMIT = 8;

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
}: DirectoryFieldProps) {
  const [options, setOptions] = useState<readonly DirectorySuggestOption[]>([]);
  const [status, setStatus] = useState<SuggestStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const seq = useRef(0);

  // Debounced suggest: a monotonic sequence number discards stale/out-of-order responses (slow
  // SSH listings answer an older prefix; the newest keystroke always wins).
  useEffect(() => {
    if (disabled || value.trim() === "" || !value.startsWith("/")) {
      seq.current += 1;
      setStatus("idle");
      setOpen(false);
      setOptions([]);
      return;
    }
    setStatus("loading");
    const mySeq = ++seq.current;
    const timer = setTimeout(() => {
      void invoke("workspace.directory.suggest", { worldId, typedPath: value, limit: SUGGEST_LIMIT })
        .then((raw) => {
          if (seq.current !== mySeq) return;
          const result = raw as { readonly suggestions?: readonly DirectorySuggestOption[] } | null;
          setOptions(result?.suggestions ?? []);
          setStatus("done");
          setError(undefined);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch((e: unknown) => {
          if (seq.current !== mySeq) return;
          // Readable reasons only — the server never sends stack traces or inventory with them.
          const raw = e instanceof Error ? e.message : String(e);
          const message = /failed: \{"kind":"[^"]+","message":"(.*?)"\}/s.exec(raw)?.[1] ?? raw.replace(/^Invocation of [^ ]+ failed: /, "");
          setError(message);
          setStatus("error");
          setOpen(false);
          setOptions([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, worldId, invoke, disabled]);

  const choose = useCallback(
    (option: DirectorySuggestOption) => {
      seq.current += 1;
      setOpen(false);
      setOptions([]);
      setStatus("idle");
      setActiveIndex(-1);
      onChange(option.path);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!open || options.length === 0) return;
        e.preventDefault();
        setOpen(true);
        setActiveIndex((prev) => {
          const delta = e.key === "ArrowDown" ? 1 : -1;
          const next = prev === -1 && e.key === "ArrowUp" ? options.length - 1 : (prev + delta + options.length) % options.length;
          return next;
        });
        return;
      }
      if (e.key === "Tab") {
        if (open && activeIndex >= 0 && activeIndex < options.length) {
          e.preventDefault();
          choose(options[activeIndex]!);
        }
        return;
      }
      if (e.key === "Enter") {
        // Enter with an active suggestion completes it (the visible intent); with the list
        // closed or nothing active it falls through to the form's own submit behavior.
        if (open && activeIndex >= 0 && activeIndex < options.length) {
          e.preventDefault();
          choose(options[activeIndex]!);
          return;
        }
        if (open) {
          e.preventDefault();
          setOpen(false);
          return;
        }
      }
    },
    [open, options, activeIndex, choose],
  );

  return (
    <div className="dir-field">
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls="dir-suggest-list"
        aria-autocomplete="list"
        aria-describedby={hint ? "dir-field-hint" : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
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
      {open && status === "done" && (
        <ul id="dir-suggest-list" role="listbox" aria-label={suggestedLabel} className="dir-suggest-list">
          {options.length === 0 && (
            <li className="dir-suggest-empty" role="status">
              No matching folders here.
            </li>
          )}
          {options.map((option, index) => (
            <li
              key={option.path}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "dir-suggest-option active" : "dir-suggest-option"}
              onMouseDown={(e) => {
                // mousedown (not click) so focus never leaves the field before the value lands.
                e.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="dir-suggest-name">{option.name}</span>
              <span className="dir-suggest-path">{option.path}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="dir-field-status" role="status" aria-live="polite">
        {status === "loading" ? "Searching folders…" : status === "error" && error ? error : ""}
      </span>
    </div>
  );
}
