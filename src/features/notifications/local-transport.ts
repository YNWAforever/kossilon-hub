import type { NotificationOutboxRecord, NotificationTransport } from "./types";

const dispatchedPayloads: NotificationOutboxRecord[] = [];

export function createLocalNotificationTransport(): NotificationTransport {
  return {
    async dispatch(notification) {
      dispatchedPayloads.push(structuredClone(notification));
      return { providerMessageId: `local:${notification.id}` };
    },
  };
}

export function getLocalNotificationPayloadsForTest(): readonly NotificationOutboxRecord[] {
  return dispatchedPayloads.map((payload) => structuredClone(payload));
}

export function resetLocalNotificationTransportForTest(): void {
  dispatchedPayloads.length = 0;
}
