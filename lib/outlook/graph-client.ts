// [fork] Minimal Microsoft Graph client for the organizer mailbox (spec 12.24): client-credentials
// token, calendar events and sendMail over fetch, no SDK. Never logs the secret or the token.
import type { OutlookConfig } from "@/lib/outlook/config";
import { GRAPH_TIME_ZONE, type Attendee, type DesiredEvent, type GraphDateTime } from "@/lib/outlook/desired";

export interface EventInput extends DesiredEvent {
  bodyHtml: string;
}

export interface GraphEvent {
  id: string;
  subject: string;
  start: GraphDateTime;
  end: GraphDateTime;
  isAllDay: boolean;
  isCancelled: boolean;
  attendees: Attendee[];
}

export interface MailInput {
  subject: string;
  html: string;
  to: string[];
  bcc: string[];
}

export interface GraphClient {
  createEvent(input: EventInput, transactionId: string): Promise<{ id: string; iCalUId: string | null }>;
  updateEvent(id: string, input: EventInput): Promise<void>;
  cancelEvent(id: string, comment: string): Promise<void>;
  /** null when the event no longer exists. */
  getEvent(id: string): Promise<GraphEvent | null>;
  sendMail(mail: MailInput): Promise<void>;
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs: number | null = null
  ) {
    super(message);
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 10_000;
const TOKEN_MARGIN_MS = 60_000;

function eventBody(input: EventInput) {
  return {
    subject: input.subject,
    body: { contentType: "HTML", content: input.bodyHtml },
    start: input.start,
    end: input.end,
    isAllDay: input.isAllDay,
    attendees: input.attendees.map((a) => ({ emailAddress: { address: a.address, name: a.name ?? a.address }, type: "required" })),
    showAs: "busy",
    isReminderOn: true,
    responseRequested: false,
    allowNewTimeProposals: false,
  };
}

function retryAfter(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return response.headers.has("retry-after") && Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function failure(response: Response): Promise<GraphError> {
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const nested = data && typeof data.error === "object" && data.error ? (data.error as { code?: string; message?: string }) : null;
  const code = nested?.code ?? (typeof data?.error === "string" ? data.error : "");
  const message = nested?.message ?? (typeof data?.error_description === "string" ? data.error_description : response.statusText);
  const text = `${response.status} ${code} ${message}`.replace(/\s+/g, " ").trim().slice(0, 500);
  return new GraphError(response.status, text, retryAfter(response));
}

export function createGraphClient(config: OutlookConfig, fetchImpl: typeof fetch = fetch): GraphClient {
  const mailbox = `${GRAPH}/users/${encodeURIComponent(config.organizer)}`;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_MARGIN_MS > Date.now()) return token.value;
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    // Any token failure means the credentials are unusable: report it as auth so the worker pauses.
    if (!response.ok) throw new GraphError(401, (await failure(response)).message);
    const data = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token.value;
  }

  async function call(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
    const response = await fetchImpl(`${mailbox}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) token = null;
    if (!response.ok) throw await failure(response);
    return response;
  }

  return {
    async createEvent(input, transactionId) {
      const response = await call("/events", { method: "POST", body: { ...eventBody(input), transactionId } });
      const data = (await response.json()) as { id: string; iCalUId?: string };
      return { id: data.id, iCalUId: data.iCalUId ?? null };
    },
    async updateEvent(id, input) {
      await call(`/events/${encodeURIComponent(id)}`, { method: "PATCH", body: eventBody(input) });
    },
    async cancelEvent(id, comment) {
      await call(`/events/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { comment } });
    },
    async getEvent(id) {
      try {
        const response = await call(`/events/${encodeURIComponent(id)}?$select=subject,start,end,isAllDay,isCancelled,attendees`, {
          method: "GET",
          headers: { Prefer: `outlook.timezone="${GRAPH_TIME_ZONE}"` },
        });
        const data = (await response.json()) as Omit<GraphEvent, "attendees"> & {
          attendees: { emailAddress: { address: string; name?: string } }[];
        };
        return {
          id: data.id,
          subject: data.subject,
          start: data.start,
          end: data.end,
          isAllDay: data.isAllDay,
          isCancelled: data.isCancelled,
          attendees: data.attendees.map((a) => ({ address: a.emailAddress.address.toLowerCase(), name: a.emailAddress.name ?? null })),
        };
      } catch (error) {
        if (error instanceof GraphError && error.isNotFound) return null;
        throw error;
      }
    },
    async sendMail(mail) {
      const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
      await call("/sendMail", {
        method: "POST",
        body: {
          message: {
            subject: mail.subject,
            body: { contentType: "HTML", content: mail.html },
            toRecipients: recipients(mail.to),
            bccRecipients: recipients(mail.bcc),
          },
          saveToSentItems: false,
        },
      });
    },
  };
}

/**
 * Development client (OUTLOOK_DRY_RUN=true): logs every call and keeps events in memory only.
 * After a restart getEvent finds nothing, so the next nightly verify re-creates the events.
 */
export function createDryRunClient(log: (message: string) => void = (message) => console.info(message)): GraphClient {
  const events = new Map<string, GraphEvent>();
  const who = (input: EventInput) => input.attendees.map((a) => a.address).join(", ") || "(no attendees)";
  return {
    async createEvent(input, transactionId) {
      const id = `dry-${transactionId}`;
      events.set(id, { id, subject: input.subject, start: input.start, end: input.end, isAllDay: input.isAllDay, isCancelled: false, attendees: input.attendees });
      log(`[Outlook dry-run] create ${id} "${input.subject}" ${input.start.dateTime} -> ${who(input)}`);
      return { id, iCalUId: null };
    },
    async updateEvent(id, input) {
      events.set(id, { id, subject: input.subject, start: input.start, end: input.end, isAllDay: input.isAllDay, isCancelled: false, attendees: input.attendees });
      log(`[Outlook dry-run] update ${id} "${input.subject}" ${input.start.dateTime} -> ${who(input)}`);
    },
    async cancelEvent(id, comment) {
      events.delete(id);
      log(`[Outlook dry-run] cancel ${id} (${comment})`);
    },
    async getEvent(id) {
      return events.get(id) ?? null;
    },
    async sendMail(mail) {
      log(`[Outlook dry-run] mail "${mail.subject}" to=${mail.to.join(", ")} bcc=${mail.bcc.join(", ")}`);
    },
  };
}

export function graphClientFor(config: OutlookConfig): GraphClient {
  return config.dryRun ? createDryRunClient() : createGraphClient(config);
}
