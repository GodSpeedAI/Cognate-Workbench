// Pure keyboard-shortcut logic (T11, J-PREFS-shortcuts): chord normalisation, capture, reserved
// refusal, conflict detection and default restoration. No React, no client, no DOM — so the rules
// that decide whether a chord may be bound are unit-testable without a browser
// (test/workbench-shortcuts.test.ts).
//
// Two hard product rules live here rather than in the UI, because they must hold regardless of which
// surface offers editing:
//   1. Never intercept typing. A chord with no modifier would fire while the operator writes.
//   2. Never override a browser-reserved chord. Ctrl+T/W/N/R must keep meaning what the browser says.

/** An editable application action. Only actions that genuinely exist in this app are listed. */
export interface ShortcutAction {
  readonly id: string;
  readonly label: string;
  /** The shipped chord, or `undefined` for an action that starts unbound. */
  readonly defaultChord: string | undefined;
}

/** The "Application" region of the shortcuts dialog — the editable set. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: "open-shortcuts", label: "Open keyboard shortcuts", defaultChord: "Ctrl+/" },
  { id: "new-session", label: "New Session", defaultChord: undefined },
  { id: "toggle-sidebar", label: "Toggle left sidebar", defaultChord: undefined },
  { id: "open-settings", label: "Open settings", defaultChord: undefined },
];

export function actionById(id: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((a) => a.id === id);
}

/** Durable per-action overrides: `null` means explicitly unbound. Absent means "use the default". */
export type ShortcutOverrides = Readonly<Record<string, string | null>>;

/** Structural guard for a `settings.changeShortcuts` patch: every key must be a known action id and
 *  every value a chord string or `null`. Cross-action conflict checking is separate. */
export function isShortcutOverrides(value: unknown): value is ShortcutOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(([key, v]) => actionById(key) !== undefined && (v === null || typeof v === "string"));
}

/** The effective chord for an action: an explicit override wins, else the shipped default. */
export function effectiveChord(actionId: string, overrides: ShortcutOverrides): string | undefined {
  if (Object.hasOwn(overrides, actionId)) {
    const value = overrides[actionId];
    return value === null || value === "" ? undefined : value;
  }
  return actionById(actionId)?.defaultChord;
}

/** Canonical chord text → what the dialog shows. "Ctrl+Shift+K" → "Ctrl Shift K". */
export function describeChord(chord: string | undefined): string {
  if (!chord) return "No shortcut";
  return chord.split("+").join(" ");
}

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Meta"] as const;

/**
 * Builds a canonical chord from a KeyboardEvent-shaped object. Returns `undefined` for a key that
 * cannot stand alone (a bare modifier, or a modifier-less character key) so that binding one is
 * impossible by construction, not merely discouraged.
 */
export function chordFromKeyboardEvent(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): string | undefined {
  const key = event.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return undefined;
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.shiftKey) mods.push("Shift");
  if (event.altKey) mods.push("Alt");
  if (event.metaKey) mods.push("Meta");
  if (mods.length === 0) return undefined;
  const canonical = key.length === 1 ? key.toUpperCase() : key;
  // Keep the display order stable regardless of the physical press order.
  const ordered = MODIFIER_ORDER.filter((m) => mods.includes(m));
  return [...ordered, canonical].join("+");
}

/**
 * True when a chord is syntactically well-formed: at least one non-empty part, no empty parts, and
 * a final key that is not itself a bare modifier. Deliberately *not* the same question as "does it
 * carry a modifier" — `validateChord` answers that with its own, distinct message, so a modifier-less
 * chord is refused for the reason that actually matters rather than as a syntax error.
 */
export function isChord(value: string): boolean {
  if (value.length === 0) return false;
  const parts = value.split("+");
  if (parts.length === 0 || parts.some((p) => p.length === 0)) return false;
  const key = parts[parts.length - 1] ?? "";
  return key !== "Control" && key !== "Shift" && key !== "Alt" && key !== "Meta";
}

/**
 * Chords the browser or the OS owns. Refusing them is not a nicety: a bound Ctrl+W would either do
 * nothing (the browser wins) or close the operator's tab. Either way the shortcut would lie.
 */
