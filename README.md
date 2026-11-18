# Sketchpilot

An open-source AI layer for [Excalidraw](https://github.com/excalidraw/excalidraw): an inline **Ask AI** bar on top of the real editor. Describe a diagram, or select shapes and describe a change. Model-agnostic: a CLI, a paid API, or a local open-source model.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 165 unit tests
npm run aws:icons  # optional: install the official AWS Architecture Icons (or use settings in the app)
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
| **Notes** | "Write me notes on linked lists in Python" produces a laid-out study page: title, pointer diagrams, key ideas, syntax-coloured code cards, complexity tables, gotchas, steps and practice questions. Select a card and ask for changes ("add a section on cycle detection") and the note is updated in place. See below. |
| **AWS architecture** | Professional AWS diagrams with the official icons, groups (Cloud, Region, VPC, zones, subnets), numbered flows and orthogonal routing. See below. |
| **Stats** | Model, time and token counts for each call. |

## Notes

Ask for notes, a cheat sheet, a study guide or flashcards and the bar switches to Notes mode (**Output: Auto**; force it with **Notes**).

The model writes the content as a small spec (sections of type `points`, `code`, `table`, `callout`, `steps`, `qa`, and `chain` pictures of data structures such as linked lists, doubly linked lists, arrays and flows). It never positions anything: `src/lib/notes/render.js` lays the page out deterministically, a title block, full-width pictures, then a three-column grid of cards sized to their content.

- **Code cards** are real monospace code with syntax colours. Excalidraw has no rich text, so each colour is its own transparent text layer on the same grid (`src/lib/notes/highlight.js`): 3-5 elements per card, and the layers always line up. Supports Python, JavaScript/TypeScript, Java/C#/Kotlin, C/C++, Go, Rust, SQL, Bash and JSON.
- **Pictures** for linked structures show `head`/`tail` pointers, `[data | next]` cells, the `None` terminator and, for doubly linked lists, `prev` and `next` links.
- **Cards are groups**, so a card moves as one piece.
- **Edit in place:** select any part of a note and describe the change; the model returns the full updated note and it replaces the old one.
- Everything is validated server-side (`server/notes.js`): section types, sizes and counts are capped, markdown is stripped, code fences removed. Attached files are treated as data, not instructions.

One thing worth knowing: Excalidraw sizes a text element from whichever font is loaded when it is created and clips text to that width. The notes renderer waits for the fonts and then sets monospace sizes exactly, which is what keeps code from being cut off.

## AWS architecture diagrams

Mention AWS in a request ("three-tier app on AWS with CloudFront, ALB, EC2 and RDS") and the bar switches to AWS mode (**Diagram: Auto**; force it with **AWS architecture**). To change an existing diagram, select any part of it and describe the change ("add WAF in front of CloudFront"); the diagram is re-laid-out and replaced in place.

How it works, and why it is robust:

1. **The model describes, it never draws.** It returns a small spec: groups (`aws-cloud`, `region`, `vpc`, `az`, `public-subnet`, `private-subnet`, ...), nodes (an exact service slug from the icon catalogue), and edges with optional step numbers. No coordinates, so even small local models produce clean diagrams.
2. **Deterministic layout** (`src/lib/aws/layout.js`): flow tiers read left to right, same-tier siblings such as availability zones stack and mirror each other, everything sits on an 8 px grid.
3. **Orthogonal routing**: A* on that grid with bend and overlap penalties. Arrows leave an icon's east side and enter the next one's west side, vertical neighbours connect bottom to top, and routes never cut through an icon or label.
4. **Official look** (`src/lib/aws/render.js`): AWS Architecture Icons (304 services, 466 resources, 13 group icons), group colours read from AWS's own group icons, flat style, numbered step badges, arrows bound to icons so they follow when you move one.
5. **Validation** (`server/aws.js`): unknown services fall back to a labelled generic box, bad parents/cycles/edges are dropped, common names (`s3`, `alb`, `kms`, ...) resolve to the right icon.

**Icons are not in this repo.** AWS permits using them in architecture diagrams but says nothing about redistribution, so the app downloads the official package onto your machine (14 MB, from `aws.amazon.com/architecture/icons`) into `public/aws-icons` (git-ignored). Install from settings (sliders icon), or `npm run aws:icons` (`-- --zip path` for a package you already downloaded). The importer looks up the current release itself, only downloads from `d1.awsstatic.com` over https, and skips any SVG with scripts or external references.

## Export to Obsidian (or any Markdown tool)

The download icon next to the scene menu exports what you are looking at: the selected note or AWS diagram, else the only one on the canvas, else the whole scene.

| Button | Writes |
|---|---|
| **Save Markdown + image** | `Name.md` (frontmatter with tags, headings, code fences, tables, `[!callout]`s, foldable Q&A flashcards, an AWS spec block) and `Name.svg` (embedded in the note; the scene is inside the SVG, so it can be reopened and edited) |
| **Save editable drawing** | `Name.excalidraw.md`: your notes on top, the editable drawing below, in the format of Obsidian's Excalidraw plugin |
| **Copy Markdown** | the Markdown on the clipboard |

Files go to `EXCALIDRAW_EXPORT_DIR` (default: the scenes folder). Point it at an Obsidian vault folder.

- **Links:** other notes already in the folder whose title appears in the text are listed under `## Related` as `[[links]]`.
- **Your edits are safe:** if a file already exists and differs, the old version is copied to `.export-history/<name>/` (a dot folder, hidden from Obsidian) before it is replaced. An unchanged file is not rewritten. The `created` date is kept.
- **Escaping:** pipes in table cells are escaped (an unescaped one silently drops the next cell), and `[[` in ordinary text is neutralised so it does not turn into a link.
- **Scene files** (`.excalidraw`) also open in the Excalidraw plugin directly (compatibility mode).

Tested against the real Obsidian app with the Excalidraw plugin 2.29.0: files open, links and embeds resolve, tags and properties parse, the drawing round-trips through a plugin save with all 172 elements (notes) and all 21 icon images (AWS), and re-exporting does not duplicate anything. Two things to know:

1. The plugin rewrites any text id that is not 8 characters. The drawing export therefore shortens text ids deterministically, so a re-export carries the same ids and never duplicates labels.
2. Close a drawing in Obsidian before exporting it again. Re-exporting while it is open and has unsaved edits can leave it in a mixed state (some icons as placeholders until it is reopened). Nothing is lost: your version is in `.export-history`.

## Providers

| Type | Covers |
|---|---|
| `anthropic` | Anthropic Messages API |
| `openai-compat` | OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, Gemini (compat), Ollama, LM Studio, vLLM, llama.cpp |
| `cli` | Any command: `claude -p`, or your own (see `providers.config.js`) |

Configuration layers, later wins:

1. `providers.config.js` (code defaults)
2. `~/.config/sketchpilot/providers.json` (written by the Settings panel (sliders icon); owner-only file, holds UI-entered keys)
3. `.env` / environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, see `.env.example`), used when no key was saved in the UI

