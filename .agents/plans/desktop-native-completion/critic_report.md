# Critic Report — Stage 7

**Target:** `.agents/plans/desktop-native-completion/design.md` (FeatureRange 1–371)
**Reviewers:** egm-design, egm-structural, egm-style (fresh contexts; egm-design and egm-structural
audited against `feature-spec-standard.md`, egm-style per persona)
**Date:** 2026-11-06

## Blockers

### B7-1. Goal 1's "can never silently destroy" guarantee is fail-open as specified [egm-design]
Scope: lines 63–64, 151–158, 111–117. The close-confirm path triggers only when the title marker
is present, and the marker is authored by the web layer. If the webview fails to load, crashes, or
the write lags, the marker is absent while runs are still in flight server-side — and the shell
closes silently: exactly the failure Goal 1 declares impossible. **Recommendation:** invert the
default — confirm close whenever the shell has not received a parseable "idle" marker from a live
webview within a recent interval (unknown state = confirm), or require an explicit idle heartbeat;
add a T1 harness row that kills the web app mid-run and asserts the shell still confirms.

## Majors

### M7-2. False premise: "the web app already owns document.title" [egm-design]
Scope: 111–117. Verified false: no `document.title` setter exists in `src/ui/`; the served title is
static (`src/server.ts:396`), the Rust builder sets another string (`backend.rs:320`). Three title
strings currently disagree. Channel 2 is net-new web-side work (a title owner composing base name +
marker, a format-contract test on both sides, reconciliation of the three existing strings), not
tuning of an existing mechanism.

### M7-3. Title-protocol robustness and enforcement unaddressed [egm-design]
Scope: 111–117, 136, 166–168. Priority when markers collide is undefined; copy churn silently
breaks the Rust parser; "verbatim" notification bodies risk drifting toward session content outside
the app; the only safeguard is documentation. **Recommendation:** versioned machine-readable
sentinel prefix, human suffix separate; strict parser treating non-conforming titles as unknown
(feeding the fail-safe); web-side format guard test; unit test that notification bodies derive only
from parsed fields.

### M7-4. Ctrl+N default contradicts the codebase's hard rule and breaks the `--app` surface [egm-design]
Scope: 180–183, 357–359. `src/shortcuts.ts:21-23` reserves Ctrl+N explicitly for "an installed app
window" scenario too; `RESERVED_EXACT` refusal is a hard rule; in the `--app` fallback the browser
still owns Ctrl+N, so the shipped default would be dead there and `validateChord` would refuse it.
**(Recommendation)** keep Ctrl+Alt+N as the default and reopen the reservation only per-surface
inside Tauri, or amend `shortcuts.ts`'s rule + rationale in the same change and record the fallback
limitation.

### M7-5. Blob/file downloads in the packaged app: dropped from the brief without disposition [egm-design]
Scope: absent. `src/ui/download.ts` (Blob + `anchor.download`) backs the config export and other
affordances; Tauri wires no download handler and WebKitGTK needs embedder support — a shipped
affordance likely silently fails in the shell. **Recommendation:** restore the brief's row:
per-engine verify row in T1; if dead, route exports through a server endpoint or REMOVE/DEFER in
the ledger.

### M7-6. Debian package-name collision: flagged by the brief, dropped by the design [egm-design]
Scope: §4, §6, Alt 8. Tauri deb name derives from productName; standalone deb installs
`/usr/bin/cognate-workbench`; both artifacts remain shipped; the Jetson runbook says
`apt install ./cognate-workbench-*.deb` without saying which. **Recommendation:** make the call in
this document — distinct shell package name (e.g. `cognate-workbench-shell`) or retire the
standalone deb on Linux with the decision recorded.

### M7-7. No consolidated Risks & Mitigations section [egm-design + egm-structural]
Scope: document structure. The standard requires failure modes, security implications, and
mitigations; they are scattered inline and several are missing entirely: title-channel fragility
and spoofing/abuse of the attention/notification trigger path, the fail-open close path, downloads,
deb collision, watchdog recovery, MenuSelect a11y gate failing mid-conversion (WCAG 2.2 AA is
mandatory), startup deadlines declared "measured not guessed" with no measurement recorded.
**Recommendation:** add a Risks & Mitigations section, each risk mapped to its tranche owner.

