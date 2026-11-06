/** One NDJSON request/response over the SEA-Forge Unix socket. */
export async function seaForgeCall(socketPath: string, request: Record<string, unknown>, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  let buffered = "";
  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("SEA-Forge did not answer in time")), timeoutMs);
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) { socket.write(`${JSON.stringify(request)}\n`); },
        data(socket, chunk) {
          buffered += new TextDecoder().decode(chunk);
          const newline = buffered.indexOf("\n");
          if (newline < 0) return;
          // Settle before closing: in Bun, end() fires close() synchronously.
          try { finish(null, JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>); }
          catch { finish(new Error("SEA-Forge answered with invalid JSON")); }
          socket.end();
        },
        close() { finish(new Error("SEA-Forge closed the connection without an answer")); },
        error(_socket, error) { finish(error); },
      },
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
