// [fork] Sends queued Dienstfrei mails via Graph sendMail, same loop as lib/notify/dispatch.ts.
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { logSystemEvent } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { resolveDayOffRecipients } from "@/lib/dayoff/recipients";
import { renderDayOffMail } from "@/lib/dayoff/render";
import { dayOffOutbox, dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import { MAX_MAIL_ATTEMPTS, type DispatchResult } from "@/lib/notify/dispatch";
import { getMailTranslator } from "@/lib/notify/translator";
import type { NotificationFailedMetadata } from "@/lib/outlook/audit";
import type { OutlookConfig } from "@/lib/outlook/config";
import { GraphError, type GraphClient } from "@/lib/outlook/graph-client";
import { backoffMs } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";

const MAILS_PER_RUN = 20;

export async function dispatchDayOffNotifications(client: GraphClient, config: OutlookConfig, now: Date): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, authError: null };
  const rows = db
    .select()
    .from(dayOffOutbox)
    .where(and(eq(dayOffOutbox.status, "pending"), or(isNull(dayOffOutbox.nextAttemptAt), lte(dayOffOutbox.nextAttemptAt, now))))
    .orderBy(asc(dayOffOutbox.createdAt))
    .limit(MAILS_PER_RUN)
    .all();
  if (rows.length === 0) return result;
  const { t, locale } = await getMailTranslator();

  for (const row of rows) {
    const finish = (status: "sent" | "skipped") => {
      db.update(dayOffOutbox)
        .set({ status, sentAt: status === "sent" ? now : null, lastError: null })
        .where(eq(dayOffOutbox.id, row.id))
        .run();
      result[status]++;
    };

    try {
      const dayOff = db.select().from(dayOffs).where(eq(dayOffs.id, row.dayOffId)).get();
      const calendarId = dayOff
        ? db.select({ calendarId: rotations.calendarId }).from(rotations).where(eq(rotations.id, dayOff.rotationId)).get()?.calendarId
        : undefined;
      const openHolder = dayOff
        ? db
            .select()
            .from(dayOffProposals)
            .where(and(eq(dayOffProposals.dayOffId, dayOff.id), eq(dayOffProposals.side, "holder"), eq(dayOffProposals.status, "open")))
            .orderBy(asc(dayOffProposals.date))
            .all()
        : [];
      const stale =
        !dayOff ||
        !calendarId ||
        (row.kind === "day_off_locked" && dayOff.status !== "locked") ||
        ((row.kind === "day_off_proposed" || row.kind === "day_off_reminder") && openHolder.length === 0);
      if (stale) {
        finish("skipped");
        continue;
      }
      const recipients = await resolveDayOffRecipients(row.audience, dayOff, calendarId, row.actorUserId);
      if (recipients.length === 0) {
        finish("skipped");
        continue;
      }

      const proposal = row.proposalId ? db.select().from(dayOffProposals).where(eq(dayOffProposals.id, row.proposalId)).get() : undefined;
      const holder = db.select({ name: user.name }).from(user).where(eq(user.id, dayOff.userId)).get();
      const mail = renderDayOffMail(
        {
          kind: row.kind,
          holderName: holder?.name ?? t("notifications.mail.someone"),
          dutyDate: dayOff.dutyDate,
          date: row.kind === "day_off_accepted" ? (dayOff.date ?? proposal?.date ?? null) : (proposal?.date ?? dayOff.date),
          proposedDates: openHolder.map((p) => p.date),
          reason: row.kind === "day_off_declined" ? (proposal?.declineReason ?? null) : null,
          note: row.kind === "day_off_locked" ? dayOff.lockNote : null,
          appUrl: config.appUrl,
        },
        t,
        locale
      );
      // One recipient sees their own address; several go to BCC so nobody sees the others.
      const emails = recipients.map((r) => r.email);
      const single = emails.length === 1;

      await client.sendMail({ ...mail, to: single ? emails : [config.organizer], bcc: single ? [] : emails });
      finish("sent");
    } catch (error) {
      if (error instanceof GraphError && error.isAuth) {
        result.authError = error.message;
        return result;
      }
      // Any other error takes the normal retry path so one bad row cannot block the queue.
      const attempts = row.attempts + 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (attempts >= MAX_MAIL_ATTEMPTS) {
        db.update(dayOffOutbox).set({ status: "failed", attempts, lastError: message }).where(eq(dayOffOutbox.id, row.id)).run();
        result.failed++;
        await logSystemEvent<NotificationFailedMetadata>({
          action: "notification.failed",
          resourceType: "day_off",
          resourceId: row.dayOffId,
          // swapId carries the Dienstfrei id here; the metadata shape is shared with swap mails.
          metadata: { kind: row.kind, swapId: row.dayOffId, message },
        });
      } else {
        const wait = error instanceof GraphError && error.retryAfterMs !== null ? error.retryAfterMs : backoffMs(attempts);
        db.update(dayOffOutbox)
          .set({ attempts, nextAttemptAt: new Date(now.getTime() + wait), lastError: message })
          .where(eq(dayOffOutbox.id, row.id))
          .run();
      }
    }
  }
  return result;
}
