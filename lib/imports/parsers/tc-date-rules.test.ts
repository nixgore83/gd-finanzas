import { describe, it, expect } from 'vitest';
import { TC_DATE_RULES_BLOCK, UNREADABLE_DATE_MARKER } from './tc-date-rules';
import { galiciaTcParser } from './galicia-tc';
import { bnaTcParser } from './bna-tc';
import { icbcTcParser } from './icbc-tc';
import { icbcMastercardTcParser } from './icbc-mastercard-tc';

/**
 * Regresión del bug de 2026-07: los prompts de TC solo hablaban de fechas para
 * decir "la fecha de la cuota debe ser la FECHA DE CIERRE ... NO la fecha original
 * de compra", y el modelo generalizaba eso a TODAS las líneas (resúmenes enteros
 * con los consumos apilados en la fecha de cierre).
 */
const TC_LLM_PARSERS = [
  ['galicia-tc', galiciaTcParser],
  ['bna-tc', bnaTcParser],
  ['icbc-tc', icbcTcParser],
  ['icbc-mastercard-tc', icbcMastercardTcParser],
] as const;

describe('TC_DATE_RULES_BLOCK', () => {
  it('exige la fecha real por línea y prohíbe la de cierre', () => {
    expect(TC_DATE_RULES_BLOCK).toContain('REGLA DE FECHAS');
    expect(TC_DATE_RULES_BLOCK).toContain('PROHIBIDO usar la fecha de cierre');
    expect(TC_DATE_RULES_BLOCK).toContain('MISMA fecha en todas');
  });

  it('define la resolución de año para fechas sin año (DD/MM)', () => {
    expect(TC_DATE_RULES_BLOCK).toContain('POSTERIOR al mes de cierre');
    expect(TC_DATE_RULES_BLOCK).toContain('2026-06-28');
  });

  it('acota la excepción de cierre a las cuotas', () => {
    expect(TC_DATE_RULES_BLOCK).toContain('ÚNICA EXCEPCIÓN');
    expect(TC_DATE_RULES_BLOCK).toContain('CUOTA');
  });

  it('prohíbe inventar fechas: marca la línea para revisión', () => {
    expect(TC_DATE_RULES_BLOCK).toContain('NO la inventes');
    expect(TC_DATE_RULES_BLOCK).toContain(UNREADABLE_DATE_MARKER);
  });
});

describe.each(TC_LLM_PARSERS)('prompt de %s', (_id, parser) => {
  it('incluye el bloque compartido de reglas de fecha', () => {
    expect(parser.systemPrompt).toContain(TC_DATE_RULES_BLOCK);
  });

  it('no reintroduce la regla global de fecha de cierre', () => {
    expect(parser.systemPrompt).not.toContain(
      'la fecha de la cuota debe ser la FECHA DE CIERRE del resumen',
    );
    expect(parser.systemPrompt).not.toContain('la fecha de la cuota debe ser la FECHA DEL RESUMEN');
  });
});
