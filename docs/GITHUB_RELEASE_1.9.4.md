# Orbit 1.9.4

This GitHub release brings Orbit's built-in browser and desktop workbench together with safer agent execution, reusable Skills, and staged workflows. The browser can open pages and searches, click, type, scroll, navigate tabs and history, find text, and attach the active page to a question. Website uploads and downloads require explicit, page-bound confirmation.

The workbench keeps chat and its draft visible beside Browser, Changes, and Run. Keyboard navigation, focus recovery, and browser loading/reconnection states have been refined in English, Simplified Chinese, and Traditional Chinese.

This release also updates official DeepSeek support to `deepseek-flash`, improves session/run event isolation, and routes project checks through normal approval and sandbox policy. See the [full changelog](https://github.com/Hephaestus-DevKit/Orbit/blob/v1.9.4/CHANGELOG.md) for fixes and technical details.

## Upgrade notes

- Explicit official DeepSeek selections using retired Flash/chat/reasoner IDs must be changed to `deepseek-flash`. Existing configuration and historical sessions are not rewritten; no persisted-session migration is required.
- Project checks may now ask for execution approval where older versions bypassed it.
- The built-in browser needs a locally installed compatible Chromium browser. Browser extensions and website audio are not supported.

This is a GitHub-only release. `@orbit-build/cli@1.9.4` is **not** being published to npm yet. The attached CLI archive is provided for inspection and manual installation; verify its SHA-256 checksum before use.
