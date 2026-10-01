import { z } from "zod";

const FeatureFlagsSchema = z.object({
  FEATURE_1688_PARSER: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  FEATURE_PINDUODUO_PARSER: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type ProductSourceFeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export function parseProductSourceFeatureFlags(environment: NodeJS.ProcessEnv = process.env): ProductSourceFeatureFlags {
  return FeatureFlagsSchema.parse(environment);
}
