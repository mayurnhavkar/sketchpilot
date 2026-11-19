# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately with GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting). Include what you found, how to reproduce it, and the impact if you can.

You can expect an acknowledgement within about a week. Sketchpilot is maintained by one person, so fixes are best effort.

## What is in scope

- The local dev server and its API routes (`server/`), including file reads, folder reads and exports to a vault folder.
- Handling of provider keys saved in `~/.config/sketchpilot/providers.json` and in `.env`.
- Prompt-injection paths where attached files or canvas text could change what the app does outside the canvas.

## Good to know

- Sketchpilot is meant to run on your own machine (`127.0.0.1`). It is not designed to be exposed to the internet.
- The `cli` provider type runs a command you configured by hand. It cannot be created from the UI on purpose.
- Attached files are sent to whichever provider you picked. Use a local model for private code.
