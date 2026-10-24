import { structuredArticleSchema, type ArticleResult } from '../domain/entities/structured-article';
import { articleNodes } from '../editor/document/structured-article';
import { listSelectionBoundaryError } from '../editor/list/list-conversion';
import { documentNavigation } from './document-navigation';
import type { Editor } from '@tiptap/core';
import type { SelectionBookmark } from '@tiptap/pm/state';
import { Mark } from '@tiptap/pm/model';
import { closeHistory, undoDepth, redoDepth } from '@tiptap/pm/history';
import { agentRequestSchema, externalRequestSchema, requestSchema, operationLabel, type AgentOrigin, type AppliedChange, type OperationRecord, type OperationResult } from '../domain/entities/operation';
import { applyOperation, commandContext } from '../editor/commands/registry';
import { resolveTargetSelection } from '../editor/commands/target-selection';
import { documentSnapshot, documentOutline, readBlocks, selectionBlockContext } from '../editor/document-snapshot';
import { BlockIndex, type BlockRange } from '../editor/document/block-index';
import { changedBlockIds } from '../editor/document/changed-blocks';
import { SelectiveUndoHistory } from '../editor/document/selective-undo';
import { requestSignature } from '../shared/request-signature';

/** A selection captured now and kept mapped through every later document change until released. */
export type SelectionAnchor = { resolve(): { from: number; to: number }; release(): void };

/** Single synchronous writer for programmatic edits. Native typing remains in ProseMirror. */
export class DocumentEngine {
  readonly sessionId = crypto.randomUUID();
  private disposed = false;
  revision = 0;
  records: OperationRecord[] = [];
  private bookmark: SelectionBookmark | null = null;
  private anchors = new Set<{ bookmark: SelectionBookmark }>();
  private results = new Map<string, { signature: string; result: OperationResult }>();
  private articleResults = new Map<string, { signature: string; result: ArticleResult }>();
  private listeners = new Set<() => void>();
  private appliedListeners = new Set<(event: AppliedChange) => void>();
  private blocks = new BlockIndex();
  private turnHistory: SelectiveUndoHistory;
  private clearBookmarkOnInput = () => { this.bookmark = null; };
  private handleTransaction: (event: { transaction: import('@tiptap/pm/state').Transaction; appendedTransactions?: import('@tiptap/pm/state').Transaction[] }) => void;

