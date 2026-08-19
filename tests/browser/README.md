# Browser development-mode E2E

This suite starts the repository's real Vite development server and drives the
application in headless Chromium through WebdriverIO. It verifies route loading,
the absence of the Tauri bridge, and the StoryAssets browser-mode persistence
boundary.

It intentionally does not claim coverage of SQLite transactions, Tauri IPC,
native windows, installers, or updates. Those capabilities remain covered by
the Windows desktop E2E workflow.

Run locally with the existing dependencies:

```powershell
npx wdio run tests/browser/wdio.conf.ts
```

On Windows the suite first reuses `.e2e-tools/edgedriver-*` (or the explicit
`BROWSER_E2E_DRIVER` path) with installed Microsoft Edge, so an already
provisioned desktop-test driver also works offline. Other environments use
WebdriverIO's Chrome driver management; Chromium or Google Chrome must be
installed and reachable.
