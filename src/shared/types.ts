export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
};

export type LinkInfo = {
  text: string;
  href: string;
};

export type PingResult = {
  message: "pong";
  at: string;
  page: PageState;
};