  constructor(readonly editor: Editor, options: { undoStepLimit?: number } = {}) {
    this.turnHistory = new SelectiveUndoHistory(options.undoStepLimit);
    this.blocks.update(editor.state.doc);
    this.handleTransaction = ({ transaction, appendedTransactions = [] }) => {
      this.turnHistory.record(transaction, appendedTransactions);
      // Appended transactions (stable IDs, reference sync, list numbering) change
      // the document too, even when the dispatched one did not. One definition of
      // "the document changed" feeds the revision and the bookmarks;
      // the revision advances once per dispatch, however many steps it held.
      const changed = [transaction, ...appendedTransactions].filter(tr => tr.docChanged);
      if (changed.length) {
        this.revision++;
        const map = (bookmark: SelectionBookmark) => changed.reduce((current, tr) => current.map(tr.mapping), bookmark);
        if (this.bookmark) this.bookmark = map(this.bookmark);
        for (const anchor of this.anchors) anchor.bookmark = map(anchor.bookmark);
      }
      for (const listener of this.listeners) listener();
    };
    editor.on('transaction', this.handleTransaction);
    editor.view.dom.addEventListener('pointerdown', this.clearBookmarkOnInput);
    editor.view.dom.addEventListener('keydown', this.clearBookmarkOnInput);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onApplied(listener: (event: AppliedChange) => void) { this.appliedListeners.add(listener); return () => { this.appliedListeners.delete(listener); }; }
  destroy() {
    this.disposed = true;
    this.editor.off('transaction', this.handleTransaction);
    this.editor.view.dom.removeEventListener('pointerdown', this.clearBookmarkOnInput);
    this.editor.view.dom.removeEventListener('keydown', this.clearBookmarkOnInput);
    this.listeners.clear();
    this.appliedListeners.clear();
    this.anchors.clear();
    this.turnHistory.clear();
  }
  captureSelection() { this.bookmark = this.editor.state.selection.getBookmark(); }
  /** The user's current selection, kept pointing at the same content through later edits (agent or user) until released. */
  anchorSelection(): SelectionAnchor {
    const anchor = { bookmark: this.editor.state.selection.getBookmark() };
    this.anchors.add(anchor);
    return {
      resolve: () => { const selection = anchor.bookmark.resolve(this.editor.state.doc); return { from: selection.from, to: selection.to }; },
      release: () => { this.anchors.delete(anchor); },
    };
  }
  clearSelectionBookmark() { this.bookmark = null; }
  /** Programmatic edits are possible: the engine and editor are alive and the editor is editable. */
  canEdit() { return !this.disposed && !this.editor.isDestroyed && this.editor.isEditable; }
  /** The document body or a registered workspace field (title, find, dialogs) is mid IME composition. */
  isComposing() { return documentNavigation(this.editor).isComposing(); }
  get canUndo() { return undoDepth(this.editor.state) > 0; }
  get canRedo() { return redoDepth(this.editor.state) > 0; }

  /** Synchronous validation and commit: no async gap between preconditions and insertion. */
  insertStructuredArticle(input: unknown, options: { signal?: AbortSignal; origin?: AgentOrigin } = {}): ArticleResult {
    const fail = (code: string, error: string): ArticleResult => ({ ok: false, id: typeof (input as { callId?: unknown } | null)?.callId === 'string' ? (input as {callId: string}).callId : '', revision: this.revision, code, error });
    const parsed = structuredArticleSchema.safeParse(input);
    if (!parsed.success) return fail('INVALID', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const article = parsed.data;
    if (this.disposed || this.editor.isDestroyed || !this.editor.isEditable) return fail('UNAVAILABLE', 'The document is not editable.');
    if (article.expectedSessionId !== this.sessionId) return fail('STALE', 'The editing session has changed.');
    const signature = JSON.stringify(article);
    const prior = this.articleResults.get(article.callId);
    if (prior) return prior.signature === signature ? prior.result : fail('DUPLICATE', 'A callId cannot be reused for different article parameters.');
    if (options.signal?.aborted) return fail('CANCELLED', 'The article insertion was cancelled.');
    if (options.origin && (!options.origin.actor || !options.origin.turnId)) return fail('INVALID', 'Agent origin requires actor and turnId.');
    if (documentNavigation(this.editor).isComposing()) return fail('COMPOSING', 'Finish the current text composition first.');
    if (article.expectedRevision !== this.revision) return fail('STALE', 'The document has changed. Keep the article and refresh the destination and revision.');
    let position = this.editor.state.doc.content.size;
    const destination = article.destination;
    if (destination.kind !== 'document_end') {
      let found = false;
      this.editor.state.doc.forEach((node, offset) => {
        if (node.attrs.blockId === destination.blockId) { found = true; position = offset + (destination.kind === 'after_block' ? node.nodeSize : 0); }
      });
      if (!found) return fail('TARGET', 'The destination must be an existing top-level block boundary.');
    }
    const nodes = articleNodes(this.editor.schema, article);
    const state = this.editor.state;
    const tr = closeHistory(state.tr).insert(position, nodes);
    tr.setSelection(state.selection.map(tr.doc, tr.mapping)).setStoredMarks(state.storedMarks);
    tr.setMeta('vdoc', { id: article.callId, source: options.origin ? 'agent' : 'api', ...options.origin });
    if (options.origin) tr.setMeta('addToHistory', false);
    tr.doc.check();
    if (options.signal?.aborted) return fail('CANCELLED', 'The article insertion was cancelled.');
    this.editor.view.dispatch(tr);
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    const headingCounts = { 1: 1, 2: 0, 3: 0 };
    let paragraphCount = 0;
    for (const block of article.blocks) { if (block.kind === 'heading') headingCounts[block.level]++; else paragraphCount++; }
    const result: ArticleResult = { ok: true, id: article.callId, revision: this.revision, title: article.title, insertedBlockIds: nodes.map(node => node.attrs.blockId as string), headingCounts, paragraphCount };
    this.articleResults.set(article.callId, { signature, result });
    this.record(article.callId, 'Insert structured article', options.origin ? 'agent' : 'api', nodes.length, options.origin);
    const event: AppliedChange = Object.freeze({ id: article.callId, label: 'Insert structured article', source: options.origin ? 'agent' : 'api', ...options.origin, revision: this.revision, changedBlockIds: Object.freeze(result.insertedBlockIds!), documentChanged: true });
    for (const listener of this.appliedListeners) listener(event);
    return result;
  }

  executeExternal(input: unknown): OperationResult {
    const parsed = externalRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, id: crypto.randomUUID(), revision: this.revision, code: 'INVALID', error: parsed.error.issues[0]?.message || 'Read the document and supply session, revision, and an explicit target.' };
    if (parsed.data.expectedRevision === undefined && parsed.data.expectedBlocks === undefined) return { ok: false, id: parsed.data.id ?? crypto.randomUUID(), revision: this.revision, code: 'STALE', error: 'Supply a revision or covering block versions.' };
    return this.execute(parsed.data);
  }

  /** Automated callers: external rules plus an agent origin. The user's selection, stored marks, focus and toolbar bookmark stay as they were. */
  executeAgent(input: unknown, origin: AgentOrigin): OperationResult {
    const parsed = agentRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, id: crypto.randomUUID(), revision: this.revision, code: 'INVALID', error: parsed.error.issues[0]?.message || 'Read the document and supply session, revision, and an explicit target.' };
    if (parsed.data.expectedRevision === undefined && parsed.data.expectedBlocks === undefined) return { ok: false, id: parsed.data.id ?? crypto.randomUUID(), revision: this.revision, code: 'STALE', error: 'Supply a revision or covering block versions.' };
    return this.execute({ ...parsed.data, source: 'agent', actor: origin.actor, turnId: origin.turnId });
  }

