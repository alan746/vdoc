import { createFormatRegistry } from '../usecases/file-formats';
import { backupImporter } from '../infrastructure/importers/backup-importer';
import { wordImporter } from '../infrastructure/importers/word-importer';
import { textImporter } from '../infrastructure/importers/text-importer';
import { backupExporter } from '../infrastructure/export/backup-exporter';
import { htmlExporter } from '../infrastructure/export/html-exporter';
import { wordExporter } from '../infrastructure/export/word-exporter';
import { textExporter } from '../infrastructure/export/text-exporter';
import { pdfExporter } from '../infrastructure/export/pdf-exporter';

/** Add a strategy module and one entry here to extend import, export and both menus. */
export const fileFormats = createFormatRegistry([
  { id: 'json', label: 'VDoc backup', extension: 'vdoc.json', menuLabel: 'Download VDoc backup',
    import: { extensions: ['json'], strategy: backupImporter },
    export: { kind: 'document', delivery: 'download', strategy: backupExporter } },
  { id: 'html', label: 'HTML', extension: 'html', menuLabel: 'Download HTML',
    export: { kind: 'document', delivery: 'download', strategy: htmlExporter } },
  { id: 'docx', label: 'Word', extension: 'docx', menuLabel: 'Download Word (.docx)',
    import: { extensions: ['docx'], strategy: wordImporter, maxBytes: 20_000_000 },
    export: { kind: 'document', delivery: 'prepared', strategy: wordExporter } },
  { id: 'txt', label: 'plain text', extension: 'txt', menuLabel: 'Download plain text',
    import: { extensions: ['txt'], strategy: textImporter, maxBytes: 20_000_000 },
    export: { kind: 'document', delivery: 'download', strategy: textExporter } },
  { id: 'pdf', label: 'PDF', extension: 'pdf', menuLabel: 'Print / Save as PDF',
    export: { kind: 'paginated', strategy: pdfExporter } },
]);
