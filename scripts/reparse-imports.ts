import postgres from 'postgres';
import { loadEnv } from './_env';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { ParsedTxLine } from '../lib/imports/parsers/types';
import { parserOutputSchema } from '../lib/imports/parsers/types';
import { resolveParser } from '../lib/imports/parsers/registry';
import { normalizeDescription } from '../lib/imports/category-suggest';

/**
 * Re-parsea imports confirmados para detectar líneas truncadas.
 *
 * Para cada import:
 * 1. Borra import_lines sin transaction_id (no pierde nada en confirmados)
 * 2. Descarga el PDF/CSV de Storage
 * 3. Parsea con LLM (16k tokens)
 * 4. Inserta nuevas líneas como "pending" (con sugerencia de categoría)
 * 5. Reporta: líneas originales vs nuevas
 *
 * Uso: npm run imports:reparse [--dry-run] [--id <importId>]
 */

const FLAGS = process.argv.slice(2);
const dryRun = FLAGS.includes('--dry-run');
const idFlag = FLAGS.indexOf('--id');
const specificId = idFlag >= 0 ? FLAGS[idFlag + 1] : null;
const modelFlag = FLAGS.indexOf('--model');
const modelOverride = modelFlag >= 0 ? FLAGS[modelFlag + 1] : null;

