import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request } from './api';
import { storageKey } from './Tenant';
import { indiaDate, payableMoney, payablePaise } from './payables';
import type { CashActive, CashPage, CashShift, Expense, ExpensePage, MovementPage } from './cash';
import './purchasing.css';

type Command = { kind: 'open' | 'close' | 'expense'; path: string; body: unknown; summary: string[]; shiftId?: string };
const pendingKey = () => storageKey('cash.control.pending');
const selectedKey = () => storageKey('cash.control.selected');
function saved(): Command | null { try { return JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); } catch { return null; } }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Cash control unavailable.';
const cashMoney = (paise: number) => paise < 0 ? `−${payableMoney(-paise)}` : payableMoney(paise);
const countPaise = (input: string) => /^0+(\.0{1,2})?$/.test(input.trim()) ? 0 : payablePaise(input);
// Each history owns an abortable request and keyset cursor, independent of edit/review drafts.
function History<T extends { nextCursor: string | null }>({ token, path, revision, title, children }: { token: string; path: string; revision: number; title: string; children: (page: T) => React.ReactNode }) {
  const [page, setPage] = useState<T | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const cursor = cursors.at(-1); const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(''); setPage(null);
    void request<T>(token, `${path}?limit=10${cursor ? `&before=${cursor}` : ''}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, path, revision, cursor, reload]);
  return <section className="purchase-history"><h3>{title}</h3>{error && <p className="error">{error}</p>}{busy && <p>Loading history…</p>}{page && children(page)}<div className="purchase-actions"><button className="secondary" disabled={busy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>Newer {title.toLowerCase()}</button><button className="secondary" disabled={busy || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(value => [...value, page.nextCursor]); }}>Older {title.toLowerCase()}</button><button className="secondary" disabled={busy} onClick={() => { setCursors([null]); setReload(value => value + 1); }}>Latest {title.toLowerCase()}</button></div></section>;
}
function ExpenseRecord({ value }: { value: Expense }) {
  return <article className="purchase-editor"><h4>{value.payee} · {payableMoney(value.amountPaise)}</h4><p>{value.category} · {value.method} · {value.expenseDate}</p><p>{value.reference}</p><small>Expense ID: {value.id}</small><small>{value.cashShiftId ? `Drawer: ${value.cashShiftId}` : 'Noncash — no drawer movement'}</small><small>Recorded {localTime(value.createdAt)} IST · staff {value.actorId}</small></article>;
}
export function CashControlView({ token }: { token: string }) {
  const [activeId, setActiveId] = useState<string | null>(null); const [shift, setShift] = useState<CashShift | null>(null); const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(''); const [openingReference, setOpeningReference] = useState(''); const [counted, setCounted] = useState(''); const [reason, setReason] = useState('');
  const [payee, setPayee] = useState(''); const [category, setCategory] = useState(''); const [reference, setReference] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(indiaDate); const [method, setMethod] = useState('CASH');
  const [lookup, setLookup] = useState(''); const [expenseLookup, setExpenseLookup] = useState(''); const [expense, setExpense] = useState<Expense | null>(null);
  const [review, setReview] = useState<Command | null>(null); const [pending, setPending] = useState<Command | null>(saved);
  const [busy, setBusy] = useState(false); const [stale, setStale] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0);
  const lock = useRef(false); const mounted = useRef(true); const reviewPanel = useRef<HTMLElement | null>(null); const detailPanel = useRef<HTMLElement | null>(null);
  const blocked = busy || !!pending || !!review || !ready;
  async function load(id?: string) {
    const current = await request<CashActive>(token, '/cash/active');
    const selected = id || current.shift?.id;
    const value = selected ? await request<CashShift>(token, `/cash/shifts/${encodeURIComponent(selected)}`) : null;
    if (mounted.current) {
      setActiveId(current.shift?.id ?? null); setShift(value); setReady(true); setStale(false); setCounted(''); setReason('');
      if (value) sessionStorage.setItem(selectedKey(), value.id); else sessionStorage.removeItem(selectedKey());
    }
  }
  async function reload(id?: string) {
    if (lock.current || pending || review) return;
    lock.current = true; setBusy(true); setError('');
    try { await load(id); setRevision(value => value + 1); } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true; void reload(sessionStorage.getItem(selectedKey()) ?? undefined);
    // Pending commands still need a read of the drawer; never submit automatically.
    if (pending) { lock.current = true; setBusy(true); void load().catch(cause => { if (mounted.current) setError(message(cause)); }).finally(() => { lock.current = false; if (mounted.current) setBusy(false); }); }
    return () => { mounted.current = false; };
  }, [token]);
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'center' }); }, [review]);
  useEffect(() => { if (shift && window.matchMedia('(max-width:1000px)').matches) detailPanel.current?.scrollIntoView({ block: 'start' }); }, [shift?.id, shift?.version]);
  function prepare(make: () => Command) {
    if (blocked || lock.current) return; setError(''); setNotice('');
    try { setReview(make()); } catch (cause) { setError(message(cause)); }
  }
  async function execute(command: Command) {
    if (lock.current) return;
    try { sessionStorage.setItem(pendingKey(), JSON.stringify(command)); }
    catch { setError('Cannot retain the command. No cash action was sent.'); return; }
    lock.current = true; setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      let selected = command.shiftId;
      if (command.kind === 'expense') {
        const value = await request<Expense>(token, command.path, command.body);
        selected = value.cashShiftId ?? undefined;
        if (mounted.current) { setExpense(value); setPayee(''); setReference(''); setAmount(''); }
      } else selected = (await request<CashShift>(token, command.path, command.body)).id;
      sessionStorage.removeItem(pendingKey());
      if (!mounted.current) return;
      setPending(null); setReview(null); setStale(true); setNotice('Cash-control record saved. Original evidence is retained.'); setRevision(value => value + 1);
      if (command.kind === 'open') { setOpening(''); setOpeningReference(''); }
      try { await load(selected); } catch (cause) { if (mounted.current) setError(`Saved, but refresh failed: ${message(cause)}`); }
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) {
        sessionStorage.removeItem(pendingKey()); if (mounted.current) { setPending(null); setReview(null); setStale(true); }
      }
      if (mounted.current) setError(message(cause));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function recoverExpense() {
    if (blocked || lock.current) return; lock.current = true; setBusy(true); setError(''); setExpense(null);
    try { const value = await request<Expense>(token, `/expenses/${encodeURIComponent(expenseLookup.trim())}`); if (mounted.current) setExpense(value); }
    catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="workspace purchasing-workspace" aria-label="Cash drawer and operating expenses"><div className="workspace-heading"><div><span className="eyebrow">COUNT. RECORD. RECONCILE.</span><h2>One shared cash drawer.</h2><p>Opening float plus received cash, less cash expenses and supplier payments.</p></div></div>
    <p className="workspace-notice">Cash sales require an open shift. Sale cash is net of change; check splits count when received, not again at final settlement. Record supplier bill payments in Supplier bills & payments, never again as expenses. Noncash spending does not change this drawer. Corrections/refunds/top-ups are not supported; closing never rewrites transactions.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    <p className="workspace-notice">{ready ? activeId ? `Open drawer ID: ${activeId}` : 'No open cash shift. Cash transactions are blocked.' : 'Loading drawer…'}</p>
    <button className="secondary" disabled={busy || !!pending || !!review} onClick={() => void reload()}>Load active drawer</button>
    {pending && <div className="recovery-banner"><p>Outcome unconfirmed. Retry this exact command; do not assign it to another shift.</p><button className="primary" disabled={busy} onClick={() => void execute(pending)}>Retry same cash-control action</button></div>}
    {review && !pending && <section ref={reviewPanel} className="purchase-review" aria-label="Review cash-control action"><h3>Review cash-control action</h3>{review.summary.map((line, index) => <p key={index}>{line}</p>)}<button className="secondary" disabled={busy} onClick={() => setReview(null)}>Back to drawer</button><button className="primary" disabled={busy} onClick={() => void execute(review)}>Confirm cash-control action</button></section>}
    <div className="purchasing-layout"><section>
      {!activeId && <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); prepare(() => {
        const openingPaise = countPaise(opening); const id = crypto.randomUUID(); return { kind: 'open', path: '/cash/shifts', shiftId: id, body: { id, openingPaise, reference: openingReference }, summary: [`Open the shared drawer with ${payableMoney(openingPaise)} physically counted?`, openingReference, 'This is opening cash, not sales. The previous shift balance is not carried forward automatically.'] };
      }); }}><h3>Open shared drawer</h3><fieldset disabled={blocked}><label>Opening cash (INR)<input id="cash-opening" required inputMode="decimal" value={opening} onChange={event => setOpening(event.target.value)}/></label><label>Opening reference<input id="cash-opening-reference" required maxLength={120} value={openingReference} onChange={event => setOpeningReference(event.target.value)}/></label><button className="primary">Review opening drawer</button></fieldset></form>}
      <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); prepare(() => {
        if (method === 'CASH' && !activeId) throw new Error('Open a shift before recording cash spending.');
        const amountPaise = payablePaise(amount); return { kind: 'expense', path: '/expenses', shiftId: method === 'CASH' ? activeId! : undefined,
          body: { id: crypto.randomUUID(), payee, category, reference, expenseDate: date, amountPaise, method, cashShiftId: method === 'CASH' ? activeId : null },
          summary: [`Operating expense: ${payableMoney(amountPaise)} paid to ${payee}`, `${category} · ${reference} · ${date} · ${method}`, method === 'CASH' ? `Reduce shared drawer ${activeId} once.` : 'No drawer movement.', 'Confirm this is immediate operating spending, NOT a supplier bill payment or stock receipt. No edit/refund workflow yet.'] };
      }); }}><h3>Record operating expense</h3><fieldset disabled={blocked || stale}><label>Payee<input id="expense-payee" required maxLength={80} value={payee} onChange={event => setPayee(event.target.value)}/></label><label>Expense category<input id="expense-category" required maxLength={60} value={category} onChange={event => setCategory(event.target.value)}/></label><label>Expense reference<input id="expense-reference" required maxLength={120} value={reference} onChange={event => setReference(event.target.value)}/></label><label>Expense amount (INR)<input id="expense-amount" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)}/></label><label>Expense date<input id="expense-date" type="date" required min={method === 'CASH' ? indiaDate() : '2000-01-01'} max={indiaDate()} value={date} onChange={event => setDate(event.target.value)}/></label><label>Expense method<select id="expense-method" value={method} onChange={event => setMethod(event.target.value)}><option value="CASH">Cash from shared drawer</option><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="OTHER">Other</option></select></label><button className="primary">Review operating expense</button></fieldset></form>
      <History<CashPage> token={token} path="/cash/shifts" revision={revision} title="Shifts">{page => <>{page.shifts.map(value => <article className="admin-card" key={value.id}><div><h4>Shift #{value.sequence} · {value.status}</h4><p>{value.reference} · expected {cashMoney(value.expectedPaise)}</p></div><button className="secondary" disabled={blocked} aria-label={`Open cash shift ${value.sequence}`} onClick={() => void reload(value.id)}>Open</button></article>)}{!page.shifts.length && <p>No shifts recorded.</p>}</>}</History>
      <History<ExpensePage> token={token} path="/expenses" revision={revision} title="Expenses">{page => <>{page.expenses.map(value => <ExpenseRecord key={value.id} value={value}/>)}{!page.expenses.length && <p>No operating expenses recorded.</p>}</>}</History>
    </section><section>
      <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); void reload(lookup.trim()); }}><label>Recover shift by ID<input id="recover-cash-shift" required value={lookup} onChange={event => setLookup(event.target.value)}/></label><button className="secondary" disabled={blocked}>Open cash shift</button></form>
      {shift && <section ref={detailPanel} className="purchase-detail" aria-label="Selected cash shift"><h3>Shift #{shift.sequence} · {shift.reference}</h3><p className="purchase-status">{shift.status}</p><small>Shift ID: {shift.id} · version {shift.version}</small><small>Opened {localTime(shift.openedAt)} IST · staff {shift.openedBy}</small>
        <div className="purchase-quantities"><strong>Expected {cashMoney(shift.expectedPaise)}</strong><span>Opening {payableMoney(shift.openingPaise)}</span><span>Sales cash +{payableMoney(shift.salesPaise)}</span><span>Expenses −{payableMoney(shift.expensesPaise)}</span><span>Supplier cash −{payableMoney(shift.supplierPaise)}</span></div>
        {shift.status === 'CLOSED' && <div className="workspace-notice"><p>Counted {payableMoney(shift.countedPaise!)} · discrepancy {cashMoney(shift.discrepancyPaise!)}</p><p>{shift.closeReason || 'Count matched expected cash.'}</p><small>Closed {localTime(shift.closedAt!)} IST · staff {shift.closedBy}</small></div>}
        {stale && <p className="workspace-notice">Reload and recount before another action. Old counts will not be rebased.</p>}
        <button className="secondary" disabled={busy || !!pending || !!review} onClick={() => void reload(shift.id)}>Discard count and reload drawer</button>
        {shift.status === 'OPEN' && <form className="admin-form close-purchase" onSubmit={event => { event.preventDefault(); prepare(() => {
          const countedPaise = countPaise(counted); const discrepancy = countedPaise - shift.expectedPaise;
          if (discrepancy !== 0 && !reason.trim()) throw new Error('Explain the difference between counted and expected cash.');
          return { kind: 'close', path: `/cash/shifts/${shift.id}/close`, shiftId: shift.id, body: { id: crypto.randomUUID(), expectedVersion: shift.version, countedPaise, reason },
            summary: [`Close shift #${shift.sequence}? Expected ${cashMoney(shift.expectedPaise)}; counted ${payableMoney(countedPaise)}; discrepancy ${cashMoney(discrepancy)}.`, reason || 'Count matches expected.', 'Closed evidence is immutable. Stop drawer activity while counting; a concurrent cash movement makes this review stale.'] };
        }); }}><h4>Count and close drawer</h4><fieldset disabled={blocked || stale}><label>Counted cash (INR)<input id="cash-counted" required inputMode="decimal" value={counted} onChange={event => setCounted(event.target.value)}/></label><label>Discrepancy reason / closing note<input id="cash-close-reason" maxLength={200} value={reason} onChange={event => setReason(event.target.value)}/></label><button className="primary">Review closing drawer</button></fieldset></form>}
        <History<MovementPage> key={shift.id} token={token} path={`/cash/shifts/${shift.id}/movements`} revision={revision} title="Movements">{page => <>{page.movements.map(value => <article key={value.sequence}><h4>{value.kind} · {cashMoney(value.deltaPaise)}</h4><p>Balance then {cashMoney(value.balancePaise)}</p><small>Source ID: {value.sourceId}</small><small>{localTime(value.createdAt)} IST · staff {value.actorId}</small></article>)}{!page.movements.length && <p>No drawer movements. Opening float only.</p>}</>}</History>
      </section>}
      <form className="admin-form purchase-editor" onSubmit={event => { event.preventDefault(); void recoverExpense(); }}><label>Recover expense by ID<input id="recover-expense" required value={expenseLookup} onChange={event => setExpenseLookup(event.target.value)}/></label><button className="secondary" disabled={blocked}>Open operating expense</button></form>
      {expense && <section aria-label="Recovered operating expense"><ExpenseRecord value={expense}/></section>}
    </section></div>
  </section>;
}
