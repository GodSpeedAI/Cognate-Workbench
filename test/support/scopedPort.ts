// Direct tests of the contained port run it the way the server does: inside the admitted child run's context
// (`containedRun`), which is where the port reads the run identity and the declared reach from (review M9).
import type { StdioSpawnPort } from "@godspeedai/cognate-runtime-api";
import { containedRun } from "../../src/capabilities/containedRunContext.ts";
import type { ContainedStdioPortConfig } from "../../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort, type ContainedStdioSpawnPort } from "../../src/capabilities/containedStdioPort.ts";

type Spec = Parameters<StdioSpawnPort["spawn"]>[0];
const reachOf = (spec: Spec): "none" | "host-socket" => (spec.restrictions?.network?.outbound?.length ? "host-socket" : "none");

/** The real port, with `spawn` (and `forRun().spawn`) entered as the run `ctx.runId`, declared with the reach the spec asks for. */
export function scopedPort(config: ContainedStdioPortConfig): ContainedStdioSpawnPort {
  const port = containedStdioSpawnPort(config);
  const enter = (run: (spec: Spec, ctx: { intentId: string; runId: string }) => Promise<{ readonly id: string }>) =>
    (spec: Spec, ctx: { intentId: string; runId: string }) => containedRun.run({ runId: ctx.runId, reach: reachOf(spec) }, () => run(spec, ctx));
  return { ...port, spawn: enter(port.spawn.bind(port)), forRun: (ctx) => { const view = port.forRun(ctx); return { ...view, spawn: enter(view.spawn.bind(view)) }; } };
}
