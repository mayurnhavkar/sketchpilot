# excalidraw-claude

Open-source [Excalidraw](https://github.com/excalidraw/excalidraw) with an inline **Ask AI** bar. Describe a diagram, or select shapes and describe a change. Model-agnostic: a CLI, a paid API, or a local open-source model.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 103 unit tests, no extra dependencies
npm run aws:icons  # optional: install the official AWS Architecture Icons (or use ⚙ in the app)
```

## What it does

| | |
|---|---|
| **Mermaid first** | Flowcharts, architecture, sequence, state, class and ER diagrams come back as Mermaid and are laid out automatically. Freeform shapes are used for everything else. |
| **Edit by selection** | Select shapes, then "make these red", "rename this to …", "delete this", "add a cache between these". Replies are update/delete operations on real element ids, never a redraw. |
| **One-step undo** | Everything a reply does is a single undo step (⌘Z on Mac). |
| **Streaming + cancel** | Live progress while the model answers; Esc or Cancel aborts the request (and kills a CLI process). |
| **Follow-ups** | The last few requests are sent along, so "now add retries to that" works. |
| **Scenes on disk** | Autosave to plain `.excalidraw` files in `scenes/`, with snapshots of earlier versions (🕘). Open them in any Excalidraw. |
| **File / folder context** | 📎 / 📁 attach text or code. Read in the browser; secrets (`.env`, keys, `node_modules`) are skipped. Warns when the provider is a cloud one. |
| **Image input** | 🖼 or paste a screenshot / whiteboard photo into the bar (vision-capable provider and model). |
| **Style presets** | Hand-drawn, Clean (grid-snapped), Mono, Bold sketch. |
| **AWS architecture** | Professional AWS diagrams with the official icons, groups (Cloud, Region, VPC, zones, subnets), numbered flows and orthogonal routing. See below. |
| **Stats** | Model, time and token counts for each call. |

## AWS architecture diagrams

Mention AWS in a request ("three-tier app on AWS with CloudFront, ALB, EC2 and RDS") and the bar switches to AWS mode (**Diagram: Auto**; force it with **AWS architecture**). To change an existing diagram, select any part of it and describe the change ("add WAF in front of CloudFront"); the diagram is re-laid-out and replaced in place.

How it works, and why it is robust:

1. **The model describes, it never draws.** It returns a small spec: groups (`aws-cloud`, `region`, `vpc`, `az`, `public-subnet`, `private-subnet`, ...), nodes (an exact service slug from the icon catalogue), and edges with optional step numbers. No coordinates, so even small local models produce clean diagrams.
2. **Deterministic layout** (`src/lib/aws/layout.js`): flow tiers read left to right, same-tier siblings such as availability zones stack and mirror each other, everything sits on an 8 px grid.
3. **Orthogonal routing**: A* on that grid with bend and overlap penalties. Arrows leave an icon's east side and enter the next one's west side, vertical neighbours connect bottom to top, and routes never cut through an icon or label.
4. **Official look** (`src/lib/aws/render.js`): AWS Architecture Icons (304 services, 466 resources, 13 group icons), group colours read from AWS's own group icons, flat style, numbered step badges, arrows bound to icons so they follow when you move one.
5. **Validation** (`server/aws.js`): unknown services fall back to a labelled generic box, bad parents/cycles/edges are dropped, common names (`s3`, `alb`, `kms`, ...) resolve to the right icon.

**Icons are not in this repo.** AWS permits using them in architecture diagrams but says nothing about redistribution, so the app downloads the official package onto your machine (14 MB, from `aws.amazon.com/architecture/icons`) into `public/aws-icons` (git-ignored). Install from ⚙ settings, or `npm run aws:icons` (`-- --zip path` for a package you already downloaded). The importer looks up the current release itself, only downloads from `d1.awsstatic.com` over https, and skips any SVG with scripts or external references.

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
ollama pull qwen2.5:7b        # text
ollama pull qwen2.5vl:3b      # vision (then tick "can read images" for Ollama in ⚙)
```

## Security

The dev server binds to 127.0.0.1. `/api/*` also requires a local `Host`, a same-origin `Origin`, and a per-process token embedded in the page, so other websites can't spend your keys, run your CLI or read your scenes. Replies are validated server-side: only whitelisted properties can be changed on existing elements, and only ids that were actually on your canvas. Attached files are wrapped as data, not instructions.

## Layout

```
server/   prompt + reply validation, provider adapters, scenes, AWS catalogue + icon importer, API plugin
src/lib/  pure scene logic (edit ops, ids, style, layout), file readers
src/lib/aws/  layout, routing, AWS renderer, diagram lookup
src/      React UI
test/     node:test suites
scenes/   your drawings (git-ignored)
public/aws-icons/  downloaded AWS icons (git-ignored)
```

## Known limits

- The model places freeform shapes by guesswork; Mermaid is more reliable for graphs.
- Small local models (3B-7B) draw less carefully than large ones; there is one automatic retry.
- Excalidraw's undo does not cover switching scenes (history is cleared on switch; use 🕘 for older saves).
