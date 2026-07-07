import type { Enquiry, EnquiryIntent } from "@/lib/mock-data";
import type { StatusTone } from "@/lib/status";

export type EnquiryTriageBand = "urgent" | "priority" | "watch" | "routine";
export type EnquiryRiskLevel = "high" | "medium" | "low";
export type EnquiryRouteTeam = "Filing Team A" | "Filing Team B" | "New Business";

export type EnquiryTriage = {
  intent: EnquiryIntent;
  confidence: number;
  band: EnquiryTriageBand;
  riskLevel: EnquiryRiskLevel;
  routeTeam: EnquiryRouteTeam;
  recommendedAction: string;
  reasons: string[];
  requiresHumanReview: boolean;
  score: number;
};

type IntentRule = {
  intent: EnquiryIntent;
  keywords: string[];
  phrases: string[];
};

const INTENT_RULES: IntentRule[] = [
  {
    intent: "Annual Return",
    keywords: ["nar1", "annual", "return", "filing", "anniversary", "checklist", "signature"],
    phrases: ["annual return", "return due", "ar reminder", "filing deadline"],
  },
  {
    intent: "Payment Query",
    keywords: ["invoice", "paid", "payment", "fps", "receipt", "proof", "bank", "transfer"],
    phrases: ["payment proof", "has this been received", "invoice paid"],
  },
  {
    intent: "New Incorporation",
    keywords: [
      "open",
      "incorporate",
      "incorporation",
      "limited",
      "ltd",
      "company",
      "kyc",
      "nnc1",
      "fee",
    ],
    phrases: ["new company", "hk company", "open a company", "open a hk"],
  },
  {
    intent: "Change of Director",
    keywords: ["director", "appointment", "resignation", "cessation", "nd2a", "nd2b", "change"],
    phrases: ["change director", "change one director", "appoint director"],
  },
  {
    intent: "Deregistration",
    keywords: ["deregister", "deregistration", "dormant", "dr1", "objection", "closure", "close"],
    phrases: ["no objection", "dormant company", "close company"],
  },
  {
    intent: "General Question",
    keywords: ["stamp", "transfer", "registered", "office", "secretary", "scr", "nominee", "tcsp"],
    phrases: ["share transfer", "registered office", "nominee director", "significant controller"],
  },
];

const URGENT_PATTERNS = [
  /\boverdue\b/,
  /\blate\b/,
  /\bpenalt(?:y|ies)\b/,
  /\bdue\s+(today|tomorrow)\b/,
  /\bdeadline\b/,
  /\bmissing\b.*\bsignature\b/,
  /\bsignature\b.*\bmissing\b/,
];

const COMPLIANCE_SENSITIVE_PATTERNS = [
  /\bnominee\b/,
  /\bscr\b/,
  /\bsignificant\s+controller\b/,
  /\baml\b/,
  /\btcsp\b/,
  /\bprosecution\b/,
  /\bfine\b/,
];

const wordsIn = (message: string) => new Set(message.split(/[^a-z0-9]+/).filter(Boolean));

function scoreRule(message: string, words: Set<string>, rule: IntentRule): number {
  const keywordScore = rule.keywords.reduce((score, keyword) => {
    return score + (words.has(keyword) ? 1 : 0);
  }, 0);
  const phraseScore = rule.phrases.reduce((score, phrase) => {
    return score + (message.includes(phrase) ? 2 : 0);
  }, 0);

  return keywordScore + phraseScore;
}

function detectIntent(
  message: string,
  fallback: EnquiryIntent,
): { intent: EnquiryIntent; score: number } {
  const words = wordsIn(message);
  const ranked = INTENT_RULES.map((rule) => ({
    intent: rule.intent,
    score: scoreRule(message, words, rule),
  })).sort((a, b) => b.score - a.score);

  const sensitive = COMPLIANCE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
  if (sensitive && (ranked[0]?.score ?? 0) <= 4) {
    return { intent: "General Question", score: Math.max(4, ranked[0]?.score ?? 0) };
  }

  const top = ranked[0];
  if (!top || top.score === 0) {
    return { intent: fallback, score: 0 };
  }

  return top;
}

