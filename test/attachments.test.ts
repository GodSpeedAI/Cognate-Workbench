// Unit tests for screenshot paste bounds (plan T02).
//
// These prove *presentation and honesty*, not transport: nothing here can make a pixel reach a
// provider, and the tests say so rather than implying otherwise.
import { describe, expect, test } from "bun:test";
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  attachmentLimitNotice,
  attachmentsBlockSend,
  isImageFile,
  reducePaste,
  rejectionMessage,
  removeAttachment,
  revokeAll,
  type PastedFileLike,
  type PastedImage,
} from "../src/attachments.ts";

function file(name: string, type = "image/png", size = 1024): PastedFileLike {
  return { name, type, size };
}

/** A fake URL factory that records what was allocated, so a test can assert a rejected file never
 *  allocated one (which would then need revoking). */
function factory() {
  const made: string[] = [];
  return {
    made,
    make: (f: PastedFileLike): string => {
      const url = `blob:fake/${f.name}`;
      made.push(url);
      return url;
    },
  };
}

function existing(count: number): PastedImage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `existing-${i}`,
    name: `old-${i}.png`,
    mediaType: "image/png",
    size: 10,
    previewUrl: `blob:fake/old-${i}.png`,
  }));
}

describe("isImageFile", () => {
  test("accepts a declared image MIME type", () => {
    expect(isImageFile(file("shot.png", "image/png"))).toBe(true);
    expect(isImageFile(file("shot.jpg", "image/jpeg"))).toBe(true);
  });

  test("accepts an image extension when the MIME type is empty", () => {
    // Some platforms hand over a pasted screenshot with no type at all; the donor falls back to the
    // extension and so do we, otherwise a real screenshot would be refused.
    expect(isImageFile(file("Screenshot 2026-10-26 at 21.00.00.png", ""))).toBe(true);
    expect(isImageFile(file("photo.JPEG", ""))).toBe(true);
  });

  test("rejects non-images", () => {
    expect(isImageFile(file("notes.txt", "text/plain"))).toBe(false);
    expect(isImageFile(file("archive.zip", "application/zip"))).toBe(false);
  });
});

describe("reducePaste", () => {
  test("accepts a single image and reports nothing rejected", () => {
    const f = factory();
    const result = reducePaste([], [file("a.png")], f.make);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted[0]?.name).toBe("a.png");
    expect(result.accepted[0]?.previewUrl).toBe("blob:fake/a.png");
  });

  test("TEETH: pasting 5 images accepts 4 and rejects 1 with the limit reason", () => {
    const f = factory();
    const files = Array.from({ length: 5 }, (_, i) => file(`shot-${i}.png`));
    const result = reducePaste([], files, f.make);

    expect(result.accepted).toHaveLength(MAX_IMAGES);
    expect(result.rejected).toHaveLength(1);
    // No silent drop: the fifth file is named and carries an actionable sentence.
    expect(result.rejected[0]?.name).toBe("shot-4.png");
    expect(result.rejected[0]?.reason).toBe("too-many");
    expect(result.rejected[0]?.message).toContain(`up to ${MAX_IMAGES} images`);
    // The rejected file must not have allocated a preview URL that would then leak.
    expect(f.made).toHaveLength(MAX_IMAGES);
  });

  test("the cap is per message, not per paste", () => {
    const f = factory();
    // Three already attached, then three more pasted: only one may be accepted.
    const result = reducePaste(existing(3), [file("x.png"), file("y.png"), file("z.png")], f.make);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.name).toBe("x.png");
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.reason === "too-many")).toBe(true);
  });

  test("a paste at exactly the cap accepts nothing further", () => {
    const result = reducePaste(existing(MAX_IMAGES), [file("one-more.png")], () => "blob:x");
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  test("an oversized image is rejected by name, not silently", () => {
    const result = reducePaste([], [file("huge.png", "image/png", MAX_IMAGE_BYTES + 1)], () => "blob:x");
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("too-large");
    expect(result.rejected[0]?.name).toBe("huge.png");
  });

  test("an image exactly at the byte ceiling is accepted", () => {
    const result = reducePaste([], [file("edge.png", "image/png", MAX_IMAGE_BYTES)], () => "blob:x");
    expect(result.accepted).toHaveLength(1);
  });

  test("a non-image is rejected without blocking the images beside it", () => {
    const f = factory();
    const result = reducePaste([], [file("a.png"), file("b.txt", "text/plain"), file("c.png")], f.make);
    expect(result.accepted.map((a) => a.name)).toEqual(["a.png", "c.png"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("not-an-image");
  });

  test("an empty paste is a no-op", () => {
    const result = reducePaste([], [], () => "blob:x");
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  test("accepted ids are unique", () => {
    const result = reducePaste([], [file("a.png"), file("b.png")], () => "blob:x");
    const ids = result.accepted.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("rejectionMessage", () => {
  test("every reason has actionable copy naming the limit", () => {
    // A bare "rejected" leaves the user unable to fix anything.
    expect(rejectionMessage("too-many")).toContain(String(MAX_IMAGES));
    expect(rejectionMessage("too-large")).toContain(String(MAX_IMAGE_BYTES / (1024 * 1024)));
    expect(rejectionMessage("not-an-image")).toContain("images");
  });
});

describe("send blocking", () => {
  test("TEETH: any attachment blocks send", () => {
    expect(attachmentsBlockSend(existing(1))).toBe(true);
    expect(attachmentsBlockSend(existing(MAX_IMAGES))).toBe(true);
  });

  test("no attachments does not block send", () => {
    expect(attachmentsBlockSend([])).toBe(false);
  });
});

describe("limit notice", () => {
  test("states the limitation instead of promising transport", () => {
    const notice = attachmentLimitNotice(1);
    // It must name the model and say the image is NOT part of the message...
    expect(notice).toContain("cannot send images to the model");
    expect(notice).toContain("not part of your message");
    // ...and must never claim the image was sent or understood.
    expect(notice).not.toContain("attached to your message");
    expect(notice).not.toContain("will be sent");
  });

  test("agrees in number for one and many", () => {
    expect(attachmentLimitNotice(1)).toContain("1 image is");
    expect(attachmentLimitNotice(3)).toContain("3 images are");
  });
});

describe("revocation", () => {
  test("revokeAll revokes each URL exactly once and clears the list", () => {
    const revoked: string[] = [];
    const remaining = revokeAll(existing(3), (url) => revoked.push(url));
    expect(revoked).toHaveLength(3);
    expect(new Set(revoked).size).toBe(3);
    expect(remaining).toHaveLength(0);
  });

  test("revokeAll never revokes an empty URL", () => {
    const revoked: string[] = [];
    // A `makePreview` that returns "" (tests, or a path with no preview) must not call revoke.
    revokeAll([{ id: "a", name: "a.png", mediaType: "image/png", size: 1, previewUrl: "" }], (u) => revoked.push(u));
    expect(revoked).toHaveLength(0);
  });

  test("removeAttachment revokes only the removed URL", () => {
    const revoked: string[] = [];
    const remaining = removeAttachment(existing(3), "existing-1", (url) => revoked.push(url));
    expect(revoked).toEqual(["blob:fake/old-1.png"]);
    expect(remaining.map((a) => a.id)).toEqual(["existing-0", "existing-2"]);
  });

  test("removing an id that is not present is a no-op that still returns the list", () => {
    const revoked: string[] = [];
    const remaining = removeAttachment(existing(1), "nope", (url) => revoked.push(url));
    expect(revoked).toHaveLength(0);
    expect(remaining).toHaveLength(1);
  });
});
