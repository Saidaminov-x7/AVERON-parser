import "dotenv/config";
import path from "node:path";
import { z } from "zod";
import { parseProductSourceFeatureFlags } from "./feature-flags.js";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4318),
  HOST: z.string().default("127.0.0.1"),
  HEADLESS: z.string().default("true").transform((value) => value.toLowerCase() !== "false"),
  BROWSER_CHANNEL: z.string().default("chrome"),
  BROWSER_PROFILE_DIR: z.string().default(".browser-profile"),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MAX_RESULTS: z.coerce.number().int().min(1).max(60).default(24),
  AI_BASE_URL: z.string().url().optional().or(z.literal("")),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("qwen2.5:7b"),
  BACKEND_API_URL: z.string().url().optional().or(z.literal("")),
  PARSER_IMPORT_TOKEN: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  BACKEND_IMPORT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
}).superRefine((env, context) => {
  if (env.NODE_ENV === "production" && env.BACKEND_API_URL && new URL(env.BACKEND_API_URL).protocol !== "https:") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKEND_API_URL"],
      message: "BACKEND_API_URL must use HTTPS in production",
    });
  }
});

const env = EnvSchema.parse(process.env);

export const config = {
  port: env.PORT,
  host: env.HOST,
  headless: env.HEADLESS,
  browserChannel: env.BROWSER_CHANNEL,
  browserProfileDir: path.resolve(env.BROWSER_PROFILE_DIR),
  searchTimeoutMs: env.SEARCH_TIMEOUT_MS,
  maxResults: env.MAX_RESULTS,
  aiBaseUrl: env.AI_BASE_URL || undefined,
  aiApiKey: env.AI_API_KEY,
  aiModel: env.AI_MODEL,
  backendApiUrl: env.BACKEND_API_URL || undefined,
  parserImportToken: env.PARSER_IMPORT_TOKEN,
  backendImportTimeoutMs: env.BACKEND_IMPORT_TIMEOUT_MS,
  productSourceFeatureFlags: parseProductSourceFeatureFlags(),
  dataDir: path.resolve("data"),
  publicDir: path.resolve("public"),
};
