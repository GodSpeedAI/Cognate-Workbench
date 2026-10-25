// The desktop's authenticated call to its own loopback remote-control routes (`/remote/*`). The boot
// session bearer lives in the generated browser entry; it is handed here once and never stored elsewhere.
type RemoteFetch = (path: string, init?: RequestInit) => Promise<Response>;

let impl: RemoteFetch | undefined;

export function setRemoteFetch(fn: RemoteFetch): void {
  impl = fn;
}

export function remoteFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!impl) return Promise.reject(new Error("remote control is not ready"));
  return impl(path, init);
}
