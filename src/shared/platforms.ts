export type FieldType = "title" | "description" | "tags" | "category" | "visibility" | "cover" | "publishTime" | "collection" | "localInvisible";

export interface PlatformData {
  name: string;
  url: string;
  fields: FieldType[];
}

export const PLATFORMS: Record<string, PlatformData> = {
  douyin: { name: "DOUYIN", url: "https://creator.douyin.com/creator-micro/content/upload", fields: ["title", "description", "tags", "cover", "visibility", "publishTime", "collection", "localInvisible"] },
  kuaishou: { name: "KUAISHOU", url: "https://cp.kuaishou.com/article/publish/video", fields: ["description", "cover", "visibility", "publishTime", "collection", "localInvisible"] },
  kwai: { name: "KWAI", url: "https://studio.kwai.com/publish/video", fields: ["description", "cover", "visibility", "publishTime"] },
  tiktok: { name: "TIKTOK", url: "https://www.tiktok.com/creator-center/upload", fields: ["description", "cover", "visibility", "publishTime", "collection"] },
  youtube: { name: "YOUTUBE", url: "https://studio.youtube.com/", fields: ["title", "description", "tags", "category", "visibility", "cover", "publishTime", "collection"] },
  bilibili: { name: "BILIBILI", url: "https://member.bilibili.com/platform/upload/video/frame", fields: ["title", "description", "tags", "category", "cover", "publishTime", "collection"] }
};

export type PlatformKey = keyof typeof PLATFORMS;
