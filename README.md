# pi-kimi-web-tools

Kimi-backed `web_search` and `web_fetch` tools for the
[pi](https://github.com/earendil-works/pi-mono) coding agent, ported from
[MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) (MIT).

- `web_search` — web search via the Kimi for Coding search service.
- `web_fetch` — URL to main-text markdown via the Kimi fetch service, with an
  SSRF-guarded local fetcher (Readability extraction) as fallback.
- The tools are injected only while the active model is a Kimi model and Kimi
  credentials are available.

## Install

```bash
pi install git:github.com/Fr4nk1inCs/pi-kimi-web-tools
```

Requires a Kimi for Coding credential: `/login kimi-coding` in pi, or set
`KIMI_API_KEY` / `MOONSHOT_API_KEY`.

## Development

```bash
nix develop    # node + formatters; also installs the git hooks
npm install
npm run verify # typecheck + biome (lint/format) + vitest
```

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/),
enforced by a commitizen commit-msg hook.

## Disclaimer

All code in this repository was written by an LLM (Kimi K3) under human
direction.

## License

MIT. Contains code ported from MoonshotAI/kimi-code (MIT, © Moonshot AI).
