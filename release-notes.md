# Kanban Swimlanes 1.0.3

- Added Android/mobile-safe Web Animation fallbacks.
- Added long-press header reordering without blocking normal touch scrolling or taps.
- Made essential swimlane, column, and cell actions visible and touch-sized on mobile.
- Added the **Open as Kanban swim board** action to mobile file context menus.
- Made the color picker and mobile navbar integration resilient to mobile runtime differences.
- Aligned release metadata across the manifest, package, and version compatibility map.

## Earlier fork work

- Forked the Obsidian Kanban plugin under plugin id `obsidian-kanban-swimlanes`.
- Added markdown-backed `swimlanes-v1` boards using `# Swimlane` and `## Column` headings.
- Added static swimlane rendering, cell drop targets, and card drag/drop across cells.
- Added UI for swimlane and column creation, rename, delete, reorder, collapse, and colors.
- Added card colors and compact, preview, and expanded display modes for linked-note cards.
- Added note search insertion as wikilink cards without writing metadata/frontmatter to linked notes.
- Kept classic `## Column` boards loadable for backward compatibility.
