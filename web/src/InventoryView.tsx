import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request } from './api';
import { storageKey } from './Tenant';
import { parseQuantity, quantityInput, stockQuantity, unitLabels, type Ingredient, type InventorySummary, type StockMovementPage, type StockMoveResult, type StockUnit } from './inventory';
import './inventory.css';

type Command = { path: string; body: unknown };
const PENDING = () => storageKey('inventory.pending');
function saved(): Command | null { try { return JSON.parse(sessionStorage.getItem(PENDING()) || 'null'); } catch { return null; } }
export function InventoryView({ token, canManage }: { token: string; canManage: boolean }) {
  const [items, setItems] = useState<Ingredient[]>([]); const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(storageKey('inventory.selected')));
  const [pending, setPending] = useState<Command | null>(saved); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [search, setSearch] = useState('');
  const [name, setName] = useState(''); const [unit, setUnit] = useState<StockUnit>('G'); const [threshold, setThreshold] = useState('0');
  const [editName, setEditName] = useState(''); const [editThreshold, setEditThreshold] = useState('0');
  const [kind, setKind] = useState<'RECEIPT' | 'WASTE' | 'ADJUSTMENT'>('RECEIPT'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [reference, setReference] = useState('');
  const [history, setHistory] = useState<StockMovementPage | null>(null); const [historyError, setHistoryError] = useState(''); const [historyBusy, setHistoryBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [refreshKey, setRefreshKey] = useState(0);
  const item = items.find(value => value.id === selected); const blocked = busy || pending !== null || !loaded;
  const mounted = useRef(true);
  async function refresh() {
    const result = await request<InventorySummary>(token, '/inventory');
    if (mounted.current) { setItems(result.ingredients); setLoaded(true); setRefreshKey(value => value + 1); }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void request<InventorySummary>(token, '/inventory', undefined, controller.signal).then(value => { if (!controller.signal.aborted) { setItems(value.ingredients); setLoaded(true); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Inventory unavailable.'); });
    return () => { mounted.current = false; controller.abort(); };
  }, [token]);
  useEffect(() => {
    setEditName(item?.name ?? ''); setEditThreshold(quantityInput(item?.lowStockMilli ?? 0));
  }, [item?.id, item?.version]);
  const cursor = cursors.at(-1);
  useEffect(() => {
    if (!selected) { setHistory(null); return; }
    const controller = new AbortController(); setHistoryBusy(true); setHistoryError('');
    void request<StockMovementPage>(token, `/inventory/movements?ingredientId=${selected}&limit=25${cursor ? `&before=${cursor}` : ''}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setHistory(value); })
      .catch(cause => { if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : 'Stock history unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setHistoryBusy(false); });
    return () => controller.abort();
  }, [selected, cursor, token, refreshKey]);
  function select(value: Ingredient) {
    if (blocked) return; setSelected(value.id); sessionStorage.setItem(storageKey('inventory.selected'), value.id);
    setCursors([null]); setHistory(null); setAmount(''); setReason(''); setReference(''); setError(''); setNotice('');
  }
  async function execute(command: Command) {
    if (lock.current || !canManage) return;
    try { sessionStorage.setItem(PENDING(), JSON.stringify(command)); }
    catch { setError('Cannot retain the command ID. No stock action was sent.'); return; }
    lock.current = true; setPending(command); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<Ingredient | StockMoveResult>(token, command.path, command.body);
      sessionStorage.removeItem(PENDING()); setPending(null);
      const ingredient = 'ingredient' in result ? result.ingredient : result;
      setSelected(ingredient.id); sessionStorage.setItem(storageKey('inventory.selected'), ingredient.id);
      setItems(previous => [ingredient, ...previous.filter(value => value.id !== ingredient.id)]);
      setCursors([null]); setAmount(''); setReason(''); setReference('');
      if (command.path === '/inventory/ingredients') { setName(''); setThreshold('0'); }
      setNotice('Saved. The stock history retains who changed the balance and why.');
      try { await refresh(); } catch (cause) { setError(`Action saved, but refresh failed: ${cause instanceof Error ? cause.message : 'try refresh'}`); }
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) { sessionStorage.removeItem(PENDING()); setPending(null); }
      setError(cause instanceof Error ? cause.message : 'Stock outcome is uncertain. Retry the same action.');
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function prepare(action: () => Command) {
    if (blocked) return;
    try { void execute(action()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid stock quantity.'); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Inventory refresh failed.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="workspace inventory-workspace" aria-label="Inventory and recipes"><div className="workspace-heading"><div><span className="eyebrow">EVERY INGREDIENT. EVERY MOVEMENT.</span><h2>Know what is in your kitchen.</h2><p>Balances include received stock, recipe consumption, waste and explained adjustments.</p></div><button className="secondary" disabled={busy} onClick={() => void reload()}>Refresh inventory</button></div>
    <div className="workspace-notice">Shortages warn, not block. Negative balances remain visible. Units are fixed base units: grams, millilitres or each. Opening stock must be an explained adjustment; receiving here is not a supplier invoice or purchase order.</div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {pending && <div className="recovery-banner"><p>{busy ? 'Saving stock action…' : 'The outcome is unconfirmed. The exact command is retained for this business; retry it unchanged.'}</p><button className="primary" disabled={busy} onClick={() => void execute(pending)}>Retry same inventory action</button></div>}
    <div className="inventory-summary"><span>{items.length} ingredients</span><span>{items.filter(value => value.lowStock).length} low stock</span><span>{items.filter(value => value.balanceMilli < 0).length} negative balances</span></div>
    <div className="inventory-layout"><section><label className="search"><input aria-label="Search ingredients" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search ingredients…"/></label><div className="admin-records">{items.filter(value => value.name.toLowerCase().includes(search.toLowerCase())).map(value => <article className={`admin-card ${value.balanceMilli < 0 ? 'negative-stock' : ''}`} key={value.id}><div><h3>{value.name}</h3><p>{stockQuantity(value.balanceMilli, value.unit)} on hand</p><small>Low at {stockQuantity(value.lowStockMilli, value.unit)} · version {value.version}{value.lowStock && ' · LOW STOCK'}</small></div><button className="secondary" aria-label={`Manage ingredient ${value.name}`} disabled={blocked} onClick={() => select(value)}>Manage</button></article>)}</div>{loaded && !items.length && <p className="workspace-notice">No ingredients yet. Add your first ingredient to begin recording stock.</p>}
    {canManage && <section className="admin-editor ingredient-create"><h3>Add ingredient</h3><form className="admin-form" onSubmit={event => { event.preventDefault(); prepare(() => ({ path: '/inventory/ingredients', body: { id: crypto.randomUUID(), name, unit, lowStockMilli: parseQuantity(threshold) } })); }}><fieldset disabled={blocked}><label>Ingredient name<input id="ingredient-name" value={name} maxLength={80} required onChange={event => setName(event.target.value)}/></label><label>Base unit<select id="ingredient-unit" value={unit} onChange={event => setUnit(event.target.value as StockUnit)}>{Object.entries(unitLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Low-stock threshold ({unitLabels[unit]})<input id="ingredient-threshold" inputMode="decimal" value={threshold} required onChange={event => setThreshold(event.target.value)}/></label><button className="primary">Create ingredient</button></fieldset></form></section>}</section>
    <section>{item && <><section className="admin-editor"><h3>{item.name}</h3><p className={item.balanceMilli < 0 ? 'stock-negative-label' : 'stock-balance'}>{stockQuantity(item.balanceMilli, item.unit)} on hand</p><small>Ingredient ID: {item.id}</small>{canManage && <><form className="admin-form stock-movement-form" onSubmit={event => { event.preventDefault(); prepare(() => ({ path: `/inventory/ingredients/${item.id}/movements`, body: { id: crypto.randomUUID(), kind, quantityMilli: parseQuantity(amount, kind === 'ADJUSTMENT'), reason, reference: reference.trim() || null, expectedVersion: item.version } })); }}><h4>Record a stock movement</h4><fieldset disabled={blocked}><label>Movement type<select id="stock-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="RECEIPT">Stock received</option><option value="WASTE">Wastage</option><option value="ADJUSTMENT">Adjustment / opening stock</option></select></label><label>Quantity ({unitLabels[item.unit]})<input id="stock-quantity" inputMode="decimal" value={amount} required onChange={event => setAmount(event.target.value)}/></label><p className="admin-hint">Receiving and waste use positive amounts. Adjustments are signed changes, not a replacement balance. Up to three decimals.</p><label>Reason<input id="stock-reason" value={reason} maxLength={200} required onChange={event => setReason(event.target.value)}/></label><label>Reference (optional)<input id="stock-reference" value={reference} maxLength={80} onChange={event => setReference(event.target.value)}/></label><button className="primary">Record stock movement</button></fieldset></form>
    <details className="ingredient-settings"><summary>Edit name / low-stock threshold</summary><form className="admin-form" onSubmit={event => { event.preventDefault(); prepare(() => ({ path: `/inventory/ingredients/${item.id}`, body: { expectedVersion: item.version, name: editName, lowStockMilli: parseQuantity(editThreshold) } })); }}><fieldset disabled={blocked}><label>Ingredient display name<input value={editName} maxLength={80} required onChange={event => setEditName(event.target.value)}/></label><label>Low-stock threshold ({unitLabels[item.unit]})<input value={editThreshold} inputMode="decimal" required onChange={event => setEditThreshold(event.target.value)}/></label><button className="secondary">Save ingredient settings</button></fieldset></form></details></>}</section>
    <section className="stock-history" aria-label="Stock movement history"><h3>Movement history</h3>{historyError && <p className="error" role="alert">{historyError}</p>}{historyBusy && <p>Refreshing history…</p>}{history?.movements.map(movement => <article key={movement.sequence}><div><strong>{movement.kind} · {stockQuantity(movement.deltaMilli, movement.unit)}</strong><span>Balance {stockQuantity(movement.balanceMilli, movement.unit)}</span></div><p>{movement.reason}{movement.reference && ` · ${movement.reference}`}</p><small>{localTime(movement.createdAt)} IST · staff {movement.actorId}</small>{movement.orderId && <small>Kitchen submission: {movement.orderId}</small>}</article>)}{history && !history.movements.length && <p className="workspace-notice">No movements recorded.</p>}<div className="pagination"><button className="secondary" disabled={historyBusy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>Newer</button><button className="secondary" disabled={historyBusy || !history?.nextCursor} onClick={() => { if (history?.nextCursor) setCursors(value => [...value, history.nextCursor]); }}>Older</button></div></section></>}{!item && <p className="workspace-notice">Select an ingredient to record receiving, waste or adjustments and inspect its history.</p>}</section></div>
  </section>;
}
