// POST /api/live/create-input
// Creates a Cloudflare Stream Live Input on demand for the coach about to start
// a live capture session. Returns the WHIP ingest URL the browser uses for
// WebRTC push, plus the HLS playback URL other coaches use to watch.
//
// Auth: the API token is read from env (server-only). The client doesn't see it.
// TODO Phase 1C.5: verify the requesting user's Firebase ID token + team
// membership before creating an input (currently any client can hit this route).

import { NextRequest, NextResponse } from "next/server";

interface CloudflareLiveInputResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: {
    uid: string;
    webRTC?: { url: string };
    webRTCPlayback?: { url: string };
    rtmps?: { url: string; streamKey: string };
    rtmpsPlayback?: { url: string };
    srt?: { url: string; streamId: string; passphrase: string };
    srtPlayback?: { url: string; streamId: string; passphrase: string };
    created: string;
    modified: string;
    meta: Record<string, string>;
    recording: {
      mode: string;
      timeoutSeconds: number;
      requireSignedURLs: boolean;
    };
  };
}

export async function POST(req: NextRequest) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) {
    return NextResponse.json(
      { error: "Cloudflare Stream credentials not configured on server" },
      { status: 500 }
    );
  }

  let body: { periodId?: string; teamId?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { periodId, teamId, label } = body;
  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }

  // Create a live input. recording.mode=automatic means Cloudflare keeps the
  // live stream as a VOD after it ends — perfect for our "play it back at
  // intermission" use case.
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta: {
          periodId,
          teamId: teamId ?? "",
          label: label ?? `District Lab live ${periodId}`,
        },
        recording: {
          mode: "automatic",
          timeoutSeconds: 10,
          requireSignedURLs: false,
        },
      }),
    }
  );

  const data = (await res.json()) as CloudflareLiveInputResponse;
  if (!data.success || !data.result) {
    return NextResponse.json(
      {
        error: "Cloudflare API call failed",
        details: data.errors,
      },
      { status: 500 }
    );
  }

  // Derive the customer subdomain from the WebRTC playback URL Cloudflare returns.
  // whepUrl looks like https://customer-xyz.cloudflarestream.com/{uid}/webRTC/play
  // → we strip the path to get https://customer-xyz.cloudflarestream.com
  // → then HLS URL is {subdomain}/{uid}/manifest/video.m3u8
  let hlsUrl: string | null = null;
  const whepUrl = data.result.webRTCPlayback?.url;
  if (whepUrl) {
    try {
      const u = new URL(whepUrl);
      hlsUrl = `${u.protocol}//${u.host}/${data.result.uid}/manifest/video.m3u8`;
    } catch {
      // ignore, hlsUrl stays null
    }
  }

  return NextResponse.json({
    uid: data.result.uid,
    whipUrl: data.result.webRTC?.url ?? null,
    whepUrl: whepUrl ?? null,
    hlsUrl,
    rtmpsUrl: data.result.rtmps?.url ?? null,
    rtmpsKey: data.result.rtmps?.streamKey ?? null,
  });
}