Keys never go back to the browser. CLI commands can only be defined in `providers.config.js` or by hand-editing the config file, never from the UI.

### Ollama

```bash
ollama pull qwen2.5:7b        # text
ollama pull qwen2.5vl:3b      # vision (then tick "can read images" for Ollama in the settings)
```

## Security

The dev server binds to 127.0.0.1. `/api/*` also requires a local `Host`, a same-origin `Origin`, and a per-process token embedded in the page, so other websites can't spend your keys, run your CLI or read your scenes. Replies are validated server-side: only whitelisted properties can be changed on existing elements, and only ids that were actually on your canvas. Attached files are wrapped as data, not instructions.

## Layout

```
server/   prompt + reply validation, provider adapters, scenes, AWS catalogue + icon importer, API plugin
src/lib/  pure scene logic (edit ops, ids, style, layout), file readers
src/lib/aws/  layout, routing, AWS renderer, diagram lookup
src/lib/notes/  note renderer, syntax highlighter, note lookup
src/lib/export/  Markdown builders, Obsidian plugin file format, export target
server/export.js  safe writes into a vault folder
src/      React UI
test/     node:test suites
scenes/   your drawings (git-ignored)
public/aws-icons/  downloaded AWS icons (git-ignored)
```

## Known limits

- The model places freeform shapes by guesswork; Mermaid is more reliable for graphs.
- Small local models (3B-7B) draw less carefully than large ones; there is one automatic retry.
- Excalidraw's undo does not cover switching scenes (history is cleared on switch; use 🕘 for older saves).

## Credits and license

Sketchpilot is an addition to the open-source [Excalidraw](https://github.com/excalidraw/excalidraw) project (MIT) and embeds the `@excalidraw/excalidraw` editor; the drawing canvas, hand-drawn style and `.excalidraw` file format are theirs. Mermaid conversion uses `@excalidraw/mermaid-to-excalidraw`. AWS icons are downloaded from AWS's own package and are not redistributed here.

Released under the [MIT License](LICENSE). Not affiliated with or endorsed by Excalidraw or AWS.
