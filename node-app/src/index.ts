import ari from "ari-client";
import type { Client, Channel } from "ari-client";
import { ASTERISK_URL, ARI_USER, ARI_PASS, APP_NAME } from "./config.js";
import { queueManager } from "./services/queue.js";
import { handleIvrMenu } from "./services/ivr.js";
import { routeDirect } from "./services/callRouter.js";

async function start() {
  try {
    console.log("[ARI] Connecting to Asterisk ARI...");
    const client: Client = await ari.connect(ASTERISK_URL, ARI_USER, ARI_PASS);
    console.log("[ARI] Connected successfully");

    // Initialize department holding bridges with Music on Hold
    await queueManager.initBridges(client);

    client.on("StasisStart", async (event: any, channel: Channel) => {
      // Ignore outbound legs originated by our script
      if (event.args && event.args[0] === "dialed") {
        console.log(`[CALL] Target channel ${channel.id} joined Stasis`);
        return;
      }

      const caller = channel.caller?.number || "Unknown";
      const destination = channel.dialplan?.exten || "";
      console.log(
        `[CALL] Incoming: ${caller} -> ${destination} (Channel: ${channel.id})`,
      );

      try {
        await channel.answer();
        console.log(`[CALL] Answered ${channel.id}`);
      } catch (err: any) {
        console.warn(
          `[WARN] Channel ${channel.id} hung up before answer: ${err.message}`,
        );
        return;
      }

      // 1. Echo Test (9999)
      if (destination === "9999") {
        console.log(
          `[CALL] Handing channel ${channel.id} over to native Echo app`,
        );
        await channel.continueInDialplan({
          context: "from-internal-echo",
          extension: "9999",
          priority: 1,
        });
        return;
      }

      // 2. IVR Hotline (8000)
      if (destination === "8000") {
        await handleIvrMenu(client, channel, caller);
        return;
      }

      // 3. Direct extension-to-extension dialing (e.g. 1001 calling 1002 directly)
      await routeDirect(client, channel, destination);
    });

    client.on("StasisEnd", (_event: any, channel: Channel) => {
      console.log(`[CALL] Channel ${channel.id} exited Stasis`);
    });

    client.start(APP_NAME);
    console.log(`[ARI] Listening for application: ${APP_NAME}`);
  } catch (error) {
    console.error("[ERROR] Failed to initialize ARI client:", error);
  }
}

start();
