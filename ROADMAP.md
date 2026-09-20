# Roadmap

What is planned, roughly in order. Nothing here is promised; items move when the store review or user reports change the priorities. Open an issue or a discussion if you want something moved up.

## Now

- Chrome Web Store: 1.5.1 submitted with the `debugger` permission (trusted input). Once listed, the store link goes into the README and the awesome-list entries.
- Re-run the 17-task suite on 1.5.0 and update the results table. The last recorded run was 13/17 on 1.4.x with synthetic events; trusted input should help the sites that ignore scripted clicks.
- If the store rejects `<all_urls>`: switch to `optional_host_permissions`, ask for the current site when a run starts, and pause on a cross-site navigation until the user grants the new site from the popup.

## Let other agents use it

Jev is a one-second, near-free executor. It makes most sense underneath a large model that plans, the way jev-ultrafast is described. Three ways in, most useful first:

1. **MCP server** (`jev-for-chrome-mcp`, npm). A stdio MCP server that opens a localhost WebSocket; the extension connects to it when "Allow local agents" is on in Options. One tool, `jev_run(goal, url?)`, returns the final status and the trace. Claude Code, Cursor, Claude Desktop and any other MCP client can then hand "do this on the current tab" to Jev and keep the large model for planning. No new extension permissions, no native messaging host to register: the user runs `npx jev-for-chrome-mcp`. Listing it in the MCP directories is also a way for people to find the extension.
2. **Extension-to-extension messages.** Listen on `chrome.runtime.onMessageExternal` so another extension that knows the ID can start a run with `{ goal }` and receive progress. Small, but only useful to someone writing their own extension.
3. **Web page access.** `externally_connectable` for named origins, so a web console (or a demo page) can start runs and show the trace.

## Page coverage

- Elements inside same-origin iframes: observe them with frame offsets and dispatch trusted input at the translated point. Cross-origin frames stay out of scope.
- Open shadow roots: walk them during observation; trusted input already lands on whatever is at the point.
- Hover-only menus: the pointer now really moves, so they open; the observation after a click should look for what appeared under the pointer and offer it.
- Natively hidden checkboxes and radios styled through their label: offer the label as the click target.
- File inputs, drag and drop, canvas UIs: not planned.

## Model side

- Ask for the next two or three actions when the page is unlikely to change (form filling), and execute them in one step while the page fingerprint stays the same.
- A second opinion on DONE from the text helper on long runs, using the last few observations, when the goal check and the operation head disagree.
- Per-site notes the user can save in Options ("on this site, the search box is …"), sent as part of the task state.

## Quality of life

- Popup: pause/resume, and "run from here" on a step of the trace.
- Options: import/export settings without the keys.
- Locale strings for the popup and options (the pages are English only; the READMEs exist in English and Chinese).

## Done

See [CHANGELOG.md](CHANGELOG.md).
