import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";

// Declared here rather than imported from lib/annual-return-store so this shared
// component does not depend on a demo fixture store (see demo-store-boundary).
type RiskLevel = "overdue" | "due-soon" | "blocked" | "healthy" | "ready-to-file" | "filed";

const riskLabels: Record<RiskLevel, string> = {
  overdue: "已逾期",
  "due-soon": "即將到期",
  blocked: "受阻",
  healthy: "正常",
  "ready-to-file": "可遞交",
  filed: "已遞交",
};

const riskTones: Record<RiskLevel, StatusTone> = {
  overdue: "red",
  "due-soon": "orange",
  blocked: "yellow",
  healthy: "neutral",
  "ready-to-file": "green",
  filed: "blue",
};

/**
 * A case's risk as the dashboard shows it. The board and the case page each
 * drew their own square pill in raw Tailwind colours, so 已逾期 looked different
 * on every screen and missed the contrast-checked status tokens.
 */
export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <StatusPill tone={riskTones[risk]}>{riskLabels[risk]}</StatusPill>;
}
