// [fork] Sends queued swap notifications via Graph sendMail from the organizer mailbox (spec 12.27).
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { logSystemEvent } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { shifts, user } from "@/lib/db/schema";
import { resolveRecipients } from "@/lib/notify/recipients";
import { renderMail, type MailDuty } from "@/lib/notify/render";
import { notificationOutbox } from "@/lib/notify/schema";
import { getMailTranslator } from "@/lib/notify/translator";
import type { NotificationFailedMetadata } from "@/lib/outlook/audit";
import type { OutlookConfig } from "@/lib/outlook/config";
import { GraphError, type GraphClient } from "@/lib/outlook/graph-client";
import { backoffMs } from "@/lib/outlook/sync";
import type { DutyTiming } from "@/lib/swap/rules";
import { getSwap, loadSlot } from "@/lib/swap/service";

export const MAX_MAIL_ATTEMPTS = 5;
const MAILS_PER_RUN = 20;

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
  authError: string | null;
}

// SlotView carries timing only; the mail also shows the shift title.
const withTitle = (duty: DutyTiming): MailDuty => ({
  ...duty,
  title: db.select({ title: shifts.title }).from(shifts).where(eq(shifts.id, duty.shiftId)).get()?.title ?? "",
});
const dutyOf = (shiftId: string | null): MailDuty | null => {
  const slot = shiftId ? loadSlot(db, shiftId) : null;
  return slot ? withTitle(slot.duty) : null;
};
const nameOf = (id: string | null): string | null =>
  id ? (db.select({ name: user.name }).from(user).where(eq(user.id, id)).get()?.name ?? null) : null;

export async function dispatchNotifications(client: GraphClient, config: OutlookConfig, now: Date): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, authError: null };
  const rows = db
    .select()
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.status, "pending"),
        or(isNull(notificationOutbox.nextAttemptAt), lte(notificationOutbox.nextAttemptAt, now))
      )
    )
    .orderBy(asc(notificationOutbox.createdAt))
    .limit(MAILS_PER_RUN)
    .all();
  if (rows.length === 0) return result;
  const { t, locale } = await getMailTranslator();

  for (const row of rows) {
    const finish = (status: "sent" | "skipped") => {
      db.update(notificationOutbox)
        .set({ status, sentAt: status === "sent" ? now : null, lastError: null })
        .where(eq(notificationOutbox.id, row.id))
        .run();
      result[status]++;
    };

    try {
      const swap = getSwap(row.swapId);
      const offered = swap ? loadSlot(db, swap.offeredShiftId) : null;
      const openOnly = row.kind === "offer_to_all" || row.kind === "offer_to_me" || row.kind === "forced_to_all";
      if (!swap || !offered || (openOnly && swap.status !== "open")) {
        finish("skipped");
        continue;
      }
      const recipients = await resolveRecipients(row.kind, swap, offered.duty.calendarId, row.actorUserId);
      if (recipients.length === 0) {
        finish("skipped");
        continue;
      }

      const someone = t("notifications.mail.someone");
      const mail = renderMail(
        {
          kind: row.kind,
          type: swap.type,
          offered: withTitle(offered.duty),
          requested: dutyOf(swap.requestedShiftId),
          accepted: dutyOf(swap.acceptedShiftId),
          offeredByName: nameOf(swap.offeredByUserId) ?? someone,
          acceptedByName: nameOf(swap.acceptedByUserId) ?? someone,
          actorName: nameOf(row.actorUserId) ?? someone,
          note: swap.note,
          counterWindowEnd: swap.counterWindowEnd,
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
      // Any other error (Graph or local) takes the normal retry path so one bad row cannot block the queue.
      const attempts = row.attempts + 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (attempts >= MAX_MAIL_ATTEMPTS) {
        db.update(notificationOutbox).set({ status: "failed", attempts, lastError: message }).where(eq(notificationOutbox.id, row.id)).run();
        result.failed++;
        await logSystemEvent<NotificationFailedMetadata>({
          action: "notification.failed",
          resourceType: "shift_swap",
          resourceId: row.swapId,
          metadata: { kind: row.kind, swapId: row.swapId, message },
        });
      } else {
        const wait = error instanceof GraphError && error.retryAfterMs !== null ? error.retryAfterMs : backoffMs(attempts);
        db.update(notificationOutbox)
          .set({ attempts, nextAttemptAt: new Date(now.getTime() + wait), lastError: message })
          .where(eq(notificationOutbox.id, row.id))
          .run();
      }
    }
  }
  return result;
}
