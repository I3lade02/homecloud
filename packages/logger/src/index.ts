import pino, { type LoggerOptions } from "pino";

export function createLogger(name: string) {
  const options: LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? "info",
  };

  if (process.env.NODE_ENV !== "production") {
    return pino(
      options,
      pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          singleLine: true,
          translateTime: "SYS:standard",
        },
      }),
    );
  }

  return pino(options);
}
