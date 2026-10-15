# motion-005: the six flows, verified in a browser

**Run:** `pnpm -C web exec playwright test e2e/motion005.spec.ts` (Chromium, SwiftShader, 1280 × 800), all 9 cases passed. Each case samples the app's own hooks on every animation frame: successive observed frames establish the motion, and the screenshots below record the layout (downscaled to 960 px). The full samples are attached to the Playwright report. The hardware-GPU run of the measurements is in `docs/performance.md` § Epic motion.

| Flow | Speed | What the frames showed | Screenshot |
|---|---|---|---|
| Junction crossing | 1× | 65 frames, 1 link change(s), largest step 2.61 m (in 83 ms), 100 % of frames between two sim frames | [junction at 1×](motion-005/junction-1x.png) |
| Junction crossing | 20× | 64 frames, 2 link change(s), largest step 30.79 m (in 100 ms), 100 % of frames between two sim frames | [junction at 20×](motion-005/junction-20x.png) |
| Queue formation and release | 1× (the queue was built up at the faster speed first) | 54 frames, 54 with queued cars, all held behind the stop line: True | [queue formed, observed at 1×](motion-005/queue-formed.png) |
| Queue formation and release | 20× | 59 frames, 33 with queued cars, all held behind the stop line: True; release is S10: both Main Bridge directions carry cars again within 5 sim min, and the mean queue from minute 5 to minute 7 does not grow | [queue released at 20×](motion-005/queue-released.png) |
| Close and reopen the main bridge | 1× | closed within 2 s; the ring drawn on both links; ✕ entry and marker; the bridge emptied, no car entered; reopened with ○ | [bridge closed at 1×](motion-005/bridge-1x-closed.png), [reopened](motion-005/bridge-1x-reopened.png) |
| Close and reopen the main bridge | 20× | the same at 20× | [bridge closed at 20×](motion-005/bridge-20x-closed.png), [reopened](motion-005/bridge-20x-reopened.png) |
| Pause, inspect and resume | 1× | paused: no frames, tick still, drawing on; road and car inspected, brackets drawn; resumed: 73 frames, 1 link change(s), largest step 1.59 m (in 50 ms), 88 % of frames between two sim frames | [paused inspection at 1×](motion-005/pause-1x.png) |
| Pause, inspect and resume | 20× | the same; resumed: 59 frames, 1 link change(s), largest step 39.87 m (in 167 ms), 100 % of frames between two sim frames | [paused inspection at 20×](motion-005/pause-20x.png) |
| Rewind and branch | 1× | running seek: 42 frames sampled; paused seek: 40 frames, cars still; switch to A: 30 frames on A; on B: 67 frames, 1 link change(s), largest step 2.83 m (in 50 ms), 97 % of frames between two sim frames | [branch at 1×](motion-005/branch-1x.png) |
| Rewind and branch | 20× | running seek: 31 frames sampled; paused seek: 34 frames, cars still; switch to A: 23 frames on A; on B: 50 frames, 1 link change(s), largest step 30.50 m (in 133 ms), 100 % of frames between two sim frames | [branch at 20×](motion-005/branch-20x.png) |
| Side-by-side comparison | 1× | 35 frames: A and B at the same tick on 35, one presentation time on 35; tickA 2306.0 → 2312.1; B's map shows moving cars (pixel check) | [comparison at 1×](motion-005/compare-1x.png) |
| Side-by-side comparison | 20× | 31 frames: A and B at the same tick on 31, one presentation time on 31; tickA 2358.3 → 2476.4 | [comparison at 20×](motion-005/compare-20x.png) |

**Limits of this evidence:**
- The browser here renders with SwiftShader, a software GPU. The motion checks use the presentation's own positions, so they do not depend on the renderer. The frame rates and render intervals do, and those are measured on the hardware GPU separately.
- At 20× the per-frame motion bound cannot tell interpolation from drawing at frame records; the share of frames between two sim frames covers that (ward spec).
