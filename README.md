# Kanban Swimlanes

Markdown-backed Kanban boards for Obsidian with first-class horizontal swimlanes.

This is a fork of [`obsidian-community/obsidian-kanban`](https://github.com/obsidian-community/obsidian-kanban). The plugin id is `obsidian-kanban-swimlanes`, so it can be installed next to the original Kanban plugin for testing.

## Swimlane Format

Swimlane boards are stored in the board markdown file:

```md
---
kanban-plugin: board
kanban-format: swimlanes-v1
---

# Work

## Todo
- [ ] [[Note A]]

## Doing

## Done

# Personal

## Todo

## Doing

## Done
```

- `# H1` headings are swimlanes.
- `## H2` headings are columns inside each swimlane.
- Cards remain normal Markdown task/list items.
- Linked notes are represented as wikilink cards; the board does not write metadata to linked notes.

## Current Features

- Add, rename, delete, recolor, collapse, and reorder swimlanes.
- Add, rename, delete, recolor, and reorder columns across all swimlanes.
- Drag cards within a cell, across columns, across swimlanes, and across both dimensions.
- Add an existing note to a cell as a `[[wikilink]]` card.
- Compact, preview, and expanded card display modes, including editable linked-note previews.
- Backward-compatible loading of classic `## Column` Kanban boards.

## Development

```sh
npm install
npm run typecheck
npm run lint
npm run build
```

The release artifact for Obsidian is:

- `manifest.json`
- `main.js`
- `styles.css`

## Mobile

The plugin supports Obsidian Mobile. On Android, tap a swimlane or column header to open its
menu, or long-press and drag the header to reorder it. Card drag-and-drop uses the inherited
long-press gesture from the original Kanban plugin. Long-pressing a recognized board file in
the file explorer also provides **Open as Kanban swim board**.

For a manual mobile installation, place the three release artifacts in
`.obsidian/plugins/obsidian-kanban-swimlanes/`, then restart Obsidian and enable **Kanban
Swimlanes** under **Settings → Community plugins**.
