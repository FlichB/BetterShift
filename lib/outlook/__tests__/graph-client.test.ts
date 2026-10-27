import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlookConfig } from "@/lib/outlook/config";
import { createDryRunClient, createGraphClient, GraphError, graphClientFor, type EventInput } from "@/lib/outlook/graph-client";
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
  showAs: "busy",
  attendees: [{ address: "a@firma.at", name: "Anna" }],
  details: { time: null, partners: [] },
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

  it("turns a rejected token request into an auth error without echoing the secret", async () => {
    const secretConfig = { ...config, clientSecret: "s3cr3t-value" };
    const { fetchImpl } = fakeFetch([json(400, { error: "invalid_client", error_description: "bad secret" })]);
    const error = await createGraphClient(secretConfig, fetchImpl).cancelEvent("ev1", "x").catch((e) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.isAuth).toBe(true);
    expect(error.message).not.toContain("s3cr3t-value");
  });

  it("keeps a transient token outage (503) retryable instead of treating it as bad credentials", async () => {
    const { fetchImpl } = fakeFetch([json(503, { error: "temporarily_unavailable", error_description: "try later" })]);
    const error = await createGraphClient(config, fetchImpl).cancelEvent("ev1", "x").catch((e) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.status).toBe(503);
    expect(error.isAuth).toBe(false);
  });

  it("treats an empty Retry-After header as no delay", async () => {
    const { fetchImpl } = fakeFetch([token(), json(429, { error: { code: "TooManyRequests", message: "slow" } }, { "Retry-After": "  " })]);
    const error = await createGraphClient(config, fetchImpl).updateEvent("ev1", input).catch((e) => e);
    expect(error.retryAfterMs).toBeNull();
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

  it("patches an event by id in the organizer mailbox", async () => {
    const { calls, fetchImpl } = fakeFetch([token(), json(200, {})]);
    await createGraphClient(config, fetchImpl).updateEvent("ev/1", input);
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/users/office%40firma.at/events/ev%2F1");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ subject: "Samstagsdienst", isAllDay: false });
  });

  it("cancels an event with the comment in the body", async () => {
    const { calls, fetchImpl } = fakeFetch([token(), new Response(null, { status: 202 })]);
    await createGraphClient(config, fetchImpl).cancelEvent("ev1", "Dienst entfällt");
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/users/office%40firma.at/events/ev1/cancel");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ comment: "Dienst entfällt" });
  });

  it("drops the cached token after a 401 and fetches a new one for the next call", async () => {
    const { calls, fetchImpl } = fakeFetch([
      token(),
      json(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } }),
      json(200, { access_token: "tok2", expires_in: 3600 }),
      json(200, {}),
    ]);
    const client = createGraphClient(config, fetchImpl);
    const error = await client.updateEvent("ev1", input).catch((e) => e);
    expect(error).toMatchObject({ status: 401, isAuth: true });
    await client.updateEvent("ev1", input);

    const tokenRequests = calls.filter((c) => c.url.includes("/oauth2/v2.0/token"));
    expect(tokenRequests).toHaveLength(2);
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe("Bearer tok2");
  });

  it("returns the requested id from getEvent even if the payload carries another one", async () => {
    const { fetchImpl } = fakeFetch([
      token(),
      json(200, {
        id: "other",
        subject: "S",
        start: { dateTime: "2026-11-07T09:30:00.0000000", timeZone: GRAPH_TIME_ZONE },
        end: { dateTime: "2026-11-07T15:00:00.0000000", timeZone: GRAPH_TIME_ZONE },
        isAllDay: false,
        isCancelled: false,
        attendees: [],
      }),
    ]);
    expect((await createGraphClient(config, fetchImpl).getEvent("abc"))?.id).toBe("abc");
  });
});

describe("dry-run client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves every call without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {}); // graphClientFor logs through console.info
    for (const client of [createDryRunClient(log), graphClientFor({ ...config, dryRun: true })]) {
      const { id } = await client.createEvent(input, "tx-1");
      await expect(client.updateEvent(id, input)).resolves.toBeUndefined();
      await expect(client.cancelEvent(id, "x")).resolves.toBeUndefined();
      await expect(client.deleteEvent(id)).resolves.toBeUndefined();
      await expect(client.sendMail({ subject: "S", html: "<p>h</p>", to: ["a@firma.at"], bcc: [] })).resolves.toBeUndefined();
      expect(await client.getEvent(id)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});
