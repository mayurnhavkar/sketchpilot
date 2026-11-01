# excalidraw-claude

Open-source [Excalidraw](https://github.com/excalidraw/excalidraw) with an inline "Ask AI" bar that draws diagrams from a prompt. Model-agnostic: use a CLI, a paid API, or a local open-source model.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

## Providers

| Type | Covers |
|---|---|
| `anthropic` | Anthropic Messages API |
| `openai-compat` | OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, Gemini (compat), Ollama, LM Studio, vLLM, llama.cpp |
| `cli` | Any command: `claude -p`, or your own (see `providers.config.js`) |

Configuration layers, later wins:

1. `providers.config.js` (code defaults)
2. `~/.config/excalidraw-claude/providers.json` (written by the ⚙ Settings panel; owner-only file, holds UI-entered keys)
3. `.env` / environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, see `.env.example`), used when no key was saved in the UI

Keys never go back to the browser. CLI commands can only be defined in `providers.config.js` or by hand-editing the config file, never from the UI.

### Ollama

```bash
ollama pull qwen2.5:7b
```

Select "Ollama (local)" in the bar. No key needed.

## Security

The dev server binds to 127.0.0.1. `/api/*` also requires a local `Host`, a same-origin `Origin`, and a per-process token embedded in the page, so other websites can't spend your keys or run your CLI.
