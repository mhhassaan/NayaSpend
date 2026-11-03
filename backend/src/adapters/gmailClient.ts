// Sender/subject-scoped Gmail query. The exact subject phrase is
// provisional pending real NayaPay email samples (see the plan's
// Plan-Level Rulings) -- this is the one place that restriction is
// defined, so every caller stays auditable against it.
export const NAYAPAY_QUERY = 'from:nayapay.com subject:"You spent"';

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
    query: string,
    pageToken?: string
  ): Promise<{ messages: GmailMessageSummary[]; nextPageToken?: string }>;
  getMessage(id: string): Promise<GmailMessage>;
};

function base64UrlToText(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function findHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name === name)?.value ?? "";
}

function findPlainTextBody(payload: {
  body?: { data?: string };
  parts?: { mimeType?: string; body?: { data?: string } }[];
}): string {
  if (payload.body?.data) {
    return base64UrlToText(payload.body.data);
  }
  const plainPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  if (plainPart?.body?.data) {
    return base64UrlToText(plainPart.body.data);
  }
  return "";
}

export function createGmailClient(accessToken: string): GmailClient {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  return {
    async listMessages(query, pageToken) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", query);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), { headers: authHeaders });
      const json = (await response.json()) as {
        messages?: GmailMessageSummary[];
        nextPageToken?: string;
      };
      return { messages: json.messages ?? [], nextPageToken: json.nextPageToken };
    },

    async getMessage(id) {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
        { headers: authHeaders }
      );
      const json = (await response.json()) as {
        id: string;
        threadId: string;
        internalDate: string;
        payload: {
          headers: { name: string; value: string }[];
          body?: { data?: string };
          parts?: { mimeType?: string; body?: { data?: string } }[];
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
  };
}
