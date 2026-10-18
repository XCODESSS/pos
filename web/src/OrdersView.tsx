import { useState } from 'react';
import { kitchenLabels, localTime, money, orderContext } from './api';
import { useOrderFeed } from './useOrderFeed';

type Props = { token: string; busy: boolean; canOpen: boolean; onOpen: (id: string) => Promise<void> };
export function OrdersView({ token, busy, canOpen, onOpen }: Props) {
  const [status, setStatus] = useState('OPEN');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [recoveryId, setRecoveryId] = useState('');
  const cursor = cursors[cursors.length - 1];
  const query = new URLSearchParams({ status, limit: '25', ...(cursor ? { before: cursor } : {}) });
  const feed = useOrderFeed(token, `/orders?${query}`);
  function filter(value: string) { setStatus(value); setCursors([null]); }

  return <section className="workspace" aria-label="Order history">
    <div className="workspace-heading"><div><span className="eyebrow">EVERY BILL, WITHIN REACH</span><h2>Nothing lost between shifts.</h2><p>Reopen an unpaid bill or view a settled sale. Kitchen progress is separate from payment.</p></div><button className="secondary" disabled={feed.loading} onClick={() => void feed.refresh()}>{feed.loading ? 'Refreshing…' : 'Refresh orders'}</button></div>
    <div className="workspace-toolbar"><div className="categories order-filters" aria-label="Payment filter">{[['OPEN', 'Open bills'], ['PAID', 'Paid bills'], ['ALL', 'All bills']].map(([value, label]) => <button key={value} aria-pressed={status === value} className={status === value ? 'selected' : ''} onClick={() => filter(value)}>{label}</button>)}</div><span className="feed-time">{feed.updatedAt ? `Updated ${localTime(feed.updatedAt)} IST` : 'Loading orders…'}</span></div>
    {!canOpen && <p className="workspace-notice">Finish your unsaved cart or resolve the uncertain checkout before opening another bill. Your current work is preserved.</p>}
    <form className="recover-form" onSubmit={event => { event.preventDefault(); void onOpen(recoveryId.trim()); }}><label htmlFor="recover-id">Recover by order ID</label><input id="recover-id" value={recoveryId} onChange={event => setRecoveryId(event.target.value)} placeholder="Paste the UUID from a bill" required maxLength={36}/><button className="secondary" disabled={!canOpen || busy || !recoveryId.trim()}>Find bill</button></form>
    {feed.error && <p className="error" role="alert">{feed.error} {feed.page ? 'Showing the last successful page; it may be out of date.' : 'No order data could be loaded.'}</p>}
    {feed.page && <><div className="order-list">{feed.page.orders.map(order => <article className="order-history-card" key={order.bill.id}><div className="order-card-top"><div><h3>{order.bill.billNumber}</h3><p>{orderContext(order)} · {localTime(order.bill.createdAt)} IST</p></div><span className={`state-badge payment-${order.status.toLowerCase()}`}>{order.status === 'OPEN' ? 'Unpaid' : 'Paid'}</span></div><div className="order-card-dishes">{order.bill.lines.map(line => `${line.quantity} × ${line.name}`).join(' · ')}</div><div className="order-card-bottom"><span className={`state-badge kitchen-${order.kitchen?.status.toLowerCase() ?? 'legacy'}`}>{order.kitchen ? kitchenLabels[order.kitchen.status] : 'Legacy · no kitchen ticket'}</span><strong>{money(order.bill.totalPaise)}</strong><button className="secondary" disabled={!canOpen || busy} aria-label={`Open bill ${order.bill.billNumber}`} onClick={() => void onOpen(order.bill.id)}>{order.status === 'OPEN' ? 'Resume bill →' : 'View bill →'}</button></div></article>)}</div>{feed.page.orders.length === 0 && <div className="workspace-empty"><span>✓</span><h3>{status === 'OPEN' ? 'No unpaid bills on this page' : 'No bills on this page'}</h3><p>New bills appear here after they are created at the counter.</p></div>}<div className="pagination"><span>{feed.page.orders.length} bills shown · newest first · page {cursors.length}</span><div><button className="secondary" disabled={cursors.length === 1 || feed.loading} onClick={() => setCursors(previous => previous.slice(0, -1))}>← Newer</button><button className="secondary" disabled={!feed.page.nextCursor || feed.loading} onClick={() => { const next = feed.page?.nextCursor; if (next) setCursors(previous => [...previous, next]); }}>Older →</button></div></div></>}
  </section>;
}
