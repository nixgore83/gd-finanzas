import { CARD_BRAND_LABELS, type ACCOUNT_TYPES, type CARD_BRANDS } from '@/lib/schemas/account';

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CardBrand = (typeof CARD_BRANDS)[number];
type Currency = 'ARS' | 'USD';

/**
 * Forma mínima que `formatAccount` necesita. Cualquier query que muestre una
 * cuenta debe seleccionar estos campos (en especial `institutionName`, que
 * antes vivía embebido en `name`).
 */
export type AccountForDisplay = {
  institutionName: string | null;
  type: AccountType;
  cardBrand: CardBrand | null;
  /** Rótulo distintivo opcional (campo `accounts.name`). */
  name: string | null;
  ownerTag: string;
  currency: Currency;
};

/**
 * Producto que se muestra según el tipo de cuenta. Las TC usan la marca
 * (`card_brand`), no esta tabla. `ewallet`/`other` no muestran producto.
 */
const PRODUCT_BY_TYPE: Partial<Record<AccountType, string>> = {
  bank_savings: 'Caja de ahorro',
  bank_checking: 'Cuenta corriente',
  broker: 'Inversiones',
};

/**
 * Nombre legible y consistente de una cuenta. Formato canónico:
 * `Institución Producto [Rótulo] · Dueño · Moneda`.
 *
 * - El producto sale de la marca (TC) o del tipo (caja de ahorro, cuenta
 *   corriente, inversiones). `cash` se muestra como "Efectivo" sin institución.
 * - El rótulo (`name`) se agrega solo si tiene contenido.
 * - `withInstitution`/`withOwner`/`withCurrency` permiten omitir partes en
 *   contextos donde ya son obvias — ej. una lista agrupada por institución usa
 *   `withInstitution:false` para mostrar solo el producto (default: todas
 *   incluidas).
 *
 * Único lugar donde se compone el nombre de una cuenta — usado en listas,
 * dropdowns, tabla de transacciones, imports y transferencias.
 */
export function formatAccount(
  account: AccountForDisplay,
  opts?: { withInstitution?: boolean; withOwner?: boolean; withCurrency?: boolean },
): string {
  const withInstitution = opts?.withInstitution ?? true;
  const withOwner = opts?.withOwner ?? true;
  const withCurrency = opts?.withCurrency ?? true;

  const segments: string[] = [];

  if (account.type === 'cash') {
    segments.push('Efectivo');
  } else {
    if (withInstitution && account.institutionName) segments.push(account.institutionName);
    const product =
      account.type === 'credit_card'
        ? account.cardBrand
          ? CARD_BRAND_LABELS[account.cardBrand]
          : undefined
        : PRODUCT_BY_TYPE[account.type];
    if (product) segments.push(product);
  }

  const rotulo = account.name?.trim();
  if (rotulo) segments.push(rotulo);

  const label = segments.join(' ') || rotulo || '—';

  const tail: string[] = [];
  if (withOwner && account.ownerTag) tail.push(account.ownerTag);
  if (withCurrency) tail.push(account.currency);

  return tail.length > 0 ? `${label} · ${tail.join(' · ')}` : label;
}
