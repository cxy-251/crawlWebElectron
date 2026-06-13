import { session, Session } from "electron";

export const KUAISHOU_PARTITION = "persist:kuaishou-uploader";

export class SessionManager {
  getKuaishouSession(): Session {
    return session.fromPartition(KUAISHOU_PARTITION);
  }

  getSummary() {
    return {
      partition: KUAISHOU_PARTITION,
      persistent: true,
      storage: "Electron persistent session partition"
    };
  }
}

