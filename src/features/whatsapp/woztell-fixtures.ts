/**
 * Webhook payloads copied verbatim from WOZTELL's own documentation:
 * https://doc.woztell.com/docs/documentations/channels/channels-webhook/
 *
 * These are the contract. Do NOT edit a fixture to make a test pass — if a fixture
 * and the code disagree, the code is wrong. The previous fixture set was written
 * against Meta's WhatsApp Cloud API shapes, which WOZTELL does not send, and that
 * is precisely why 87 passing tests did not notice that inbound was 100% lost.
 *
 * Typos such as "channeId" are WOZTELL's, reproduced deliberately.
 */

/** Inbound text. Note: no `eventType`, and no message id of any kind. */
export const WOZTELL_INBOUND_TEXT = {
  from: "85260903521",
  to: "85268227287",
  timestamp: "1599536864",
  type: "TEXT",
  data: { text: "Hello" },
  member: "memberId",
  channel: "channeId",
  app: "appId",
  memberExtraData: { field: "Test Metadata", path: "gender" },
};

/** Inbound media. No `data.text` at all — the body has to be derived. */
export const WOZTELL_INBOUND_MISC_VIDEO = {
  from: "85260903521",
  to: "85268227287",
  timestamp: "1599536864",
  type: "MISC",
  data: {
    attachments: [{ type: "VIDEO", waMediaId: "e8a85916-2386-49dc-8f05-1cd0527bfb68" }],
  },
  member: "memberId",
  channel: "channeId",
  app: "appId",
  memberExtraData: { field: "Test Metadata", path: "gender" },
};

/** Status update. eventType INBOUND, type READ, millisecond timestamp. */
export const WOZTELL_STATUS_READ = {
  to: "85268227287",
  timestamp: 1701914905000,
  messageId: "wamid.ABcLODUyNTQwNjM1OTgVAgARGBJCRDc4MkU4QTUzREFCMkU3REEA",
  from: "85254063598",
  data: { messageId: "wamid.ABcLODUyNTQwNjM1OTgVAgARGBJCRDc4MkU4QTUzREFCMkU3REEA" },
  type: "READ",
  eventType: "INBOUND",
  member: "MEMBER_ID",
  channel: "CHANNEL_ID",
  app: "APP_ID",
};

/** Same envelope as READ, with type DELIVERED. `data` is its own object, not shared with READ. */
export const WOZTELL_STATUS_DELIVERED = {
  ...WOZTELL_STATUS_READ,
  data: { ...WOZTELL_STATUS_READ.data },
  type: "DELIVERED",
  timestamp: 1701914900000,
};

/** Our own outbound, echoed back. Message is nested under `messageEvent`. */
export const WOZTELL_API_OUTBOUND = {
  type: "MANUAL",
  app: "APP_ID",
  channel: "CHANNEL_ID",
  member: "MEMBER_ID",
  eventType: "API_OUTBOUND",
  meta: {
    agentUserId: "59cb495865243d002c6fc1f5",
    apiSource: { integrationId: "inbox", build: 1, appIntegration: "6420ffb53e65b445d4657ee1" },
    __source__: { integrationId: "inbox", build: 1, appIntegration: "6420ffb53e65b445d4657ee1" },
  },
  messageEvent: {
    from: "14132521446",
    to: "85260903521",
    data: { text: "hihi" },
    type: "TEXT",
    timestamp: 1712807869354,
    messageId: "wamid.HBgLODUyNjA5MDM1MjEVAgARGBJFMkI5MkQwODQ1NDc3Q0UwM0QA",
  },
};

/** Member profile change event; carries `before`/`after` snapshots of the member document. */
export const WOZTELL_MEMBER_UPDATE = {
  eventType: "MEMBER_UPDATE",
  functionName: "NORMAL_UPDATE_MEMBER",
  member: "memberId",
  channel: "channelId",
  app: "appId",
  before: { liveChat: false, tempData: { faqAns: [], listLength: 5 }, tags: ["test_broadcast"] },
  after: {
    liveChat: true,
    tempData: { faqAns: [], listLength: 1 },
    tags: ["test_broadcast", "testing_tag_2"],
  },
};

/** Bulk tag/update event applied across multiple `members` at once, keyed by MongoDB-style update operators. */
export const WOZTELL_BATCH_MEMBER_UPDATE = {
  eventType: "BATCH_MEMBER_UPDATE",
  functionName: "BATCH_ADD_TAGS",
  members: ["memberId_1", "memberId_2", "memberId_3"],
  channel: "channelId",
  app: "appId",
  update: { $addToSet: { tags: { $each: ["testing_tag_1"] } } },
};

/** Flow node trigger. `compositeId: null` is as documented; the message is nested under `messageEvent` (same asymmetry as API_OUTBOUND). */
export const WOZTELL_NODE_TRIGGER = {
  app: "appId",
  channel: "channelId",
  member: "memberId",
  timestamp: 1680605255829,
  node: "nodeId",
  compositeId: null,
  tree: "treeId",
  eventType: "NODE_TRIGGER",
  messageEvent: {
    to: "123461662163",
    timestamp: 1680605248000,
    messageId: "wamid.HLavODUyNTpRNjM1OTgVAgASGBYzRUabcjRDNTcxQjhPQ8E3MEI0MkFCAA==",
    from: "85212345678",
    type: "TEXT",
    data: { text: "Testing" },
  },
};

/** Every documented payload, for tests that assert "nothing throws, nothing 503s". */
export const WOZTELL_DOCUMENTED_PAYLOADS = [
  WOZTELL_INBOUND_TEXT,
  WOZTELL_INBOUND_MISC_VIDEO,
  WOZTELL_STATUS_READ,
  WOZTELL_STATUS_DELIVERED,
  WOZTELL_API_OUTBOUND,
  WOZTELL_MEMBER_UPDATE,
  WOZTELL_BATCH_MEMBER_UPDATE,
  WOZTELL_NODE_TRIGGER,
];
