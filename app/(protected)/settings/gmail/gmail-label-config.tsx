'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Hair, Body } from '@/components/ui/typography';
import { listGmailLabels } from '@/app/actions/gmail/list-labels';
import { saveLabelMapping } from '@/app/actions/gmail/save-label-mapping';

interface AccountRow {
  id: string;
  name: string;
  type: string;
  institutionName: string | null;
  ownerTag: string;
  gmailLabelId: string | null;
}

interface GmailLabel {
  id: string;
  name: string;
}

const NONE_VALUE = '__none__';

export function GmailLabelConfig({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  const [loadingLabels, setLoadingLabels] = useState(false);

  const handleLoadLabels = async () => {
    setLoadingLabels(true);
    try {
      const result = await listGmailLabels();
      if (result.ok) {
        setLabels(result.labels);
        toast.success(`${result.labels.length} labels cargados`);
      } else if (result.error === 'not_configured') {
        toast.error('Gmail no configurado. Corré `npm run oauth:google-token` primero.');
      } else {
        toast.error('Error al cargar labels');
      }
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleSave = (accountId: string, labelId: string) => {
    const value = labelId === NONE_VALUE ? null : labelId;
    startTransition(async () => {
      const result = await saveLabelMapping({ accountId, gmailLabelId: value });
      if (result.ok) {
        toast.success('Label guardado');
        router.refresh();
      } else {
        toast.error('Error al guardar');
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleLoadLabels}
          disabled={loadingLabels}
        >
          {loadingLabels ? 'Cargando...' : labels ? 'Recargar labels' : 'Cargar labels de Gmail'}
        </Button>
        {labels && (
          <Body>{labels.length} labels disponibles</Body>
        )}
      </div>

      <Hair />

      <div className="space-y-3">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border/40 pb-3"
          >
            <div>
              <span className="font-display text-sm text-foreground">{acc.name}</span>
              {acc.institutionName && (
                <span className="ml-2 font-sans text-[9px] uppercase tracking-wide text-muted-foreground">
                  {acc.institutionName} · {acc.ownerTag}
                </span>
              )}
              {acc.gmailLabelId && (
                <span className="ml-2 inline-block rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-800">
                  Configurado
                </span>
              )}
            </div>

            {labels ? (
              <Select
                value={acc.gmailLabelId ?? NONE_VALUE}
                onValueChange={(v) => handleSave(acc.id, v)}
                disabled={isPending}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Sin label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Sin label —</SelectItem>
                  {labels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                {acc.gmailLabelId ?? '—'}
              </span>
            )}

            {acc.gmailLabelId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSave(acc.id, NONE_VALUE)}
                disabled={isPending}
                className="text-muted-foreground"
              >
                Quitar
              </Button>
            )}
          </div>
        ))}
      </div>

      <Body className="text-xs">
        Tip: creá labels en Gmail con prefijo &quot;gd/&quot; (ej: &quot;gd/Galicia Amex&quot;).
        Configurá filtros en Gmail para que los mails del banco se etiqueten automáticamente.
      </Body>
    </div>
  );
}
