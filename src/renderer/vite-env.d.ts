/// <reference types="vite/client" />

import type { BrowserBounds, LinkInfo, PageState, PingResult } from "../shared/types";

declare global {
  interface Window {
    crawlWeb: {
      browser: {
        navigate(url: string): Promise<PageState>;
        back(): Promise<PageState>;
        forward(): Promise<PageState>;
        reload(): Promise<PageState>;
        setBounds(bounds: BrowserBounds): Promise<void>;
        getState(): Promise<PageState>;
        getUrl(): Promise<string>;
        getTitle(): Promise<string>;
        extractLinks(limit?: number): Promise<LinkInfo[]>;
        onStateChange(handler: (state: PageState) => void): () => void;
      };
      debug: {
        ping(): Promise<PingResult>;
      };
    };
  }
}

export {};

