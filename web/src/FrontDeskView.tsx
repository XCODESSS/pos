import { useEffect, useRef, useState } from 'react';
import { ApiFailure, kitchenLabels, localTime, money, request, type CartLine, type DiningTable, type MenuItem, type RunningCheck } from './api';
import { addLine, CartLines, describeLine, MenuPicker, quantityChange } from './MenuComposer';
import { StockWarnings, StockPreviewPanel } from './StockWarnings';
import { requireCashShift } from './cash';

import { storageKey, tenantSlug } from './Tenant';
const PENDING = tenantSlug ? storageKey('frontdesk.pending') : '';
const SELECTED = tenantSlug ? storageKey('frontdesk.selected') : '';
const DRAFT = tenantSlug ? storageKey('frontdesk.draft') : '';
type Command = { path: string; body: unknown; kind: 'table' | 'check'; clearDraft?: boolean };
function saved<T>(key: string): T | null { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function TableEditor({ tables, disabled, save }: { tables: DiningTable[]; disabled: boolean; save: (command: Command) => Promise<boolean> }) {
  const [editing, setEditing] = useState<DiningTable | null>(null);
  const [label, setLabel] = useState(''); const [floor, setFloor] = useState('Main floor'); const [seats, setSeats] = useState(4); const [active, setActive] = useState(true);
  function edit(table: DiningTable | null) { setEditing(table); setLabel(table?.label ?? ''); setFloor(table?.floor ?? 'Main floor'); setSeats(table?.seats ?? 4); setActive(table?.active ?? true); }
  return <details className="table-administration"><summary>Manage floors & tables</summary><div className="table-editor-layout"><div className="admin-records">{tables.map(table => <article className="admin-card" key={table.id}><div><strong>{table.floor} / {table.label}</strong><small>{table.seats} seats · {table.active ? 'Active' : 'Inactive'}</small></div><button className="secondary" disabled={disabled || !!table.checkId} onClick={() => edit(table)}>Edit</button></article>)}</div><form className="admin-form" onSubmit={async event => {
    event.preventDefault(); const table = { label, floor, seats, active };
    const command: Command = editing ? { kind: 'table', path: `/admin/tables/${editing.id}`, body: { expectedVersion: editing.version, table } } : { kind: 'table', path: '/admin/tables', body: { id: crypto.randomUUID(), table } };
    if (await save(command)) edit(null);
  }}><h3>{editing ? 'Edit table' : 'Add table'}</h3><fieldset disabled={disabled}><label>Floor / area<input aria-label="Floor / area" value={floor} maxLength={60} required onChange={event => setFloor(event.target.value)}/></label><label>Table label<input aria-label="Table label" value={label} maxLength={40} required onChange={event => setLabel(event.target.value)}/></label><label>Seats<input type="number" min={1} max={100} value={seats} required onChange={event => setSeats(Number(event.target.value))}/></label><label className="check-label"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)}/>Active</label><button className="primary">{editing ? 'Save table changes' : 'Create table'}</button>{editing && <button type="button" className="secondary" onClick={() => edit(null)}>New table instead</button>}</fieldset><p>Occupied tables cannot be edited or deactivated. Transfer or settle their check first.</p></form></div></details>;
}

