import { createServerFn } from "@tanstack/react-start";

export const getNeonAuthClientConfiguration = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getNeonAuthUrl } = await import("./neon-auth-server");
    return { url: getNeonAuthUrl() };
  },
);

export const getAuthenticatedActor = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { requireActor }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./neon-auth-server"),
  ]);

  return requireActor(getRequest());
});
