const ACTOR_ID_ENV_KEY = "KOSSILON_ANNUAL_RETURN_ACTOR_ID";

export function getCurrentAnnualReturnActorId(): string {
  const actorId = process.env[ACTOR_ID_ENV_KEY]?.trim();

  if (!actorId) {
    throw new Error(`${ACTOR_ID_ENV_KEY} actor is not configured.`);
  }

  return actorId;
}
