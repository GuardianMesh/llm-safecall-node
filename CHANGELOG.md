# Changelog

## 0.4.0 — unreleased

- **Breaking:** Require Zod 4 schemas for `outputSchema` and `ToolRunner`. Consumers using Zod 3 must upgrade their direct dependency to `zod@^4.6.7` and migrate their schemas before upgrading to 0.4.0. These changes have not been published.
- Validate retry and timeout options, enforce the configured retry count, and disable hidden SDK retries.
- Apply policy and moderation to decoded JSON and transformed schema values; recheck tool fallback defaults.
- Send JSON Schema guidance with model requests and limit repair to one JSON/schema failure.
- Admit each retry, repair and stream against the rate and available budget; persist actual reported charges.
- Bound streamed output, moderate each chunk, and surface blocked chunks in strict mode.
- Reject oversized output before returning a prefix and avoid retrying permanent provider errors.
- Replace the retired Anthropic default and omit unsupported sampling parameters.
- Apply input policy and moderation to repair prompts before another provider call.
- Make CLI failures nonzero by default, validate schema fields, and send diagnostic logs to stderr.
- Validate sanitized tool arguments before dispatch and support plain string result schemas.
- Reject invalid rate and budget charges, use monotonic refill time, and validate direct policy configuration.
- Install and exercise packed public types, API and CLI without optional SDKs; add minimum-runtime consumer checks.
- Add runnable JavaScript setup examples and explain explicit `.env` loading with Node.
- Isolate cache entries by `SafeCall` instance and recheck cached output before returning it.
- Bound cache storage by entry count and serialized size, with FIFO eviction.
- Reject encoded URL path separators and directory-prefix lookalikes.
- Reject unknown provider names before selecting an API client.
- Pin CI actions and require a reviewed release environment after building and checking packages.
- Correct policy examples, fallback behavior, and package links in the documentation.
- Reject unknown YAML policy fields and invalid values instead of silently ignoring them.
- Match URL scheme and authority before applying output path prefixes.
- Return nonzero CLI status for configuration and argument errors.
- Apply configured timeouts to built-in provider requests.
- Require tests, linting, type checks, and formatting checks in CI and before releases.
- Update Zod, the OpenAI SDK, and test tooling to resolve dependency advisories.
- Keep default caches in memory so separate callers do not share results through the working directory.
