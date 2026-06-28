import { session, Session } from "electron";

export const KUAISHOU_PARTITION = "persist:kuaishou-uploader";

export type BrowserProfileId = "kuaishou";

export class SessionManager {
  getSession(_profileId: BrowserProfileId): Session {
    return this.getKuaishouSession();
  }

  getKuaishouSession(): Session {
    return session.fromPartition(KUAISHOU_PARTITION);
  }

  getSummary() {
    return {
      partitions: {
        kuaishou: KUAISHOU_PARTITION
      },
      persistent: true,
      storage: "Electron persistent session partition"
    };
  }
}
