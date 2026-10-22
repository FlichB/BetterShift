import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  calendars,
  calendarPermissionBundles,
  calendarShares,
  shiftPresets,
  user,
} from "@/lib/db/schema";
import { seedPermissionBundles } from "@/lib/auth/permissions";
import { defaultBundleDefinitionsForNewCalendar } from "@/lib/permission-bundles";

export function createUser(name: string, role: string | null = null): string {
  const id = crypto.randomUUID();
  db.insert(user)
    .values({
      id,
      name,
      email: `${name.toLowerCase()}-${id}@example.test`,
      emailVerified: true,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return id;
}

export function shareCalendar(
  calendarId: string,
  userId: string,
  seedKey: "read" | "contribute" | "manage" | "admin",
  sharedBy: string
): void {
  const bundle = db
    .select()
    .from(calendarPermissionBundles)
    .where(and(eq(calendarPermissionBundles.calendarId, calendarId), eq(calendarPermissionBundles.seedKey, seedKey)))
    .get();
  if (!bundle) throw new Error(`bundle ${seedKey} missing`);
  db.insert(calendarShares).values({ calendarId, userId, bundleId: bundle.id, sharedBy }).run();
}

/** Owner + n Teilnehmer with the Read bundle, a team calendar and the Samstagsdienst preset. */
export function seedTeam({ members = 8 }: { members?: number } = {}) {
  const ownerId = createUser("Chef");
  const calendarId = crypto.randomUUID();
  db.insert(calendars)
    .values({ id: calendarId, name: "Team", color: "#3b82f6", ownerId, signupsEnabled: true })
    .run();
  seedPermissionBundles(calendarId, defaultBundleDefinitionsForNewCalendar());

  const presetId = crypto.randomUUID();
  db.insert(shiftPresets)
    .values({
      id: presetId,
      calendarId,
      title: "Samstagsdienst",
      startTime: "09:30",
      endTime: "15:00",
      color: "#3b82f6",
    })
    .run();

  const memberIds = Array.from({ length: members }, (_, i) => {
    const id = createUser(`M${i + 1}`);
    shareCalendar(calendarId, id, "read", ownerId);
    return id;
  });
  return { ownerId, memberIds, calendarId, presetId };
}
