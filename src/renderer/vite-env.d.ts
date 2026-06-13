/// <reference types="vite/client" />

import type { AppApi } from "../preload/appApi";

declare global {
  interface Window {
    appApi: AppApi;
  }
}

export {};

