# T02 — Screenshot paste (preview only): evidence

Date: this session. Target repo @ `6fc51ab` + T02 changes.

## Scope actually shipped

User-selected option **(a-lite)**: paste → thumbnail strip → 4-image cap → capability-limit copy.
**No send path.** A pasted image never leaves the composer.

| File | Change |
|---|---|
| `src/attachments.ts` | **new** — `MAX_IMAGES`, `MAX_IMAGE_BYTES`, `isImageFile`, `reducePaste`, `attachmentsBlockSend`, `attachmentLimitNotice`, `revokeAll`, `removeAttachment` |
| `src/ui/App.tsx` | `Composer` gains `onPaste`, attachment strip, limit notice, remove-per-chip, object-URL revocation (unmount + removal), and a send guard |
| `src/ui/app.css` | `.composer-attachments`, `.composer-attachment-strip`, `.composer-attachment`, `-thumb`, `-name`, `-remove`, `-notice`, `.composer-paste-notice` |
| `test/attachments.test.ts` | **new** — 21 tests |
| `test/composer-attachments.test.tsx` | **new** — 3 render tests |

No existing test was modified.

## Gate

```
just typecheck → exit 0
bun test test/attachments.test.ts test/composer-attachments.test.tsx → 24 pass, 0 fail
```

## Teeth (from the plan) — each one, with its resolution

1. **Paste 5 images → 4 accepted, 1 rejected with the limit reason; no silent drop.**
   `attachments.test.ts` → "TEETH: pasting 5 images accepts 4 and rejects 1 with the limit reason".
   It asserts the *count*, the rejected **file name** (`shot-4.png`), the reason (`too-many`), the
   user-facing sentence (`up to 4 images`), **and** that only 4 preview URLs were allocated — so a
   rejected file cannot leak an object URL that nothing would ever revoke.

2. **A clipboard with no image items → `preventDefault` not called, text paste proceeds.**
   Handled structurally in `handlePaste`: it returns early when no `kind === "file"` items exist, and
   `preventDefault` is reached only after `reducePaste` produced at least one accept-or-reject. This
   mirrors the donor (`attachments.ts:221-227`, which returns `false` and skips `preventDefault` when
   `!files.length`). The pure half (non-image files being rejected rather than coerced) is covered by
   "a non-image is rejected without blocking the images beside it".
   **Honest limit:** the early-return branch itself needs a live DOM + clipboard to execute, so it is
   *not* covered by an automated test here — see "what is not proven" below.

3. **With one attachment present, send → no `onSend` call, reason visible in markup.**
   The guard is in both send paths (`submit` and `busySubmit`), so the busy/queue behaviour cannot
   bypass it either. `attachmentsBlockSend` is tested directly; the rendered reason string is set on
   the same state the `role="alert"` paragraph renders.
   **Honest limit:** as above, the click itself needs a DOM.

## What is **not** proven, and why

- **No DOM tests for the handler itself.** This repo's UI tests are static-markup assertions via
  `renderToStaticMarkup` (11 of 14 `.tsx` test files; see `recon/test-infrastructure.md` §1A), which
  cannot dispatch a `paste` event or simulate a click. So the *logic* is proven purely
  (`reducePaste`, `attachmentsBlockSend`) and the *rendered honesty* is proven statically, but the
  glue between them is not covered by an automated assertion. The plan put these two behaviours in
  `teeth`; they are satisfied by construction plus the pure tests, not by an executed simulation.
  Closing this properly means adding a DOM-testing dependency this repo does not have — out of scope
  here and recorded in `remaining-opportunities.md`.
- **Bytes are never sent.** `ModelMessage.content` is `readonly string`
  (`node_modules/@godspeedai/cognate-capabilities/src/model.ts:7-14`) and all four mounted adapters
  hardcode `multimodal_input: false`. Independently confirmed by `recon/message-path.md` §3, which
  enumerates every `multimodal_input` occurrence under `node_modules/@godspeedai` and confirms no
  adapter serialises non-string content. The composer therefore blocks sending while an attachment is
  present rather than silently dropping it.
- **Nothing is persisted.** Attachments live in `Composer` state only. A reload or session switch
  loses them. Stated in the UI copy ("kept in the composer"), not hidden.

## Design notes

- **8 MiB per-image ceiling is an addition, not a port.** The donor caps by count only
  (`MAX_IMAGES = 4`). A byte ceiling was added because previews are retained object URLs in the tab,
  so an unbounded paste is a memory problem before it is a UX problem. 8 MiB covers a full-screen 4K
  PNG.
- **The cap is per message, not per paste** — `reducePaste` takes the existing list and counts from
  `existing.length`, so pasting 3 then 3 yields 4 + 2 rejections, matching the donor's
  `current.filter(kind === 'image').length + otherImages >= MAX_IMAGES` check (`:62`).
- **`makePreview` is injected** so URL creation/revocation stays with the caller and tests can assert
  allocation counts without a DOM.
- **Revocation is centralised** in `revokeAll` / `removeAttachment`, called on removal *and* on
  unmount. A leaked object URL is invisible in the UI, so the revoke path is explicit and tested
  (including "never revoke an empty URL", which would otherwise throw in some engines).
