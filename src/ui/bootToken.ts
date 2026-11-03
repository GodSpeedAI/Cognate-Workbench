// The boot session bearer, handed once by the generated browser entry (see BROWSER_ENTRY_TEMPLATE
// in src/server.ts). Surfaces that cannot set request headers — websockets — present it as their
// first message; the server resolves it through the durable-session authenticator like any other
// request and never trusts the string itself as identity.
let token: string | undefined;

export function setBootToken(value: string): void {
  token = value;
}

export function bootToken(): string | undefined {
  return token;
}