  execute(input: unknown): OperationResult {
    const parsed = requestSchema.safeParse(input);
    const id = parsed.success ? parsed.data.id ?? crypto.randomUUID() : crypto.randomUUID();
    const fail = (code: OperationResult['code'], error: string): OperationResult => ({ ok: false, id, revision: this.revision, code, error });
    if (!parsed.success) return fail('INVALID', parsed.error.issues[0]?.message ?? 'Invalid operation parameters.');
    const request = parsed.data;
    if (!this.canEdit()) return fail('UNAVAILABLE', 'The document is not editable.');
    if (request.expectedSessionId !== undefined && request.expectedSessionId !== this.sessionId) return fail('STALE', 'The editing session has changed. Read the document again.');
    // Only a caller-supplied ID can be retried, so only those requests are
    // remembered; a generated ID is unknown to the caller until it is returned.
    const signature = request.id === undefined ? undefined : requestSignature(request);
    const prior = signature === undefined ? undefined : this.results.get(id);
    if (prior) return prior.signature === signature ? prior.result : fail('DUPLICATE', 'An operation ID cannot be reused for a different request.');
    // Workspace fields (title, find, dialog inputs) compose outside ProseMirror.
    // Share their registered guards with navigation so programmatic edits cannot
    // bypass the protection just because the document body is not composing.
    if (this.isComposing()) return fail('COMPOSING', 'Finish the current text composition first.');
    if (request.expectedRevision !== undefined && request.expectedRevision !== this.revision) return fail('STALE', 'The document has changed. Read the target again.');
    if (request.expectedBlocks !== undefined) {
      if (request.expectedRevision === undefined && request.operations.some(op => op.type.startsWith('document.') || op.type === 'text.findReplace' || op.type === 'block.move' || op.type === 'block.insert' || op.type === 'block.delete')) return fail('STALE', 'Document-wide operations require a document revision.');
      const target = request.target;
      const targetId = target.kind === 'block' ? target.id : target.kind === 'text' ? target.blockId : target.kind === 'cell' || target.kind === 'cells' ? target.tableId : undefined;
      if (request.expectedRevision === undefined && (!targetId || !request.expectedBlocks.some(block => block.id === targetId))) return fail('STALE', 'Block versions must cover the target.');
      if (request.expectedBlocks.some(block => this.index().version(block.id) !== block.version)) return fail('STALE', 'A target block has changed. Read it again.');
    }
    if (request.target.kind === 'range' && request.expectedRevision === undefined) return fail('STALE', 'An explicit range requires a document revision.');
    // Find/replace and document settings act on the whole document, so a target that has gone stale
    // (an agent replaying a confirmed call after other edits) must not stop them.
    const documentWide = request.operations.every(op => op.type === 'text.findReplace' || op.type.startsWith('document.'));
    if (!documentWide && request.target.kind === 'range' && (request.target.from > request.target.to || request.target.to > this.editor.state.doc.content.size)) return fail('TARGET', 'Invalid target range.');

    const agent = request.source === 'agent';
    const userSelection = this.editor.state.selection, userMarks = this.editor.state.storedMarks;
    let selection = userSelection;
    try {
      if (request.target.kind === 'selection' && request.source === 'toolbar' && this.bookmark) selection = this.bookmark.resolve(this.editor.state.doc);
      const resolved = resolveTargetSelection(request.target, this.editor.state.doc, selection);
      if ('error' in resolved) { if (!documentWide) return fail('TARGET', resolved.error); }
      else selection = resolved;
    } catch { if (!documentWide) return fail('TARGET', 'The target could not be located. Select it again.'); }

    const beforeRevision = this.revision;
    const beforeDocument = this.editor.state.doc;
    const beforeMarks = selection.empty
      ? (selection.eq(this.editor.state.selection) ? this.editor.state.storedMarks : null) ?? selection.$from.marks()
      : [];
    let error = '';
    const ok = this.editor.chain().command(props => {
      const { tr } = props;
      closeHistory(tr);
      // Re-setting an unchanged cursor clears the user's active typing marks.
      if (!tr.selection.eq(selection)) tr.setSelection(selection);
      tr.setMeta('vdoc', { id, source: request.source, actor: request.actor, turnId: request.turnId });
      if (agent) tr.setMeta('addToHistory', false);
      try {
        const context = commandContext(props, message => { error = message; });
        for (const operation of request.operations) {
          // Agent insertion must never silently replace a selected block or
          // range, including text selected by an earlier operation in a batch.
          // A text range spanning paragraphs or cells would flatten them into one when replaced or
          // deleted (a whole section emptied, the paragraph after a table pulled into its last cell).
          if (agent && (operation.type === 'text.replace' || operation.type === 'text.delete') && !tr.selection.$from.sameParent(tr.selection.$to)) {
            error = `${operation.type} must stay inside one paragraph, heading or table cell. To remove whole paragraphs use block.delete with each paragraph's id; to rewrite one paragraph use a text target on that block.`;
            break;
          }
          if (agent && operation.type === 'text.insert' && !tr.selection.empty) {
            error = 'text.insert requires an empty insertion target. Read the destination again and use equal start/end text offsets or equal from/to range positions. Use text.replace only for an explicitly requested replacement.';
            break;
          }
          if (!applyOperation(operation, context)) { error ||= (operation.type === 'list.toggle' ? listSelectionBoundaryError(props.tr.selection) : null) || 'This operation is not available for the current selection.'; break; }
        }
        // The agent edits beside the user, not through the user's cursor.
        if (agent && !error) tr.setSelection(userSelection.map(tr.doc, tr.mapping)).setStoredMarks(userMarks);
        tr.doc.check();
      } catch { error = 'The operation could not be completed. The document is unchanged.'; }
      if (error) tr.setMeta('preventDispatch', true);
      return !error;
    }).run();
    if (!ok || error) return fail('UNAVAILABLE', error || 'The operation was not completed.');

    // Separate this command from subsequent native typing / commands.
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    if (!agent) this.bookmark = null;
    if (request.source === 'toolbar' || request.source === 'keyboard') this.editor.view.focus();
    const afterSelection = this.editor.state.selection;
    const afterMarks = afterSelection.empty ? this.editor.state.storedMarks ?? afterSelection.$from.marks() : [];
    const label = request.label ?? request.operations.map(operationLabel).join(' · ');
    if (this.revision !== beforeRevision || (!agent && !Mark.sameSet(beforeMarks, afterMarks)))
      this.record(id, label, request.source, request.operations.length, agent ? { actor: request.actor!, turnId: request.turnId! } : undefined);
    const movedIds = [...new Set(request.operations.flatMap(op => op.type === 'block.move' ? [op.id] : []))];
    const result: OperationResult = { ok: true, id, revision: this.revision,
      ...(movedIds.length ? { blockMoves: movedIds.map(id => ({ id, location: this.index().get(id)?.location ?? null })) } : {}),
    };
    if (signature !== undefined) {
      this.results.set(id, { signature, result });
      if (this.results.size > 200) this.results.delete(this.results.keys().next().value!);
    }
    const documentChanged = !beforeDocument.eq(this.editor.state.doc);
    if (this.appliedListeners.size && (documentChanged || (!agent && !Mark.sameSet(beforeMarks, afterMarks)))) {
      const event: AppliedChange = Object.freeze({ id, label, source: request.source, ...(agent ? { actor: request.actor, turnId: request.turnId } : {}), revision: result.revision,
        changedBlockIds: Object.freeze(changedBlockIds(beforeDocument, this.editor.state.doc)), documentChanged });
      for (const listener of this.appliedListeners) listener(event);
    }
    return result;
  }

