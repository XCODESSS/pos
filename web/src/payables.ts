export type SupplierBill = {
  id: string; sequence: string; supplierId: string; supplierName: string; purchaseOrderId: string | null;
  reference: string; billDate: string; dueDate: string; totalPaise: number; paidPaise: number; outstandingPaise: number;
  overdue: boolean; status: 'OPEN' | 'PAID' | 'VOID'; version: number; actorId: string; createdAt: string;
  voidReason: string | null; voidedBy: string | null; voidedAt: string | null;
};
export type SupplierPayment = { id: string; sequence: string; billId: string; amountPaise: number; paymentDate: string; method: string; reference: string; actorId: string; createdAt: string };
export type SupplierBillDetail = { bill: SupplierBill; payments: SupplierPayment[] };
export type SupplierBillPage = { bills: SupplierBill[]; nextCursor: string | null };
export type PayableSummary = { asOf: string; timezone: string; suppliers: { supplierId: string; supplierName: string; outstandingPaise: string; overduePaise: string; openBills: string }[] };
export const indiaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function payablePaise(input: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) throw new Error('Enter a positive INR amount with at most two decimals.');
  const [rupees, fraction = ''] = input.trim().split('.');
  const value = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value < 1n || value > 1_000_000_000_000n) throw new Error('Amount must be between ₹0.01 and ₹10,00,00,00,000.00.');
  return Number(value);
}
export function payableMoney(value: string | number | bigint): string {
  const paise = BigInt(value);
  return `₹${(paise / 100n).toLocaleString('en-IN')}.${(paise % 100n).toString().padStart(2, '0')}`;
}
