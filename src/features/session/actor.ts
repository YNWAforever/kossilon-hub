const ACTOR_ID_ENV_KEY = "KOSSILON_ACTOR_ID";
const LEGACY_ACTOR_ID_ENV_KEY = "KOSSILON_ANNUAL_RETURN_ACTOR_ID";

/**
 * Prototype actor resolver. Until real authentication lands, every server-side
 * write attributes itself to a single configured user. The login phase replaces
 * this with a session lookup — keep it the only source of actor identity.
 */
export function getCurrentActorId(): string {
  const actorId =
    process.env[ACTOR_ID_ENV_KEY]?.trim() || process.env[LEGACY_ACTOR_ID_ENV_KEY]?.trim();

  if (!actorId) {
    throw new Error(`${ACTOR_ID_ENV_KEY} actor is not configured.`);
  }

  return actorId;
}
