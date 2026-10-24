import type { Client, Channel, Bridge } from "ari-client";
import { DEPARTMENTS, type DepartmentKey } from "../config.js";
import { connectCallerWithAgent } from "./callRouter.js";

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
    console.log("[QUEUE] Queue system ready (using native Channel Music on Hold)");
  }

  /**
   * Adds a caller to a department queue, or connects immediately if an agent is free.
   */
  async enqueue(client: Client, deptKey: DepartmentKey, callerChannel: Channel) {
    const dept = DEPARTMENTS[deptKey];
    console.log(`[QUEUE] Customer requested ${dept.name} department`);

    // Find the first free agent assigned to this department
    const freeAgent = dept.agents.find((agent) => !this.busyAgents.has(agent));

    if (freeAgent) {
      console.log(`[QUEUE] Agent ${freeAgent} is FREE. Connecting caller immediately...`);
      await this.dispatchToAgent(client, deptKey, freeAgent, callerChannel);
    } else {
      // All agents in this department are busy! Place caller in waiting queue
      this.waitingQueues[deptKey].push(callerChannel);
      const position = this.waitingQueues[deptKey].length;
      console.log(
        `[QUEUE] All ${dept.name} agents busy. Customer ${callerChannel.id} placed in ${dept.name} Queue (Position: ${position})`,
      );

      // Start Music on Hold directly on the caller channel
      try {
        await callerChannel.startMoh({ mohClass: "default" });
        console.log(`[QUEUE] Playing Music on Hold for Customer ${callerChannel.id}`);
      } catch (e: any) {
        console.warn(`[WARN] Failed to start MOH: ${e.message}`);
      }

      // If customer abandons call while waiting in queue, remove them from the array
      callerChannel.on("ChannelDestroyed", () => {
        console.log(`[QUEUE] Customer ${callerChannel.id} abandoned ${dept.name} queue`);
        this.waitingQueues[deptKey] = this.waitingQueues[deptKey].filter(
          (c) => c.id !== callerChannel.id,
        );
      });
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
  private handleAgentFree(client: Client, deptKey: DepartmentKey, agentExt: string) {
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
      console.log(`[QUEUE] Agent ${agentExt} is now idle. No callers waiting in ${dept.name} queue.`);
    }
  }
}

export const queueManager = new QueueManager();
