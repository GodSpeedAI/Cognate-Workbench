// Keyboard hint chips. A chord is stored canonically ("Ctrl+Alt+N", see src/shortcuts.ts); this
// renders it as one <kbd> per key and shows Cmd/Option on Apple platforms, where the global
// shortcut listener treats Cmd as Ctrl.
export const isApplePlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform ?? "");

export function chordParts(chord: string): readonly string[] {
  return chord.split("+").map((part) => {
    if (isApplePlatform) {
      if (part === "Ctrl" || part === "Meta") return "⌘";
      if (part === "Alt") return "⌥";
      if (part === "Shift") return "⇧";
    }
    return part === "Meta" ? "Win" : part;
  });
}

export function Kbd({ chord, className }: { readonly chord: string | undefined; readonly className?: string }) {
  if (!chord) return null;
  return (
    <span className={className ? `kbd-group ${className}` : "kbd-group"} aria-hidden="true">
      {chordParts(chord).map((part, i) => (
        <kbd key={`${part}-${i}`}>{part}</kbd>
      ))}
    </span>
  );
}

/** Text form for titles/aria-keyshortcuts: "Ctrl+Alt+N". */
export function chordLabel(chord: string | undefined): string {
  return chord ? chordParts(chord).join("+") : "";
}
