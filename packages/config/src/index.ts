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