export function FrontDeskView({ token, canManage, canOrder, canPay, initialCheckId, onOpened, onSettled }: {
  token: string; canManage: boolean; canOrder: boolean; canPay: boolean; initialCheckId: string | null; onOpened: () => void; onSettled: () => Promise<void>;
}) {
  const [tables, setTables] = useState<DiningTable[]>([]); const [menu, setMenu] = useState<MenuItem[]>([]);
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(SELECTED));
  const [check, setCheck] = useState<RunningCheck | null>(null);
  const [draft, setDraftState] = useState<{ checkId: string; lines: CartLine[] } | null>(() => saved(DRAFT));
  const [pending, setPending] = useState<Command | null>(() => saved(PENDING));
  const [busy, setBusy] = useState(false); const lock = useRef(false); const mounted = useRef(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState(''); const [destination, setDestination] = useState(''); const [recover, setRecover] = useState('');
  const [cashConfirmation, setCashConfirmation] = useState<{ command: Command; amountPaise: number } | null>(null);
  const lines = draft?.checkId === selected ? draft.lines : [];
  const blocked = busy || pending !== null || cashConfirmation !== null || !loaded;
  const editable = !!check && check.status === 'OPEN' && canOrder;
  const draftRef = useRef(draft); draftRef.current = draft;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  function setDraft(value: { checkId: string; lines: CartLine[] } | null) {
    if (value) sessionStorage.setItem(DRAFT, JSON.stringify(value)); else sessionStorage.removeItem(DRAFT);
    setDraftState(value);
  }
  function select(id: string | null) {
    if (id) sessionStorage.setItem(SELECTED, id); else sessionStorage.removeItem(SELECTED);
    setSelected(id); selectedRef.current = id; setCheck(null); setAmount(''); setDestination('');
  }
  async function refresh(id: string | null = selectedRef.current) {
    const [nextTables, nextMenu, value] = await Promise.all([
      request<DiningTable[]>(token, '/tables'), canOrder ? request<MenuItem[]>(token, '/menu') : Promise.resolve([]),
      id ? request<RunningCheck>(token, `/checks/${encodeURIComponent(id)}`) : Promise.resolve(null),
    ]);
    if (!mounted.current) return;
    setTables(nextTables);
    setMenu(previous => [...nextMenu, ...previous.filter(item => draftRef.current?.lines.some(line => line.itemId === item.id) && !nextMenu.some(fresh => fresh.id === item.id)).map(item => ({ ...item, available: false }))]);
    if (id === selectedRef.current) setCheck(value);
    setLoaded(true);
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh the front desk.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true; void reload();
    return () => { mounted.current = false; };
  }, [token]);
  useEffect(() => {
    if (!initialCheckId || !loaded || busy || pending) return;
    onOpened(); void openExisting(initialCheckId);
  }, [initialCheckId, loaded, busy, pending]);

  async function execute(command: Command): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    sessionStorage.setItem(PENDING, JSON.stringify(command)); setPending(command);
    try {
      const result = await request<RunningCheck | DiningTable>(token, command.path, command.body);
      sessionStorage.removeItem(PENDING); setPending(null);
      if (command.clearDraft) setDraft(null);
      if (command.kind === 'check') {
        const value = result as RunningCheck;
        sessionStorage.setItem(SELECTED, value.id); selectedRef.current = value.id;
        setSelected(value.id); setCheck(value); setAmount(''); setDestination('');
      }
      setNotice('Saved. Existing kitchen batches and bill prices are preserved.');
      // A failed follow-up refresh never turns a known committed command into an uncertain retry.
      try { await refresh(); if (command.path.endsWith('/cash-payments')) await onSettled(); }
      catch (cause) { setError(`Action saved, but refresh failed: ${cause instanceof Error ? cause.message : 'retry refresh'}`); }
      return true;
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) {
        sessionStorage.removeItem(PENDING); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : 'The action could not be confirmed. Retry the same request.');
      return false;
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function openExisting(id: string) {
    if (blocked || lock.current) return;
    if (lines.length && !window.confirm('Discard the unsent kitchen batch before opening another check?')) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const value = await request<RunningCheck>(token, `/checks/${encodeURIComponent(id)}`);
      setDraft(null); select(value.id); setCheck(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open check.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function openTable(table: DiningTable) {
    if (blocked) return;
    if (table.checkId) { void openExisting(table.checkId); return; }
    if (!canOrder || !table.active) return;
    if (lines.length && !window.confirm('Discard the unsent batch before opening this table?')) return;
    void execute({ kind: 'check', path: '/checks', body: { id: crypto.randomUUID(), tableId: table.id }, clearDraft: true });
  }
  function updateLines(value: CartLine[]) { if (selected && !blocked && editable) setDraft({ checkId: selected, lines: value }); }
  function submit() {
    if (!check || !lines.length) return;
    void execute({ kind: 'check', path: `/checks/${check.id}/batches`, body: { id: crypto.randomUUID(), expectedVersion: check.version, lines }, clearDraft: true });
  }
  async function recordCash(exact = false) {
    if (!check || lock.current || blocked) return;
    if (lines.length) { setError('Submit or discard the unsent batch before settlement.'); return; }
    let paise = check.duePaise;
    if (!exact) {
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(amount)) { setError('Enter an exact cash amount in INR, with up to two decimal places.'); return; }
      const [whole, fraction = ''] = amount.split('.'); paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    }
    if (paise < 1 || paise > check.duePaise) { setError('Cash must be positive and cannot exceed the balance due.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const cashShiftId = await requireCashShift(token);
      if (mounted.current) setCashConfirmation({ amountPaise: paise, command: { kind: 'check', path: `/checks/${check.id}/cash-payments`, body: { id: crypto.randomUUID(), expectedVersion: check.version, amountPaise: paise, cashShiftId } } });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Cash shift unavailable.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const destinations = tables.filter(table => table.active && !table.checkId);
  const floors = [...new Set(tables.map(table => table.floor))];
  return <section className="workspace frontdesk" aria-label="Tables and running checks"><div className="workspace-heading"><div><span className="eyebrow">ONE TABLE. EVERY ROUND. ONE CHECK.</span><h2>Keep the whole service together.</h2><p>Open a table, send multiple kitchen batches, then settle in one or several cash amounts.</p></div><button className="secondary" disabled={busy} onClick={() => void reload()}>Refresh tables & check</button></div>
    <div className="workspace-notice">A table is released after full settlement, even if food is still preparing. The first payment locks additions. Sales recognize the full check only on final settlement; partial cash is listed on the check. Splits are by amount, not by guest/item. Demo bills are not GST invoices.</div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {pending && <div className="recovery-banner"><p>{busy ? 'Saving…' : 'An action is unconfirmed. The exact request is saved in this browser tab. Retry it before doing anything else.'}</p><button className="primary" disabled={busy} onClick={() => void execute(pending)}>Retry same front-desk action</button></div>}
    {cashConfirmation && <section className="cash-confirmation" aria-label="Confirm received cash" role="region"><h3>Confirm physical cash received</h3><p>Amount: <strong>{money(cashConfirmation.amountPaise)}</strong>. The first payment locks dish additions. This posts to the shared drawer selected for this review; it does not process a digital payment.</p><button className="primary" disabled={busy} onClick={() => { if (lock.current) return; const command = cashConfirmation.command; setCashConfirmation(null); void execute(command); }}>Confirm cash received</button><button className="secondary" disabled={busy} onClick={() => setCashConfirmation(null)}>Cancel cash confirmation</button></section>}
    <div className="floor-board">{floors.map(floor => <section key={floor}><h3>{floor}</h3><div className="table-grid">{tables.filter(table => table.floor === floor).map(table => <button key={table.id} className={`table-card ${table.checkId ? 'occupied' : ''}`} disabled={blocked || (!table.checkId && (!table.active || !canOrder))} onClick={() => openTable(table)}><strong>{table.label}</strong><span>{table.seats} seats</span><small>{table.checkId ? 'Occupied · open check →' : table.active ? 'Available · open table' : 'Inactive'}</small></button>)}</div></section>)}</div>
    {loaded && !tables.length && <p className="workspace-notice">No tables yet. {canManage ? 'Create your floor and first table below.' : 'Ask an owner or manager to create tables.'}</p>}
    <form className="recover-form" onSubmit={event => { event.preventDefault(); void openExisting(recover.trim()); }}><label htmlFor="recover-check">Recover check by ID</label><input id="recover-check" value={recover} required maxLength={36} placeholder="Check UUID, including closed receipts" onChange={event => setRecover(event.target.value)}/><button className="secondary" disabled={blocked}>Open check</button></form>
    {check && <section className="running-check" aria-label="Selected running check"><div className="workspace-heading"><div><h2>{check.number} · {check.table.floor} / {check.table.label}</h2><p>{check.status} · version {check.version} · opened {localTime(check.createdAt)} IST</p><small>Check ID: {check.id}</small></div><button className="secondary" disabled={blocked} onClick={() => { if (lines.length && !window.confirm('Discard this unsent batch?')) return; setDraft(null); select(null); }}>Back to tables</button></div>
      <div className="check-summary"><span>Total <strong>{money(check.totalPaise)}</strong></span><span>Cash recorded <strong>{money(check.paidPaise)}</strong></span><span>Balance due <strong>{money(check.duePaise)}</strong></span></div>
      <div className="batch-list">{check.batches.map((batch, index) => <article className="batch-card" key={batch.bill.id}><div className="order-card-top"><h3>Kitchen batch {index + 1} · {batch.bill.billNumber}</h3><span className="state-badge">{batch.kitchen ? kitchenLabels[batch.kitchen.status] : 'Unknown'}</span></div><small>Submitted for {batch.bill.tableLabel} · {localTime(batch.bill.createdAt)} IST</small>{batch.bill.lines.map((line, i) => <div className="ticket-line" key={i}><div><strong>{line.quantity} × {line.name}</strong><small>{money(line.unitPricePaise)} each before tax</small></div><span>{money(line.subtotalPaise)}</span></div>)}<div className="batch-totals">Subtotal {money(batch.bill.subtotalPaise)} · CGST {money(batch.bill.cgstPaise)} · SGST {money(batch.bill.sgstPaise)} · <strong>Total {money(batch.bill.totalPaise)}</strong></div><StockWarnings snapshot={batch.inventory ?? null} historical/></article>)}</div>
      {check.payments.length > 0 && <section className="check-payments"><h3>Recorded cash splits</h3>{check.payments.map(payment => <div key={payment.id}><strong>{money(payment.amountPaise)}</strong><span>{localTime(payment.receivedAt)} IST</span><small>Payment ID: {payment.id} · Staff: {payment.receivedBy}</small></div>)}</section>}
      {check.status !== 'CLOSED' && <><div className="check-actions">{canOrder && <form onSubmit={event => { event.preventDefault(); void execute({ kind: 'check', path: `/checks/${check.id}/transfer`, body: { id: crypto.randomUUID(), expectedVersion: check.version, tableId: destination } }); }}><label>Transfer to<select aria-label="Transfer to table" value={destination} disabled={blocked} required onChange={event => setDestination(event.target.value)}><option value="">Choose an available table</option>{destinations.map(table => <option key={table.id} value={table.id}>{table.floor} / {table.label}</option>)}</select></label><button className="secondary" disabled={blocked || !destination || lines.length > 0}>Transfer check</button></form>}{canPay && check.duePaise > 0 && <form onSubmit={event => { event.preventDefault(); recordCash(); }}><label>Cash split amount (INR)<input aria-label="Cash split amount (INR)" value={amount} inputMode="decimal" disabled={blocked} onChange={event => setAmount(event.target.value)} required/></label><button className="primary" disabled={blocked || lines.length > 0}>Record cash split</button><button type="button" className="secondary" disabled={blocked || lines.length > 0} onClick={() => recordCash(true)}>Record remaining {money(check.duePaise)}</button></form>}{canOrder && !check.batches.length && <button className="secondary" disabled={blocked || lines.length > 0} onClick={() => void execute({ kind: 'check', path: `/checks/${check.id}/close-empty`, body: { id: crypto.randomUUID(), expectedVersion: check.version } })}>Release empty table</button>}</div>
      {editable && <div className="pos-layout check-composer"><MenuPicker menu={menu} locked={blocked} onAdd={line => updateLines(addLine(lines, line))}/><section className="ticket" aria-label="Next kitchen batch"><h3>Next kitchen batch</h3><p>Only new dishes are sent. Earlier batches are never dispatched again.</p><CartLines lines={lines} menu={menu} locked={blocked} onChange={(key, change) => updateLines(quantityChange(lines, key, change))}/><p>Estimated subtotal: <strong>{money(lines.reduce((sum, line) => sum + describeLine(line, menu).price * line.quantity, 0))}</strong></p><StockPreviewPanel token={token} lines={lines} disabled={blocked}/><button className="primary full" disabled={blocked || !lines.length || lines.some(line => !describeLine(line, menu).available)} onClick={submit}>Send batch to kitchen</button>{lines.length > 0 && <button className="print-button" disabled={blocked} onClick={() => { if (window.confirm('Discard the unsent batch?')) setDraft(null); }}>Discard unsent batch</button>}</section></div>}</>}
      {check.status === 'CLOSED' && <p className="paid-message">✓ Check closed · {check.totalPaise ? 'Cash fully recorded' : 'Empty table released'}</p>}
      <button className="print-button" onClick={() => window.print()}>Print check summary</button><p className="demo-note">DEMO CHECK · Not a GST tax invoice</p>
    </section>}
    {canManage && <TableEditor tables={tables} disabled={blocked} save={execute}/>}
  </section>;
}