### M7-8. No success measures / acceptance criteria; acceptance deferred to unnamed artifacts [egm-structural]
Scope: Goals, §4, §7-C/E. Goals are qualitative and several untestable as written ("behave per
platform convention"); T1/T2/T3 verify infrastructure, not the desktop contract's product rows;
milestone C defers to "the desktop-contract acceptance rows from the original matrix" — that matrix
is `.agents/plans/desktop-terminal-browser/acceptance-matrix.md`, never named, and belongs to a
different mission. **Recommendation:** add an acceptance-criteria table keyed to goals, or name the
exact external artifact paths and rows adopted.

### M7-9. Open decisions have no home; two have no decision authority [egm-structural]
Scope: 165, 209–213, 264, 329. Notifications v2 "if the operator experience justifies more" — no
evidence source, threshold, or owner; the Windows graceful-shutdown "day of implementation" — no
assignee or artifact. **Recommendation:** add an Open Questions section listing each undecided item
with deciding authority, trigger, and deadline; assign the Windows attempt and the
notification-evidence review.

### M7-10. Channel set enumerated three inconsistent ways [egm-style]
Scope: 47–49, 67, 100–107. Decision 1 says "two mechanisms"; Goal 3 says "one protocol"; §1 says
"three channels". **Recommendation:** enumerate once in §1 (shell→web: eval dispatch; web→shell:
hash-route, title, standard close paths) and quote that enumeration in decision 1 and Goal 3.

### M7-11. Disposition taxonomy inconsistent and missing a value for features [egm-style + comprehension-7]
Scope: 55–56 vs 247–248, 252, 365. Four values in Overview, five in §5; no value covers
Pin/remote-diagnostics feature rows. **Recommendation:** five values at first use + BUILD (or
restrict the disposition column to defect rows and give features their own column).

### M7-12. "Evidence class" is load-bearing and undefined [egm-style + comprehension-8]
Scope: 248. **Recommendation:** define the classes (audit-row reference, code citation,
measurement, journey evidence) or drop the field.

### M7-13. "Verified/proven" used for both completed and planned verification [egm-style]
Scope: 20, 66, 119, 175–176, 217, 290. The document's own rule requires claims to name the
verifying engine; conflating tenses makes evidence status undecidable. **Recommendation:** future
or imperative mood for planned checks; reserve "verified" for completed runs.

### M7-14. Goal 1 promises "asked, warned, or cued"; the plan decides two mechanisms [egm-style + egm-structural-7]
Scope: 63–64 vs 151–162. No "warned" mechanism exists. **Recommendation:** restate Goal 1 to match
the uniform contract (and the fail-safe close rule from B7-1).

### M7-15. Critical path references B1–B5/E1–E2 that the milestone bullets never assign [egm-style + egm-structural-11]
Scope: 285–299. **Recommendation:** label the sub-steps so the dependency statement is checkable.

### M7-16. "Most accessible control that exists" — unprovable absolute, stated twice [egm-style]
Scope: 251–252, 362. **Recommendation:** replace with the concrete properties (OS-rendered,
platform keyboard/screen-reader support without custom ARIA) and delete the superlative.

### M7-17. "Donor" and "the standing donor rule" undefined in this document [egm-style]
Scope: 42, 90–91. **Recommendation:** one-line definition at first use or a pointer to the brief's
glossary.

### M7-18. Goal 6 "exist as real capabilities" collides with the term of art [egm-style + comprehension-1 (Pin undefined)]
Scope: 73 vs 42, 260–261. Also: Pin is never behaviorally defined anywhere (what pinning does —
top-of-sidebar independent of sort, durable across restarts — is guessable but not stated; the
donor-parity source D-23 is not linked). **Recommendation:** Goal 6 → "real, shipped features";
define Pin's behavior at first mention and link D-23.

## Nits (consolidated; each with the fix)

- **N7-19** [egm-design] `find_sidecar` host-triple matching already landed (commit `9b6bb21`, with unit tests) — reclassify the §3 bullet as done; only raw-response logging remains.
- **N7-20** [egm-design] Matrix runner name wrong: package.yml uses `macos-14` for darwin-arm64, not `macos-15` — use real values (or actually upgrade the runner and say so).
- **N7-21** [egm-design] Watchdog recovery path unspecified (kill wedged sidecar? stale-lock? relaunch offer?) — specify + T1 row.
- **N7-22** [egm-design] Windows startup-timeout path inherits the hard-kill limitation silently — add the parallel Windows row for startup timeout.
- **N7-23** [egm-design] Attention cue on Linux/WSLg unnamed and may no-op — add a per-platform attention row to the honesty matrix.
- **N7-24** [egm-design] Channel 3 "standard web APIs that already work" is unverified and has no consumer (`window.close()` unused) — demote to a smoke probe or cut.
- **N7-25** [egm-design] "D-9 … D-34" overstates the open set — point at DEBT.md's reconciled list (D-9, D-12, D-13, D-15–D-19, D-21, D-22, D-24–D-30, D-34).
- **N7-26** [egm-design] Hash-route dispatch oversells existing routing (only the plugins view is hash-addressable) — say so in the menu map.
- **N7-27** [egm-structural] Header note "Sections are appended as they are approved" is stale; no Status/Date/Author block; `design_draft.md` is a byte-identical duplicate — add a status header, remove or subordinate the duplicate.
- **N7-28** [egm-structural] Pathless references ("the previous plan", "DEBT.md", "architecture.md corrections", "the dependency analysis") and no stated relationship to the sibling desktop-terminal-browser mission — add paths + one positioning sentence.
- **N7-29** [egm-structural] Menu map vs menu→action mapping table: one artifact or two, no file path — name the file (menu map is the mapping table) or split explicitly.
- **N7-30** [egm-structural] Box-drawing misalignment in the §1 diagram (bottom border of the second box one column wide) — trim one character.
- **N7-31** [egm-style] Self-applied "honest/honestly" ~10× — replace with the concrete commitment; reserve "honest" for quoted copy.
- **N7-32** [egm-style] Terminology drift: tray/minimize-to-tray vs minimize-to-continue; shortcut registry phrased four ways; authority model three ways; "dispositions ledger" vs "defect ledger"; "this design/this draft/this effort" — unify each.
- **N7-33** [egm-style] Undefined pointers at first use: A2 audit, posture budget rule, "same conflict rules", platform-honesty rule, model-first rule, verification log, drift report, EGM, "the original matrix", "the reviews" — cite or define each.
- **N7-34** [egm-style] Imprecise criteria: "measured not guessed" (basis unstated), "survives a day … without platform hacks", two different notification gates ("operator experience justifies" vs "evidence demands"), "if the ledger admits it", "a failed row is a finding" (no consequence), "aligned in the same tranche" (unnamed) — make each checkable with a named consequence.
- **N7-35** [egm-style] Garbled phrasing: "(it already exists in the Remote panel work)", "device read-only until they act", "instead of zombie webview", "only a wedged process is killed" — rewrite plain.
- **N7-36** [egm-style] §7 clarity: "user's A–E order" ambiguous, checkmarks informal, "resolve" without actor, two different "guards" in B2/B3 — name them.
- **N7-37** [egm-style] pg0 never expanded; MSRV wording conflates project MSRV with the device's toolchain — expand and clarify.
- **N7-38** [egm-style] "no capability file ships, ever" overstates beside the posture-budget escape clause — "in this design".
- **N7-39** [egm-style] File-count reconciliation: §5 lists nine files, brief says ten — reconcile alongside the control count.
- **N7-40** [egm-style] Ctrl+N discussion never names the current default (Ctrl+Alt+N) — half a sentence makes the change traceable.
- **N7-41** [comprehension-2,3,5,6,9,10 — folded here] EGM expanded at first use + drift report linked; "mobile/phone entry" glossed (docs/REMOTE.md); notification authorship reworded (web app authors, Rust never reformats); DnD added to ledger inputs or condition reworded; pg0 glossed; diagnostics surface named (`src/ui/RemotePanel.tsx` diagnostics section, not a dialog), compositing check defined, coexistence/uninstall step added to the harness list.
