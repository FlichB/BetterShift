import { describe, expect, it } from "vitest";
import type { OutlookConfig } from "@/lib/outlook/config";
import { createGraphClient, GraphError, type EventInput } from "@/lib/outlook/graph-client";
import { GRAPH_TIME_ZONE } from "@/lib/outlook/desired";

const config: OutlookConfig = {
  tenantId: "tenant",
  clientId: "client",
  clientSecret: "secret",
  organizer: "office@firma.at",
  intervalMs: 60_000,
  dryRun: false,
  appUrl: "https://shift.firma.at",
};

const input: EventInput = {
  subject: "Samstagsdienst",
  start: { dateTime: "2026-11-07T09:30:00", timeZone: GRAPH_TIME_ZONE },
  end: { dateTime: "2026-11-07T15:00:00", timeZone: GRAPH_TIME_ZONE },
  isAllDay: false,
  attendees: [{ address: "a@firma.at", name: "Anna" }],
  bodyHtml: "<p>x</p>",
};

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no response queued");
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const token = () => json(200, { access_token: "tok", expires_in: 3600 });

describe("createGraphClient", () => {
  it("fetches a client-credentials token once and creates events in the organizer mailbox", async () => {
    const { calls, fetchImpl } = fakeFetch([token(), json(201, { id: "ev1", iCalUId: "uid1" }), json(201, { id: "ev2" })]);
    const client = createGraphClient(config, fetchImpl);
    expect(await client.createEvent(input, "tx-1")).toEqual({ id: "ev1", iCalUId: "uid1" });
    expect(await client.createEvent(input, "tx-2")).toEqual({ id: "ev2", iCalUId: null });

    expect(calls[0].url).toBe("https://login.microsoftonline.com/tenant/oauth2/v2.0/token");
    expect(String(calls[0].init.body)).toContain("grant_type=client_credentials");
    expect(calls).toHaveLength(3); // token cached
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/users/office%40firma.at/events");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body).toMatchObject({
      subject: "Samstagsdienst",
      transactionId: "tx-1",
      responseRequested: false,
      allowNewTimeProposals: false,
      attendees: [{ emailAddress: { address: "a@firma.at", name: "Anna" }, type: "required" }],
      body: { contentType: "HTML", content: "<p>x</p>" },
    });
  });

  it("turns a rejected token request into an auth error", async () => {
    const { fetchImpl } = fakeFetch([json(400, { error: "invalid_client", error_description: "bad secret" })]);
    const error = await createGraphClient(config, fetchImpl).cancelEvent("ev1", "x").catch((e) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.isAuth).toBe(true);
    expect(error.message).not.toContain("secret\""); // never echoes the request
  });

  it("reports throttling with Retry-After", async () => {
    const { fetchImpl } = fakeFetch([token(), json(429, { error: { code: "TooManyRequests", message: "slow down" } }, { "Retry-After": "7" })]);
    const error = await createGraphClient(config, fetchImpl).updateEvent("ev1", input).catch((e) => e);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 7000 });
  });

  it("returns null for a missing event and normalises attendees", async () => {
    const { calls, fetchImpl } = fakeFetch([
      token(),
      json(404, { error: { code: "ErrorItemNotFound", message: "gone" } }),
      json(200, {
        id: "ev2",
        subject: "S",
        start: { dateTime: "2026-11-07T09:30:00.0000000", timeZone: GRAPH_TIME_ZONE },
        end: { dateTime: "2026-11-07T15:00:00.0000000", timeZone: GRAPH_TIME_ZONE },
        isAllDay: false,
        isCancelled: false,
        attendees: [{ emailAddress: { address: "A@Firma.at", name: "Anna" } }],
      }),
    ]);
    const client = createGraphClient(config, fetchImpl);
    expect(await client.getEvent("ev1")).toBeNull();
    expect((await client.getEvent("ev2"))?.attendees).toEqual([{ address: "a@firma.at", name: "Anna" }]);
    expect((calls[2].init.headers as Record<string, string>).Prefer).toBe(`outlook.timezone="${GRAPH_TIME_ZONE}"`);
  });

  it("sends mail without saving a copy", async () => {
    const { calls, fetchImpl } = fakeFetch([token(), new Response(null, { status: 202 })]);
    await createGraphClient(config, fetchImpl).sendMail({ subject: "S", html: "<p>h</p>", to: ["office@firma.at"], bcc: ["a@firma.at"] });
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/users/office%40firma.at/sendMail");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      message: {
        subject: "S",
        body: { contentType: "HTML", content: "<p>h</p>" },
        toRecipients: [{ emailAddress: { address: "office@firma.at" } }],
        bccRecipients: [{ emailAddress: { address: "a@firma.at" } }],
      },
      saveToSentItems: false,
    });
  });
});
