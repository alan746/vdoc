import type { FileExporter } from '../../usecases/ports';
import { exportPlainText } from './plain-text';

export const textExporter: FileExporter = {
  write: source => ({ blob: new Blob([exportPlainText(source.doc)], { type: 'text/plain;charset=utf-8' }) }),
};