function reasonsFor(message: string, intent: EnquiryIntent, highRisk: boolean): string[] {
  const reasons: string[] = [];

  if (
    intent === "Annual Return" &&
    (message.includes("annual") ||
      message.includes("nar1") ||
      message.includes("deadline") ||
      message.includes("signature"))
  ) {
    reasons.push("Annual return deadline language");
  }

  if (URGENT_PATTERNS.some((pattern) => pattern.test(message))) {
    reasons.push("Late filing or penalty risk");
  }

  if (COMPLIANCE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(message))) {
    reasons.push("Compliance-sensitive keyword");
  }

  if (intent === "Payment Query") {
    reasons.push("Payment or invoice language");
  }

  if (intent === "New Incorporation") {
    reasons.push("New company formation language");
  }

  if (reasons.length === 0 && highRisk) {
    reasons.push("High-risk compliance context");
  }

  return reasons;
}

function actionFor(intent: EnquiryIntent): string {
  switch (intent) {
    case "Annual Return":
      return "Open the annual-return case, verify the deadline risk, and send an approved checklist or signature follow-up.";
    case "Payment Query":
      return "Check the invoice ledger, attach payment proof to the client timeline, and confirm receipt by WhatsApp.";
    case "New Incorporation":
      return "Prepare an incorporation quote and collect KYC/company-name details.";
    case "Change of Director":
      return "Confirm the appointment or cessation date, then prepare the ND2A/ND2B document checklist.";
    case "Deregistration":
      return "Check solvency and IRD no-objection status before quoting the deregistration workflow.";
    case "General Question":
    default:
      return "Review the question and answer with an approved company-secretary template.";
  }
}

function routeFor(intent: EnquiryIntent): EnquiryRouteTeam {
  switch (intent) {
    case "New Incorporation":
      return "New Business";
    case "Annual Return":
    case "Payment Query":
    case "Change of Director":
      return "Filing Team A";
    case "Deregistration":
    case "General Question":
    default:
      return "Filing Team B";
  }
}

function clampConfidence(value: number): number {
  return Math.min(0.97, Math.max(0.5, Number(value.toFixed(2))));
}

export function triageEnquiry(enquiry: Enquiry): EnquiryTriage {
  const message = enquiry.lastMessage.toLowerCase().replace(/\s+/g, " ").trim();
  const { intent, score } = detectIntent(message, enquiry.intent);
  const urgentLanguage = URGENT_PATTERNS.some((pattern) => pattern.test(message));
  const complianceSensitive = COMPLIANCE_SENSITIVE_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
  const operationalIntent =
    intent === "Annual Return" ||
    intent === "Payment Query" ||
    intent === "Change of Director" ||
    intent === "Deregistration";

  const riskLevel: EnquiryRiskLevel =
    urgentLanguage || complianceSensitive ? "high" : operationalIntent ? "medium" : "low";

  const band: EnquiryTriageBand =
    urgentLanguage && intent === "Annual Return"
      ? "urgent"
      : riskLevel === "high" || operationalIntent
        ? "priority"
        : score === 0
          ? "watch"
          : "routine";

  const confidence = clampConfidence(
    0.6 + score * 0.06 + (urgentLanguage || complianceSensitive ? 0.08 : 0),
  );
  const bandScore = { urgent: 400, priority: 300, watch: 200, routine: 100 }[band];

  return {
    intent,
    confidence,
    band,
    riskLevel,
    routeTeam: routeFor(intent),
    recommendedAction: actionFor(intent),
    reasons: reasonsFor(message, intent, riskLevel === "high"),
    requiresHumanReview: riskLevel === "high",
    score: bandScore + Math.round(confidence * 100) + enquiry.unread * 3,
  };
}

export function triageTone(band: EnquiryTriageBand): StatusTone {
  switch (band) {
    case "urgent":
      return "red";
    case "priority":
      return "orange";
    case "watch":
      return "yellow";
    case "routine":
    default:
      return "green";
  }
}

export function sortEnquiriesByTriage(enquiries: Enquiry[]): Enquiry[] {
  return [...enquiries].sort((a, b) => {
    const triageDelta = triageEnquiry(b).score - triageEnquiry(a).score;
    if (triageDelta !== 0) return triageDelta;

    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });
}
