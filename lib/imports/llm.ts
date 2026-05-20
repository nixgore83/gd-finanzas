import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { getServerEnv } from '@/lib/env';

let cached: Anthropic | null = null;

function getClient(): Anthropic {
  if (cached) return cached;
  const env = getServerEnv();
  cached = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cached;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public code: 'invalid_json' | 'schema_invalid' | 'api_failure' | 'empty',
    public override cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export type LlmRunResult<T> = {
  data: T;
  model: string;
  tokensUsed: { input: number; output: number };
};

type RunInput<T> = {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  file:
    | { kind: 'pdf'; base64: string }
    | { kind: 'text'; text: string }
    | null;
  outputSchema: z.ZodSchema<T>;
  maxTokens?: number;
};

function extractJson(text: string): unknown {
  // Look for the first { and the matching closing }. LLM can occasionally
  // wrap JSON in prose; we strip that defensively.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError('no JSON found in LLM output', 'invalid_json');
  }
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    throw new LlmError('JSON.parse failed on LLM output', 'invalid_json', err);
  }
}

/**
 * Llama al modelo con un mensaje compuesto (PDF + texto) o solo texto, valida
 * con Zod, y reintenta UNA vez si el JSON viene roto.
 */
export async function runParser<T>(input: RunInput<T>): Promise<LlmRunResult<T>> {
  const client = getClient();
  const maxTokens = input.maxTokens ?? 8000;

  async function callOnce(extraInstruction?: string): Promise<LlmRunResult<T>> {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (input.file?.kind === 'pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: input.file.base64,
        },
      });
    }
    const textPrompt = extraInstruction
      ? `${input.userPrompt}\n\n${extraInstruction}`
      : input.userPrompt;
    content.push({ type: 'text', text: textPrompt });
    if (input.file?.kind === 'text') {
      content.push({
        type: 'text',
        text: `\n\n--- ARCHIVO (texto crudo) ---\n${input.file.text}`,
      });
    }

    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model: input.modelId,
        max_tokens: maxTokens,
        system: input.systemPrompt,
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      // Extraer info útil del error del SDK (sin loggear el body crudo, que
      // podría contener prompt/contenido). Surface status + tipo + modelo.
      const e = err as {
        status?: number;
        message?: string;
        type?: string;
        error?: { type?: string; message?: string };
      };
      const status = e.status ?? 0;
      const innerType = e.error?.type ?? e.type ?? 'unknown';
      const innerMsg = e.error?.message ?? e.message ?? 'no-message';
      const detail = `status=${status} type=${innerType} model=${input.modelId} msg=${innerMsg}`;
      console.error('[llm] anthropic api failure', {
        status,
        type: innerType,
        model: input.modelId,
        // El message del SDK suele incluir "404 model not found" o similar;
        // no expone payload, es seguro loggearlo.
        message: innerMsg.slice(0, 200),
      });
      throw new LlmError(`Anthropic API call failed (${detail})`, 'api_failure', err);
    }

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text.trim()) {
      throw new LlmError('LLM returned empty content', 'empty');
    }

    const json = extractJson(text);
    const parsed = input.outputSchema.safeParse(json);
    if (!parsed.success) {
      // Diagnóstico defensivo: loggea la forma del output (keys del primer
      // elemento, sin valores) para que podamos ajustar prompt o preprocess
      // cuando el modelo se desvía. NUNCA loggea montos.
      try {
        const root = json as Record<string, unknown>;
        const lines = Array.isArray(root?.lines) ? (root.lines as unknown[]) : [];
        const sampleKeys =
          lines[0] && typeof lines[0] === 'object'
            ? Object.keys(lines[0] as Record<string, unknown>)
            : Object.keys(root ?? {});
        console.warn('[llm] schema mismatch — output keys:', sampleKeys, 'lineCount:', lines.length);
      } catch {
        /* swallow logging errors */
      }
      throw new LlmError(
        `output failed schema: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
        'schema_invalid',
        parsed.error,
      );
    }
    return {
      data: parsed.data,
      model: response.model,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }

  try {
    return await callOnce();
  } catch (err) {
    if (err instanceof LlmError && (err.code === 'invalid_json' || err.code === 'schema_invalid')) {
      // Reintento con instrucción explícita.
      return callOnce(
        'IMPORTANTE: tu respuesta anterior no fue JSON válido o no cumplió el schema. Devolvé ÚNICAMENTE un objeto JSON puro, sin texto antes ni después, sin markdown fences, que cumpla el schema indicado.',
      );
    }
    throw err;
  }
}
