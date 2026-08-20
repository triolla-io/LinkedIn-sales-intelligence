/**
 * The one SWR fetcher. It throws on a failed response.
 *
 * Fourteen copies of `fetch(u).then((r) => r.json())` were spread across the app, none
 * of which checked `r.ok`. That is not a style problem: an API route that answers 500
 * with `{"error":"..."}` parses perfectly, so the component reads `data.candidates` as
 * `undefined` and renders its empty state. A failure becomes the words "no results
 * found" — the same silent-failure family as the 25 contacts filtered out with no
 * reason recorded, and the misleading "0 found".
 *
 * Throwing hands the failure to SWR's `error`, so a screen can say what went wrong.
 */

export class FetchError extends Error {
  readonly status: number;
  /** The server's own message when it sent one — usually the most useful text. */
  readonly serverMessage: string | null;

  constructor(status: number, serverMessage: string | null) {
    super(serverMessage ?? `HTTP ${status}`);
    this.name = "FetchError";
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/** Best-effort read of an error body. Never throws — an HTML 502 page is not JSON. */
async function readServerMessage(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const msg = (body as { error?: unknown; message?: unknown })?.error ?? (body as { message?: unknown })?.message;
    return typeof msg === "string" && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new FetchError(res.status, await readServerMessage(res));
  return (await res.json()) as T;
}

/**
 * Hebrew text for an SWR error. A 401 is a different instruction to the reader than a
 * 500, and "something went wrong" tells them nothing about whether to retry.
 */
export function fetchErrorMessage(err: unknown): string {
  if (err instanceof FetchError) {
    if (err.status === 401 || err.status === 403) return "אין הרשאה — נסי להתחבר מחדש";
    if (err.status === 404) return "הכתובת לא נמצאה";
    if (err.serverMessage) return `שגיאה מהשרת: ${err.serverMessage}`;
    return `השרת החזיר שגיאה (${err.status})`;
  }
  // A network failure or an unparseable body never reaches FetchError.
  return "לא הצלחנו לטעון את הנתונים — בדקי את החיבור ונסי לרענן";
}
