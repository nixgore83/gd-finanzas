import { describe, it, expect } from 'vitest';
import {
  amountKey,
  findAlreadyImported,
  type ExistingTx,
  type PendingLine,
} from './duplicate-detection';

/** Datos sintéticos: montos chicos e inventados, nunca reales. */
const line = (id: string, date: string | null, amount: string | null): PendingLine => ({
  id,
  date,
  amount,
});
const tx = (id: string, date: string, amount: string): ExistingTx => ({ id, date, amount });

describe('amountKey', () => {
  it('ignora el signo: la dirección la da el kind, no el monto', () => {
    expect(amountKey('-100.50')).toBe(amountKey('100.50'));
  });

  it('normaliza decimales para que 1000.1 y 1000.10 sean la misma clave', () => {
    expect(amountKey('1000.1')).toBe('1000.10');
    expect(amountKey('1000.100')).toBe('1000.10');
  });

  it('devuelve null para lo que no es un número', () => {
    expect(amountKey('')).toBeNull();
    expect(amountKey(null)).toBeNull();
    expect(amountKey('mil pesos')).toBeNull();
  });
});

describe('findAlreadyImported — el caso que motivó todo', () => {
  it('CASO REAL: un extracto que vuelve a listar lo ya cargado', () => {
    // Extracto de junio que cubre desde enero: cada línea ya existe.
    const existentes = [
      tx('t1', '2026-01-02', '1500.00'),
      tx('t2', '2026-02-14', '830.25'),
      tx('t3', '2026-03-09', '12000.00'),
    ];
    const nuevas = [
      line('l1', '2026-01-02', '1500.00'),
      line('l2', '2026-02-14', '-830.25'), // el signo no importa
      line('l3', '2026-03-09', '12000.00'),
      line('l4', '2026-06-30', '450.00'), // ésta sí es nueva
    ];
    expect([...findAlreadyImported(nuevas, existentes)].sort()).toEqual(['l1', 'l2', 'l3']);
  });

  it('tolera un día de corrimiento entre fuentes', () => {
    // Visto en la reconciliación de junio: la misma operación fechada distinto
    // según la fuente.
    const existentes = [tx('t1', '2026-03-10', '999.99')];
    expect(findAlreadyImported([line('l1', '2026-03-11', '999.99')], existentes).has('l1')).toBe(true);
    expect(findAlreadyImported([line('l2', '2026-03-09', '999.99')], existentes).has('l2')).toBe(true);
    // Dos días ya es demasiado.
    expect(findAlreadyImported([line('l3', '2026-03-12', '999.99')], existentes).has('l3')).toBe(false);
  });
});

describe('findAlreadyImported — respeta CANTIDADES (lo que hace legítimos los repetidos)', () => {
  it('16 existentes + 16 entrantes → se marcan los 16', () => {
    // Caso real: la caja de Pau tiene 16 "TRANSFERENCIA DE TERCEROS" del mismo
    // día por el mismo monto. Si otro archivo trae los mismos 16, son duplicados.
    const existentes = Array.from({ length: 16 }, (_, i) => tx(`t${i}`, '2026-04-10', '5000.00'));
    const nuevas = Array.from({ length: 16 }, (_, i) => line(`l${i}`, '2026-04-10', '5000.00'));
    expect(findAlreadyImported(nuevas, existentes).size).toBe(16);
  });

  it('16 existentes + 1 entrante → se marca 1', () => {
    const existentes = Array.from({ length: 16 }, (_, i) => tx(`t${i}`, '2026-04-10', '5000.00'));
    expect(findAlreadyImported([line('l1', '2026-04-10', '5000.00')], existentes).size).toBe(1);
  });

  it('CLAVE: 1 existente + 16 entrantes → se marca 1, los otros 15 son NUEVOS', () => {
    // Éste es el que evita el desastre: un extracto donde el mismo importe se
    // repite 16 veces no es 16 duplicados sólo porque ya haya uno cargado.
    const existentes = [tx('t1', '2026-04-10', '5000.00')];
    const nuevas = Array.from({ length: 16 }, (_, i) => line(`l${i}`, '2026-04-10', '5000.00'));
    expect(findAlreadyImported(nuevas, existentes).size).toBe(1);
  });

  it('ninguna transacción se consume dos veces', () => {
    const existentes = [tx('t1', '2026-04-10', '100.00')];
    const nuevas = [line('l1', '2026-04-10', '100.00'), line('l2', '2026-04-10', '100.00')];
    const res = findAlreadyImported(nuevas, existentes);
    expect(res.size).toBe(1);
    expect(res.has('l1')).toBe(true); // gana la primera, orden determinístico
  });
});

describe('findAlreadyImported — prudencia', () => {
  it('una línea sin fecha legible NUNCA se marca como duplicada', () => {
    const existentes = [tx('t1', '2026-04-10', '100.00')];
    expect(findAlreadyImported([line('l1', null, '100.00')], existentes).size).toBe(0);
    expect(findAlreadyImported([line('l2', 'FECHA_RARA', '100.00')], existentes).size).toBe(0);
  });

  it('una línea sin monto legible tampoco', () => {
    const existentes = [tx('t1', '2026-04-10', '100.00')];
    expect(findAlreadyImported([line('l1', '2026-04-10', null)], existentes).size).toBe(0);
  });

  it('montos distintos no se cruzan aunque coincida la fecha', () => {
    const existentes = [tx('t1', '2026-04-10', '100.00')];
    expect(findAlreadyImported([line('l1', '2026-04-10', '100.01')], existentes).size).toBe(0);
  });

  it('sin transacciones previas no marca nada', () => {
    expect(findAlreadyImported([line('l1', '2026-04-10', '100.00')], []).size).toBe(0);
  });

  it('es determinístico: mismo input, mismo resultado', () => {
    const existentes = [tx('t1', '2026-04-10', '100.00'), tx('t2', '2026-04-11', '100.00')];
    const nuevas = [line('l1', '2026-04-11', '100.00'), line('l2', '2026-04-10', '100.00')];
    const a = [...findAlreadyImported(nuevas, existentes)].sort();
    const b = [...findAlreadyImported(nuevas, existentes)].sort();
    expect(a).toEqual(b);
    expect(a).toEqual(['l1', 'l2']);
  });
});
