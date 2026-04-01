export interface PlaylistMetadataSummary {
  playlistId: string | null;
  title: string;
  visibility: string | null;
  videoCount: number | null;
}

export interface PlaylistMetadata {
  playlistId: string | null;
  videoCount: number | null;
}

export interface PlaylistMetadataIndex {
  byExactKey: Map<string, PlaylistMetadata>;
  byUniqueTitle: Map<string, PlaylistMetadata>;
}

export function buildPlaylistMetadataIndex(
  summaries: PlaylistMetadataSummary[]
): PlaylistMetadataIndex {
  const byExactKey = new Map<string, PlaylistMetadata>();
  const byUniqueTitle = new Map<string, PlaylistMetadata>();
  const titleCounts = new Map<string, number>();

  for (const summary of summaries) {
    const exactKey = makePlaylistLookupKey(summary.title, summary.visibility);
    if (!byExactKey.has(exactKey)) {
      byExactKey.set(exactKey, {
        playlistId: summary.playlistId,
        videoCount: summary.videoCount
      });
    }

    titleCounts.set(summary.title, (titleCounts.get(summary.title) ?? 0) + 1);
  }

  for (const summary of summaries) {
    if ((titleCounts.get(summary.title) ?? 0) !== 1) {
      continue;
    }

    byUniqueTitle.set(summary.title, {
      playlistId: summary.playlistId,
      videoCount: summary.videoCount
    });
  }

  return {
    byExactKey,
    byUniqueTitle
  };
}

export function resolvePlaylistMetadata(
  index: PlaylistMetadataIndex,
  title: string,
  visibility: string | null
): PlaylistMetadata | null {
  const exactKey = makePlaylistLookupKey(title, visibility);
  if (index.byExactKey.has(exactKey)) {
    return index.byExactKey.get(exactKey) ?? null;
  }

  return index.byUniqueTitle.get(title) ?? null;
}

function makePlaylistLookupKey(title: string, visibility: string | null): string {
  return `${title}\u0000${visibility ?? ""}`;
}