  history(action: 'undo' | 'redo', source = 'toolbar'): OperationResult {
    const id = crypto.randomUUID();
    if (!this.canEdit()) return { ok: false, id, revision: this.revision, code: 'UNAVAILABLE', error: 'The document is not editable.' };
    if (this.isComposing()) return { ok: false, id, revision: this.revision, code: 'COMPOSING', error: 'Finish the current text composition first.' };
    this.bookmark = null;
    const ok = this.editor.commands[action]();
    if (ok) {
      this.editor.view.dispatch(closeHistory(this.editor.state.tr));
      if (source !== 'api') this.editor.view.focus();
      this.record(id, action === 'undo' ? 'Undo' : 'Redo', source, 1);
    }
    return { ok, id, revision: this.revision, ...(ok ? {} : { code: 'UNAVAILABLE' as const, error: 'There is nothing to undo or redo.' }) };
  }

  undoTurn(turnId: string, origin: AgentOrigin): OperationResult {
    const id = crypto.randomUUID();
    const fail = (code: OperationResult['code'], error: string): OperationResult => ({ ok: false, id, revision: this.revision, code, error });
    if (!this.canEdit()) return fail('UNAVAILABLE', 'The document is not editable.');
    if (typeof turnId !== 'string' || !turnId || !origin || typeof origin.actor !== 'string' || !origin.actor || origin.actor.length > 128 || typeof origin.turnId !== 'string' || !origin.turnId || origin.turnId.length > 128) return fail('INVALID', 'Undo needs an actor and a new turn ID.');
    const undoOrigin = { actor: origin.actor, turnId: origin.turnId };
    if (this.isComposing()) return fail('COMPOSING', 'Finish the current text composition first.');
    const before = this.editor.state.doc;
    const plan = this.turnHistory.prepare(this.editor.state, turnId, origin.turnId);
    if (!plan.ok) return fail('UNAVAILABLE', plan.error);
    const tr = plan.transaction;
    tr.setSelection(this.editor.state.selection.map(tr.doc, tr.mapping)).setStoredMarks(this.editor.state.storedMarks);
    closeHistory(tr).setMeta('addToHistory', false).setMeta('vdoc', { id, source: 'agent', ...undoOrigin });
    this.editor.view.dispatch(tr);
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    const label = `Undo turn ${turnId}`;
    this.record(id, label, 'agent', tr.steps.length, undoOrigin);
    const result = { ok: true, id, revision: this.revision };
    if (this.appliedListeners.size) {
      const event: AppliedChange = Object.freeze({ id, label, source: 'agent', ...undoOrigin, revision: result.revision,
        changedBlockIds: Object.freeze(changedBlockIds(before, this.editor.state.doc)), documentChanged: true });
      for (const listener of this.appliedListeners) listener(event);
    }
    return result;
  }

  snapshot() { return documentSnapshot(this.editor, this.sessionId, this.revision, this.index()); }
  outline() { return documentOutline(this.index()); }
  readBlocks(ids: readonly string[]) { return readBlocks(this.index(), ids); }
  selectionContext(selection: { from: number; to: number }) { return selectionBlockContext(this.index(), selection, this.editor.state.doc); }
  hasBlock(id: string) { return this.index().has(id); }
  /** Current range of a block in the live document, without walking it. */
  locateBlock(id: string): BlockRange | undefined { return this.index().range(id); }
  // Rebuild on the first read of a changed document, including updateState
  // replacements. All readers share it until the document changes again.
  // Block versions compare content with the last indexed read, not every edit.
  private index() {
    if (!this.blocks.describes(this.editor.state.doc)) this.blocks.update(this.editor.state.doc);
    return this.blocks;
  }
  private record(id: string, label: string, source: string, count: number, origin?: AgentOrigin) {
    this.records = [{ id, label, source, time: Date.now(), revision: this.revision, count, ...origin }, ...this.records].slice(0, 60);
    for (const listener of this.listeners) listener();
  }
}
