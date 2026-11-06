/**
 * Node IncomingMessage/ServerResponse ↔ Web Fetch Request/Response helpers.
 */

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function nodeRequestToFetch(req: IncomingMessage, baseOrigin: string): Promise<Request> {
  const url = new URL(req.url ?? "/", baseOrigin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    // @ts-expect-error Node requires duplex for streaming request bodies
    duplex: hasBody ? "half" : undefined,
    body: hasBody ? (Readable.toWeb(req) as BodyInit) : undefined,
  });
}

export async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    reader.releaseLock();
    res.destroy(error instanceof Error ? error : undefined);
  }
}
