import { useEffect, useState } from "react";

/** Cursor failures retain a successful page; identity/filter changes never do. */
export function useRetainedPage<T>(scope: string, data: T | undefined): T | undefined {
  const [loaded, setLoaded] = useState<{ scope: string; data: T }>();
  useEffect(() => {
    if (data !== undefined) setLoaded({ scope, data });
    else setLoaded((previous) => (previous?.scope === scope ? previous : undefined));
  }, [scope, data]);
  return data ?? (loaded?.scope === scope ? loaded.data : undefined);
}