const RESERVED_EXACT = new Set([
  "Ctrl+T", "Ctrl+W", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Shift+T", "Ctrl+Shift+W",
  "Ctrl+R", "Ctrl+Shift+R", "Ctrl+L", "Ctrl+Tab", "Ctrl+Shift+Tab",
  "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+F4", "F5", "F11", "F12",
  "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+C", "Ctrl+J",
  "Meta+T", "Meta+W", "Meta+N", "Meta+Shift+N", "Meta+Q", "Meta+L", "Meta+R",
]);

/** A binding decision: either the chord is usable, or a specific human-readable reason why not. */
export type ChordDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Decides whether a chord may be bound. Refuses, in order: a chord that cannot be produced by the
 * capture rules, a browser-reserved chord, and a chord with no modifier (which would fire while the
 * operator types).
 */
export function validateChord(chord: string): ChordDecision {
  if (!isChord(chord)) return { ok: false, reason: "That combination cannot be used as a shortcut." };
  if (RESERVED_EXACT.has(chord)) {
    return { ok: false, reason: `${describeChord(chord)} is reserved by the browser and cannot be reassigned.` };
  }
  const parts = chord.split("+");
  const hasModifier = parts.some((p) => MODIFIER_ORDER.includes(p as (typeof MODIFIER_ORDER)[number]));
  if (!hasModifier) {
    return { ok: false, reason: "A shortcut needs Ctrl, Shift, Alt or Meta so it never fires while you type." };
  }
  return { ok: true };
}

/** Conflict result: either no other action holds this chord, or the clashing action is named. */
export type ConflictDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly conflictWith: string };

/** Refuses a chord already bound to a *different* action under the given overrides. */
export function detectConflict(actionId: string, chord: string, overrides: ShortcutOverrides): ConflictDecision {
  for (const other of SHORTCUT_ACTIONS) {
    if (other.id === actionId) continue;
    if (effectiveChord(other.id, overrides) === chord) {
      return {
        ok: false,
        reason: `${describeChord(chord)} is already assigned to "${other.label}".`,
        conflictWith: other.id,
      };
    }
  }
  return { ok: true };
}

/** The full gate a new binding must pass, in the order the UI should surface failures. */
export function validateAssignment(actionId: string, chord: string, overrides: ShortcutOverrides): ChordDecision | ConflictDecision {
  if (actionById(actionId) === undefined) {
    return { ok: false, reason: "Unknown action." };
  }
  const chordCheck = validateChord(chord);
  if (!chordCheck.ok) return chordCheck;
  return detectConflict(actionId, chord, overrides);
}

/** Every override reduced to the shipped defaults. */
export function restoreDefaults(): ShortcutOverrides {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultChord ?? null]));
}

/** True when the given overrides differ from the shipped defaults (drives "Restore all defaults"). */
export function isDefault(overrides: ShortcutOverrides): boolean {
  return SHORTCUT_ACTIONS.every((a) => effectiveChord(a.id, overrides) === a.defaultChord);
}

/** Maps each action id to the chord that triggers it under the given overrides. */
export function resolveAll(overrides: ShortcutOverrides): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const action of SHORTCUT_ACTIONS) {
    const chord = effectiveChord(action.id, overrides);
    if (chord) map.set(chord, action.id);
  }
  return map;
}

/** True when the event's target is somewhere the operator is entering text, so a shortcut must not
 *  fire. Contenteditable is included because the composer supports it. */
export function isTypingTarget(target: { readonly tagName?: string; readonly isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The single decision the global key listener makes: does this event trigger an action?
 * A chord fires only when the event was not produced inside a text-entry target.
 */
export function resolveKeypress(
  event: { readonly key: string; readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey: boolean },
  overrides: ShortcutOverrides,
  target: { readonly tagName?: string; readonly isContentEditable?: boolean } | null,
): string | undefined {
  const chord = chordFromKeyboardEvent(event);
  if (!chord) return undefined;
  const actionId = resolveAll(overrides).get(chord);
  if (!actionId) return undefined;
  // The composer's send-on-Enter and the dialog controls own their own keys; a shortcut must never
  // steal from a text field.
  if (isTypingTarget(target)) return undefined;
  return actionId;
}
