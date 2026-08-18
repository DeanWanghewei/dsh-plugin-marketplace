import { z } from 'zod'

const localizedText = z.object({
  zh: z.string().optional(),
  en: z.string().optional(),
})

export const categoryDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'category id must be a lowercase slug'),
  name: localizedText,
  parent: z.string().nullable().default(null),
  description: z.string().optional(),
})

export const pluginSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('npm'), package: z.string().min(1) }),
  z.object({
    type: z.literal('git'),
    url: z.string().min(1),
    ref: z.string().optional(),
    subdir: z.string().optional(),
    private: z.boolean().optional(),
  }),
  z.object({ type: z.literal('path'), path: z.string().min(1), link: z.boolean().optional() }),
])

/** Demo gallery image: a plain https URL — GitHub attachment, S3-proxy link, any host. */
export const pluginImageSchema = z.object({
  url: z.string().url().regex(/^https?:\/\//, 'image url must be http(s)'),
  caption: z.string().optional(),
})

export const pluginEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'plugin id must be a lowercase slug'),
  name: z.string().min(1),
  description: z.string().default(''),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  author: z.string().optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  verified: z.boolean().default(false),
  source: pluginSourceSchema,
  images: z.array(pluginImageSchema).default([]),
  requires: z.array(z.string()).optional(),
  requiresServices: z.array(z.string()).optional(),
  providesServices: z.array(z.string()).optional(),
})

export const registryDataSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  categories: z.array(categoryDefSchema).default([]),
  plugins: z.array(pluginEntrySchema).default([]),
})

export interface RawRegistryInput {
  schemaVersion?: number
  name?: string
  categories?: unknown
  plugins?: unknown
}

export interface RegistryParseError {
  message: string
}

/** Parse and validate a registry document; returns a typed result instead of throwing. */
export function parseRegistry(
  input: RawRegistryInput,
): { ok: true; data: import('./types.js').RegistryData } | { ok: false; error: string } {
  const result = registryDataSchema.safeParse(input)
  if (result.success) {
    return { ok: true, data: result.data as import('./types.js').RegistryData }
  }
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
  return { ok: false, error: issues }
}
