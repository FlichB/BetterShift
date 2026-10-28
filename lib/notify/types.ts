// [fork] Client-safe notification types (no database imports).
export interface NotificationPreferences {
  offersToAll: boolean;
  offersToMe: boolean;
  myOffers: boolean;
  myDayOffs: boolean;
  dayOffRequests: boolean;
}

export interface NotificationSettings {
  /** false when no Outlook/Graph mailbox is configured: switches are shown but nothing is sent. */
  configured: boolean;
  preferences: NotificationPreferences;
}
