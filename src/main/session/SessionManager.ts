import { session, Session } from "electron";

export const KUAISHOU_PARTITION = "persist:kuaishou-uploader";
export const BOSS_ZHIPIN_PARTITION = "persist:boss-zhipin";

export type BrowserProfileId = "kuaishou" | "boss-zhipin";

const BOSS_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8";

export class SessionManager {
  private bossSessionConfigured = false;

  getSession(profileId: BrowserProfileId): Session {
    return profileId === "boss-zhipin" ? this.getBossZhipinSession() : this.getKuaishouSession();
  }

  getKuaishouSession(): Session {
    return session.fromPartition(KUAISHOU_PARTITION);
  }

  getBossZhipinSession(): Session {
    const bossSession = session.fromPartition(BOSS_ZHIPIN_PARTITION);
    this.configureBossSession(bossSession);
    return bossSession;
  }

  getChromeCompatibleUserAgent(): string {
    const chromeVersion = process.versions.chrome || "126.0.0.0";
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  getSummary() {
    return {
      partitions: {
        kuaishou: KUAISHOU_PARTITION,
        bossZhipin: BOSS_ZHIPIN_PARTITION
      },
      persistent: true,
      storage: "Electron persistent session partition"
    };
  }

  private configureBossSession(bossSession: Session): void {
    if (this.bossSessionConfigured) return;

    this.bossSessionConfigured = true;
    bossSession.setUserAgent(this.getChromeCompatibleUserAgent(), BOSS_ACCEPT_LANGUAGE);
    bossSession.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          "Accept-Language": BOSS_ACCEPT_LANGUAGE
        }
      });
    });
  }
}
