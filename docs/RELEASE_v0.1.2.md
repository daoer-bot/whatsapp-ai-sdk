# Release v0.1.2

**WhatsApp AI Extension** — unofficial Chromium MV3 extension for WhatsApp Web.

Tag: `v0.1.2`  
Date: 2026-07-28

## Highlights

- **Positioning**: browser extension (not an npm runtime SDK); load **repo root**, not `dist/`
- **OpenAI-compatible provider** + mock / dify; default remains **mock** (no network)
- **In-page settings drawer** (right-click / long-press ✦)
- **Composer anti-duplication** fixes (Lexical double-insert / polish not updating input)
- **Docs for portfolio & safety**: EN README, threat model, selector regression checklist
- **Demo video**: [`docs/assets/demo-usage.mp4`](./assets/demo-usage.mp4) (~38s) + still frames
- **Tests**: 30 pure-logic unit tests (ai-client, rpc, prompt-builder, message-types)

## Install (developers)

```bash
git clone https://github.com/daoer-bot/whatsapp-ai-sdk.git
cd whatsapp-ai-sdk
npm ci
npm run verify
```

1. Chrome/Edge → `chrome://extensions` → Developer mode → **Load unpacked**
2. Select the **repository root** (folder with `manifest.json`), **not** `dist/`
3. Open https://web.whatsapp.com and log in
4. Keep provider `mock`; click **✦** beside the composer

## Docs

| Doc | Link |
| --- | --- |
| README (ZH) | [README.md](../README.md) |
| README (EN) | [README.en.md](../README.en.md) |
| API | [API.md](./API.md) |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Threat model | [THREAT_MODEL.md](./THREAT_MODEL.md) |
| Selector checklist | [SELECTOR_CHECKLIST.md](./SELECTOR_CHECKLIST.md) |
| Changelog | [CHANGELOG.md](../CHANGELOG.md) |

## Breaking / migration

- None intentional for local unpacked users on 0.1.x
- After upgrade: `npm run build` → reload extension → hard-refresh WhatsApp Web
- `@wppconnect/wa-js` pinned to `^4.4.2` (see compatibility notes for harmless `getUserhash` logs)

## Known limits

- AI HTTP still from content script → CORS must allow `https://web.whatsapp.com`
- API keys in `chrome.storage.local` unencrypted
- `window.WhatsappAI` is page-visible (not an authenticated private API)
- WhatsApp Web / WPP DOM can break without notice

## GitHub Release checklist (manual)

- [ ] Push `main` and tag `v0.1.2`
- [ ] Create GitHub Release from this file’s Highlights + Install sections
- [ ] Set repository Description + Topics (`chrome-extension`, `manifest-v3`, `whatsapp-web`, …)
- [ ] Optional: add screenshots under `docs/assets/` (no real chats / keys)

## Verify

```bash
npm run verify
# build + secret scan + 30 unit tests + smoke
```
