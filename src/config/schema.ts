import { z } from "zod";

export const runConfigSchema = z.object({
  profileDir: z.string().min(1).optional(),
  storageStatePath: z.string().min(1).optional(),
  expectedAccount: z.string().min(1).optional(),
  browserChannel: z.string().min(1).optional(),
  browserExecutablePath: z.string().min(1).optional(),
  browserCdpUrl: z.string().url().optional(),
  headless: z.boolean().default(false),
  artifactsDirName: z.string().min(1).default("artifacts"),
  stopOnAccountMismatch: z.boolean().default(true),
  slowMoMs: z.number().int().min(0).default(0),
  youtubeBaseUrl: z.url().default("https://www.youtube.com")
});

export type RunConfigInput = z.input<typeof runConfigSchema>;
