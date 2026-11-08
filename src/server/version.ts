export type DeploymentVersion = {
  /** The commit the running build was produced from. */
  sha: string;
  /** Vercel environment name: production, preview or development. */
  environment: string;
  /** Which data mode the running bundle resolved to. */
  dataMode: "demo" | "production";
  /** Deployment hostname, when the platform supplies one. */
  host: string | null;
};

/**
 * The public deployment identity.
 *
 * Deliberately small: a way to answer "what is live?" without a dashboard login
 * and without exposing env values. Every field is either a commit sha, a
 * platform label or the data-mode flag the bundle was built with.
 */
export function buildDeploymentVersion(input: {
  env: Record<string, string | undefined>;
  dataMode: "demo" | "production";
}): DeploymentVersion {
  const sha = input.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const environment = input.env.VERCEL_ENV?.trim();
  const host = input.env.VERCEL_URL?.trim();

  return {
    sha: sha || "unknown",
    environment: environment || "unknown",
    dataMode: input.dataMode,
    host: host || null,
  };
}
