import { z } from "zod";

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return value;
}, z.boolean());

const commonSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PICLOUD_NAME: z.string().min(1).default("PiCloud"),

  PICLOUD_VERSION: z.string().min(1).default("0.2.0"),

  DATABASE_URL: z.string().url(),

  VALKEY_URL: z.string().url(),

  STORAGE_PATH: z.string().min(1).default("./data"),
});

const apiSchema = commonSchema.extend({
  API_HOST: z.string().min(1).default("0.0.0.0"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  COOKIE_SECURE: booleanFromEnvironment.default(false),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(10 * 1024 * 1024 * 1024),

  UPLOAD_CHUNK_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(256 * 1024)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),

  UPLOAD_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
});

export type CommonConfig = z.infer<typeof commonSchema>;
export type ApiConfig = z.infer<typeof apiSchema>;

function parse<T>(schema: z.ZodType<T>, environment: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(environment);

  if (!result.success) {
    console.error("Invalid PiCloud environment configuration");
    console.error(z.prettifyError(result.error));

    throw new Error("Invalid environment configuration");
  }

  return result.data;
}

export function loadCommonConfig(environment = process.env): CommonConfig {
  return parse(commonSchema, environment);
}

export function loadApiConfig(environment = process.env): ApiConfig {
  return parse(apiSchema, environment);
}
