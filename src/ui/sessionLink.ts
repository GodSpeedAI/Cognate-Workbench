// Deep link to a session (and optionally one event in it): `#sessions/<sessionId>[/<eventId>]`.
// Horizon's comparison view links here. The hash is the source of truth, like `#plugins/<id>`.
export interface SessionLink {
  readonly sessionId: string;
  readonly eventId?: string;
}

/** Parses a location hash; anything that is not a well-formed sessions link is `undefined`. */
export function parseSessionHash(hash: string): SessionLink | undefined {
  const match = /^#?\/?sessions\/([^/]+)(?:\/([^/]+))?\/?$/.exec(hash);
  if (!match) return undefined;
  try {
    const sessionId = decodeURIComponent(match[1]!);
    const eventId = match[2] === undefined ? undefined : decodeURIComponent(match[2]);
    return sessionId === "" ? undefined : eventId === undefined ? { sessionId } : { sessionId, eventId };
  } catch {
    return undefined;
  }
}

export function sessionHash(sessionId: string, eventId?: string): string {
  return `#sessions/${encodeURIComponent(sessionId)}${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`;
}

/** The session row a hash points at, or `undefined` while the sessions list has not loaded it (the caller waits and retries). */
export function resolveSessionLink<T extends { readonly id: string }>(hash: string, sessions: readonly T[]): { readonly session: T; readonly eventId?: string } | undefined {
  const link = parseSessionHash(hash);
  if (!link) return undefined;
  const session = sessions.find((row) => row.id === link.sessionId);
  if (!session) return undefined;
  return link.eventId === undefined ? { session } : { session, eventId: link.eventId };
}
