import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request } from './api';
import { storageKey } from './Tenant';
import { parseQuantity, stockQuantity, unitLabels, type Ingredient, type InventorySummary, type StockCount, type StockCountInput, type StockCountPage } from './inventory';

type DraftLine = { ingredient: Ingredient; quantity: string };
const pendingKey = () => storageKey('inventory.count.pending');
function saved(): StockCountInput | null {
  try { return JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); } catch { return null; }
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Stock counts unavailable.';

function CountRecord({ count }: { count: StockCount }) {
  return <article className="count-record"><h4>Count #{count.sequence}</h4><p>{count.reason}</p><small>{localTime(count.createdAt)} IST · staff {count.actorId}</small><small>Count ID: {count.id}</small>
    {count.lines.map(line => <div className="count-record-line" key={line.ingredientId}><strong>{line.ingredientName}</strong><span>Recorded {stockQuantity(line.recordedMilli, line.unit)}</span><span>Counted {stockQuantity(line.countedMilli, line.unit)}</span><span>Variance {stockQuantity(line.varianceMilli, line.unit)}</span></div>)}
  </article>;
}

/** A draft keeps its observed versions until explicitly discarded; refreshing inventory cannot rebase it. */
export function StockCountsView({ token, canManage, disabled, onSaved }: { token: string; canManage: boolean; disabled: boolean; onSaved: () => Promise<void> }) {
  const [available, setAvailable] = useState<Ingredient[] | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]); const [choice, setChoice] = useState(''); const [reason, setReason] = useState('');
  const [review, setReview] = useState<StockCountInput | null>(null); const [pending, setPending] = useState<StockCountInput | null>(saved);
  const [busy, setBusy] = useState(false); const locked = useRef(false); const mounted = useRef(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [stale, setStale] = useState(false);
  const [history, setHistory] = useState<StockCountPage | null>(null); const [historyError, setHistoryError] = useState(''); const [historyBusy, setHistoryBusy] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [refreshKey, setRefreshKey] = useState(0);
  const [lookupId, setLookupId] = useState(''); const [found, setFound] = useState<StockCount | null>(null);
  const blocked = busy || disabled || pending !== null || !canManage;
  const cursor = cursors.at(-1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setHistoryBusy(true); setHistoryError(''); setHistory(null);
    void request<StockCountPage>(token, `/inventory/counts?limit=10${cursor ? `&before=${cursor}` : ''}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setHistory(value); })
      .catch(cause => { if (!controller.signal.aborted) setHistoryError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryBusy(false); });
    return () => controller.abort();
  }, [token, cursor, refreshKey]);
  async function start() {
    if (blocked || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    // Discard the previous draft explicitly, even if the reload fails. Never substitute new versions into old observations.
    setAvailable(null); setLines([]); setReview(null); setReason(''); setChoice('');
    try {
      const result = await request<InventorySummary>(token, '/inventory');
      if (mounted.current) { setAvailable(result.ingredients); setStale(false); }
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  function prepare() {
    if (blocked || stale) return;
    setError('');
    try {
      if (!lines.length) throw new Error('Select at least one ingredient.');
      if (!reason.trim()) throw new Error('Explain the count before reviewing.');
      setReview({ id: crypto.randomUUID(), reason: reason.trim(), lines: lines.map(line => ({ ingredientId: line.ingredient.id, expectedVersion: line.ingredient.version, countedMilli: parseQuantity(line.quantity) })) });
    } catch (cause) { setError(message(cause)); }
  }
  async function execute(body: StockCountInput) {
    if (locked.current || !canManage || disabled) return;
    try { sessionStorage.setItem(pendingKey(), JSON.stringify(body)); }
    catch { setError('Cannot retain the count ID. No correction was sent.'); return; }
    locked.current = true; setBusy(true); setPending(body); setError(''); setNotice('');
    try {
      const count = await request<StockCount>(token, '/inventory/counts', body);
      sessionStorage.removeItem(pendingKey());
      if (!mounted.current) return;
      setPending(null); setReview(null); setAvailable(null); setLines([]); setReason(''); setFound(count);
      setCursors([null]); setRefreshKey(value => value + 1);
      setNotice(`Count #${count.sequence} recorded. Variances and staff attribution are retained.`);
      try { await onSaved(); } catch (cause) { if (mounted.current) setError(`Count saved, but inventory refresh failed: ${message(cause)}`); }
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) {
        sessionStorage.removeItem(pendingKey());
        if (mounted.current) { setPending(null); setReview(null); setStale(true); }
      }
      if (mounted.current) setError(message(cause));
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function lookup() {
    if (locked.current || busy) return;
    locked.current = true; setBusy(true); setError(''); setFound(null);
    try { const value = await request<StockCount>(token, `/inventory/counts/${encodeURIComponent(lookupId.trim())}`); if (mounted.current) setFound(value); }
    catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="stock-counts" aria-label="Physical stock counts"><h3>Physical stock counts</h3>
    <p>Count selected ingredients, review the differences, then confirm the correction. Coordinate counting with kitchen activity: this does not pause service.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {pending && <div className="recovery-banner"><p>{busy ? 'Recording count…' : 'Count outcome is unconfirmed. Retry the exact saved command; do not enter another correction.'}</p><small>Count ID: {pending.id}</small><button className="primary" disabled={busy || disabled || !canManage} onClick={() => void execute(pending)}>Retry same stock count</button></div>}
    {canManage && <><button className="secondary" disabled={blocked} onClick={() => void start()}>{available || stale ? 'Discard draft and reload stock' : 'Start physical count'}</button>
    {stale && <p className="workspace-notice">This draft cannot be submitted. Discard it, reload stock and review the physical quantities again.</p>}
    {available && !stale && !pending && <form className="admin-form count-form" onSubmit={event => { event.preventDefault(); prepare(); }}><fieldset disabled={blocked || review !== null}>
      <label>Ingredient to count<select id="count-ingredient" value={choice} onChange={event => setChoice(event.target.value)}><option value="">Select an ingredient</option>{available.filter(item => !lines.some(line => line.ingredient.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} ({unitLabels[item.unit]})</option>)}</select></label>
      <button type="button" className="secondary" disabled={!choice || lines.length >= 100} onClick={() => { const item = available.find(value => value.id === choice); if (item && !lines.some(line => line.ingredient.id === item.id)) setLines(previous => [...previous, { ingredient: item, quantity: '' }]); setChoice(''); }}>Add to count</button>
      {lines.map((line, index) => <div className="count-line" key={line.ingredient.id}><div><strong>{line.ingredient.name}</strong><p>Recorded {stockQuantity(line.ingredient.balanceMilli, line.ingredient.unit)} · version {line.ingredient.version}</p></div><label>Physical quantity ({unitLabels[line.ingredient.unit]})<input aria-label={`Counted quantity ${index + 1}`} inputMode="decimal" required value={line.quantity} onChange={event => setLines(previous => previous.map((value, position) => position === index ? { ...value, quantity: event.target.value } : value))}/></label><button type="button" className="secondary" aria-label={`Remove count ingredient ${index + 1}`} onClick={() => setLines(previous => previous.filter((_, position) => position !== index))}>Remove</button></div>)}
      <label>Count reason<input id="count-reason" value={reason} maxLength={200} required onChange={event => setReason(event.target.value)}/></label><button className="primary" disabled={!lines.length}>Review stock count</button>
    </fieldset></form>}
    {review && !pending && <section className="count-review" aria-label="Review stock count"><h4>Review before correcting stock</h4><p>{review.reason}</p>{review.lines.map(line => { const item = lines.find(value => value.ingredient.id === line.ingredientId)!.ingredient; return <div className="count-record-line" key={item.id}><strong>{item.name}</strong><span>Recorded {stockQuantity(item.balanceMilli, item.unit)}</span><span>Counted {stockQuantity(line.countedMilli, item.unit)}</span><strong>Variance {stockQuantity(line.countedMilli - item.balanceMilli, item.unit)}</strong></div>; })}
      <p>Confirmation records these differences once. If stock changed meanwhile, the entire count will be rejected for review.</p><div className="count-actions"><button className="secondary" disabled={blocked} onClick={() => setReview(null)}>Back to count</button><button className="primary" disabled={blocked} onClick={() => void execute(review)}>Confirm stock count</button></div>
    </section>}</>}
    <form className="admin-form count-lookup" onSubmit={event => { event.preventDefault(); void lookup(); }}><label>Recover count by ID<input id="recover-count" value={lookupId} required onChange={event => setLookupId(event.target.value)}/></label><button className="secondary" disabled={busy || !lookupId.trim()}>Open stock count</button></form>
    {found && <section aria-label="Recovered stock count"><CountRecord count={found}/></section>}
    <section className="count-history" aria-label="Stock count history"><h4>Count history</h4>{historyError && <p className="error" role="alert">{historyError}</p>}{historyBusy && <p>Loading count history…</p>}{history?.counts.map(count => <CountRecord key={count.id} count={count}/>)}{history && !history.counts.length && <p>No physical counts recorded.</p>}
      <div className="count-actions"><button className="secondary" disabled={historyBusy || cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>Newer counts</button><button className="secondary" disabled={historyBusy || !history?.nextCursor} onClick={() => { if (history?.nextCursor) setCursors(value => [...value, history.nextCursor]); }}>Older counts</button><button className="secondary" disabled={historyBusy} onClick={() => { setCursors([null]); setRefreshKey(value => value + 1); }}>Refresh count history</button></div>
    </section>
  </section>;
}
