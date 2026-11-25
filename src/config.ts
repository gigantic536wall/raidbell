import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Device } from "./rust/types.js";

const DeviceSchema = z.object({
  entityId: z.number().int().positive(),
  name: z.string().min(1).max(60),
  kind: z.enum(["switch", "alarm", "monitor"]),
});

const commaList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number().int()).min(1, "at least one chat id"));

const Env = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, "looks like 123456:ABC-... (from @BotFather)"),
    /** demo: every chat gets its own simulated server. live: one real server for the allowed chats. */
    MODE: z.enum(["live", "demo"]).default("live"),
    TELEGRAM_CHAT_ID: commaList.optional(),
    RUST_SERVER_IP: z.string().optional(),
    RUST_SERVER_PORT: z.coerce.number().int().positive().optional(),
    RUST_PLAYER_ID: z.string().regex(/^\d{17}$/, "your 17-digit Steam id").optional(),
    RUST_PLAYER_TOKEN: z.coerce.number().int().optional(),
    RUST_USE_PROXY: z.enum(["true", "false"]).default("false"),
    /** Paired devices as JSON, or a path to a JSON file (DEVICES_FILE). */
    DEVICES: z.string().optional(),
    DEVICES_FILE: z.string().default("data/devices.json"),
    POLL_SECONDS: z.coerce.number().int().min(3).max(300).default(10),
    UPKEEP_WARN_MINUTES: z.coerce.number().int().min(10).default(180),
    /** Public https URL of this service: switches from long polling to a webhook (for hosting). */
    WEBHOOK_URL: z.url().optional(),
    WEBHOOK_SECRET: z.string().min(16).optional(),
    PORT: z.coerce.number().int().positive().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MODE === "live") {
      for (const key of ["TELEGRAM_CHAT_ID", "RUST_SERVER_IP", "RUST_SERVER_PORT", "RUST_PLAYER_ID", "RUST_PLAYER_TOKEN"] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: "required in live mode (see README: Pairing)" });
        }
      }
    }
    if (env.WEBHOOK_URL && !env.PORT) {
      ctx.addIssue({ code: "custom", path: ["PORT"], message: "required with WEBHOOK_URL" });
    }
  });

export type Config = z.infer<typeof Env> & { devices: Device[] };

/** Reads and checks the environment; throws one readable message listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, readFile = (p: string) => readFileSync(p, "utf8")): Config {
  // Render tells every service its public address; use it as the webhook URL unless one is set.
  const withDefaults = env.WEBHOOK_URL || !env.RENDER_EXTERNAL_URL ? env : { ...env, WEBHOOK_URL: env.RENDER_EXTERNAL_URL };
  const parsed = Env.safeParse(withDefaults);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".") || "config"}: ${i.message}`);
    throw new Error(`Configuration problems:\n${problems.join("\n")}`);
  }
  const config = parsed.data;
  let devices: Device[] = [];
  if (config.MODE === "live") {
    const raw = config.DEVICES ?? readOptional(config.DEVICES_FILE, readFile);
    if (raw) {
      const list = z.array(DeviceSchema).safeParse(JSON.parse(raw));
      if (!list.success) {
        throw new Error(`Devices are not valid: ${list.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      devices = list.data;
    }
  }
  return { ...config, devices };
}

function readOptional(path: string, readFile: (p: string) => string): string | undefined {
  try {
    return readFile(path);
  } catch {
    return undefined;
  }
}
