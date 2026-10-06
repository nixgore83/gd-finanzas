import { describe, it, expect } from 'vitest';
import { mercadoPagoTcParser } from './mercado-pago-tc';
import { UNREADABLE_DATE_MARKER } from './tc-date-rules';

/**
 * El PDF de TC de Mercado Pago tiene dos trampas propias, las dos verificadas
 * contra los resúmenes reales de ene–jul 2026:
 *
 *  1. NO imprime el año en ningún lado. Los únicos números de 4 dígitos del
 *     archivo son el CUIT y el DNI del titular.
 *  2. La cuota va en una COLUMNA aparte ("5 de 6"), no dentro de la descripción,
 *     y la fecha que acompaña a esa fila es la de la COMPRA ORIGINAL (dos cuotas
 *     consecutivas del mismo comercio repiten fecha en resúmenes distintos).
 *
 * Sin (1) el modelo inventa el año; sin (2) no reconoce la fila como cuota y no
 * le aplica la regla de negocio (la cuota se imputa al mes del resumen).
 */
describe('prompt de mercado-pago-tc', () => {
  const p = mercadoPagoTcParser.systemPrompt;

  it('avisa que el PDF no trae el año y prohíbe usar CUIT/DNI como tal', () => {
    expect(p).toContain('NO IMPRIME EL AÑO EN NINGUNA PARTE');
    expect(p).toContain('CUIT y DNI');
  });

  it('manda tomar el año del bloque de período externo', () => {
    expect(p).toContain('PERÍODO DEL RESUMEN');
  });

  it('si no hay referencia de año, marca para revisión en vez de inventarlo', () => {
    expect(p).toContain(UNREADABLE_DATE_MARKER);
  });

  it('describe la cuota como columna propia y pide arrastrarla a la descripción', () => {
    expect(p).toContain('COLUMNA PROPIA');
    expect(p).toContain('5 de 6');
    expect(p).toContain('C.05/06');
  });

  it('ignora el saldo anterior y el pago de la tarjeta, con los DOS títulos que usa MP', () => {
    // MP renombró las secciones con el tiempo: los resúmenes de ene–mar 2026 dicen
    // "Resumen de [mes]" / "Pagos realizados"; los de abr–jul, "Composición del
    // saldo del periodo anterior" / "Pagos anticipados". Nombrar sólo un juego deja
    // al modelo sin ancla en la mitad de los archivos.
    expect(p).toContain('Composición del saldo del periodo anterior');
    expect(p).toContain('Resumen de [mes anterior]');
    expect(p).toContain('Pagos anticipados');
    expect(p).toContain('Pagos realizados');
    expect(p).toContain('IGNORAR LA SECCIÓN ENTERA');
  });

  it('sigue matcheando sólo Mercado Pago / tipo tc', () => {
    expect(mercadoPagoTcParser.institutionMatch('Mercado Pago')).toBe(true);
    expect(mercadoPagoTcParser.institutionMatch('MercadoPago')).toBe(true);
    expect(mercadoPagoTcParser.institutionMatch('Galicia')).toBe(false);
    expect(mercadoPagoTcParser.importTypeMatch('tc')).toBe(true);
    expect(mercadoPagoTcParser.importTypeMatch('banco')).toBe(false);
  });
});
