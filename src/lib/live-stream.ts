// Cloudflare Stream Live integration.
// Phase 1C+ Path C: real-time multi-coach live streaming via WHIP (WebRTC ingest)
// + HLS playback for other coaches.
//
// Flow:
//   1. Coach hits "Go Live" → POST /api/live/create-input → server provisions
//      a Cloudflare Stream Live Input, returns whipUrl (ingest) + uid.
//   2. Browser pushes its tracks (getDisplayMedia / getUserMedia) to the
//      whipUrl via WebRTC using `pushToWhip()`.
//   3. Cloudflare transcodes + serves HLS automatically.
//   4. Other coaches' Lab clients see /videos/{periodId} change to
//      { isLive: true, liveUid, hlsUrl } and play HLS via hls.js.
//   5. On stop: WebRTC tracks stop, Cloudflare auto-records the live as a
//      regular Stream video. /videos doc updates with the recorded video URL.

import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const VIDEOS_COLLECTION = "videos";

export interface LiveInputDetails {
  uid: string;
  whipUrl: string;
  whepUrl: string | null;
  /** HLS playback URL — what other coaches' browsers play via hls.js (or Safari native). */
  hlsUrl: string | null;
  rtmpsUrl: string | null;
  rtmpsKey: string | null;
}

/** Provision a live input on Cloudflare via our server route. */
export async function createLiveInput(
  periodId: string,
  teamId: string,
  label: string
): Promise<LiveInputDetails> {
  const res = await fetch("/api/live/create-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodId, teamId, label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`createLiveInput failed: ${JSON.stringify(err)}`);
  }
  return (await res.json()) as LiveInputDetails;
}

/**
 * Push a MediaStream to Cloudflare Stream via WHIP (WebRTC-HTTP Ingestion).
 * Returns the RTCPeerConnection so the caller can stop it later.
 */
export async function pushToWhip(
  stream: MediaStream,
  whipUrl: string
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    bundlePolicy: "max-bundle",
  });

  // Add all tracks from the stream
  for (const track of stream.getTracks()) {
    pc.addTransceiver(track, { direction: "sendonly" });
  }

  // Create + set local offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete so the offer SDP is fully populated
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
    // Safety timeout — don't wait forever for ICE
    setTimeout(resolve, 3000);
  });

  // POST the SDP to the WHIP endpoint
  const sdpResponse = await fetch(whipUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? "",
  });
  if (!sdpResponse.ok) {
    pc.close();
    throw new Error(`WHIP push failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
  }
  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return pc;
}

/** Update Firestore /videos/{periodId} to point at the live stream. */
export async function markVideoLive(
  periodId: string,
  teamId: string,
  uid: string,
  hlsUrl: string,
  ownerId: string
): Promise<void> {
  await setDoc(
    doc(db, VIDEOS_COLLECTION, periodId),
    {
      periodId,
      teamId,
      liveUid: uid,
      hlsUrl,
      isLive: true,
      uploadedBy: ownerId,
      uploadedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Mark the live ended — Cloudflare auto-records the VOD with the same uid, so HLS URL stays valid. */
export async function markVideoLiveEnded(periodId: string): Promise<void> {
  await updateDoc(doc(db, VIDEOS_COLLECTION, periodId), {
    isLive: false,
  });
}
