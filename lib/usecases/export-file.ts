import type { FormatRegistry } from './file-formats';
import type { DocumentExportSource, PaginatedExportSource, ExportPayload, FileExportOptions } from './ports';

export type ExportedFile = ExportPayload & { name: string };

/** Binds conversion strategies and portable naming, without browser delivery. */
export function createFileExport(registry: FormatRegistry, filename: (title: string, extension: string) => string) {
  function finish(id: string, title: string, payload: ExportPayload | Promise<ExportPayload>, options?: FileExportOptions): ExportedFile | Promise<ExportedFile> {
    const name = filename(title, registry.get(id).extension);
    const result = (value: ExportPayload) => { options?.signal?.throwIfAborted(); return { ...value, name }; };
    return payload instanceof Promise ? payload.then(result) : result(payload);
  }
  return {
    exportDocument(id: string, source: DocumentExportSource, options?: FileExportOptions) {
      const capability = registry.get(id).export;
      if (capability?.kind !== 'document') throw new Error(`Format ${id} cannot export an editor snapshot.`);
      options?.signal?.throwIfAborted();
      return finish(id, source.title, capability.strategy.write(source, options), options);
    },
    exportPages(id: string, source: PaginatedExportSource, options?: FileExportOptions) {
      const capability = registry.get(id).export;
      if (capability?.kind !== 'paginated') throw new Error(`Format ${id} cannot export paginated sheets.`);
      options?.signal?.throwIfAborted();
      return finish(id, source.title, capability.strategy.write(source, options), options);
    },
  };
}
