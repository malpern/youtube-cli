# 0003 Verify Via Playlist Page Inventory

- Status: accepted

## Context

The migration needs a verification phase before any destructive deletion can be considered.

The copy flow uses the watch-page save panel because that is the most reliable place to add a video to a playlist in the authenticated YouTube UI. That save panel is useful for mutation, but it is a poor source of truth for verification:

- it only shows playlists for one current video
- it does not expose the full target playlist ordering
- it does not help detect missing, duplicate, or reordered items across the copied set

We needed a verification path that stays inside the real YouTube UI, avoids reverse-engineered APIs, and gives a stable ordered inventory of the target playlist.

## Decision

Verification inventories the target playlist from YouTube's own playlist page.

The implementation resolves the target playlist page URL by:

1. opening `/feed/playlists`
2. finding the playlist link by exact visible title
3. extracting the `list` query parameter
4. converting that into the canonical `/playlist?list=<id>` URL

Once on the playlist page, verification reuses the same `ytd-playlist-video-renderer` row parser that is already used for Watch Later inventory.

The first verification implementation compares the ordered target prefix against the ordered source prefix for the bounded subset under test.

## Consequences

- verification stays within the authenticated YouTube UI
- the same extraction logic is reused for source and target playlists
- ordered comparison is simple and inspectable
- target playlist ordering can be validated directly instead of inferred from modal state

Current limitation:

- the comparator currently checks ordered prefixes for bounded runs; it is not yet the final full-run discrepancy engine for missing, duplicate, and reordered items across the entire 5,000-item migration
