export type StockUnit = 'G' | 'ML' | 'EACH';
export const unitLabels: Record<StockUnit, string> = { G: 'g', ML: 'ml', EACH: 'each' };
export type Ingredient = { id: string; name: string; unit: StockUnit; lowStockMilli: number; balanceMilli: number; version: number; lowStock: boolean };
export type InventorySummary = { ingredients: Ingredient[] };
export type StockMovement = { sequence: string; ingredientId: string; ingredientName: string; unit: StockUnit; kind: string; deltaMilli: number; balanceMilli: number; commandId: string | null; orderId: string | null; reason: string; reference: string | null; actorId: string; createdAt: string };
export type StockMovementPage = { movements: StockMovement[]; nextCursor: string | null };
export type StockMoveResult = { ingredient: Ingredient; movement: StockMovement };

/** Parse exact decimal text; quantities in transport/ledger remain integer thousandths. */
export function parseQuantity(text: string, signed = false): number {
  if (!(signed ? /^-?\d{1,10}(\.\d{1,3})?$/ : /^\d{1,10}(\.\d{1,3})?$/).test(text)) throw new Error('Enter a quantity with at most three decimal places in the displayed base unit.');
  const negative = text.startsWith('-'); const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const value = (Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000_000) throw new Error('Quantity exceeds the supported range.');
  return value;
}
export const quantityInput = (milli: number) => (milli / 1000).toFixed(3);
const formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const stockQuantity = (milli: number, unit: StockUnit) => `${formatter.format(milli / 1000)} ${unitLabels[unit]}`;
