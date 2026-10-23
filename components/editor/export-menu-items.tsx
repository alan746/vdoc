import { Fragment } from 'react';
import { ArrowDownToLine, Printer } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { fileFormats } from '@/lib/composition/file-formats';
import type { FormatRegistry } from '@/lib/usecases/file-formats';

/** Shared by File and Export; presentation depends on capabilities, not format IDs. */
export function ExportMenuItems({ onExport, onPrint, busy = false, registry = fileFormats }: {
  onExport: (id: string) => void; onPrint: () => void; busy?: boolean; registry?: FormatRegistry;
}) {
  return registry.exportable.map(format => {
    const paginated = format.export?.kind === 'paginated';
    const preparing = busy && format.export?.kind === 'document' && format.export.delivery === 'prepared';
    return <Fragment key={format.id}>
      {paginated && <DropdownMenuSeparator />}
      <DropdownMenuItem disabled={preparing} onSelect={() => paginated ? onPrint() : onExport(format.id)}>
        {paginated ? <Printer /> : <ArrowDownToLine />}
        {preparing ? `Preparing ${format.label}…` : format.menuLabel}
      </DropdownMenuItem>
    </Fragment>;
  });
}
