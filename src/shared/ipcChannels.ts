export const IPC_CHANNELS = {
  browserNavigate: "browser:navigate",
  browserBack: "browser:back",
  browserForward: "browser:forward",
  browserReload: "browser:reload",
  browserSetBounds: "browser:set-bounds",
  browserGetState: "browser:get-state",
  browserGetUrl: "browser:get-url",
  browserGetTitle: "browser:get-title",
  browserExtractLinks: "browser:extract-links",
  browserStateChanged: "browser:state-changed",
  debugPing: "debug:ping"
} as const;

