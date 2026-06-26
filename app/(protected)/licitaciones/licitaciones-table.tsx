import Link from 'next/link';
import { DownloadButton } from './[id]/download-button';

export type LicitacionRow = {
  id: string;
  status: 'uploaded' | 'processing' | 'done' | 'error';
  pdfCount: number;
  lunesOverride: string | null;
  createdAt: string; // ISO
  hasOutput: boolean;
};

const STATUS_LABELS: Record<LicitacionRow['status'], string> = {
  uploaded: 'Subido',
  processing: 'Procesando…',
  done: 'Listo',
  error: 'Error',
};

const STATUS_CLASSES: Record<LicitacionRow['status'], string> = {
  uploaded: 'text-muted-foreground',
  processing: 'text-amber-700',
  done: 'text-emerald-700',
  error: 'text-rose-700',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function LicitacionesTable({ rows }: { rows: LicitacionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Creado</th>
            <th className="px-3 py-2 font-medium">PDFs</th>
            <th className="px-3 py-2 font-medium">Lunes</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.createdAt)}</td>
              <td className="px-3 py-2">{r.pdfCount}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.lunesOverride ?? '—'}</td>
              <td className={`px-3 py-2 font-medium ${STATUS_CLASSES[r.status]}`}>
                {STATUS_LABELS[r.status]}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-3">
                  {r.status === 'done' && r.hasOutput && (
                    <DownloadButton jobId={r.id} size="sm" />
                  )}
                  <Link href={`/licitaciones/${r.id}`} className="text-primary hover:underline">
                    Ver
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
