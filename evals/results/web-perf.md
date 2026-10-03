# Web performance — static export

Measured on 2026-10-03 (local) by `pnpm eval:web-perf` (scripts/evaluation/web-perf.ts). Bytes come from the built export (gzip level 9). Timings: headless Chromium, 1280×800, CPU throttled 4×, cold cache, local server over loopback (no network latency), median of 3 runs. "Blocking" is the long-task time past 50 ms after first paint (a total-blocking-time proxy).

| Page | Scripts (inline) | JS raw / gzip (KB) | CSS gzip (KB) | HTML gzip (KB) | FCP (ms) | LCP (ms) | CLS | Blocking (ms) |
|---|---|---|---|---|---|---|---|---|
| `/` | 8 (22) | 574.6 / 160 | 12.4 | 17.5 | 208 | 208 | 0 | 0 |
| `/intelligence/?ticker=AAPL` | 14 (9) | 1491.4 / 390.1 | 12.4 | 6 | 104 | 612 | 0 | 139 |
| `/compare/?tickers=AAPL,MSFT,NVDA` | 14 (9) | 1501.2 / 393.7 | 12.4 | 6 | 152 | 400 | 0 | 67 |
| `/analysis/new/` | 13 (9) | 1451.1 / 377.9 | 12.4 | 6 | 100 | 452 | 0 | 111 |
| `/findings/` | 14 (9) | 1477.7 / 386.5 | 12.4 | 6 | 100 | 540 | 0.022 | 96 |
| `/architecture/` | 8 (20) | 566.4 / 159.1 | 12.4 | 15.6 | 136 | 136 | 0.01 | 0 |
| `/sources/filing/?id=AAPL_10K_2025-10-31` | 12 (9) | 1133.5 / 309.3 | 12.4 | 5.9 | 100 | 776 | 0 | 352 |
