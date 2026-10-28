export type MarketingLocale = "zh-HK" | "en";

type Item = { title: string; text: string };
type MarketingCopy = {
  nav: string[];
  navLabel: string;
  menu: string;
  skip: string;
  eyebrow: string;
  headline: string;
  intro: string;
  login: string;
  secondary: string;
  footnote: string;
  valuesTitle: string;
  valuesIntro: string;
  values: Item[];
  workflowTitle: string;
  steps: Item[];
  featuresTitle: string;
  featuresIntro: string;
  features: Item[];
  pricingTitle: string;
  pricingText: string;
  pricingStatus: string;
  faqTitle: string;
  faq: Item[];
  closingTitle: string;
  closingText: string;
  footer: string;
  legalNote: string;
  metaDescription: string;
  sample: {
    label: string;
    heading: string;
    subheading: string;
    metrics: string[];
    company: string;
    task: string;
    status: string;
    rows: [string, string, string][];
    next: string;
    nextText: string;
    caption: string;
  };
};

export const marketingCopy: Record<MarketingLocale, MarketingCopy> = {
  "zh-HK": {
    nav: ["使用流程", "功能", "方案", "常見問題"],
    navLabel: "產品導覽",
    menu: "選單",
    skip: "跳至內容",
    eyebrow: "專為香港公司秘書團隊而設",
    headline: "讓每一宗公司秘書工作，都有清晰下一步。",
    intro:
      "由周年申報、文件追收到團隊交接，將分散嘅進度放返同一個工作空間。ComSec OS 幫你睇清到期日、負責人同待辦事項，讓團隊有序跟進。",
    login: "登入工作空間",
    secondary: "睇下點樣運作",
    footnote: "為已獲授權嘅同事及客戶提供登入入口。方案及收費待公布。",
    valuesTitle: "少啲來回查問，多啲清晰進度。",
    valuesIntro: "每宗案件都有唔同嘅文件、期限同協作需要。先將工作脈絡整理好，再推進下一步。",
    values: [
      {
        title: "今日要做乜，一眼睇清",
        text: "集中查看到期、逾期同待處理事項，按工作風險安排跟進次序。",
      },
      {
        title: "文件同進度，放返一齊",
        text: "將案件清單、文件狀態同跟進紀錄連起來，減少喺唔同工具之間搵資料。",
      },
      {
        title: "交接有依據，跟進有人接",
        text: "清楚記錄負責人、所屬團隊同案件狀態，方便同事接手與覆核。",
      },
    ],
    workflowTitle: "由接手案件，到完成覆核。",
    steps: [
      {
        title: "整理公司與案件",
        text: "集中管理公司資料、服務案件同申報期限，建立共同嘅工作脈絡。",
      },
      {
        title: "按清單逐步跟進",
        text: "分配工作、追收所需文件、更新付款及案件狀態，讓下一位同事知道進度。",
      },
      {
        title: "覆核與保留紀錄",
        text: "由獲授權同事核對文件及申報證明，保留案件紀錄，方便後續查閱。",
      },
    ],
    featuresTitle: "將日常工作，串成一條清晰流程。",
    featuresIntro: "圍繞公司秘書團隊實際需要，讓案件、文件同協作有共同落點。",
    features: [
      {
        title: "工作總覽與隊列",
        text: "查看近期到期、欠缺文件同待處理案件；按負責人及團隊跟進工作。",
      },
      {
        title: "周年申報流程",
        text: "用案件清單追蹤準備、簽署、付款及申報證明，保留每個階段嘅狀態。",
      },
      {
        title: "公司資料與服務案件",
        text: "整理客戶公司、公司註冊及公司變更工作，方便團隊查閱相關紀錄。",
      },
      { title: "文件收集與覆核", text: "集中處理上載、欠件及覆核狀態；文件存取按使用者權限限制。" },
      { title: "客戶入口", text: "獲授權客戶可於獨立入口查看相關案件及提交文件，減少重複查問。" },
      {
        title: "通訊與團隊協作",
        text: "配合負責人分工及跟進紀錄協作。WhatsApp 等整合須完成服務設定，功能以實際啟用狀態為準。",
      },
    ],
    pricingTitle: "適合你團隊嘅方案，準備中。",
    pricingText: "方案內容、使用限額及收費仍待確認。此頁未提供即時購買或付款服務。",
    pricingStatus: "方案及收費待公布",
    faqTitle: "開始之前，你可能想知。",
    faq: [
      {
        title: "ComSec OS 適合邊類團隊？",
        text: "主要為香港公司秘書服務團隊而設，支援整理公司資料、周年申報、文件及日常跟進工作。實際使用範圍視乎機構設定及帳戶權限。",
      },
      {
        title: "可以直接註冊或購買嗎？",
        text: "目前主要入口係登入已獲授權嘅工作空間。方案及收費仍待公布，此頁未提供公開自助購買。",
      },
      {
        title: "客戶同同事會見到同一批資料嗎？",
        text: "同事及客戶使用不同入口；資料存取由帳戶角色、團隊及公司授權控制。客戶入口只供已獲授權客戶使用。",
      },
      {
        title: "會自動代我提交申報或發訊息嗎？",
        text: "此頁並不承諾自動提交或自動發送。申報資料及文件仍須由合適同事覆核；通訊功能取決於整合設定、啟用狀態及操作權限。",
      },
      {
        title: "畫面入面係真實客戶資料嗎？",
        text: "唔係。此頁產品畫面以合成資料示意，並非真實客戶、即時數據或服務承諾。實際介面及可用功能以工作空間為準。",
      },
    ],
    closingTitle: "下一宗案件，由清晰開始。",
    closingText: "登入 ComSec OS，將團隊嘅日常工作接返埋一齊。",
    footer: "為香港公司秘書團隊整理案件、文件與日常協作。",
    legalNote: "本頁為產品介紹，並非法律或專業合規意見。申報及文件內容須經適當覆核。",
    metaDescription:
      "ComSec OS 為香港公司秘書團隊集中整理周年申報、文件追收、工作分配與客戶協作。方案及收費待公布。",
    sample: {
      label: "產品流程示意",
      heading: "今日工作",
      subheading: "將每個待辦，變成下一步。",
      metrics: ["即將到期", "待收文件", "待覆核"],
      company: "示例公司",
      task: "工作事項",
      status: "目前狀態",
      rows: [
        ["示例公司 A", "周年申報", "待收文件"],
        ["示例公司 B", "公司變更", "待覆核"],
        ["示例公司 C", "公司註冊", "準備中"],
      ],
      next: "下一步 · 示例公司 A",
      nextText: "核對所需文件 → 同事覆核 → 更新案件進度",
      caption: "合成示意畫面，並非真實客戶或即時數據；實際介面及功能以工作空間為準。",
    },
  },
  en: {
    nav: ["How it works", "Features", "Pricing", "FAQ"],
    navLabel: "Product navigation",
    menu: "Menu",
    skip: "Skip to content",
    eyebrow: "BUILT FOR HONG KONG COMPANY SECRETARIAL TEAMS",
    headline: "A clear next step for every company secretarial case.",
    intro:
      "Bring annual returns, document follow-ups and team handovers into one workspace. ComSec OS helps your team see deadlines, ownership and outstanding work, so every case keeps moving.",
    login: "Log in to workspace",
    secondary: "See how it works",
    footnote:
      "Workspace access for authorized staff and clients. Plans and pricing to be confirmed.",
    valuesTitle: "Less chasing for updates. More clarity on the work.",
    valuesIntro:
      "Every case has its own documents, deadlines and people. Give your team a shared view before taking the next step.",
    values: [
      {
        title: "See what needs attention",
        text: "Review upcoming deadlines, overdue cases and outstanding work to prioritize follow-ups.",
      },
      {
        title: "Keep documents in context",
        text: "Connect case checklists, document status and follow-up records without searching across separate tools.",
      },
      {
        title: "Make handovers clearer",
        text: "Record ownership, team and case status so the next colleague can pick up where you left off.",
      },
    ],
    workflowTitle: "From taking on a case to reviewing the record.",
    steps: [
      {
        title: "Organize companies and cases",
        text: "Keep company details, service cases and filing deadlines together to establish a shared context.",
      },
      {
        title: "Follow the checklist",
        text: "Assign work, collect documents and update payment and case status so colleagues can see what comes next.",
      },
      {
        title: "Review and retain records",
        text: "Authorized colleagues review documents and filing evidence, keeping case records available for follow-up.",
      },
    ],
    featuresTitle: "Bring the everyday work into one clear flow.",
    featuresIntro:
      "A shared place for the cases, documents and collaboration your company secretarial team handles every day.",
    features: [
      {
        title: "Work overview and queues",
        text: "Review upcoming deadlines, missing documents and pending cases. Follow work by owner and team.",
      },
      {
        title: "Annual return workflows",
        text: "Track preparation, signatures, payments and filing evidence through case checklists and status updates.",
      },
      {
        title: "Companies and service cases",
        text: "Organize client company records, incorporation and corporate change work for your team to consult.",
      },
      {
        title: "Document collection and review",
        text: "Track uploads, missing items and review status, with document access limited by user permissions.",
      },
      {
        title: "Client portal",
        text: "Authorized clients use a separate portal to view relevant cases and submit documents, reducing repeat queries.",
      },
      {
        title: "Communication and teamwork",
        text: "Coordinate through ownership and follow-up records. Integrations such as WhatsApp require service configuration; availability depends on what is enabled.",
      },
    ],
    pricingTitle: "Plans for your team. Details coming soon.",
    pricingText:
      "Plan features, usage limits and pricing are still being confirmed. This page does not offer checkout or payments.",
    pricingStatus: "Plans and pricing to be confirmed",
    faqTitle: "A few things you may want to know.",
    faq: [
      {
        title: "Who is ComSec OS for?",
        text: "It is designed for Hong Kong company secretarial service teams managing company records, annual returns, documents and daily follow-ups. Available workflows depend on organization settings and account permissions.",
      },
      {
        title: "Can I sign up or buy a plan here?",
        text: "The current entry point is login to an authorized workspace. Plans and pricing are to be confirmed; public self-service purchasing is not available on this page.",
      },
      {
        title: "Do clients and staff see the same information?",
        text: "Staff and clients use different entry points. Account roles, teams and company authorization control data access. The client portal is for authorized clients only.",
      },
      {
        title: "Does it automatically file returns or send messages?",
        text: "This page does not promise automatic filing or sending. Appropriate colleagues must review filing details and documents. Communication features depend on integration setup, enabled services and permissions.",
      },
      {
        title: "Is the product illustration real client data?",
        text: "No. The illustration uses synthetic data. It does not show real clients or live results, and is not a service commitment. Actual screens and available features depend on your workspace.",
      },
    ],
    closingTitle: "Start the next case with clarity.",
    closingText: "Log in to ComSec OS and bring your team's daily work together.",
    footer: "Cases, documents and everyday collaboration for Hong Kong company secretarial teams.",
    legalNote:
      "Product information only, not legal or professional compliance advice. Filing details and documents require appropriate review.",
    metaDescription:
      "ComSec OS brings annual returns, document follow-ups, task ownership and client collaboration together for Hong Kong company secretarial teams. Pricing TBC.",
    sample: {
      label: "ILLUSTRATIVE WORKFLOW",
      heading: "Today's work",
      subheading: "A next step for every open task.",
      metrics: ["Due soon", "Documents due", "For review"],
      company: "Sample company",
      task: "Work item",
      status: "Status",
      rows: [
        ["Sample company A", "Annual return", "Documents due"],
        ["Sample company B", "Corporate change", "For review"],
        ["Sample company C", "Incorporation", "Preparing"],
      ],
      next: "NEXT STEP · SAMPLE COMPANY A",
      nextText: "Check documents → Colleague review → Update case",
      caption:
        "Synthetic illustration, not real client data or live results. Actual screens and features depend on your workspace.",
    },
  },
};
