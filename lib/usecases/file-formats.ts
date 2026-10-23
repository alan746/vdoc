import type { FileImporter, FileExporter, PaginatedExportSource } from './ports';

export type FormatExport =
  | { kind: 'document'; delivery: 'download' | 'prepared'; strategy: FileExporter }
  | { kind: 'paginated'; strategy: FileExporter<PaginatedExportSource> };

export type FileFormat = {
  readonly id: string;
  readonly label: string;
  /** Download suffix without the leading dot; compound extensions are allowed. */
  readonly extension: string;
  readonly menuLabel: string;
  readonly import?: { readonly extensions: readonly string[]; readonly strategy: FileImporter; readonly maxBytes?: number };
  readonly export?: FormatExport;
};

/** The same capabilities drive dispatch, menus and the picker. No format-id switches. */
export function createFormatRegistry(entries: readonly FileFormat[]) {
  const ids = new Set<string>();
  const validExtension = (value: string) => /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(value);
  const formats = Object.freeze(entries.map(entry => {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Duplicate or empty file format id: ${entry.id}`);
    if (!validExtension(entry.extension) || entry.import?.extensions.some(extension => !validExtension(extension))) {
      throw new Error(`Invalid extension for file format: ${entry.id}`);
    }
    if (!entry.import && !entry.export) throw new Error(`File format has no capabilities: ${entry.id}`);
    ids.add(entry.id);
    return Object.freeze({ ...entry,
      ...(entry.import ? { import: Object.freeze({ ...entry.import, extensions: Object.freeze([...entry.import.extensions]) }) } : {}),
      ...(entry.export ? { export: Object.freeze({ ...entry.export }) } : {}),
    });
  }));
  const importable = formats.filter(format => format.import);
  const exportable = formats.filter(format => format.export);
  return Object.freeze({
    formats,
    importable: Object.freeze(importable),
    exportable: Object.freeze(exportable),
    accept: [...new Set(importable.flatMap(format => format.import!.extensions.map(extension => `.${extension}`)))].join(','),
    get(id: string): FileFormat {
      const format = formats.find(candidate => candidate.id === id);
      if (!format) throw new Error(`Unsupported file format: ${id}`);
      return format;
    },
  });
}
export type FormatRegistry = ReturnType<typeof createFormatRegistry>;
