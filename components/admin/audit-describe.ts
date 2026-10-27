"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

interface DescribableLog {
  action: string;
  metadata?: unknown;
}

function field(metadata: unknown, key: string): unknown {
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[key] : undefined;
}

function text(metadata: unknown, key: string): string {
  const value = field(metadata, key);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function count(metadata: unknown, key: string): number {
  const value = Number(field(metadata, key));
  return Number.isFinite(value) ? value : 0;
}

// text() only reads a top-level key; announcement metadata nests fields under
// "announcement"/"before"/"after", so this reaches one level down.
function nested(metadata: unknown, outer: string, inner: string): string {
  return text(field(metadata, outer), inner);
}

/**
 * Plain-language summary of an audit entry, built from its action and metadata.
 * Falls back to the raw action name when the metadata lacks what a sentence needs.
 */
export function useAuditDescription() {
  const t = useTranslations();

  return useCallback(
    (log: DescribableLog): string => {
      const m = log.metadata;
      const target = text(m, "targetUser") || text(m, "deletedUser");
      const calendar = text(m, "calendarName");
      const sync = text(m, "syncName");

      switch (log.action) {
        case "admin.user.ban":
          if (!target) break;
          return text(m, "expiresAt") === "permanent"
            ? t("adminAudit.describe.userBannedPermanently", { user: target })
            : t("adminAudit.describe.userBanned", { user: target });
        case "admin.user.unban":
          if (target) return t("adminAudit.describe.userUnbanned", { user: target });
          break;
        case "admin.user.password_reset":
          if (target) return t("adminAudit.describe.passwordReset", { user: target });
          break;
        case "admin.user.delete":
          if (target) return t("adminAudit.describe.userDeleted", { user: target });
          break;
        case "admin.user.update":
          if (target) return t("adminAudit.describe.userUpdated", { user: target });
          break;
        case "admin.calendar.transfer":
          if (calendar && text(m, "newOwnerEmail")) {
            return t("adminAudit.describe.calendarTransferred", {
              calendar,
              user: text(m, "newOwnerEmail"),
            });
          }
          break;
        case "admin.calendar.bulk_transfer":
          if (text(m, "newOwnerEmail")) {
            return t("adminAudit.describe.calendarsTransferred", {
              count: count(m, "count"),
              user: text(m, "newOwnerEmail"),
            });
          }
          break;
        case "admin.calendar.bulk_delete":
          return t("adminAudit.describe.calendarsDeleted", { count: count(m, "count") });
        case "admin.audit_log.delete_by_ids":
        case "admin.audit_log.delete_by_date":
          return t("adminAudit.describe.logsDeleted", { count: count(m, "deletedCount") });
        case "admin.system_settings.update":
          return t("adminAudit.describe.systemSettingsUpdated");
        case "admin.announcement.create":
          return t("adminAudit.describe.announcementCreated", {
            title: nested(m, "announcement", "title"),
          });
        case "admin.announcement.update":
          return t("adminAudit.describe.announcementUpdated", {
            title: nested(m, "after", "title"),
          });
        case "admin.announcement.delete":
          return t("adminAudit.describe.announcementDeleted", { title: text(m, "title") });
        case "admin.telemetry_consent":
          return field(m, "after") === true
            ? t("adminAudit.describe.telemetryEnabled")
            : t("adminAudit.describe.telemetryDisabled");
        case "admin.telemetry_send":
          return field(m, "result") === "failed"
            ? t("adminAudit.describe.telemetrySendFailed")
            : t("adminAudit.describe.telemetrySent");
        case "system.telemetry_send":
          return field(m, "result") === "failed"
            ? t("adminAudit.describe.telemetryAutoSendFailed")
            : t("adminAudit.describe.telemetryAutoSent");
        case "admin.calendar.update":
        case "calendar.updated":
          if (calendar) return t("adminAudit.describe.calendarUpdated", { calendar });
          break;
        case "admin.calendar.delete":
        case "calendar.deleted":
          if (calendar) return t("adminAudit.describe.calendarDeleted", { calendar });
          break;
        case "calendar.created":
          if (calendar) return t("adminAudit.describe.calendarCreated", { calendar });
          break;
        case "calendar.shared":
          if (calendar && text(m, "sharedWith")) {
            return t("adminAudit.describe.calendarShared", { calendar, user: text(m, "sharedWith") });
          }
          break;
        case "calendar.share.removed":
          if (calendar && text(m, "removedUser")) {
            return t("adminAudit.describe.shareRemoved", { calendar, user: text(m, "removedUser") });
          }
          break;
        case "calendar.permission.changed":
          if (calendar && text(m, "user")) {
            return t("adminAudit.describe.permissionChanged", { calendar, user: text(m, "user") });
          }
          break;
        case "calendar.guest_permission.changed":
          if (calendar) return t("adminAudit.describe.guestPermissionChanged", { calendar });
          break;
        case "sync.created":
          if (sync) return t("adminAudit.describe.syncCreated", { sync });
          break;
        case "sync.deleted":
          if (sync) return t("adminAudit.describe.syncDeleted", { sync });
          break;
        case "sync.orphaned.disabled":
          if (sync) return t("adminAudit.describe.syncDisabled", { sync });
          break;
        case "sync.executed":
          if (!sync) break;
          return field(m, "success") === false
            ? t("adminAudit.describe.syncFailed", { sync })
            : t("adminAudit.describe.syncExecuted", {
                sync,
                added: count(m, "shiftsAdded"),
                updated: count(m, "shiftsUpdated"),
                deleted: count(m, "shiftsDeleted"),
              });
        case "security.rate_limit.hit":
          if (text(m, "endpoint")) return t("adminAudit.describe.rateLimit", { endpoint: text(m, "endpoint") });
          break;
        case "auth.login.success":
          return text(m, "provider")
            ? t("adminAudit.describe.loginProvider", { provider: text(m, "provider") })
            : t("adminAudit.describe.loginEmail");
        case "auth.login.failed":
          if (text(m, "email")) return t("adminAudit.describe.loginFailed", { email: text(m, "email") });
          break;
        case "auth.user.registered":
          if (text(m, "email")) return t("adminAudit.describe.registered", { email: text(m, "email") });
          break;
        case "auth.profile.updated":
          return t("adminAudit.describe.profileUpdated");
        case "auth.password.changed":
          return t("adminAudit.describe.passwordChanged");
        case "auth.account.deleted":
          return t("adminAudit.describe.accountDeleted");
        case "auth.session.revoked":
          return t("adminAudit.describe.sessionsRevoked", { count: count(m, "count") || 1 });
        // [fork] Rotation events
        case "rotation.created":
          return t("adminAudit.describe.rotationCreated", { name: text(m, "rotationName"), calendar });
        case "rotation.updated":
          return t("adminAudit.describe.rotationUpdated", { name: text(m, "rotationName"), calendar });
        case "rotation.deleted":
          return t("adminAudit.describe.rotationDeleted", { name: text(m, "rotationName"), calendar });
        case "rotation.generated":
          return t("adminAudit.describe.rotationGenerated", {
            name: text(m, "rotationName"),
            from: text(m, "from"),
            to: text(m, "to"),
          });
        case "rotation.lock_removed":
          return t("adminAudit.describe.rotationLockRemoved", { name: text(m, "rotationName") });
        // [fork] Swap events
        case "swap.offered":
          return t("adminAudit.describe.swapOffered", { date: text(m, "offeredDate"), calendar });
        case "swap.accepted":
          return text(m, "acceptedDate")
            ? t("adminAudit.describe.swapExchanged", {
                date: text(m, "offeredDate"),
                other: text(m, "acceptedDate"),
                calendar,
              })
            : t("adminAudit.describe.swapAccepted", { date: text(m, "offeredDate"), calendar });
        case "swap.declined":
          return t("adminAudit.describe.swapDeclined", { date: text(m, "offeredDate") });
        case "swap.withdrawn":
          return t("adminAudit.describe.swapWithdrawn", { date: text(m, "offeredDate") });
        case "swap.expired":
          return t("adminAudit.describe.swapExpired", { date: text(m, "offeredDate") });
        case "swap.forced":
          return t("adminAudit.describe.swapForced", { date: text(m, "offeredDate"), calendar });
        case "swap.counter_chosen":
          return t("adminAudit.describe.swapCounterChosen", { date: text(m, "offeredDate"), other: text(m, "counterDate") });
        case "swap.counter_waived":
          return t("adminAudit.describe.swapCounterWaived", { date: text(m, "offeredDate"), reason: text(m, "reason") });
        case "swap.cancelled":
          return t("adminAudit.describe.swapCancelled", { date: text(m, "offeredDate") });
        // [fork] Outlook / notification events
        case "outlook.enabled":
          return t("adminAudit.describe.outlookEnabled", { name: text(m, "rotationName"), calendar });
        case "outlook.disabled":
          return t("adminAudit.describe.outlookDisabled", { name: text(m, "rotationName"), calendar });
        case "outlook.sync_failed":
          return t("adminAudit.describe.outlookSyncFailed", { date: text(m, "date"), message: text(m, "message") });
        case "outlook.auth_failed":
          return t("adminAudit.describe.outlookAuthFailed", { message: text(m, "message") });
        case "notification.failed":
          return t("adminAudit.describe.notificationFailed", { message: text(m, "message") });
        // [fork] Personal feed link
        case "personal_feed.created":
          return t("adminAudit.describe.personalFeedCreated");
        case "personal_feed.rotated":
          return t("adminAudit.describe.personalFeedRotated");
        case "personal_feed.revoked":
          return t("adminAudit.describe.personalFeedRevoked");
        // [fork] Dienstfrei
        case "dayoff.notification_failed":
          return t("adminAudit.describe.dayOffNotificationFailed", { kind: text(m, "kind") });
        case "dayoff.moved":
          return t("adminAudit.describe.dayOffMoved", { date: text(m, "dutyDate"), from: text(m, "from"), to: text(m, "to"), calendar });
        case "dayoff.locked":
          return t("adminAudit.describe.dayOffLocked", { date: text(m, "dutyDate"), calendar });
        case "dayoff.proposed": {
          const dates = field(m, "dates");
          return t("adminAudit.describe.dayOffProposed", {
            date: text(m, "dutyDate"),
            dates: Array.isArray(dates) ? dates.join(", ") : "",
            calendar,
          });
        }
        case "dayoff.countered":
          return t("adminAudit.describe.dayOffCountered", { date: text(m, "dutyDate"), to: text(m, "date"), calendar });
        case "dayoff.accepted":
          return t("adminAudit.describe.dayOffAccepted", { date: text(m, "dutyDate"), to: text(m, "date"), calendar });
        case "dayoff.declined":
          return t("adminAudit.describe.dayOffDeclined", { date: text(m, "dutyDate"), to: text(m, "date"), calendar });
        case "dayoff.reset":
          return t("adminAudit.describe.dayOffReset", { date: text(m, "dutyDate"), calendar });
        case "dayoff.dropped":
          return t("adminAudit.describe.dayOffDropped", { date: text(m, "dutyDate"), calendar });
      }
      return log.action;
    },
    [t]
  );
}
