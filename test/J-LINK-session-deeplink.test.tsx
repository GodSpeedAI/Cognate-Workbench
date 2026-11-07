// J-LINK-session-deeplink: Horizon's `#sessions/<sessionId>[/<eventId>]` link resolves to the session view.
import { describe, expect, test } from "bun:test";
import { parseSessionHash, resolveSessionLink, sessionHash } from "../src/ui/sessionLink.ts";

const sessions = [{ id: "sess-1", title: "First" }, { id: "sess/2", title: "Slash" }];

describe("session deep link", () => {
  test("deep link #sessions/<sessionId>/<eventId> resolves to the session view", () => {
    expect(parseSessionHash("#sessions/sess-1/evt-9")).toEqual({ sessionId: "sess-1", eventId: "evt-9" });
    expect(parseSessionHash("#sessions/sess-1")).toEqual({ sessionId: "sess-1" });
    expect(parseSessionHash("#/sessions/sess-1/")).toEqual({ sessionId: "sess-1" });
    const target = resolveSessionLink("#sessions/sess-1/evt-9", sessions);
    expect(target?.session.title).toBe("First");
    expect(target?.eventId).toBe("evt-9");
    // Encoded ids round-trip through the hash Horizon writes.
    expect(resolveSessionLink(sessionHash("sess/2", "e 1"), sessions)).toMatchObject({ session: { id: "sess/2" }, eventId: "e 1" });
  });

  test("other hashes and unknown sessions do not resolve", () => {
    expect(parseSessionHash("#plugins/abc")).toBeUndefined();
    expect(parseSessionHash("#sessions/")).toBeUndefined();
    expect(parseSessionHash("#sessions/%E0%A4%A")).toBeUndefined();
    expect(resolveSessionLink("#sessions/nope", sessions)).toBeUndefined();
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { ConnectHorizonView } from "../src/ui/ConnectHorizon.tsx";

describe("Connect Horizon settings action", () => {
  test("shows only the expiry date, never a key", () => {
    const html = renderToStaticMarkup(<ConnectHorizonView state={{ kind: "done", expiresAt: "2027-02-04T00:00:00.000Z" }} onConnect={() => {}} />);
    expect(html).toContain("Connect Horizon");
    expect(html).toContain("2027-02-04");
    expect(html).not.toContain("wbs1.");
  });
});
