import type { Schema, Node } from '@tiptap/pm/model';
import type { StructuredArticle } from '../../domain/entities/structured-article';

/** Only trusted editor code supplies node attributes and stable identities. */
export function articleNodes(schema: Schema, article: StructuredArticle): Node[] {
  return [{ kind: 'heading' as const, level: 1, text: article.title }, ...article.blocks].map(block =>
    schema.nodes[block.kind].createChecked({ blockId: `b_${crypto.randomUUID()}`, ...(block.kind === 'heading' ? { level: block.level } : {}) }, schema.text(block.text)));
}
