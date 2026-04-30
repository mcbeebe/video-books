# API Keys

Real keys live in `.env` at the repo root. Never commit them. The `.gitignore` excludes `.env*` (with an explicit allow-list for `.env.example`).

## Required for `wcap render`

| Var                   | Where to obtain                                                  | Estimated pilot cost |
| --------------------- | ---------------------------------------------------------------- | -------------------- |
| `FAL_KEY`             | https://fal.ai/dashboard/keys (free signup; pay-as-you-go)       | ~$10–30 for pilot    |
| `ELEVENLABS_API_KEY`  | https://elevenlabs.io/api → Profile → API Key                    | ~$22/mo Creator plan |
| `ELEVENLABS_VOICE_ID` | https://elevenlabs.io/voice-library → pick a voice → copy the ID | included in plan     |

`FAL_KEY` is used for both image (`fal-ai/flux-pro/v1.1`) and video (`fal-ai/kling-video/*`, `veo3/lite`, `seedance/v2/fast`). One key, all three.

## Setup

1. Copy the template:

   ```sh
   cp .env.example .env
   ```

2. Open `.env` in your editor and paste the values.

3. Verify:

   ```sh
   pnpm wcap validate content/chapters/fixture.spec.json
   pnpm wcap cost     content/chapters/fixture.spec.json
   ```

   Both work without keys. `wcap render` will fail fast (with a clear message) until `.env` is populated.

## Verifying endpoint shapes before spending

The image and video clients ship with **assumed** model paths (`fal-ai/flux-pro/v1.1`, `fal-ai/kling-video/v3/std`, etc.). fal.ai iterates these slugs frequently — verify each against https://fal.ai/models before running the bulk smoke. The smoke scripts (see `scripts/smoke-*.ts`) hit one endpoint each so you can confirm the response shape matches without spending much.

If a model path is wrong, the client returns `bad-response` (or a 404) — the smoke script prints it loud.

## Security

- `.env` is gitignored; double-check with `git status` before any push.
- Never log API keys. The clients accept them via config and don't echo them.
- For shared development, use https://github.com/mcbeebe/video-books/settings/secrets/actions to inject keys into CI (we don't do this yet — the smoke is a manual operation).
- Rotate keys quarterly and immediately if a `.env` ever lands in a commit (use `git filter-repo`, force-push, then rotate).

## Cost ceilings

`wcap render --max-cost 50` refuses to proceed if the estimate exceeds $50. Override with `--confirm`. The architecture's pilot budget is $500 and realistic cost is ~$143 (per `CLAUDE.md`).
