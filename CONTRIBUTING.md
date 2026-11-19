# Contributing to Sketchpilot

Thanks for helping. Sketchpilot is an open-source AI layer on top of [Excalidraw](https://github.com/excalidraw/excalidraw).

## Run it locally

```bash
npm install
npm run dev     # http://127.0.0.1:5173
npm test        # unit tests (node:test)
```

Add a provider in the Settings panel (sliders icon) or in `.env`. Copy `.env.example` to start. Never commit real keys.

## Pull requests

- Open an issue first for anything bigger than a small fix, so we agree on the approach.
- Keep a PR to one change. Add or update tests in `test/` for logic you touch (`npm test` must pass).
- The model should describe, and code should lay out and validate. Please keep that split: new output types should return a small spec that server-side code validates, not raw coordinates.
- Do not commit scenes (`scenes/`), AWS icons (`public/aws-icons/`), `.env` files or API keys. They are git-ignored on purpose.
- Match the existing style. No new dependency without a reason in the PR description.

## Reviews

`main` is protected: changes land through a pull request that the maintainer approves. Reviews may take a few days.

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

By contributing you agree your work is released under the [MIT License](LICENSE).
