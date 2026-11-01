// The client engine replays the whole event history on connect and asks every open projection to
// re-read once per replayed event. On a long-lived home that is thousands of identical
// ReadProjection requests; the browser then refuses them (ERR_INSUFFICIENT_RESOURCES) and the
// first read of a projection can be lost, leaving views such as Experts empty after a reload.
// Sharing one in-flight read per projection name is safe: the client already re-reads until the
// checkpoint covers the triggering event, so a shared stale read only costs one more loop turn.
interface ProjectionReader { readProjection: (caller: never, input: { readonly name: string }) => Promise<unknown> }

export function coalesceProjectionReads<T extends object>(service: T): T {
  const inflight = new Map<string, Promise<unknown>>();
  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (prop !== "readProjection" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      const read = value.bind(target) as ProjectionReader["readProjection"];
      return (caller: never, input: { readonly name: string }) => {
        const key = JSON.stringify(input);
        const shared = inflight.get(key);
        if (shared) return shared;
        const started = read(caller, input).finally(() => { if (inflight.get(key) === started) inflight.delete(key); });
        inflight.set(key, started);
        return started;
      };
    },
  });
}
