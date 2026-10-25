import type { Client, Channel, Bridge } from "ari-client";
import { APP_NAME } from "../config.js";
import { queueManager } from "./queue.js";

function playAudio(
  client: Client,
  channel: Channel,
  media: string,
): Promise<void> {
  return new Promise((resolve) => {
    const playback = client.Playback();
    playback.on("PlaybackFinished", () => resolve());
    channel.play({ media }, playback).catch(() => resolve());
  });
}

/**
 * Bridges an incoming caller with a target agent extension.
 * Calls onCallEnded when the call terminates (hung up or rejected).
 */
export async function connectCallerWithAgent(
  client: Client,
  callerChannel: Channel,
  agentExt: string,
  onCallEnded?: (agentExt: string) => void,
  playMohWhileRinging: boolean = false,
) {
  console.log(`[ROUTER] Connecting caller ${callerChannel.id} with Agent ${agentExt}...`);

  let bridge: Bridge;
  try {
    bridge = await client.bridges.create({ type: "mixing" });
    await bridge.addChannel({ channel: callerChannel.id });
  } catch (err: any) {
    console.warn(`[WARN] Failed creating mixing bridge: ${err.message}`);
    onCallEnded?.(agentExt);
    return;
  }

  // Play Hold Music to caller while waiting for agent to answer (Option 2)
  if (playMohWhileRinging) {
    try {
      await callerChannel.startMoh({ mohClass: "default" });
      console.log(`[ROUTER] Playing Hold Music for caller ${callerChannel.id} while Agent ${agentExt} rings`);
    } catch (e: any) {
      console.warn(`[WARN] Failed starting MOH while ringing: ${e.message}`);
    }
  }

  let dialedChannel: Channel;
  try {
    dialedChannel = await client.channels.originate({
      endpoint: `PJSIP/${agentExt}`,
      app: APP_NAME,
      appArgs: "dialed",
    });
  } catch (err: any) {
    console.warn(`[WARN] Failed to ring Agent ${agentExt}: ${err.message}`);
    try { await callerChannel.stopMoh(); } catch (e) {}
    try { await callerChannel.hangup(); } catch (e) {}
    try { await bridge.destroy(); } catch (e) {}
    onCallEnded?.(agentExt);
    return;
  }

  let isTerminated = false;
  const cleanup = async (reason: string) => {
    if (isTerminated) return;
    isTerminated = true;
    console.log(`[ROUTER] Call session terminated (${reason}) for Agent ${agentExt}`);
    try { await callerChannel.stopMoh(); } catch (e) {}
    try { await dialedChannel.hangup(); } catch (e) {}
    try { await callerChannel.hangup(); } catch (e) {}
    try { await bridge.destroy(); } catch (e) {}
    onCallEnded?.(agentExt);
  };

  // Agent answers -> Stop hold music and merge audio
  dialedChannel.on("StasisStart", async () => {
    console.log(`[BRIDGE] Agent ${agentExt} answered! Stopping hold music & merging audio with caller...`);
    try {
      await callerChannel.stopMoh();
    } catch (e) {}
    try {
      await bridge.addChannel({ channel: dialedChannel.id });
    } catch (e: any) {
      await cleanup("Failed to add agent to bridge");
    }
  });

  // When either party hangs up or leaves the bridge
  bridge.on("ChannelLeftBridge", async (event: any) => {
    console.log(`[BRIDGE] Channel ${event.channel?.id} left bridge`);
    await cleanup("Channel left bridge");
  });

  // Agent rejects before answering
  dialedChannel.on("ChannelDestroyed", async () => {
    await cleanup(`Agent ${agentExt} rejected or unavailable`);
  });

  // Agent hangs up
  dialedChannel.on("StasisEnd", async () => {
    await cleanup(`Agent ${agentExt} hung up`);
  });

  // Caller cancels or hangs up
  callerChannel.on("ChannelDestroyed", async () => {
    await cleanup("Caller channel destroyed");
  });

  callerChannel.on("StasisEnd", async () => {
    await cleanup("Caller hung up");
  });
}

/**
 * Handles direct extension-to-extension dialing (e.g. 1001 calling 1002).
 */
export async function routeDirect(
  client: Client,
  callerChannel: Channel,
  destination: string,
) {
  console.log(`[ROUTER] Direct call from ${callerChannel.id} to PJSIP/${destination}`);

  // 1. Check if destination extension is online
  let isOnline = false;
  try {
    const endpoint = await client.endpoints.get({
      tech: "PJSIP",
      resource: destination,
    });
    isOnline = endpoint && endpoint.state === "online";
  } catch (err) {
    isOnline = false;
  }

  // 2. Check if destination extension is currently busy
  const isBusy = queueManager.isAgentBusy(destination);

  if (!isOnline || isBusy) {
    console.log(
      `[ROUTER] Extension PJSIP/${destination} is unavailable (online: ${isOnline}, busy: ${isBusy}). Playing announcement and hanging up.`,
    );
    try {
      await playAudio(client, callerChannel, "sound:extension-unavailable");
      await callerChannel.hangup();
    } catch (e) {}
    return;
  }

  // 3. Mark agent as busy during the direct call
  queueManager.markBusy(destination);

  await connectCallerWithAgent(
    client,
    callerChannel,
    destination,
    () => {
      queueManager.markFree(destination);
    },
    false,
  );
}
