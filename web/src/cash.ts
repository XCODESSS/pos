import { request } from './api';
export type CashActive = { shift: { id: string; sequence: string } | null };
export type CashShift = { id: string; sequence: string; status: 'OPEN' | 'CLOSED'; reference: string; openingPaise: number; salesPaise: number; expensesPaise: number; supplierPaise: number; expectedPaise: number; version: number; openedBy: string; openedAt: string; countedPaise: number | null; discrepancyPaise: number | null; closeReason: string | null; closedBy: string | null; closedAt: string | null };
export type CashMovement = { sequence: string; cashShiftId: string; kind: string; sourceId: string; amountPaise: number; deltaPaise: number; balancePaise: number; actorId: string; createdAt: string };
export type Expense = { id: string; sequence: string; payee: string; category: string; reference: string; expenseDate: string; amountPaise: number; method: string; cashShiftId: string | null; actorId: string; createdAt: string };
export type CashPage = { shifts: CashShift[]; nextCursor: string | null };
export type ExpensePage = { expenses: Expense[]; nextCursor: string | null };
export type MovementPage = { movements: CashMovement[]; nextCursor: string | null };
export async function requireCashShift(token: string): Promise<string> {
  const current = await request<CashActive>(token, '/cash/active');
  if (!current.shift) throw new Error('No open cash shift. Ask an owner/manager to open the shared drawer before recording cash.');
  return current.shift.id;
}
