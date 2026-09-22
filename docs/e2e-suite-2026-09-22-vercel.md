# E2E suite through Vercel AI Gateway — 2026-09-22

## What changed

The e2e suite can now take its provider from the environment instead of hard-coding
OpenRouter. These runs pointed it at Jev through Vercel AI Gateway: provider
`typesafe`, endpoint `https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model
`typesafe-ai/jev`, with `deepseek/deepseek-v3.1` as the text helper through the same
gateway and the same key for both.

## Three runs

Three runs were made against the 17-task baseline (plus 2 fixture tasks), each
spoiled by a different transient fault.

**Run 1** (`.e2e-out/vercel/summary.md`): 8/17 of the baseline tasks passed. 5 were
lost to HTTP 429 `rate_limit_exceeded` from the upstream ("The upstream provider is
currently experiencing high demand. Please retry shortly.").

**Run 2** (`.e2e-out/vercel2/summary.md`): spoiled by the operator's own
misconfiguration, not the gateway. The text helper model was set to
`deepseek/deepseek-v4-flash-0731`, which returns HTTP 403 "Free tier users do not
have access to this model" on this account. Every task that needed the text helper
failed before Jev itself was exercised.

**Run 3** (`.e2e-out/vercel3/summary.md`): 9/17 of the baseline tasks passed. 5 were
lost to `Failed to fetch` inside a ten-second window (09:05:xx), and 1 hit a
transient HTTP 503 that recovered on a later step within the same task (the task
still finished verified).

## Run 3, per task

| | Task | Status | Steps | Time | Verified | Error |
|---|---|---|---|---|---|---|
| ❌ | Popup: Google Flights one-way ZRH-LON | blocked | 14 | 18.6s | no | Reached the 14-step budget without DONE. |
| ✅ | Popup: Wikipedia Taylor Swift early life | error | 5 | 19.2s | yes | Jev decision failed: TypeSafe API error (HTTP 503): {"error":{"message":"Service |
| ❌ | Popup: highest-rated product to cart (LambdaTest OpenCart demo) | error | 1 | 3.7s | no | Jev decision failed: TypeSafe API connection failed (Failed to fetch); no action |
| ❌ | Reference: Wikipedia Gödel article | error | 0 | 1.5s | no | Jev decision failed: TypeSafe API connection failed (Failed to fetch); no action |
| ❌ | X/Krouse: Wikiracing Rubber duck → Eiffel Tower | error | 0 | 1.4s | no | Jev decision failed: TypeSafe API connection failed (Failed to fetch); no action |
| ❌ | X/Krouse: Hacker News top story comments | error | 0 | 1.8s | no | Jev decision failed: TypeSafe API connection failed (Failed to fetch); no action |
| ❌ | X/Krouse: Val Town Airtable examples | error | 0 | 1.2s | no | Jev decision failed: TypeSafe API connection failed (Failed to fetch); no action |
| ✅ | X/jev-browser: Wikipedia Coffee → Espresso | done | 1 | 2.2s | yes |  |
| ✅ | X/jev-browser: GitHub newest release | done | 2 | 6.6s | yes |  |
| ✅ | X/jev-browser: Wikipedia search Ristretto | done | 2 | 6.2s | yes |  |
| ❌ | X/Terin: Python tutorial Data Structures | blocked | 6 | 39.7s | no |  |
| ✅ | WebVoyager-style: Wiktionary serendipity | done | 2 | 13.8s | yes |  |
| ❌ | WebVoyager: arXiv Attention Is All You Need | blocked | 7 | 28.6s | no |  |
| ✅ | WebVoyager: Hugging Face whisper-large-v3 | done | 2 | 6.1s | yes |  |
| ✅ | WebVoyager: Wolfram Alpha derivative | done | 3 | 17.9s | yes |  |
| ✅ | WebVoyager-style: Wikibooks Cookbook banana bread | done | 3 | 9.6s | yes |  |
| ✅ | WebVoyager: BBC technology section | done | 1 | 2.4s | yes |  |
| ✅ | Fixture: link that opens a new tab | done | 1 | 3.1s | yes |  |
| ✅ | Fixture: javascript: link reveals content | done | 1 | 2.3s | yes |  |

## Latency

Run 3: median 331 ms over 68 decisions, min 169 ms, max 6570 ms.

A separate direct probe of 25 sequential requests to the same route from the
container was 25/25 successful, median 342 ms, min 302 ms, max 475 ms.

The route is steady when driven directly. The `Failed to fetch` failures in run 3
appeared only from inside the extension's service worker, not from the direct probe.

## Free-tier model access on Vercel

Observed while diagnosing run 2's 403:

- Allowed: `deepseek/deepseek-v3.1`, `deepseek/deepseek-v3.1-terminus`,
  `claude-3-haiku`, `alibaba/qwen3.7-flash`, `moonshotai/kimi-k2`,
  `mistral/mistral-small`, `inclusionai/ling-3.0-flash`,
  `inclusionai/ling-3.0-flash-vl`, `poolside/laguna-s-2.1-free`.
- Refused with HTTP 403: `deepseek/deepseek-v3.2` and every `v4`/`v4.1` deepseek
  model, `claude-haiku-4.5`, `openai/gpt-6-astra`, `alibaba/qwen3.8-flash`,
  `google/gemini-3-flash`.

The rule appears to be that older snapshots are allowed on the free tier and newer
ones are not.

## Conclusion

Decision quality and latency through the gateway are comparable to OpenRouter: no
task failed because Jev chose badly in a way that would have succeeded on another
provider. What differed was transport reliability, which was the actual cause of
failure in two of the three runs, plus one code gap this exposed: `postJson` did not
retry a thrown `fetch` error (DNS failure, connection reset, "Failed to fetch" from
the service worker), only HTTP status codes. That gap is fixed separately (see the
retry change to `src/shared/providers/http.ts`).

The baseline figure of 13/17 referenced above comes from the 2026-09-19 OpenRouter
run (`docs/e2e-suite-2026-09-19.md`). These runs are not a controlled comparison
against it: the target web pages themselves change between runs, independent of
provider.
