import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request } from './api';
import { storageKey } from './Tenant';
import { parseQuantity, stockQuantity, unitLabels, type Ingredient, type InventorySummary } from './inventory';
import type { PurchaseDetail, PurchaseOrder, PurchasePage, PurchaseReceipt, Supplier } from './purchasing';
import './purchasing.css';

type Command = { kind: 'supplier' | 'order' | 'receive' | 'close'; path: string; body: unknown; summary: string[]; orderId?: string };
const pendingKey = () => storageKey('purchasing.pending');
const selectedKey = () => storageKey('purchasing.selected');
function saved(): Command | null { try { return JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); } catch { return null; } }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Purchasing unavailable.';

export function PurchasingView({ token, canManage }: { token: string; canManage: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]); const [items, setItems] = useState<Ingredient[]>([]); const [ready, setReady] = useState(false);
  const [supplierName, setSupplierName] = useState(''); const [contact, setContact] = useState('');
  const [supplierId, setSupplierId] = useState(''); const [reference, setReference] = useState(''); const [choice, setChoice] = useState('');
  const [lines, setLines] = useState<{ ingredientId: string; quantity: string }[]>([]);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null); const [stock, setStock] = useState<Ingredient[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({}); const [deliveryReference, setDeliveryReference] = useState(''); const [closeReason, setCloseReason] = useState('');
  const [lookupId, setLookupId] = useState(''); const [stale, setStale] = useState(false);
  const [review, setReview] = useState<Command | null>(null); const [pending, setPending] = useState<Command | null>(saved);
  const [busy, setBusy] = useState(false); const lock = useRef(false); const mounted = useRef(true); const reviewPanel = useRef<HTMLElement | null>(null); const detailPanel = useRef<HTMLElement | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [page, setPage] = useState<PurchasePage | null>(null); const [pageError, setPageError] = useState(''); const [pageBusy, setPageBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [refreshKey, setRefreshKey] = useState(0);
  const cursor = cursors.at(-1); const blocked = busy || pending !== null || review !== null || !ready || !canManage;
  const order = detail?.order;
  async function catalog() {
    const [vendors, inventory] = await Promise.all([request<{ suppliers: Supplier[] }>(token, '/purchasing/suppliers'), request<InventorySummary>(token, '/inventory')]);
    if (mounted.current) { setSuppliers(vendors.suppliers); setItems(inventory.ingredients); setReady(true); }
  }
  async function load(id: string) {
    const [purchase, inventory] = await Promise.all([request<PurchaseDetail>(token, `/purchasing/orders/${encodeURIComponent(id)}`), request<InventorySummary>(token, '/inventory')]);
    if (mounted.current) {
      setDetail(purchase); setStock(inventory.ingredients); setQuantities({}); setDeliveryReference(''); setCloseReason(''); setStale(false);
      sessionStorage.setItem(selectedKey(), id);
    }
  }
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); }, [review]);
  useEffect(() => { if (order && window.matchMedia('(max-width:1000px)').matches) detailPanel.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); }, [order?.id, order?.version]);
  useEffect(() => {
    mounted.current = true; lock.current = true; setBusy(true);
    void (async () => { try { await catalog(); const selected = sessionStorage.getItem(selectedKey()); if (selected && mounted.current) await load(selected); } catch (cause) { if (mounted.current) setError(message(cause)); } finally { lock.current = false; if (mounted.current) setBusy(false); } })();
    return () => { mounted.current = false; };
  }, [token]);
  useEffect(() => {
    const controller = new AbortController(); setPageBusy(true); setPageError(''); setPage(null);
    void request<PurchasePage>(token, `/purchasing/orders?limit=10${cursor ? `&before=${cursor}` : ''}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(cause => { if (!controller.signal.aborted) setPageError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setPageBusy(false); });
    return () => controller.abort();
  }, [token, cursor, refreshKey]);
  async function open(id: string) {
    if (lock.current || pending || review) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setDetail(null); setQuantities({});
    try { await load(id.trim()); } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function prepare(make: () => Command) {
    if (blocked) return; setError(''); setNotice('');
    try { setReview(make()); } catch (cause) { setError(message(cause)); }
  }
  async function execute(command: Command) {
    if (lock.current || !canManage) return;
    try { sessionStorage.setItem(pendingKey(), JSON.stringify(command)); }
    catch { setError('Cannot retain the command ID. No purchase action was sent.'); return; }
    lock.current = true; setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      let selected = command.orderId; let createdSupplier: Supplier | undefined;
      if (command.kind === 'supplier') createdSupplier = await request<Supplier>(token, command.path, command.body);
      else if (command.kind === 'receive') selected = (await request<PurchaseReceipt>(token, command.path, command.body)).purchaseOrderId;
      else selected = (await request<PurchaseOrder>(token, command.path, command.body)).id;
      sessionStorage.removeItem(pendingKey());
      if (!mounted.current) return;
      setPending(null); setReview(null); setNotice('Purchase action recorded. Delivery evidence and staff attribution are retained.');
      if (createdSupplier) { setSupplierName(''); setContact(''); setSupplierId(createdSupplier.id); }
      if (command.kind === 'order') { setLines([]); setReference(''); }
      setCursors([null]); setRefreshKey(value => value + 1);
      if (selected) { setStale(true); setQuantities({}); setDeliveryReference(''); setCloseReason(''); }
      try { await catalog(); if (selected) await load(selected); } catch (cause) { if (mounted.current) setError(`Action saved, but refresh failed: ${message(cause)}`); }
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) {
        sessionStorage.removeItem(pendingKey());
        if (mounted.current) { setPending(null); setReview(null); if (command.kind === 'receive' || command.kind === 'close') setStale(true); }
      }
      if (mounted.current) setError(message(cause));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="workspace purchasing-workspace" aria-label="Supplier purchasing"><div className="workspace-heading"><div><span className="eyebrow">ORDER. RECEIVE. TRACE.</span><h2>From supplier to stock.</h2><p>Record quantity orders and receive deliveries into the same ingredient ledger.</p></div></div>
    <p className="workspace-notice">Quantity tracking only: not supplier bills, payment, tax or inventory valuation. Creating an order does not add stock. Do not also record its delivery as a manual stock receipt.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {pending && <div className="recovery-banner"><p>{busy ? 'Recording purchase action…' : 'Outcome unconfirmed. Retry this exact retained command, not a new delivery.'}</p><button className="primary" disabled={busy || !canManage} onClick={() => void execute(pending)}>Retry same purchase action</button></div>}
    {review && !pending && <section ref={reviewPanel} className="purchase-review" aria-label="Review purchase action"><h3>Review purchase action</h3>{review.summary.map((text, index) => <p key={index}>{text}</p>)}<div className="purchase-actions"><button className="secondary" disabled={busy} onClick={() => setReview(null)}>Back to purchase</button><button className="primary" disabled={busy} onClick={() => void execute(review)}>Confirm purchase action</button></div></section>}
    <div className="purchasing-layout"><section>
      {canManage && <details className="purchase-editor supplier-create"><summary>Add supplier</summary><form className="admin-form" onSubmit={event => { event.preventDefault(); prepare(() => ({ kind: 'supplier', path: '/purchasing/suppliers', body: { id: crypto.randomUUID(), name: supplierName, contact }, summary: [`Create supplier: ${supplierName}`, contact || 'No contact provided.'] })); }}><fieldset disabled={blocked}><label>Supplier name<input id="supplier-name" value={supplierName} required maxLength={80} onChange={event => setSupplierName(event.target.value)}/></label><label>Contact / delivery desk (optional)<input id="supplier-contact" value={contact} maxLength={120} onChange={event => setContact(event.target.value)}/></label><button className="primary">Review supplier</button></fieldset></form></details>}
      <details className="purchase-editor supplier-directory"><summary>Supplier directory ({suppliers.length})</summary>{suppliers.map(supplier => <article key={supplier.id}><h4>{supplier.name}</h4><p>{supplier.contact || 'No contact recorded.'}</p><small>Supplier ID: {supplier.id}</small></article>)}</details>
      {canManage && <section className="purchase-editor"><h3>New purchase order</h3><form className="admin-form" onSubmit={event => { event.preventDefault(); prepare(() => {
        if (!lines.length) throw new Error('Add at least one ingredient.');
        const quantities = lines.map(line => ({ ingredientId: line.ingredientId, quantityMilli: parseQuantity(line.quantity) }));
        if (quantities.some(line => line.quantityMilli <= 0)) throw new Error('Ordered quantities must be positive.');
        return { kind: 'order', path: '/purchasing/orders', body: { id: crypto.randomUUID(), supplierId, reference, lines: quantities }, summary: [`Order from ${suppliers.find(value => value.id === supplierId)?.name}: ${reference}`, ...quantities.map(line => { const item = items.find(value => value.id === line.ingredientId)!; return `${item.name}: ${stockQuantity(line.quantityMilli, item.unit)}`; }), 'This records an order only. Stock will not change.'] };
      }); }}><fieldset disabled={blocked}><label>Supplier<select id="purchase-supplier" required value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Purchase reference<input id="purchase-reference" required maxLength={80} value={reference} onChange={event => setReference(event.target.value)}/></label><label>Ingredient to order<select id="purchase-ingredient" value={choice} onChange={event => setChoice(event.target.value)}><option value="">Select ingredient</option>{items.filter(item => !lines.some(line => line.ingredientId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} ({unitLabels[item.unit]})</option>)}</select></label><button className="secondary" type="button" disabled={!choice || lines.length >= 100} onClick={() => { if (!lines.some(line => line.ingredientId === choice)) setLines(previous => [...previous, { ingredientId: choice, quantity: '' }]); setChoice(''); }}>Add purchase ingredient</button>
      {lines.map((line, index) => { const item = items.find(value => value.id === line.ingredientId)!; return <div className="purchase-line" key={line.ingredientId}><label>{item.name} ({unitLabels[item.unit]})<input aria-label={`Ordered quantity ${index + 1}`} inputMode="decimal" required value={line.quantity} onChange={event => setLines(previous => previous.map((value, position) => position === index ? { ...value, quantity: event.target.value } : value))}/></label><button type="button" className="secondary" aria-label={`Remove purchase ingredient ${index + 1}`} onClick={() => setLines(previous => previous.filter((_, position) => index !== position))}>Remove</button></div>; })}<button className="primary" disabled={!lines.length}>Review purchase order</button></fieldset></form></section>}
      <section className="purchase-history"><h3>Purchase orders</h3>{pageError && <p className="error">{pageError}</p>}{pageBusy && <p>Loading purchases…</p>}{page?.orders.map(value => <article className="admin-card" key={value.id}><div><h4>Purchase #{value.sequence} · {value.supplierName}</h4><p>{value.reference} · {value.status}</p><small>{localTime(value.createdAt)} IST</small></div><button className="secondary" disabled={busy || pending !== null || review !== null} aria-label={`Open purchase ${value.sequence}`} onClick={() => void open(value.id)}>Open</button></article>)}{page && !page.orders.length && <p>No purchase orders recorded.</p>}<div className="purchase-actions"><button className="secondary" disabled={pageBusy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>Newer purchases</button><button className="secondary" disabled={pageBusy || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(value => [...value, page.nextCursor]); }}>Older purchases</button><button className="secondary" disabled={pageBusy} onClick={() => { setCursors([null]); setRefreshKey(value => value + 1); }}>Refresh purchases</button></div></section>
    </section><section>
      <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); void open(lookupId); }}><label>Recover purchase by ID<input id="recover-purchase" required value={lookupId} onChange={event => setLookupId(event.target.value)}/></label><button className="secondary" disabled={busy || pending !== null || review !== null || !lookupId.trim()}>Open purchase order</button></form>
      {order && detail && <section ref={detailPanel} className="purchase-detail" aria-label="Selected purchase order"><h3>Purchase #{order.sequence} · {order.supplierName}</h3><p className="purchase-status">{order.status} · {order.reference}</p><small>Purchase ID: {order.id}</small><small>{localTime(order.createdAt)} IST · staff {order.actorId} · version {order.version}</small>
        {order.lines.map(line => <div className="purchase-quantities" key={line.ingredientId}><strong>{line.ingredientName}</strong><span>Ordered {stockQuantity(line.orderedMilli, line.unit)}</span><span>Received {stockQuantity(line.receivedMilli, line.unit)}</span><span>{order.status === 'CLOSED' ? 'Closed unreceived' : 'Remaining'} {stockQuantity(line.orderedMilli - line.receivedMilli, line.unit)}</span></div>)}
        {order.closeReason && <p className="workspace-notice">Remainder closed: {order.closeReason} · staff {order.closedBy} · {order.closedAt && localTime(order.closedAt)} IST. Received stock was not reversed.</p>}
        <button className="secondary" disabled={busy || pending !== null || review !== null} onClick={() => void open(order.id)}>Discard delivery draft and reload</button>
        {stale && <p className="workspace-notice">Reload and review before sending another delivery or close command. Old quantities will not be rebased automatically.</p>}
        {canManage && order.status === 'OPEN' && <><form className="admin-form delivery-form" onSubmit={event => { event.preventDefault(); prepare(() => {
          const receiving = order.lines.filter(line => quantities[line.ingredientId]?.trim()).map(line => {
            const current = stock.find(value => value.id === line.ingredientId); if (!current) throw new Error('Reload stock before receiving.');
            const quantityMilli = parseQuantity(quantities[line.ingredientId]);
            if (quantityMilli <= 0 || quantityMilli > line.orderedMilli - line.receivedMilli) throw new Error('Delivery must be positive and no greater than the remaining quantity.');
            return { ingredientId: line.ingredientId, expectedStockVersion: current.version, quantityMilli };
          });
          if (!receiving.length) throw new Error('Enter at least one delivered quantity.');
          return { kind: 'receive', path: `/purchasing/orders/${order.id}/receipts`, orderId: order.id, body: { id: crypto.randomUUID(), expectedVersion: order.version, reference: deliveryReference, lines: receiving }, summary: [`Receive into stock for purchase #${order.sequence}: ${deliveryReference}`, ...receiving.map(line => { const item = order.lines.find(value => value.ingredientId === line.ingredientId)!; return `${item.ingredientName}: +${stockQuantity(line.quantityMilli, item.unit)}`; }), 'Confirm only what physically arrived. This does not record a supplier bill or payment.'] };
        }); }}><h4>Receive a delivery</h4><fieldset disabled={blocked || stale}>{order.lines.filter(line => line.receivedMilli < line.orderedMilli).map(line => <label key={line.ingredientId}>{line.ingredientName} delivered ({unitLabels[line.unit]})<input aria-label={`Delivered ${line.ingredientName}`} inputMode="decimal" value={quantities[line.ingredientId] ?? ''} onChange={event => setQuantities(previous => ({ ...previous, [line.ingredientId]: event.target.value }))}/></label>)}<p>Leave ingredients not delivered blank. Quantities use base units, up to three decimals.</p><label>Delivery reference<input id="delivery-reference" required maxLength={80} value={deliveryReference} onChange={event => setDeliveryReference(event.target.value)}/></label><button className="primary">Review delivery</button></fieldset></form>
        <form className="admin-form close-purchase" onSubmit={event => { event.preventDefault(); prepare(() => ({ kind: 'close', path: `/purchasing/orders/${order.id}/close`, orderId: order.id, body: { id: crypto.randomUUID(), expectedVersion: order.version, reason: closeReason }, summary: [`Close unreceived remainder of purchase #${order.sequence}?`, closeReason, 'No more deliveries can be received against this order. Received stock remains unchanged. This does not cancel a supplier bill or return goods.'] })); }}><fieldset disabled={blocked || stale}><label>Reason to close the unreceived remainder<input id="purchase-close-reason" required maxLength={200} value={closeReason} onChange={event => setCloseReason(event.target.value)}/></label><button className="secondary">Review closing remainder</button></fieldset></form></>}
        <section className="delivery-history" aria-label="Delivery receipt history"><h4>Delivery receipts</h4>{detail.receipts.map(receipt => <article key={receipt.id}><h4>Delivery #{receipt.sequence} · {receipt.reference}</h4><small>{localTime(receipt.createdAt)} IST · staff {receipt.actorId}</small><small>Receipt ID: {receipt.id}</small>{receipt.lines.map(line => <p key={line.ingredientId}>{line.ingredientName}: received {stockQuantity(line.quantityMilli, line.unit)} · balance then {stockQuantity(line.balanceMilli, line.unit)}</p>)}</article>)}{!detail.receipts.length && <p>No deliveries recorded. Stock has not been received through this order.</p>}</section>
      </section>}
    </section></div>
  </section>;
}
