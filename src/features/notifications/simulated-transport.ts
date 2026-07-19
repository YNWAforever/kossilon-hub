import type { NotificationTransport } from "./types";

export function createSimulatedNotificationTransport(): NotificationTransport {
  return {
    async dispatch(notification) {
      return {
        providerMessageId: "simulated:" + notification.channel + ":" + notification.id,
      };
    },
  };
}
