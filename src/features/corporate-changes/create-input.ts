import { z } from "zod";
const baseCreateSchema = z.object({
  companyId: z.string().uuid(),
  quotedFee: z.number().nonnegative(),
});

const createNameChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("name_change"),
  newNameEn: z.string().min(1),
  newNameZh: z.string().nullable(),
});

const transfereeFields = {
  transfereeShareholdingId: z.string().uuid("請選擇有效的承讓人股權。").nullable(),
  transfereeNewShareholderName: z
    .string()
    .trim()
    .nullable()
    .transform((value) => value || null),
};

// Usable independently while a draft still has unfinished numeric fields.
export const shareTransferTransfereeSchema = z
  .object(transfereeFields)
  .superRefine((input, ctx) => {
    if (Boolean(input.transfereeShareholdingId) !== Boolean(input.transfereeNewShareholderName))
      return;
    for (const field of ["transfereeShareholdingId", "transfereeNewShareholderName"]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: input.transfereeShareholdingId
          ? "只可選擇承讓人股權或填寫新股東名稱，不能同時提供。"
          : "請選擇承讓人股權或填寫新股東名稱。",
        path: [field],
      });
    }
  });

const createShareTransferSchema = baseCreateSchema.extend({
  changeType: z.literal("share_transfer"),
  transferorShareholdingId: z.string().uuid("請選擇有效的轉讓人股權。"),
  sharesTransferred: z
    .number({ invalid_type_error: "請輸入有效轉讓股數。" })
    .int("轉讓股數必須為整數。")
    .min(1, "轉讓股數必須大於零。")
    .max(2147483647, "轉讓股數不可超過 2,147,483,647。"),
  consideration: z.number().finite().nonnegative(),
  stampDutyAmount: z.number().finite().nonnegative(),
  ...transfereeFields,
  transfereeNewShareholderAddress: z.string().nullable(),
});

const createOfficerChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("officer_change"),
  officerAction: z.enum(["appoint", "resign", "detail_change"]),
  officerId: z.string().uuid().nullable(),
  newOfficerType: z.enum(["director", "secretary"]).nullable(),
  newOfficerName: z.string().nullable(),
  newOfficerIdentificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
  newOfficerIdentificationNumber: z.string().nullable(),
  newOfficerAddress: z.string().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createAddressChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("address_change"),
  newRegisteredOffice: z.string().min(1),
});

// zod v3's discriminatedUnion introspects each member's `.shape`, so members must stay plain
// ZodObjects — a `.refine()` on `createShareTransferSchema` would return a ZodEffects with no
// `.shape` and crash discriminatedUnion at schema-construction time. The "exactly one of an
// existing transferee or a new shareholder name" cross-field check is applied afterwards, via
// superRefine on the assembled union, and only when the branch is share_transfer.
export const createCorporateChangeRequestSchema = z
  .discriminatedUnion("changeType", [
    createNameChangeSchema,
    createShareTransferSchema,
    createOfficerChangeSchema,
    createAddressChangeSchema,
  ])
  .superRefine((input, ctx) => {
    if (input.changeType === "share_transfer") {
      const result = shareTransferTransfereeSchema.safeParse(input);
      if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  });
