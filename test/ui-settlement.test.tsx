// Presentation of governed settlement (P03): each operation's outcome, the proof's exit code, what was verified,
// and why an operation was not settled.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettlementCard, type SettlementOperation } from "../src/ui/SettlementCard.tsx";

const op = (over: Partial<SettlementOperation>): SettlementOperation => ({ runId: "r", operationId: "op-1", capability: "tool.edit", status: "settled", final: true, ...over });

describe("SettlementCard", () => {
  test("renders nothing when there is nothing to settle", () => {
    expect(renderToStaticMarkup(<SettlementCard operations={[]} />)).toBe("");
  });

  test("names each outcome, the proof's exit code and the verified tree digest", () => {
    const html = renderToStaticMarkup(<SettlementCard operations={[
      op({ status: "settled", exitCode: 0, targetDigest: "sha256:abcdef0123456789abcdef" }),
      op({ operationId: "op-2", status: "rejected", exitCode: 1 }),
    ]} />);
    expect(html).toContain("Settlement");
    expect(html).toContain("Settled");
    expect(html).toContain("Rejected");
    expect(html).toContain("proof exited 0");
    expect(html).toContain("proof exited 1");
    expect(html).toContain('title="sha256:abcdef0123456789abcdef"');
  });

  test("says why an operation was not settled", () => {
    const html = renderToStaticMarkup(<SettlementCard operations={[op({ status: "not-attempted", final: true, reason: "no proof was declared for this workspace before the run started" })]} />);
    expect(html).toContain("Not settled");
    expect(html).toContain("no proof was declared");
  });
});
