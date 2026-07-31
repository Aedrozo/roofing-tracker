# Roofing tracker test suite

End-to-end functional audit of `roofing-tracker/` — every view, calculation,
document, and data-safety path (109+ checks). Run it after any change.

```bash
npm i -g playwright        # once (or use a local install)
node tests/audit.js        # CHROME_PATH=/path/to/chrome to pin a browser
```

The suite drives a real headless Chromium against the app, simulates the
address geocoder (no network needed), and exits non-zero on any failure.
