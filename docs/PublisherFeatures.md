# CrawlWebElectron Publisher Features

This document outlines the multi-platform publishing capabilities integrated into CrawlWebElectron.

## Anti-Detection & Privacy
To protect your accounts from automated bot-detection systems (like those used by ByteDance or Kuaishou), CrawlWebElectron aggressively disguises its internal Electron environment:
- **User-Agent Spoofing**: `webViewController.ts` automatically intercepts the Chromium session upon startup and safely removes all traces of `Electron/xxx` and `crawl-web-electron/xxx`.
- **Local Isolation**: All your cookies and sessions are safely bounded to a local, isolated partition (`persist:crawl-web-electron`).

## Supported Platforms
The UI dynamically renders input fields depending on which fields the specific platform mandates.

1. **Douyin 抖音** (`creator.douyin.com`)
   - **Fields**: Title, Description
   - **Mechanism**: Injects into `.zone-container` and `.zone-title`.

2. **Kuaishou 快手** (`cp.kuaishou.com`)
   - **Fields**: Description (Kuaishou generally merges title, description, and hashtags into one massive text box).
   - **Mechanism**: Injects into `.brilliance-editor` or generic `[contenteditable="true"]`.

3. **Kwai** (`studio.kwai.com`)
   - **Fields**: Description.
   - **Mechanism**: Mirrors Kuaishou logic.

4. **TikTok** (`tiktok.com/creator-center`)
   - **Fields**: Description (Caption).
   - **Mechanism**: Injects into `.public-DraftEditor-content`.

5. **YouTube** (`studio.youtube.com`)
   - **Fields**: Title, Description, Tags.
   - **Mechanism**: Enumerates through `#textbox[contenteditable="true"]` nodes.

6. **Bilibili 哔哩哔哩** (`member.bilibili.com`)
   - **Fields**: Title, Description, Tags.
   - **Mechanism**: Injects into `.ql-editor` and natively dispatches `Enter` events to submit Tags.

## Reliable Data Injection
Instead of relying on unstable `.innerHTML` logic which fails against React/Vue framework state managers, our backend heavily utilizes:
```javascript
document.execCommand('insertText', false, text);
```
This forces the browser to emulate an actual user "pasting" data, guaranteeing that the target website's framework registers the data change properly.
