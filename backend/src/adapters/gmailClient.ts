// Sender/subject-scoped Gmail query. The exact subject phrase is
// provisional pending real NayaPay email samples (see the plan's
// Plan-Level Rulings) -- this is the one place that restriction is
// defined. listMessages always uses this internally (it takes no query
// parameter), so there is no code path that can issue an unscoped read.
export const NAYAPAY_QUERY = 'from:nayapay.com subject:"You spent"';

export type GmailErrorType =
  | "auth_failure"
  | "rate_limit"
  | "network_timeout"
  | "history_expired"
  | "unknown";

export class GmailApiError extends Error {
  readonly status: number;
  readonly errorType: GmailErrorType;

  constructor(status: number, errorType: GmailErrorType, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
    this.errorType = errorType;
  }
}

function classifyStatus(status: number): GmailErrorType {
  if (status === 401 || status === 403) return "auth_failure";
  if (status === 429) return "rate_limit";
  return "unknown";
}

async function throwForFailedResponse(response: Response): Promise<never> {
  const errorType = classifyStatus(response.status);
  throw new GmailApiError(response.status, errorType, `Gmail API request failed with status ${response.status}`);
}

export type GmailMessageSummary = { id: string };

export type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  bodyText: string;
  internalDate: string;
};

export type GmailClient = {
  listMessages(
    pageToken: string | undefined,
    maxResults: number
  ): Promise<{ messages: GmailMessageSummary[]; nextPageToken?: string }>;
  getMessage(id: string): Promise<GmailMessage>;
  listHistory(
    startHistoryId: string,
    maxResults: number,
    pageToken?: string
  ): Promise<{ addedMessageIds: string[]; newHistoryId: string; nextPageToken?: string }>;
  getCurrentHistoryId(): Promise<string>;
};

function base64UrlToText(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function findHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Real-world transactional emails (NayaPay's included) commonly nest the
// actual content below extra multipart wrappers -- a multipart/mixed or
// multipart/related layer (added the moment the template embeds an inline
// image, like a branded banner) sits above the multipart/alternative that
// holds the real text/plain and text/html parts. The previous version of
// this function only ever looked one level into payload.parts, so any
// such wrapper made it silently return "". This walks the whole MIME
// tree, collecting every text/plain and text/html part at any depth, and
// prefers a true text/plain body but falls back to HTML-stripped-to-text
// when no plain part exists anywhere (also a real case: a purely
// HTML-templated transactional email with no plain-text alternative).
function collectBodyParts(part: GmailMessagePart, plain: string[], html: string[]): void {
  if (part.body?.data) {
    if (part.mimeType === "text/html") {
      html.push(base64UrlToText(part.body.data));
    } else if (part.mimeType === "text/plain" || part.mimeType === undefined) {
      // No mimeType at all only happens for a simple, non-multipart
      // message (the whole payload IS the body, nothing to
      // disambiguate against) -- treat that the same as text/plain.
      // Any other explicit mimeType (image/*, application/* …) is an
      // attachment or inline image, never body text -- skip it rather
      // than mixing its decoded bytes into the parsed body.
      plain.push(base64UrlToText(part.body.data));
    }
  }
  for (const child of part.parts ?? []) {
    collectBodyParts(child, plain, html);
  }
}

function findPlainTextBody(payload: GmailMessagePart): string {
  const plain: string[] = [];
  const html: string[] = [];
  collectBodyParts(payload, plain, html);

  if (plain.join("\n").trim().length > 0) return plain.join("\n");
  if (html.length > 0) return stripHtmlToText(html.join("\n"));
  return "";
}

export function createGmailClient(accessToken: string): GmailClient {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  return {
    async listMessages(pageToken, maxResults) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", NAYAPAY_QUERY);
      url.searchParams.set("maxResults", String(maxResults));
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), { headers: authHeaders });
      if (!response.ok) await throwForFailedResponse(response);

      const json = (await response.json()) as {
        messages?: GmailMessageSummary[];
        nextPageToken?: string;
      };
      return { messages: json.messages ?? [], nextPageToken: json.nextPageToken };
    },

    async getMessage(id) {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
        { headers: authHeaders }
      );
      if (!response.ok) await throwForFailedResponse(response);

      const json = (await response.json()) as {
        id: string;
        threadId: string;
        internalDate: string;
        payload: {
          headers: { name: string; value: string }[];
          mimeType?: string;
          body?: { data?: string };
          parts?: GmailMessagePart[];
        };
      };

      return {
        id: json.id,
        threadId: json.threadId,
        internalDate: json.internalDate,
        subject: findHeader(json.payload.headers, "Subject"),
        from: findHeader(json.payload.headers, "From"),
        bodyText: findPlainTextBody(json.payload),
      };
    },

    async listHistory(startHistoryId, maxResults, pageToken) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("historyTypes", "messageAdded");
      // Scoped to INBOX as a cheap first filter -- the authoritative
      // NayaPay-sender/subject check still happens per-message in
      // gmailAdapter.ts, since history.list cannot take a `q` search.
      url.searchParams.set("labelId", "INBOX");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), { headers: authHeaders });
      if (!response.ok) {
        // A too-old startHistoryId (long outage, expired watermark) comes
        // back as 404, distinct from every other failure -- the caller
        // can't just retry this one, it must reseed its watermark.
        if (response.status === 404) {
          throw new GmailApiError(404, "history_expired", "Gmail history watermark is no longer valid");
        }
        await throwForFailedResponse(response);
      }

      const json = (await response.json()) as {
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      };

      const addedMessageIds = (json.history ?? []).flatMap(
        (entry) => entry.messagesAdded?.map((added) => added.message.id) ?? []
      );

      return { addedMessageIds, newHistoryId: json.historyId ?? startHistoryId, nextPageToken: json.nextPageToken };
    },

    async getCurrentHistoryId() {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: authHeaders,
      });
      if (!response.ok) await throwForFailedResponse(response);

      const json = (await response.json()) as { historyId: string };
      return json.historyId;
    },
  };
}
