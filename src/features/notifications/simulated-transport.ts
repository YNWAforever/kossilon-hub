import type { NotificationTransport } from "./types";

export function createSimulatedNotificationTransport(): NotificationTransport {
  return {
    async dispatch() {
      return { delivery: "simulated" };
    },
  };
}