async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const modelId = modelOverride ?? process.env.IMPORT_PARSER_MODEL_DEFAULT ?? 'claude-sonnet-4-6';

  if (!directUrl || !supabaseUrl || !supabaseSecret || !anthropicKey) {
    throw new Error('DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY must be set');
  }

  const sql = postgres(directUrl, { max: 1 });
  const supabase = createClient(supabaseUrl, supabaseSecret, { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  try {
    // Get household
    const [household] = await sql<{ id: string }[]>`select id from public.households limit 1`;
    if (!household) { console.warn('No household'); return; }
    const hhId = household.id;

    // Load categories for prompt enrichment + suggestion
    const cats = await sql<{ id: string; name: string; kind: string; depth: number; parentId: string | null }[]>`
      select c.id, c.name, c.kind::text,
             case when c.parent_id is null then 0 else 1 end as depth,
             c.parent_id as "parentId"
      from public.categories c
      where c.household_id = ${hhId} and c.archived = false
      order by c.kind, c.name
    `;
    const catByName = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));

    // Build category prompt block
    const catLines = cats.map(c => {
      const prefix = c.depth === 1 ? '  - ' : '- ';
      return `${prefix}${c.name} (${c.kind})`;
    });
    const categoryBlock = `
CATEGORIZACIÓN — campo OPCIONAL "suggestedCategory":
Para cada línea, si reconocés el comercio o concepto, incluí un campo "suggestedCategory" con el NOMBRE EXACTO de la categoría más apropiada de esta lista:

${catLines.join('\n')}

Reglas:
- Usá SOLO nombres de la lista. Si no reconocés el comercio, NO incluyas el campo.
- Priorizá categorías hoja (indentadas con "  - ") sobre las padre.
- Este campo es solo una sugerencia.`;

    // Load existing transactions for category suggestion
    const txDescs = await sql<{ description: string; categoryId: string }[]>`
      select description, category_id as "categoryId"
      from public.transactions
      where household_id = ${hhId} and category_id is not null
    `;
    // Build normalized lookup: normalized description → most common category_id
    const descCatCount = new Map<string, Map<string, number>>();
    for (const tx of txDescs) {
      const norm = normalizeDescription(tx.description).toLowerCase();
      if (!norm) continue;
      if (!descCatCount.has(norm)) descCatCount.set(norm, new Map());
      const m = descCatCount.get(norm)!;
      m.set(tx.categoryId, (m.get(tx.categoryId) ?? 0) + 1);
    }
    function suggestFromHistory(desc: string): string | null {
      const norm = normalizeDescription(desc).toLowerCase();
      if (!norm) return null;
      // exact
      const exactMap = descCatCount.get(desc.trim().toLowerCase());
      if (exactMap) {
        let best = ''; let bestN = 0;
        for (const [catId, n] of exactMap) { if (n > bestN) { best = catId; bestN = n; } }
        if (best) return best;
      }
      // normalized
      const normMap = descCatCount.get(norm);
      if (normMap) {
        let best = ''; let bestN = 0;
        for (const [catId, n] of normMap) { if (n > bestN) { best = catId; bestN = n; } }
        if (best) return best;
      }
      return null;
    }

    // Get imports to re-parse
    const importsToReparse = await sql<{
      id: string; type: string; status: string; fileUrl: string;
      institutionName: string; confirmedLines: number;
    }[]>`
      select i.id, i.type::text, i.status::text, i.file_url as "fileUrl",
             inst.name as "institutionName",
             (select count(*)::int from public.import_lines il
              where il.import_id = i.id and il.transaction_id is not null) as "confirmedLines"
      from public.imports i
      left join public.institutions inst on inst.id = i.institution_id
      where i.household_id = ${hhId}
        ${specificId ? sql`and i.id = ${specificId}` : sql`and i.status = 'confirmed'`}
      order by i.created_at
    `;

    console.warn(`[reparse] ${importsToReparse.length} imports to process${dryRun ? ' (DRY RUN)' : ''}`);

    for (const imp of importsToReparse) {
      console.warn(`\n[reparse] ─── ${imp.id.slice(0, 8)} · ${imp.institutionName} ${imp.type} · ${imp.confirmedLines} confirmed lines`);

      const parser = resolveParser(imp.institutionName, imp.type as 'tc' | 'banco' | 'broker');
      if (!parser) {
        console.warn(`[reparse]   ⏭ no parser for ${imp.institutionName}/${imp.type}`);
        continue;
      }

      // Download file from Storage
      const pathParts = imp.fileUrl.split('/');
      const storagePath = pathParts.slice(-2).join('/'); // householdId/filename
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('imports')
        .download(storagePath);
      if (dlErr || !fileData) {
        console.warn(`[reparse]   ❌ download failed: ${dlErr?.message ?? 'no data'}`);
        continue;
      }
      const bytes = new Uint8Array(await fileData.arrayBuffer());

      if (dryRun) {
        console.warn(`[reparse]   🏁 dry-run — would re-parse ${bytes.length} bytes`);
        continue;
      }

      // Delete unlinked import_lines
      const delResult = await sql`
        delete from public.import_lines
        where import_id = ${imp.id} and transaction_id is null
      `;
      console.warn(`[reparse]   🗑 deleted ${delResult.count} unlinked lines`);

      // Parse with LLM
      const enrichedPrompt = parser.systemPrompt + '\n\n' + categoryBlock;
      const isCsv = imp.fileUrl.toLowerCase().endsWith('.csv');
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      if (isCsv) {
        content.push({ type: 'text', text: parser.userPrompt });
        content.push({ type: 'text', text: `\n\n--- ARCHIVO (texto crudo) ---\n${new TextDecoder().decode(bytes)}` });
      } else {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') },
        });
        content.push({ type: 'text', text: parser.userPrompt });
      }

      let response: Anthropic.Messages.Message;
      try {
        response = await anthropic.messages.create({
          model: modelId,
          max_tokens: 16000,
          system: enrichedPrompt,
          messages: [{ role: 'user', content }],
        });
      } catch (err) {
        console.warn(`[reparse]   ❌ LLM failed: ${(err as Error).message?.slice(0, 100)}`);
        continue;
      }

      if (response.stop_reason === 'max_tokens') {
        console.warn(`[reparse]   ⚠️ TRUNCATED (${response.usage.output_tokens} output tokens)`);
      }

      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');

      // Extract JSON
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) {
        console.warn(`[reparse]   ❌ no JSON in LLM output`);
        continue;
      }
      let parsed: z.infer<typeof parserOutputSchema>;
      try {
        const json = JSON.parse(text.slice(start, end + 1));
        const result = parserOutputSchema.safeParse(json);
        if (!result.success) {
          console.warn(`[reparse]   ❌ schema invalid: ${result.error.issues[0]?.message}`);
          continue;
        }
        parsed = result.data;
      } catch {
        console.warn(`[reparse]   ❌ JSON parse failed`);
        continue;
      }

      const newLines = parsed.lines as (ParsedTxLine & { suggestedCategory?: string })[];
      console.warn(`[reparse]   📄 LLM returned ${newLines.length} lines (was ${imp.confirmedLines} confirmed)`);

      // Check which descriptions are already confirmed
      const confirmedDescs = await sql<{ desc: string }[]>`
        select il.parsed_data->>'description' as desc
        from public.import_lines il
        where il.import_id = ${imp.id} and il.transaction_id is not null
      `;
      const confirmedSet = new Set(confirmedDescs.map(r => r.desc?.toLowerCase()));

      // Insert only lines NOT already confirmed (avoid duplicates)
      let inserted = 0;
      for (const line of newLines) {
        if (confirmedSet.has(line.description.toLowerCase())) continue;

        // Suggest category
        let proposedCategoryId = suggestFromHistory(line.description);
        if (!proposedCategoryId && line.suggestedCategory) {
          proposedCategoryId = catByName.get(line.suggestedCategory.toLowerCase()) ?? null;
        }

        await sql`
          insert into public.import_lines (import_id, raw_data, parsed_data, proposed_category_id, status)
          values (${imp.id}, ${sql.json(line)}, ${sql.json(line)}, ${proposedCategoryId ?? null}, 'pending')
        `;
        inserted++;
      }

      // Update import status if there are new pending lines
      if (inserted > 0) {
        await sql`
          update public.imports
          set status = 'reviewing', error_message = ${`Re-parsed: ${inserted} nuevas líneas encontradas (antes truncadas)`}
          where id = ${imp.id}
        `;
      }

      const delta = newLines.length - imp.confirmedLines;
      const icon = delta > 0 ? '🔴' : (inserted > 0 ? '🟡' : '🟢');
      console.warn(`[reparse]   ${icon} delta=${delta > 0 ? '+' : ''}${delta}, inserted=${inserted} new pending lines`);
    }

    console.warn('\n[reparse] done');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[reparse] failed:', err);
  process.exit(1);
});
