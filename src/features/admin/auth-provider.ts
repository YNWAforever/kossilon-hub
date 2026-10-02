/** No tenant-verified staff invitation API/management credential is available. */
export const staffInvitationCapability = {
  state: "blocked",
  owner: "Auth 管理員",
  message: "邀請未啟用。請由 Auth 管理員核實供應商身份及設定；已有帳戶可於此維護。",
} as const;
