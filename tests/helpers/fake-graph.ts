// [fork] In-memory GraphClient for Outlook/notification tests. Queue errors in `failures`;
// each call takes the next one before doing anything.
import { GraphError, type EventInput, type GraphClient, type GraphEvent, type MailInput } from "@/lib/outlook/graph-client";

export class FakeGraph implements GraphClient {
  events = new Map<string, GraphEvent>();
  calls: string[] = [];
  mails: MailInput[] = [];
  transactionIds: string[] = [];
  failures: Error[] = [];
  private seq = 0;

  private step(call: string): void {
    this.calls.push(call);
    const failure = this.failures.shift();
    if (failure) throw failure;
  }

  private store(id: string, input: EventInput): void {
    this.events.set(id, {
      id,
      subject: input.subject,
      start: input.start,
      end: input.end,
      isAllDay: input.isAllDay,
      isCancelled: false,
      attendees: input.attendees,
    });
  }

  async createEvent(input: EventInput, transactionId: string) {
    this.step(`create:${input.start.dateTime}`);
    this.transactionIds.push(transactionId);
    const id = `ev-${++this.seq}`;
    this.store(id, input);
    return { id, iCalUId: `uid-${id}` };
  }

  async updateEvent(id: string, input: EventInput) {
    this.step(`update:${id}`);
    if (!this.events.has(id)) throw new GraphError(404, "404 ErrorItemNotFound");
    this.store(id, input);
  }

  async cancelEvent(id: string) {
    this.step(`cancel:${id}`);
    const event = this.events.get(id);
    if (!event) throw new GraphError(404, "404 ErrorItemNotFound");
    this.events.set(id, { ...event, isCancelled: true });
  }

  async getEvent(id: string) {
    this.step(`get:${id}`);
    return this.events.get(id) ?? null;
  }

  async sendMail(mail: MailInput) {
    this.step("mail");
    this.mails.push(mail);
  }

  attendeesOf(id: string): string[] {
    return this.events.get(id)?.attendees.map((a) => a.address) ?? [];
  }
}
