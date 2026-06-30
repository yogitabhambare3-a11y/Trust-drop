import { z } from "zod";

export const createDropSchema = z.object({
  name: z.string().min(1).max(200),
  token: z.string().min(1),
  claimStart: z.number().int().positive(),
  claimEnd: z.number().int().positive(),
  adminWallet: z.string().min(1),
  contractDropId: z.number().int().optional(),
  contractAddress: z.string().optional(),
  eligibilityMode: z.enum(["csv", "rules"]).default("csv"),
  ruleConfig: z
    .object({
      minTxCount: z.number().int().min(0).optional(),
      minAccountAgeDays: z.number().int().min(0).optional(),
      snapshotDate: z.string().optional(),
      defaultAmount: z.string().optional(),
    })
    .optional(),
  recipients: z
    .array(
      z.object({
        wallet: z.string().min(1),
        amount: z.string().regex(/^\d+$/),
      })
    )
    .optional(),
});

export const feedbackSchema = z.object({
  dropId: z.string().uuid(),
  wallet: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}
