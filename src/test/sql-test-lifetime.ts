import type { SqlClient } from "@/server/db/client";

// Test-only guard. The unwrapped client remains available for awaited teardown.
export function guardSqlTestLifetime(
  client: SqlClient,
  getSignal: () => AbortSignal | undefined,
): SqlClient {
  function check() {
    getSignal()?.throwIfAborted();
  }
  function guardQuery(result: unknown): unknown {
    if (
      !result ||
      typeof result !== "object" ||
      typeof Reflect.get(result, "execute") !== "function"
    )
      return result;
    // postgres.js queries are lazy. Keep this query's signal even after fixture cleanup.
    const signal = getSignal();
    const query = new Proxy(result, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          try {
            if (property !== "cancel") signal?.throwIfAborted();
          } catch (error) {
            if (property !== "then" && property !== "catch" && property !== "finally") throw error;
            const rejected = Promise.reject(error);
            return Reflect.apply(Reflect.get(rejected, property), rejected, args);
          }
          const next = Reflect.apply(value, target, args);
          return next === target ? query : next;
        };
      },
    });
    return query;
  }
  function wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      apply(fn, thisArg, args) {
        check();
        return guardQuery(
          Reflect.apply(fn as unknown as (...args: unknown[]) => unknown, thisArg, args),
        );
      },
      get(fn, property) {
        const value = Reflect.get(fn, property, fn);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          check();
          if (property === "begin" || property === "savepoint") {
            const callback = args.at(-1);
            if (typeof callback === "function") {
              args[args.length - 1] = async (transaction: SqlClient) => {
                check();
                const returned = callback(wrap(transaction));
                const result = await (Array.isArray(returned) ? Promise.all(returned) : returned);
                // Throw inside the callback so postgres.js rolls back before COMMIT/RELEASE.
                check();
                return result;
              };
            }
          }
          return guardQuery(Reflect.apply(value, fn, args));
        };
      },
    });
  }
  return wrap(client);
}
