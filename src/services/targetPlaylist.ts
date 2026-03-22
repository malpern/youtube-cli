import type { Page } from "playwright";

import { resolvePlaylistFeedSummary } from "../browser/youtube/playlistDiscovery.js";
import type { PlaylistTarget } from "../browser/youtube/saveToPlaylist.js";

export interface TargetPlaylistRequest {
  targetPlaylist: string;
  targetPlaylistId: string | null;
}

export function getTargetPlaylistRequest(
  options: {
    targetPlaylist?: string;
    targetPlaylistId?: string;
  },
  fallback = "Old Watch"
): TargetPlaylistRequest {
  const targetPlaylist = options.targetPlaylist?.trim() || fallback;
  const trimmedId = options.targetPlaylistId?.trim();

  return {
    targetPlaylist,
    targetPlaylistId: trimmedId && trimmedId.length > 0 ? trimmedId : null
  };
}

export function appendTargetPlaylistArgs(args: string[], request: TargetPlaylistRequest): void {
  args.push("--target-playlist", request.targetPlaylist);
  if (request.targetPlaylistId) {
    args.push("--target-playlist-id", request.targetPlaylistId);
  }
}

export async function resolveTargetPlaylistForSavePanel(
  page: Page,
  youtubeBaseUrl: string,
  request: TargetPlaylistRequest
): Promise<PlaylistTarget> {
  if (!request.targetPlaylistId) {
    return {
      title: request.targetPlaylist
    };
  }

  const summary = await resolvePlaylistFeedSummary(page, youtubeBaseUrl, {
    playlistId: request.targetPlaylistId,
    playlistName: request.targetPlaylist
  });

  if (!summary) {
    throw new Error(
      `Target playlist id '${request.targetPlaylistId}' could not be resolved on the Playlists feed page.`
    );
  }

  return {
    title: summary.title,
    visibility: summary.visibility,
    playlistId: summary.playlistId ?? request.targetPlaylistId
  };
}
