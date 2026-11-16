// Remote access diagnostics: the copy-report text and the route shown never include the pairing secret.
import { describe, expect, test } from "bun:test";
import { buildRemoteReport, routeOf } from "../src/ui/RemotePanel.tsx";

describe("remote diagnostics", () => {
  test("route is the link origin only, never the pairing secret", () => {
    expect(routeOf("https://relay.example.com:8443/m#p=SECRET")).toBe("https://relay.example.com:8443");
    expect(routeOf(undefined)).toBeUndefined();
    expect(routeOf("not a url")).toBeUndefined();
  });

  test("the report states connection, route, last error and events, without secrets", () => {
    const report = buildRemoteReport({
      status: { state: "waiting", generation: 3 },
      route: routeOf("https://relay.example.com/m#p=SECRET"),
      lastError: "remote 502",
      events: [{ at: 0, text: "Connection off to waiting" }],
      reachable: true,
      at: new Date(0),
    });
    expect(report).toContain("Connection: waiting");
    expect(report).toContain("Route: https://relay.example.com");
    expect(report).toContain("Last error: remote 502");
    expect(report).toContain("Connection off to waiting");
    expect(report).not.toContain("SECRET");
  });
});
