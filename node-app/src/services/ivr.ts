import type { Client, Channel } from "ari-client";
import { queueManager } from "./queue.js";

/**
 * Handles playing the IVR greeting, listening for DTMF keypresses,
 * and routing callers to their selected department queue.
 */
export async function handleIvrMenu(
  client: Client,
  callerChannel: Channel,
  callerNumber: string,
) {
  console.log(`[IVR] Caller ${callerNumber} entered IVR Hotline (8000)`);

  // Allow 750ms for WebRTC ICE/DTLS handshake and browser audio track to fully open
  await new Promise((resolve) => setTimeout(resolve, 750));

  const playback = client.Playback();

  playback.on("PlaybackStarted", () => {
    console.log("[IVR] Playback started successfully by Asterisk!");
  });

  playback.on("PlaybackFinished", () => {
    console.log(`[IVR] Playback finished. State: ${playback.state || "unknown"}`);
  });

  try {
    await callerChannel.play({ media: "sound:greeting" }, playback);
    console.log("[IVR] Dispatched play request for sound:greeting");
  } catch (err: any) {
    console.warn("[IVR] Playback dispatch error:", err.message);
  }

  // Listen for DTMF keypad presses
  callerChannel.on("ChannelDtmfReceived", async (event: any) => {
    const digit = event.digit;
    console.log(`[IVR] Caller ${callerNumber} pressed key: ${digit}`);

    // Stop greeting audio immediately
    try {
      await playback.stop();
    } catch (e) {}

    if (digit === "1") {
      // Option 1 -> Sales Queue (Agent 1001)
      console.log("[IVR] Option 1 -> Routing to Sales Queue");
      await queueManager.enqueue(client, "sales", callerChannel);
    } else if (digit === "2") {
      // Option 2 -> Support Queue (Agent 1002)
      console.log("[IVR] Option 2 -> Routing to Support Queue");
      await queueManager.enqueue(client, "support", callerChannel);
    } else {
      console.log(`[IVR] Invalid key "${digit}". Playing invalid sound.`);
      const errPlayback = client.Playback();
      try {
        await callerChannel.play({ media: "sound:pbx-invalid" }, errPlayback);
      } catch (e) {}
    }
  });
}
