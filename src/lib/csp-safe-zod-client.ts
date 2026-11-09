// Side-effect module: import this before any module that builds zod schemas.
// ES modules evaluate their dependency graph in import order, so importing this
// first runs `configureCspSafeZod` before route modules initialize schemas.
import { configureCspSafeZod } from "./csp-safe-zod";

configureCspSafeZod(typeof window !== "undefined");
