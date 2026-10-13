import type { ServiceType } from "./types";

/**
 * Standard annual fees (HKD). Used as the default when adding a
 * subscription; the fee is then a normal editable column, not derived live
 * from this table on every read — matches how payments.amount works despite
 * having a "standard" expectation elsewhere.
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  secretary: "公司秘書",
  registered_office: "註冊辦事處",
  director_correspondence_address: "董事通訊地址",
  designated_representative: "指定代表",
};

export const SERVICE_TYPE_DEFAULT_FEES: Record<ServiceType, number> = {
  secretary: 2800,
  registered_office: 2800,
  director_correspondence_address: 1000,
  designated_representative: 2000,
};
