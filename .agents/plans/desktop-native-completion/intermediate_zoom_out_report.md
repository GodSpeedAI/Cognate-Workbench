# Intermediate Zoom Out Report — Stage 8

**Target:** `.agents/plans/desktop-native-completion/design.md` (full file)
**Reviewer:** egm-zoom-out (fresh context; prior stages' reports in scope)
**Date:** 2026-11-06

Verdict on the core decisions: the zero-IPC posture survives all three prior stages intact
(eval-dispatch grants web content no new privilege; the guard is proportionate; Rust-side plugin
invocation needs no grant) and needs no re-decision. close = exit survives on the shell-owned path
but needs recorded carve-outs (findings 1, 2, 7). The title channel survives only demoted from
guard to cue (finding 3). Tiered qualification is structurally sound; only its harness spec wobbles
(finding 4). Stage 5's split-or-carry recommendation on the D track stands.

---

**1. Severity: Major — The close contract is undefined on the reused-backend path, where the
design's stated premise is false in its own codebase.**
Scope: §2 (151–158), §3 (197–203), §1 diagram (~140). close = exit is argued from "the bundled
database's owner is the shell process." That is false on the reuse path the design itself supports:
the shipped shell attaches to a live, externally owned server via lock + `/health`
(`backend.rs:103, 238–246`) and its close path already skips killing it ("a reused server keeps its
owner", `backend.rs:3, 387`). Read literally, §2 steers an implementer into SIGTERMing a CLI-owned
server mid-run — the exact destruction Goal 1 forbids — or into "fixing" the owner carve-out into
the orphan class it exists to prevent. **Recommendation:** scope the contract explicitly:
close = shell exit; shell-owned backend → in-flight confirm → SIGTERM; reused backend → shell
exits, backend untouched under its live owner. The `/health` shell-identity field the design
already adds (B5) tells the attaching shell who the owner is — wire it into this rule. One
paragraph in §2 plus a known-gaps row.

**2. Severity: Major — Goal 1's guarantee is silently scoped to the Tauri surface while the
supported `--app` fallback retains the exact silent-destructive close the goal forbids.**
Scope: Goal 1 (63–64), Alt 11 (357–359), Non-Goals (92), B5 row (441). Verified shipped behavior:
in the fallback, the app window's exit unconditionally shuts the server down
(`src/cli.ts:192–197`, `running.shutdown("app window closed")`); no confirmation is possible from
browser chrome. **Recommendation:** decide and record one of: (a) qualify Goal 1 to the Tauri shell
and put the fallback's silent close in `docs/known-gaps.md`; or (b) adopt the browser-native,
zero-grant mitigation — a `beforeunload` confirmation conditioned on
`COGNATE_SHELL=chromium-app` so it does not double-confirm inside the Tauri webview. Option (b)
rides the shell-identity mechanism the design already ships.

**3. Severity: Major — The title channel cannot hold the close-guard role it is assigned; adopt
the machine/human channel split, and restate decision 1's invariant.**
Scope: §1 channel 2 (111–117), §2 (151–158), §3 (197–203), Overview decision 1 (47–50). B7-1's
heartbeat mitigation mutates a state-driven human string into a liveness protocol (rewrite timer,
recency window, versioned sentinel, strict parser, collision rules) — hand-rolled IPC re-implemented
over a display string, inside a document whose Alternatives 1–2 reject IPC for precisely this class
of machinery. Meanwhile the shell→server `/health` probe already exists in §3 (`backend.rs:259`),
auth-free loopback (`server.ts:1045–1046`), though it currently carries no run/approval counts —
the extension is net-new and small (projections are server-side; same file B5 touches).
**Recommendation:** `/health` (extended with runs-in-flight and pending-approval counts) becomes
the machine authority for the close guard, fail-closed: probe fails or state unknown = confirm. The
title stays the human-readable cue and the attention/notification trigger, where fail-open is
harmless. Drop the heartbeat. Restate decision 1's invariant as "no capability grants to web
content" rather than "one seam / two mechanisms" — M7-10's enumeration inconsistency is a symptom of
that framing being false.

**4. Severity: Nit — The T1 harness's input contract does not match its per-commit consumer, and
its step list is internally contradictory.**
Scope: §4 (217–221), B1 (401), B2 (408). The per-commit Linux job runs T1 against a debug build
(bare binary, not an installable bundle) while the harness is specified as "install/extract
bundle"; the step list asserts "lock released" then "relaunch → assert lock reuse" (after a clean
close there is nothing to reuse — the intent is clean respawn with lock re-acquisition; the brief's
second-instance-focus check was silently dropped). **Recommendation:** give the harness a
raw-binary mode (binary path + `COGNATE_RESOURCE_DIR`) or build the deb per commit; rewrite the
relaunch step; state where second-instance focus is verified.

**5. Severity: Nit — The proposed M7-5 download mitigation collides with the design's own
navigation rule.**
Scope: §2 External links (173–176) vs M7-5's fix. A loopback download endpoint still rides the same
webview — the navigation handler's "loopback stays in-app" rule routes the download URL into the
very webview whose download path is dead. **Recommendation:** the ledger disposition should name
the shell-mediated fix: Rust-side fetch of the export URL plus save via the dialog plugin B4
already registers, or REMOVE/DEFER with the limitation recorded.

**6. Severity: Nit — ui-dispatch menu items become inert native affordances whenever the web app
is down.**
Scope: §1 menu map (107–110), B3 (418), PRODUCT.md principle 3. Menu items routed through
`__wbShell.dispatch` silently no-op while the webview is loading or dead. **Recommendation:** one
rule in the menu map: ui-dispatch items are disabled until the shell has a liveness signal — the
same `/health`-derived signal finding 3 introduces (or the watchdog error state); rust-only items
always work.

**7. Severity: Nit — The close contract enumerates every quit source except session end.**
Scope: §2 (151–158), milestone C acceptance rows (467). Logout/restart/shutdown — where the OS
closes the app with in-flight work — is neither confirmed nor recorded, and a blocking confirmation
at session end is its own platform hazard. **Recommendation:** one acceptance-matrix row per
platform defining session-end behavior, added to the T3/manual checklist.

---

Not flagged, checked and found sound: the zero-IPC guard and posture-budget rule; summons-only
notifications and their Rust-side invocation; ledger-before-code and model-first sequencing; reuse
of `qualify-*.sh` patterns, the composite binding action, and the existing gates; the docs tranche's
contract READMEs; the five-value disposition set and DnD/Pin mechanics as amended by the prior
stages.
