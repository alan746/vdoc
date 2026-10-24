import { z } from 'zod/v3';

// Product limits are independent of operation batch/risk limits.
export const ARTICLE_LIMITS = { blocks: 80, blockLength: 3000, totalLength: 12000, titleLength: 200 } as const;
const text = z.string().trim().min(1).max(ARTICLE_LIMITS.blockLength);
export const structuredArticleSchema = z.object({
  callId: z.string().min(1).max(128),
  expectedSessionId: z.string().min(1).max(128),
  expectedRevision: z.number().int().nonnegative(),
  destination: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('document_end') }).strict(),
    z.object({ kind: z.literal('before_block'), blockId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('after_block'), blockId: z.string().min(1) }).strict(),
  ]),
  title: z.string().trim().min(1).max(ARTICLE_LIMITS.titleLength),
  blocks: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('paragraph'), text }).strict(),
    z.object({ kind: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text }).strict(),
  ])).min(1).max(ARTICLE_LIMITS.blocks),
}).strict().superRefine((article, ctx) => {
  let level = 1;
  let needsBody = true;
  let total = article.title.length;
  article.blocks.forEach((block, index) => {
    total += block.text.length;
    if (block.kind === 'heading') {
      if (block.level > level + 1) ctx.addIssue({ code: 'custom', path: ['blocks', index], message: 'Heading levels cannot skip from H1 to H3.' });
      if (needsBody) ctx.addIssue({ code: 'custom', path: ['blocks', index], message: 'Each section, including the introduction, needs body text before another heading.' });
      level = block.level;
      needsBody = true;
    } else needsBody = false;
  });
  if (needsBody) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'The final section needs body text; incomplete articles cannot be inserted.' });
  if (total > ARTICLE_LIMITS.totalLength) ctx.addIssue({ code: 'custom', message: 'Article exceeds the total length limit.' });
});
export type StructuredArticle = z.infer<typeof structuredArticleSchema>;
export type ArticleResult = { ok: boolean; id: string; revision: number; code?: string; error?: string; title?: string; insertedBlockIds?: string[]; headingCounts?: Record<1 | 2 | 3, number>; paragraphCount?: number };

/** Transport identities are supplied by the trusted realtime executor. */
export const realtimeArticleSchema = structuredArticleSchema.innerType().omit({ callId: true }).superRefine((input, ctx) => {
  const parsed = structuredArticleSchema.safeParse({ ...input, callId: 'validation' });
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue(issue);
});
