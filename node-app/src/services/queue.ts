import type { Client, Channel, Endpoint } from "ari-client";
import { DEPARTMENTS, type DepartmentKey } from "../config.js";
import { connectCallerWithAgent } from "./callRouter.js";

export function playAudio(
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

class QueueManager {
  private waitingQueues: Record<DepartmentKey, Channel[]> = {
    sales: [],
    support: [],
  };

  private busyAgents: Set<string> = new Set();

  /**
   * Optional initialization hook
   */
  async initBridges(_client: Client) {
    console.log(
      "[QUEUE] Queue system ready (using native Channel Music on Hold)",
    );
  }

  isAgentBusy(agentExt: string): boolean {
    return this.busyAgents.has(agentExt);
  }

  markBusy(agentExt: string) {
    this.busyAgents.add(agentExt);
  }

  markFree(agentExt: string) {
    this.busyAgents.delete(agentExt);
  }

  /**
   * Adds a caller to a department queue, or connects immediately if an agent is free.
   */
  async enqueue(
    client: Client,
    deptKey: DepartmentKey,
    callerChannel: Channel,
  ) {
    const dept = DEPARTMENTS[deptKey];
    console.log(`[QUEUE] Customer requested ${dept.name} department`);

    const onlineAgents = [];

    for (const agentExt of dept.agents) {
      const isOnline = await this.isAgentOnline(client, agentExt);
      if (isOnline) {
        onlineAgents.push(agentExt);
      }
    }

    if (onlineAgents.length === 0) {
      console.log(
        `[QUEUE] No online agents available for ${dept.name}. Playing announcement and dropping call.`,
      );
      try {
        await playAudio(client, callerChannel, "sound:all-agents-offline");
        await callerChannel.hangup();
      } catch (e) {}
      return;
    }

    console.log(`[QUEUE] Current busy agents: [${[...this.busyAgents].join(", ")}]`);

    // Find the free agents assigned to this department
    const freeAgents = onlineAgents.filter(
      (agent) => !this.busyAgents.has(agent),
    );

    let agentToConnect;
    if (freeAgents.length > 0) {
      if (freeAgents.length > 1) {
        console.log(
          `[QUEUE] Multiple free agents available for ${dept.name}. Selecting one at random.`,
        );
        agentToConnect = Math.floor(Math.random() * freeAgents.length);
      } else {
        agentToConnect = 0;
      }
      console.log(
        `[QUEUE] Agent ${freeAgents[agentToConnect]} is FREE. Connecting caller immediately...`,
      );
      await this.dispatchToAgent(
        client,
        deptKey,
        freeAgents[agentToConnect],
        callerChannel,
      );
    } else {
      // All agents in this department are busy! Place caller in waiting queue
      this.waitingQueues[deptKey].push(callerChannel);
      const position = this.waitingQueues[deptKey].length;
      console.log(
        `[QUEUE] All ${dept.name} agents busy. Customer ${callerChannel.id} placed in ${dept.name} Queue (Position: ${position})`,
      );

      // If customer abandons call while waiting in queue, remove them from the array
      const onAbandon = () => {
        console.log(
          `[QUEUE] Customer ${callerChannel.id} abandoned ${dept.name} queue`,
        );
        this.waitingQueues[deptKey] = this.waitingQueues[deptKey].filter(
          (c) => c.id !== callerChannel.id,
        );
      };
      callerChannel.once("ChannelDestroyed", onAbandon);
      callerChannel.once("StasisEnd", onAbandon);

      // Play busy queue announcement, then transition to Music on Hold
      try {
        await playAudio(client, callerChannel, "sound:queue-wait");
        // Verify channel is still waiting before starting MOH
        if (
          this.waitingQueues[deptKey].some((c) => c.id === callerChannel.id)
        ) {
          await callerChannel.startMoh({ mohClass: "default" });
          console.log(
            `[QUEUE] Playing Music on Hold for Customer ${callerChannel.id}`,
          );
        }
      } catch (e: any) {
        console.warn(`[WARN] Failed to start MOH: ${e.message}`);
      }
    }
  }

  async handleAgentOnline(client: Client, endpoint: Endpoint) {
    if (endpoint && endpoint.state === "online") {
      const agentExt = endpoint.resource;
      if (this.busyAgents.has(agentExt)) {
        return;
      }
      const department = this.getDepartmentForAgent(agentExt);
      if (department) {
        console.log(
          `[QUEUE] Agent ${agentExt} is now ONLINE. Checking for waiting customers in ${DEPARTMENTS[department].name} queue...`,
        );
        const queue = this.waitingQueues[department];
        if (queue.length > 0) {
          const nextCaller = queue.shift()!;
          console.log(
            `[QUEUE] Popping customer ${nextCaller.id} from ${DEPARTMENTS[department].name} queue (${queue.length} remaining)`,
          );
          await this.dispatchToAgent(client, department, agentExt, nextCaller);
        } else {
          console.log(
            `[QUEUE] No waiting customers in ${DEPARTMENTS[department].name} queue.`,
          );
        }
      }
    }
  }

  /**
   * Dispatches a caller to a specific agent and handles automatic pop on completion.
   */
  private async dispatchToAgent(
    client: Client,
    deptKey: DepartmentKey,
    agentExt: string,
    callerChannel: Channel,
  ) {
    this.busyAgents.add(agentExt);

    await connectCallerWithAgent(
      client,
      callerChannel,
      agentExt,
      () => this.handleAgentFree(client, deptKey, agentExt),
      true, // Play Hold Music while waiting for the agent to answer
    );
  }

  /**
   * Called when an agent finishes or rejects a call.
   * Marks agent as free and automatically pops the next waiting customer.
   */
  private handleAgentFree(
    client: Client,
    deptKey: DepartmentKey,
    agentExt: string,
  ) {
    this.busyAgents.delete(agentExt);
    const dept = DEPARTMENTS[deptKey];
    const queue = this.waitingQueues[deptKey];

    if (queue.length > 0) {
      const nextCaller = queue.shift()!;
      console.log(
        `[QUEUE] Agent ${agentExt} is now FREE! Popping customer ${nextCaller.id} from ${dept.name} queue (${queue.length} remaining)`,
      );
      this.dispatchToAgent(client, deptKey, agentExt, nextCaller);
    } else {
      console.log(
        `[QUEUE] Agent ${agentExt} is now idle. No callers waiting in ${dept.name} queue.`,
      );
    }
  }

  private async isAgentOnline(
    client: Client,
    agentExt: string,
  ): Promise<boolean> {
    try {
      const endpoint = await client.endpoints.get({
        tech: "PJSIP",
        resource: agentExt,
      });

      const isOnline = endpoint && endpoint.state === "online";

      // Sync busy status with Asterisk source of truth
      if (endpoint && endpoint.channel_ids) {
        if (endpoint.channel_ids.length === 0) {
          this.busyAgents.delete(agentExt);
        } else {
          this.busyAgents.add(agentExt);
        }
      }

      return isOnline;
    } catch (error) {
      return false;
    }
  }

  private getDepartmentForAgent(agentExt: string): DepartmentKey | undefined {
    for (const [key, dept] of Object.entries(DEPARTMENTS)) {
      if (dept.agents.includes(agentExt)) {
        return key as DepartmentKey;
      }
    }
    return undefined;
  }
}

export const queueManager = new QueueManager();
