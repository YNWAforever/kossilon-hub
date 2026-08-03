import { getCurrentActorId } from "@/features/session/actor";

/**
 * Retained so existing importers keep working. New code should call
 * getCurrentActorId() from @/features/session/actor directly.
 */
export function getCurrentAnnualReturnActorId(): string {
  return getCurrentActorId();
}
