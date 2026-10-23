// [fork] Personal feed types shared by server and client; no DB imports here.
export interface PersonalFeedInfo {
  token: string | null;
  url: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}
