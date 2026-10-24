import { z } from 'zod/v3';

// vdoc-server's document/session identifiers are URL path segments.
export const voiceResourceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  .refine(id => id !== '.' && id !== '..', 'Invalid resource ID.');
export const voiceLanguageSchema = z.string().max(100).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export const voiceVocabularySchema = z.array(z.string().trim().min(1).max(40)).max(50);
export const voiceDocumentContextSchema = z.object({
  documentId: voiceResourceIdSchema, title: z.string().max(120),
  language: voiceLanguageSchema, vocabulary: voiceVocabularySchema,
}).strict();
export type VoiceDocumentContext = z.infer<typeof voiceDocumentContextSchema>;
export const voiceGrantSchema = z.object({ token: z.string().trim().min(1).max(16384), expiresAt: z.number().int().positive() });
export const createdVoiceSessionSchema = z.object({
  documentId: voiceResourceIdSchema, sessionId: voiceResourceIdSchema,
  transportDocumentId: voiceResourceIdSchema.optional(),
  grant: voiceGrantSchema, realtimePath: z.string().min(1).max(1024),
});
export const voiceDocumentRequestSchema = z.object({ documentId: voiceResourceIdSchema, workspace: z.enum(['cloud', 'local']).optional() }).strict();
export const voiceRealtimePath = (documentId: string, sessionId: string) =>
  `/v1/documents/${encodeURIComponent(documentId)}/voice-sessions/${encodeURIComponent(sessionId)}/realtime`;
