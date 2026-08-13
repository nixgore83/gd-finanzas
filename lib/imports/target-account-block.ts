/**
 * Bloque opcional del system prompt que le dice al parser A QUÉ CUENTA pertenece
 * el import.
 *
 * Por qué existe: algunos bancos emiten extractos **consolidados** — un solo PDF
 * con las grillas de varias cuentas del mismo titular (BIND "Cuentas bantotal"
 * trae 4 sub-cuentas; los "EXTRACTOS CONSOLIDADOS" de Galicia tienen la misma
 * forma). El modelo de la app es `1 import → 1 cuenta`, así que el archivo se
 * sube una vez por cuenta y cada parseo tiene que acotarse a la suya; sin este
 * dato el parser mezcla los movimientos de todas y la plata termina en la cuenta
 * equivocada.
 *
 * Es ADITIVO: sin `account_number` cargado devuelve string vacío y el prompt
 * queda exactamente como antes. Ningún parser existente cambia de comportamiento.
 */

export function buildTargetAccountBlock(accountNumber: string | null | undefined): string {
  const n = (accountNumber ?? '').trim();
  if (!n) return '';
  return `\n\nCUENTA DESTINO: ${n}
Este import corresponde a ESA cuenta. Si el archivo es un extracto consolidado con movimientos de varias cuentas del mismo titular, extraé ÚNICAMENTE los de la cuenta indicada arriba (alcanza con que coincida el tramo identificatorio, ej. el sufijo después de la barra). Si el archivo tiene una sola cuenta, ignorá esta instrucción y extraé todo.`;
}
