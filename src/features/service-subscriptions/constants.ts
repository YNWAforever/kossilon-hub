import type { ServiceType } from "./types";

/**
 * Standard annual fees (HKD). Used as the default when adding a
 * subscription; the fee is then a normal editable column, not derived live
 * from this table on every read — matches how payments.amount works despite
 * having a "standard" expectation elsewhere.
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  secretary: "Company Secretary",
  registered_office: "Registered Office",
  director_correspondence_address: "Director Correspondence Address",
  designated_representative: "Designated Representative",
};

export const SERVICE_TYPE_DEFAULT_FEES: Record<ServiceType, number> = {
  secretary: 2800,
  registered_office: 2800,
  director_correspondence_address: 1000,
  designated_representative: 2000,
};
