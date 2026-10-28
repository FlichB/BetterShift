// [fork] Sends queued Urlaub mails via Graph sendMail, same loop as lib/dayoff/dispatch.ts.
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { logSystemEvent } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { handleSendFailure, type DispatchResult } from "@/lib/notify/dispatch";
import { getMailTranslator } from "@/lib/notify/translator";
import type { OutlookConfig } from "@/lib/outlook/config";
import type { GraphClient } from "@/lib/outlook/graph-client";
import type { VacationNotificationFailedMetadata } from "@/lib/vacation/audit";
import { resolveVacationRecipients } from "@/lib/vacation/recipients";
import { renderVacationMail } from "@/lib/vacation/render";
import { vacationChanges, vacationOutbox, vacations } from "@/lib/vacation/schema";

const MAILS_PER_RUN = 20;

export async function dispatchVacationNotifications(client: GraphClient, config: OutlookConfig, now: Date): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, authError: null };
  const rows = db
    .select()
    .from(vacationOutbox)
    .where(and(eq(vacationOutbox.status, "pending"), or(isNull(vacationOutbox.nextAttemptAt), lte(vacationOutbox.nextAttemptAt, now))))
    .orderBy(asc(vacationOutbox.createdAt))
    .limit(MAILS_PER_RUN)
    .all();
  if (rows.length === 0) return result;
  const { t, locale } = await getMailTranslator();

  for (const row of rows) {
    const finish = (status: "sent" | "skipped") => {
      db.update(vacationOutbox)
        .set({ status, sentAt: status === "sent" ? now : null, lastError: null })
        .where(eq(vacationOutbox.id, row.id))
        .run();
      result[status]++;
    };

    try {
      const vacation = db.select().from(vacations).where(eq(vacations.id, row.vacationId)).get();
      const change = row.changeId ? db.select().from(vacationChanges).where(eq(vacationChanges.id, row.changeId)).get() : undefined;
      const stale =
        !vacation ||
        (row.kind === "vacation_requested" && vacation.status !== "pending") ||
        (row.kind === "vacation_change_requested" && change?.status !== "pending");
      if (stale) {
        finish("skipped");
        continue;
      }
      const recipients = await resolveVacationRecipients(row.kind, vacation, row.actorUserId);
      if (recipients.length === 0) {
        finish("skipped");
        continue;
      }
      const holder = db.select({ name: user.name }).from(user).where(eq(user.id, vacation.userId)).get();
      const range =
        row.kind === "vacation_change_requested" && change?.kind === "change"
          ? { startDate: change.startDate!, endDate: change.endDate! }
          : { startDate: vacation.startDate, endDate: vacation.endDate };
      const mail = renderVacationMail(
        {
          kind: row.kind,
          holderName: holder?.name ?? t("notifications.mail.someone"),
          ...range,
          previousStart: row.previousStart,
          previousEnd: row.previousEnd,
          note:
            row.kind === "vacation_rejected"
              ? vacation.decisionNote
              : row.kind === "vacation_change_rejected"
                ? (change?.decisionNote ?? null)
                : row.kind === "vacation_requested"
                  ? vacation.note
                  : (change?.note ?? null),
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
      const stop = await handleSendFailure(error, row, now, result, {
        markFailed: (attempts, message) =>
          db.update(vacationOutbox).set({ status: "failed", attempts, lastError: message }).where(eq(vacationOutbox.id, row.id)).run(),
        scheduleRetry: (attempts, nextAttemptAt, message) =>
          db.update(vacationOutbox).set({ attempts, nextAttemptAt, lastError: message }).where(eq(vacationOutbox.id, row.id)).run(),
        logFailed: (message) =>
          logSystemEvent<VacationNotificationFailedMetadata>({
            action: "vacation.notification_failed",
            resourceType: "vacation",
            resourceId: row.vacationId,
            metadata: { kind: row.kind, vacationId: row.vacationId, attempts: row.attempts + 1, message },
          }),
      });
      if (stop) return result;
    }
  }
  return result;
}
