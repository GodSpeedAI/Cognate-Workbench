// The runtime's one async mutex (review R4). Valid under the §1.5 single-committing-process
// invariant: activation, deactivation, uninstall and grant issue/revoke all run one at a time, so
// each op's last authorization re-check (`authorizeCapabilityOp`) and its commit see one state.
export interface RuntimeMutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createRuntimeMutex(): RuntimeMutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn, fn);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
