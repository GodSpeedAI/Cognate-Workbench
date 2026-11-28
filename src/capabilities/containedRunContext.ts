// The identity of the child run that is calling the contained spawn port, and the network reach the OPERATOR declared for
// its admitted provider (SEA-Forge #114, review M9). It is set by the host around the admitted child's execution
// (`AsyncLocalStorage`), so it comes from the runtime, never from arguments a provider chooses to pass to `spawn`.
// The port refuses a spawn outside any run, and one whose `ctx.runId` is not the run in this store.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ContainedRun {
  readonly runId: string;
  /** `none`, or `host-socket` when the operator declared the provider's reach as the one host-mediated unix socket. */
  readonly reach: "none" | "host-socket";
}

export const containedRun = new AsyncLocalStorage<ContainedRun>();
