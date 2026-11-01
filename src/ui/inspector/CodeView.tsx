// CodeView: a line-numbered monospace surface, read-only or editable. Shared by the Files viewer
// and the Config editor. Edit mode is a <textarea> over a synced gutter (no editor dependency).
import { useRef, type KeyboardEvent, type UIEvent } from "react";

export interface CodeViewProps {
  readonly text: string;
  readonly language?: string | undefined;
  readonly wrap?: boolean;
  readonly label: string;
  /** Present => editable. */
  readonly onChange?: (next: string) => void;
  readonly onSave?: () => void;
  /** 1-based line to highlight (e.g. a JSON error). */
  readonly errorLine?: number | undefined;
}

export function CodeView({ text, wrap = false, label, onChange, onSave, errorLine }: CodeViewProps) {
  const lines = text.split("\n");
  const gutterRef = useRef<HTMLDivElement>(null);
  const gutter = (
    <div className="cv-gutter" ref={gutterRef} aria-hidden="true">
      {lines.map((_, i) => (
        <div key={i} className={`cv-ln${errorLine === i + 1 ? " cv-ln-error" : ""}`}>{i + 1}</div>
      ))}
    </div>
  );
  if (!onChange) {
    return (
      <div className={`cv${wrap ? " cv-wrap" : ""}`} role="region" aria-label={label} tabIndex={0}>
        <div className="cv-body">
          <div className="cv-gutter" aria-hidden="true">
            {lines.map((_, i) => <div key={i} className="cv-ln">{i + 1}</div>)}
          </div>
          <pre className="cv-code">
            {lines.map((l, i) => <div key={i} className="cv-line">{l === "" ? "​" : l}</div>)}
          </pre>
        </div>
      </div>
    );
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
    } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      onChange(ta.value.slice(0, s) + "  " + ta.value.slice(en));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };
  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };
  return (
    <div className="cv cv-edit">
      <div className="cv-body">
        {gutter}
        <textarea
          className="cv-textarea"
          aria-label={label}
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
        />
      </div>
    </div>
  );
}
