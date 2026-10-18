import { tenantPath } from './Tenant';
import type { StockSnapshot } from './inventory';

export type MenuChoice = { id: string; name: string; pricePaise: number; available: boolean };
export type MenuItem = {
  id: string; name: string; category: string; pricePaise: number;
  cgstBps: number; sgstBps: number; vegetarian: boolean; available: boolean; version: number;
  variants: MenuChoice[]; addons: MenuChoice[];
};
export type CartLine = { itemId: string; quantity: number; variantId?: string | null; addonIds?: string[] };
export type CreateOrder = { id: string; lines: CartLine[]; orderType: 'TAKEAWAY' | 'DINE_IN'; tableLabel: string | null };
export type BillLine = {
  itemId: string; name: string; quantity: number; unitPricePaise: number;
  subtotalPaise: number; cgstPaise: number; sgstPaise: number;
};
export type Bill = {
  id: string; billNumber: string; createdAt: string; orderType: string; tableLabel: string | null;
  lines: BillLine[]; subtotalPaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number;
};
export type KitchenStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED';
export type KitchenTicket = { status: KitchenStatus; version: number; updatedAt: string };
export type KitchenChange = { status: KitchenStatus; expectedVersion: number };
export type Order = { bill: Bill; status: 'OPEN' | 'PAID'; paidAt: string | null; cashReceivedPaise: number | null; kitchen: KitchenTicket | null; checkId: string | null; inventory: StockSnapshot | null };
export type OrderPage<T = Order> = { orders: T[]; nextCursor: string | null };
export type KitchenOrder = { bill: Pick<Bill, 'id' | 'billNumber' | 'createdAt' | 'orderType' | 'tableLabel'> & { lines: { itemId: string; name: string; quantity: number }[] }; status: 'OPEN' | 'PAID'; kitchen: KitchenTicket | null };
export type StaffRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';
export type StaffMember = { id: string; username: string; displayName: string; role: StaffRole; active: boolean; version: number };
export type StaffSession = { accessToken: string; expiresAt: string; staff: StaffMember; permissions: string[] };
export type MenuWrite = Pick<MenuItem, 'name' | 'category' | 'pricePaise' | 'cgstBps' | 'sgstBps' | 'vegetarian' | 'available' | 'variants' | 'addons'>;
export type DiningTable = { id: string; label: string; floor: string; seats: number; active: boolean; version: number; checkId: string | null };
export type CheckPayment = { id: string; amountPaise: number; receivedAt: string; receivedBy: string };
export type RunningCheck = {
  id: string; number: string; table: DiningTable; version: number; createdAt: string; closedAt: string | null;
  status: 'OPEN' | 'SETTLING' | 'CLOSED'; batches: Order[]; payments: CheckPayment[];
  totalPaise: number; paidPaise: number; duePaise: number;
};

const unauthorizedListeners = new Set<(token: string) => void>();
export function onUnauthorized(listener: (token: string) => void) {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
}
export type SalesReport = { date: string; timezone: string; paidOrders: number; totalPaise: number };

export class ApiFailure extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function request<T>(token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; abort(); }, 15_000);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!tenantPath) throw new Error('Select a business workspace before signing in.');
    const response = await fetch(`${tenantPath}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && token) unauthorizedListeners.forEach(listener => listener(token));
      throw new ApiFailure(response.status, data.message || `Request failed (${response.status}).`);
    }
    return data as T;
  } catch (cause) {
    if (timedOut) throw new Error('The server did not respond within 15 seconds. The outcome may be uncertain; retry the same action.');
    throw cause;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export const kitchenLabels: Record<KitchenStatus, string> = {
  QUEUED: 'Queued', PREPARING: 'Preparing', READY: 'Ready', SERVED: 'Served',
};
export const orderContext = (order: { bill: Pick<Bill, 'orderType' | 'tableLabel'> }) => order.bill.orderType === 'DINE_IN'
  ? `Dine-in · ${order.bill.tableLabel}` : 'Takeaway';
// Java/SQL timestamps may retain sub-millisecond precision. Preserve the source
// string and truncate only this display projection for portable browser parsing.
export const localTime = (date: string) => new Date(date.replace(/(\.\d{3})\d+(?=Z$)/, '$1')).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const money = (paise: number) => formatter.format(paise / 100);
