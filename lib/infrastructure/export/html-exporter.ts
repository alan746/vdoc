import type { FileExporter } from '../../usecases/ports';
import { exportHTML } from './html-export';

export const htmlExporter: FileExporter = {
  write: source => ({ blob: new Blob([exportHTML(source.title, source.html, source.json)], { type: 'text/html;charset=utf-8' }) }),
};
