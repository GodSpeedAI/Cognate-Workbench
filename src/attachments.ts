// Screenshot paste — preview only (plan T02, user-selected option "a-lite").
//
// WHAT THIS DOES NOT DO: it does not send an image to the model. `ModelMessage.content` is
// `readonly string` (`node_modules/@godspeedai/cognate-capabilities/src/model.ts:7-14`) and every
// mounted provider adapter hardcodes `multimodal_input: false`, so no pixel can reach a provider
// today. This module exists so the composer can *show* a pasted screenshot and *state plainly* that
// it is not sent — deliberately not a fake multimodal affordance.
//
// Bounds ported from PandaCode 0.3.56 (`src/attachments.ts:31-32,62,221-227`): at most four images
// per message. The donor's paste handler also declines to `preventDefault` when the clipboard holds
// no image, so attaching never eats an ordinary text paste — that behaviour is preserved here.

/** Every harness path accepts at most four images per turn (donor `MAX_IMAGES`, `:32`). */
export const MAX_IMAGES = 4;

/** Per-image ceiling. The donor caps by count, not bytes; a byte ceiling is added because these
 *  previews are held as object URLs in the tab and an unbounded paste of a huge screenshot is a
 *  memory problem long before it is a UX problem. 8 MiB comfortably covers a full-screen 4K PNG. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** A pasted image, kept in the composer only. `previewUrl` is an object URL that the owner **must**
 *  revoke; see `revokeAll`. */
export interface PastedImage {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly previewUrl: string;
}

/** Why an individual file was not accepted. */
export type RejectionReason = "not-an-image" | "too-large" | "too-many";

export interface RejectedPaste {
  readonly name: string;
  readonly reason: RejectionReason;
  /** The sentence the UI shows. Kept beside the reason so copy cannot drift from the cause. */
  readonly message: string;
}

export interface PasteResult {
  /** Attachments to add, in clipboard order. */
  readonly accepted: readonly PastedImage[];
  /** Rejected files, each with the reason the user will read. */
  readonly rejected: readonly RejectedPaste[];
}

/** The copy for each reason. The limit message names the cap because "too many" alone leaves the
 *  user guessing what would work; the donor does the same (`:62`). */
export function rejectionMessage(reason: RejectionReason): string {
  switch (reason) {
    case "not-an-image":
      return "Only images can be pasted here. Text pastes normally.";
    case "too-large":
      return `Each image must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`;
    case "too-many":
      return `Attach up to ${MAX_IMAGES} images per message.`;
  }
}

/** The shape this module needs from a pasted file. A subset of the DOM `File`, so a real `File`
 *  satisfies it, while tests can pass plain objects with no DOM. */
export interface PastedFileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** True when this file should be treated as an image: by declared MIME type, or — because some
 *  platforms hand over an empty type for a pasted screenshot — by a recognised image extension.
 *  The extension fallback is what the donor does (`IMAGE_EXTENSIONS`, `:34`). */
export function isImageFile(file: PastedFileLike): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name);
}

/**
 * Decide what a paste should attach. Pure: it reads no globals, creates no object URLs and touches
 * no DOM, so the bounds can be tested exhaustively.
 *
 * `existing` is the current attachment list, which matters because the cap is per *message*, not per
 * paste — pasting 3 then 3 must not yield 6.
 *
 * `makePreview` is injected so the caller owns URL creation and revocation. It is only called for
 * accepted files, so a rejected file never allocates a URL that would later need revoking.
 */
export function reducePaste(
  existing: readonly PastedImage[],
  files: readonly PastedFileLike[],
  makePreview: (file: PastedFileLike) => string = () => "",
): PasteResult {
  const accepted: PastedImage[] = [];
  const rejected: RejectedPaste[] = [];
  // Count against the cap as we go, so the fifth file is rejected while the fourth is kept.
  let count = existing.length;

  for (const file of files) {
    if (!isImageFile(file)) {
      rejected.push({ name: file.name, reason: "not-an-image", message: rejectionMessage("not-an-image") });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejected.push({ name: file.name, reason: "too-large", message: rejectionMessage("too-large") });
      continue;
    }
    if (count >= MAX_IMAGES) {
      rejected.push({ name: file.name, reason: "too-many", message: rejectionMessage("too-many") });
      continue;
    }
    accepted.push({
      id: crypto.randomUUID(),
      name: file.name,
      mediaType: file.type,
      size: file.size,
      previewUrl: makePreview(file),
    });
    count += 1;
  }

  return { accepted, rejected };
}

/** Whether the attachments currently held should block sending.
 *
 *  This is the slice's teeth: the send path takes a `string` only, so sending with an attachment
 *  present would silently drop the image. Blocking, with the reason visible, is the honest option.
 */
export function attachmentsBlockSend(attachments: readonly PastedImage[]): boolean {
  return attachments.length > 0;
}

/** The one-line limit notice shown whenever attachments are present. Worded as a limitation, never
 *  as a promise: it must not imply the image reaches the model. */
export function attachmentLimitNotice(count: number): string {
  const noun = count === 1 ? "image is" : "images are";
  return `${count} ${noun} kept in the composer for reference only — this build cannot send images to the model, so they are not part of your message.`;
}

/** Revoke every preview URL and return an empty list.
 *
 *  Called on removal and on unmount. Doing it in one place matters because a leaked object URL is
 *  invisible: the image keeps its bytes alive for the life of the document, and nothing in the UI
 *  can reveal it. */
export function revokeAll(
  attachments: readonly PastedImage[],
  revoke: (url: string) => void,
): readonly PastedImage[] {
  for (const attachment of attachments) {
    // A caller that supplies no URL (tests, or a `makePreview` that returns "") must not produce a
    // spurious revoke call.
    if (attachment.previewUrl !== "") revoke(attachment.previewUrl);
  }
  return [];
}

/** Remove one attachment, revoking only its preview URL. */
export function removeAttachment(
  attachments: readonly PastedImage[],
  id: string,
  revoke: (url: string) => void,
): readonly PastedImage[] {
  const target = attachments.find((attachment) => attachment.id === id);
  if (target !== undefined && target.previewUrl !== "") revoke(target.previewUrl);
  return attachments.filter((attachment) => attachment.id !== id);
}

