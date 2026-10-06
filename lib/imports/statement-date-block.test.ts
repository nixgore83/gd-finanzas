import { describe, it, expect } from 'vitest';
import { buildStatementDateBlock } from './statement-date-block';

/**
 * Regresión del bug de 2026-08: el resumen de TC de Mercado Pago no imprime el
 * año en ninguna parte ("resumen de julio", "Fecha de cierre 5 de julio",
 * "4/mar"), el LLM lo inventaba, y los resúmenes de mar–jul 2026 entraron
 * fechados en 2025 → el detector de gaps los reportaba como meses sin importar.
 */
describe('buildStatementDateBlock', () => {
  it('es aditivo: sin nombre de archivo no toca el prompt', () => {
    expect(buildStatementDateBlock(null)).toBe('');
    expect(buildStatementDateBlock(undefined)).toBe('');
    expect(buildStatementDateBlock('   ')).toBe('');
  });

  it('es aditivo: si del nombre no sale fecha, no toca el prompt', () => {
    expect(buildStatementDateBlock('ERESUMEN VISA.PDF')).toBe('');
    expect(buildStatementDateBlock('8610_1040211953.pdf')).toBe('');
  });

  it('pasa el mes de cierre cuando el nombre sólo trae mes (caso Mercado Pago)', () => {
    const block = buildStatementDateBlock('202607 - credit-card-mp-statement.pdf');
    expect(block).toContain('PERÍODO DEL RESUMEN');
    expect(block).toContain('2026-07');
    expect(block).toContain('fecha de cierre cae en ese mes');
  });

  it('pasa el día exacto cuando el nombre trae la fecha de cierre completa', () => {
    const block = buildStatementDateBlock('RESUMEN_VISA23_7_2026pdf.pdf');
    expect(block).toContain('CIERRA el 2026-07-23');
  });

  it('subordina la referencia al contenido del PDF', () => {
    // Un nombre de archivo mal puesto no puede pisar un año que el extracto sí trae.
    const block = buildStatementDateBlock('202607 - credit-card-mp-statement.pdf');
    expect(block).toContain('MANDA EL PDF');
  });

  it('aclara que no es la fecha de una línea', () => {
    const block = buildStatementDateBlock('202607 - credit-card-mp-statement.pdf');
    expect(block).toContain('NO es la fecha de ninguna línea');
  });
});
