export const SERVICE_TYPES = [
  "secretary",
  "registered_office",
  "director_correspondence_address",
  "designated_representative",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type SubscriptionStatus = "Active" | "Cancelled";

export type ServiceSubscription = {
  id: string;
  companyId: string;
  serviceType: ServiceType;
  fee: number;
  status: SubscriptionStatus;
  renewalDate: string;
  cancelledAt: string | null;
};

export type AddSubscriptionInput = {
  companyId: string;
  serviceType: ServiceType;
  fee: number;
  renewalDate: string;
  actorId: string;
};

export type RenewSubscriptionInput = {
  subscriptionId: string;
  companyId: string;
  actorId: string;
};

export type CancelSubscriptionInput = {
  subscriptionId: string;
  companyId: string;
  actorId: string;
};

export type EvaluateRemindersResult = { drafted: number; skipped: number };
