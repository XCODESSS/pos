import type { StockUnit } from './inventory';

export type Supplier = { id: string; name: string; contact: string; actorId: string; createdAt: string };
export type PurchaseLine = { ingredientId: string; ingredientName: string; unit: StockUnit; orderedMilli: number; receivedMilli: number };
export type PurchaseOrder = { id: string; sequence: string; supplierId: string; supplierName: string; reference: string; actorId: string; createdAt: string; version: number; status: 'OPEN' | 'RECEIVED' | 'CLOSED'; lines: PurchaseLine[]; closeReason: string | null; closedBy: string | null; closedAt: string | null };
export type PurchaseReceipt = { id: string; sequence: string; purchaseOrderId: string; reference: string; actorId: string; createdAt: string; lines: { ingredientId: string; ingredientName: string; unit: StockUnit; quantityMilli: number; balanceMilli: number }[] };
export type PurchaseDetail = { order: PurchaseOrder; receipts: PurchaseReceipt[] };
export type PurchasePage = { orders: PurchaseOrder[]; nextCursor: string | null };
