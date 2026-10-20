import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request } from './api';
import { storageKey } from './Tenant';
import type { Supplier } from './purchasing';
import type { CashActive } from './cash';
import { indiaDate, payableMoney, payablePaise, type PayableSummary, type SupplierBill, type SupplierBillDetail, type SupplierBillPage, type SupplierPayment } from './payables';
import './purchasing.css';

type Command = { kind: 'bill' | 'payment' | 'void'; path: string; body: unknown; summary: string[]; billId: string };
const pendingKey = () => storageKey('payables.pending');
const selectedKey = () => storageKey('payables.selected');
function saved(): Command | null { try { return JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); } catch { return null; } }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Supplier bills unavailable.';

export function PayablesView({ token, canManage }: { token: string; canManage: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]); const [summary, setSummary] = useState<PayableSummary | null>(null);
  const [supplierId, setSupplierId] = useState(''); const [reference, setReference] = useState(''); const [amount, setAmount] = useState('');
  const [billDate, setBillDate] = useState(indiaDate); const [dueDate, setDueDate] = useState(indiaDate); const [purchaseId, setPurchaseId] = useState('');
  const [detail, setDetail] = useState<SupplierBillDetail | null>(null); const [lookupId, setLookupId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState(''); const [paymentDate, setPaymentDate] = useState(indiaDate); const [method, setMethod] = useState('BANK_TRANSFER');
  const [cashShiftId, setCashShiftId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState(''); const [voidReason, setVoidReason] = useState(''); const [stale, setStale] = useState(false);
  const [review, setReview] = useState<Command | null>(null); const [pending, setPending] = useState<Command | null>(saved);
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lock = useRef(false); const mounted = useRef(true); const reviewPanel = useRef<HTMLElement | null>(null); const detailPanel = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState<SupplierBillPage | null>(null); const [pageError, setPageError] = useState(''); const [pageBusy, setPageBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [refreshKey, setRefreshKey] = useState(0);
  const cursor = cursors.at(-1); const bill = detail?.bill; const blocked = busy || pending !== null || review !== null || !ready || !canManage;
  async function overview() {
    if (mounted.current) setSummary(null);
    const [vendors, balances] = await Promise.all([request<{ suppliers: Supplier[] }>(token, '/purchasing/suppliers'), request<PayableSummary>(token, '/payables/summary')]);
    if (mounted.current) { setSuppliers(vendors.suppliers); setSummary(balances); setReady(true); }
  }
  async function load(id: string) {
    const [value, drawer] = await Promise.all([request<SupplierBillDetail>(token, `/payables/bills/${encodeURIComponent(id)}`), request<CashActive>(token, '/cash/active')]);
    if (mounted.current) {
      setDetail(value); setCashShiftId(drawer.shift?.id ?? null); setPaymentAmount(''); setPaymentReference(''); setPaymentDate(indiaDate()); setVoidReason(''); setStale(false);
      sessionStorage.setItem(selectedKey(), id);
    }
  }
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); }, [review]);
  useEffect(() => { if (bill && window.matchMedia('(max-width:1000px)').matches) detailPanel.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); }, [bill?.id, bill?.version]);
  useEffect(() => {
    mounted.current = true; lock.current = true; setBusy(true);
    void (async () => { try { await overview(); const selected = sessionStorage.getItem(selectedKey()); if (selected && mounted.current) await load(selected); }
      catch (cause) { if (mounted.current) setError(message(cause)); }
      finally { lock.current = false; if (mounted.current) setBusy(false); } })();
    return () => { mounted.current = false; };
  }, [token]);
  useEffect(() => {
    const controller = new AbortController(); setPageBusy(true); setPageError(''); setPage(null);
    void request<SupplierBillPage>(token, `/payables/bills?limit=10${cursor ? `&before=${cursor}` : ''}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(cause => { if (!controller.signal.aborted) setPageError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setPageBusy(false); });
    return () => controller.abort();
  }, [token, cursor, refreshKey]);
  async function open(id: string) {
    if (lock.current || pending || review) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setDetail(null);
    try { await load(id.trim()); } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await overview(); setCursors([null]); setRefreshKey(value => value + 1); }
    catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function prepare(make: () => Command) {
    if (blocked) return; setError(''); setNotice('');
    try { setReview(make()); } catch (cause) { setError(message(cause)); }
  }
  async function execute(command: Command) {
    if (lock.current || !canManage) return;
    try { sessionStorage.setItem(pendingKey(), JSON.stringify(command)); }
    catch { setError('Cannot retain the command ID. No financial action was sent.'); return; }
    lock.current = true; setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      await request<SupplierBill | SupplierPayment>(token, command.path, command.body);
      sessionStorage.removeItem(pendingKey());
      if (!mounted.current) return;
      setPending(null); setReview(null); setStale(true); setNotice('Supplier record saved. No stock changed and no payment was sent by Counterline.');
      if (command.kind === 'bill') { setReference(''); setAmount(''); setPurchaseId(''); }
      setCursors([null]); setRefreshKey(value => value + 1);
      try { await overview(); await load(command.billId); }
      catch (cause) { if (mounted.current) setError(`Record saved, but refresh failed: ${message(cause)}`); }
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) {
        sessionStorage.removeItem(pendingKey());
        if (mounted.current) { setPending(null); setReview(null); if (command.kind !== 'bill') setStale(true); }
      }
      if (mounted.current) setError(message(cause));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const total = summary?.suppliers.reduce((value, supplier) => value + BigInt(supplier.outstandingPaise), 0n);
  const overdue = summary?.suppliers.reduce((value, supplier) => value + BigInt(supplier.overduePaise), 0n);
  return <section className="workspace purchasing-workspace" aria-label="Supplier bills and payments">
    <div className="workspace-heading"><div><span className="eyebrow">OWED. RECORDED. RECONCILED.</span><h2>Supplier bills & payments.</h2><p>Track what you owe, and record payments already made.</p></div></div>
    <p className="workspace-notice">INR totals entered from supplier bills; no tax calculation or stock receiving. Payment recording does not send money. CASH payments post once to the selected open shared drawer; do not also enter them as expenses. Credits, refunds and payment reversals are not supported yet. Only unpaid bills can be voided.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {pending && <div className="recovery-banner"><p>{busy ? 'Recording supplier action…' : 'Outcome unconfirmed. Retry the exact retained action; do not enter another payment.'}</p><small>Bill ID: {pending.billId}</small><button className="primary" disabled={busy || !canManage} onClick={() => void execute(pending)}>Retry same supplier action</button></div>}
    {review && !pending && <section ref={reviewPanel} className="purchase-review" aria-label="Review supplier action"><h3>Review supplier action</h3>{review.summary.map((text, index) => <p key={index}>{text}</p>)}<div className="purchase-actions"><button className="secondary" disabled={busy} onClick={() => setReview(null)}>Back to supplier bill</button><button className="primary" disabled={busy} onClick={() => void execute(review)}>Confirm supplier action</button></div></section>}
    <section className="purchase-editor" aria-label="Outstanding supplier balances"><h3>Outstanding {total === undefined ? '—' : payableMoney(total)} · overdue {overdue === undefined ? '—' : payableMoney(overdue)}</h3>
      {summary && <><p>As of {summary.asOf} · {summary.timezone}. Due today is not overdue. Totals cover all bills, not just this page.</p><details><summary>Balances by supplier</summary>{summary.suppliers.map(value => <article key={value.supplierId}><h4>{value.supplierName}</h4><p>{value.openBills} open bills · outstanding {payableMoney(value.outstandingPaise)} · overdue {payableMoney(value.overduePaise)}</p></article>)}</details></>}
      <button className="secondary" disabled={busy} onClick={() => void refresh()}>Refresh supplier balances</button>
    </section>
    <div className="purchasing-layout"><section>
      {canManage && <section className="purchase-editor"><h3>Record supplier bill</h3><p>Add suppliers in Supplier purchasing first. A purchase order link is optional and does not calculate the bill total.</p>
        <form className="admin-form" onSubmit={event => { event.preventDefault(); prepare(() => {
          const id = crypto.randomUUID(); const totalPaise = payablePaise(amount);
          return { kind: 'bill', path: '/payables/bills', billId: id, body: { id, supplierId, reference, billDate, dueDate, totalPaise, purchaseOrderId: purchaseId.trim() || null },
            summary: [`Supplier: ${suppliers.find(value => value.id === supplierId)?.name}`, `Bill ${reference}: ${payableMoney(totalPaise)}`, `Bill date ${billDate} · due ${dueDate}`, purchaseId.trim() ? `Linked purchase ID: ${purchaseId.trim()}` : 'No purchase order linked.', 'This creates an amount owed, not a stock receipt or payment. References remain reserved even after voiding.'] };
        }); }}><fieldset disabled={blocked}>
          <label>Bill supplier<select id="bill-supplier" required value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          <label>Supplier bill reference<input id="supplier-bill-reference" required maxLength={80} value={reference} onChange={event => setReference(event.target.value)}/></label>
          <label>Bill total (INR)<input id="supplier-bill-amount" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)}/></label>
          <label>Bill date<input id="supplier-bill-date" type="date" required min="2000-01-01" max={indiaDate()} value={billDate} onChange={event => setBillDate(event.target.value)}/></label>
          <label>Due date<input id="supplier-bill-due" type="date" required min={billDate} max="2099-12-31" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>
          <label>Purchase order ID (optional)<input id="supplier-bill-purchase" value={purchaseId} onChange={event => setPurchaseId(event.target.value)}/></label>
          <button className="primary">Review supplier bill</button>
        </fieldset></form>
      </section>}
      <section className="purchase-history"><h3>Supplier bill history</h3>{pageError && <p className="error">{pageError}</p>}{pageBusy && <p>Loading supplier bills…</p>}
        {page?.bills.map(value => <article className="admin-card" key={value.id}><div><h4>{value.supplierName} · {value.reference}</h4><p>{value.status}{value.overdue ? ' · OVERDUE' : ''} · due {value.dueDate}</p><p>Outstanding {payableMoney(value.outstandingPaise)} of {payableMoney(value.totalPaise)}</p></div><button className="secondary" aria-label={`Open supplier bill ${value.sequence}`} disabled={busy || !!pending || !!review} onClick={() => void open(value.id)}>Open</button></article>)}
        {page && !page.bills.length && <p>No supplier bills recorded.</p>}
        <div className="purchase-actions"><button className="secondary" disabled={pageBusy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>Newer supplier bills</button><button className="secondary" disabled={pageBusy || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(value => [...value, page.nextCursor]); }}>Older supplier bills</button></div>
      </section>
    </section><section>
      <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); void open(lookupId); }}><label>Recover supplier bill by ID<input id="recover-supplier-bill" required value={lookupId} onChange={event => setLookupId(event.target.value)}/></label><button className="secondary" disabled={busy || !!pending || !!review}>Open supplier bill</button></form>
      {bill && detail && <section ref={detailPanel} className="purchase-detail" aria-label="Selected supplier bill"><h3>{bill.supplierName} · {bill.reference}</h3><p className="purchase-status">{bill.status}{bill.overdue ? ' · OVERDUE' : ''}</p>
        <div className="purchase-quantities"><strong>Total {payableMoney(bill.totalPaise)}</strong><span>Paid {payableMoney(bill.paidPaise)}</span><span>Outstanding {payableMoney(bill.outstandingPaise)}</span></div>
        <p>Bill date {bill.billDate} · due {bill.dueDate}</p><small>Bill ID: {bill.id}</small>{bill.purchaseOrderId && <small>Purchase ID: {bill.purchaseOrderId}</small>}<small>{localTime(bill.createdAt)} IST · staff {bill.actorId} · version {bill.version}</small>
        {bill.voidReason && <p className="workspace-notice">Voided: {bill.voidReason} · staff {bill.voidedBy} · {bill.voidedAt && localTime(bill.voidedAt)} IST. Reference retained; no stock or payment reversed.</p>}
        <button className="secondary" disabled={busy || !!pending || !!review} onClick={() => void open(bill.id)}>Discard payment draft and reload</button>
        {stale && <p className="workspace-notice">Reload and review before recording another payment or void. The observed bill version will not be updated automatically.</p>}
        {canManage && bill.status === 'OPEN' && <><form className="admin-form delivery-form" onSubmit={event => { event.preventDefault(); prepare(() => {
          if (method === 'CASH' && !cashShiftId) throw new Error('No open cash shift. Ask an owner/manager to open the drawer, then reload this bill.');
          const amountPaise = payablePaise(paymentAmount); if (amountPaise > bill.outstandingPaise) throw new Error('Payment exceeds the outstanding supplier balance.');
          return { kind: 'payment', path: `/payables/bills/${bill.id}/payments`, billId: bill.id,
            body: { id: crypto.randomUUID(), expectedVersion: bill.version, amountPaise, paymentDate, method, reference: paymentReference, cashShiftId: method === 'CASH' ? cashShiftId : null },
            summary: [`Record ${payableMoney(amountPaise)} already paid to ${bill.supplierName} for ${bill.reference}?`, `${paymentDate} · ${method} · ${paymentReference}`, method === 'CASH' ? `Cash drawer: ${cashShiftId}. This reduces drawer cash once; do not record an expense too.` : 'Noncash: no drawer movement.', `Remaining after this record: ${payableMoney(bill.outstandingPaise - amountPaise)}`, 'Confirm only an actual payment already made. This action does not send money. Payment reversal is not yet supported.'] };
        }); }}><h4>Record payment already made</h4><fieldset disabled={blocked || stale}>
          {detail.payments.length >= 99 && <p className="workspace-notice">This preview supports 100 payment records per bill; the last must settle the balance. Do not record an amount larger than actually paid.</p>}
          <label>Payment amount (INR)<input id="supplier-payment-amount" required inputMode="decimal" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)}/></label>
          {method === 'CASH' && <p className="workspace-notice">Cash must use today's India date. Drawer: {cashShiftId ?? 'none open — open a shift, then reload this bill'}.</p>}
          <label>Payment date<input id="supplier-payment-date" type="date" required min={bill.billDate} max={indiaDate()} value={paymentDate} onChange={event => setPaymentDate(event.target.value)}/></label>
          <label>Payment method<select id="supplier-payment-method" value={method} onChange={event => setMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label>
          <label>Payment evidence / reference<input id="supplier-payment-reference" required maxLength={120} value={paymentReference} onChange={event => setPaymentReference(event.target.value)}/></label><button className="primary">Review supplier payment</button>
        </fieldset></form>
        {bill.paidPaise === 0 && <form className="admin-form close-purchase" onSubmit={event => { event.preventDefault(); prepare(() => ({ kind: 'void', path: `/payables/bills/${bill.id}/void`, billId: bill.id,
          body: { id: crypto.randomUUID(), expectedVersion: bill.version, reason: voidReason }, summary: [`Void unpaid bill ${bill.reference} for ${bill.supplierName}: ${payableMoney(bill.totalPaise)}?`, voidReason, 'This removes the outstanding liability but retains the bill and reference. It does not return stock or refund money. A replacement needs a different reference.'] })); }}><fieldset disabled={blocked || stale}><label>Reason to void unpaid bill<input id="supplier-bill-void-reason" required maxLength={200} value={voidReason} onChange={event => setVoidReason(event.target.value)}/></label><button className="secondary">Review void supplier bill</button></fieldset></form>}</>}
        <section className="delivery-history" aria-label="Supplier payment history"><h4>Recorded payments</h4>{detail.payments.map(payment => <article key={payment.id}><h4>{payableMoney(payment.amountPaise)} · {payment.method}</h4><p>{payment.paymentDate} · {payment.reference}</p><small>Payment ID: {payment.id}</small><small>Recorded {localTime(payment.createdAt)} IST · staff {payment.actorId}</small></article>)}{!detail.payments.length && <p>No payments recorded.</p>}</section>
      </section>}
    </section></div>
  </section>;
}
