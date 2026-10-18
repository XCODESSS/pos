import { useRef, useState } from 'react';
import { ApiFailure, kitchenLabels, localTime, orderContext, request, type KitchenChange, type KitchenStatus, type KitchenOrder } from './api';
import { useOrderFeed } from './useOrderFeed';

const next: Partial<Record<KitchenStatus, KitchenStatus>> = { QUEUED: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
const actionLabels: Partial<Record<KitchenStatus, string>> = { PREPARING: 'Start preparing', READY: 'Mark ready', SERVED: 'Mark served' };
type Command = { id: string; billNumber: string; body: KitchenChange };

export function KitchenView({ token, canWrite }: { token: string; canWrite: boolean }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const feed = useOrderFeed<KitchenOrder>(token, `/kitchen?limit=50${cursor ? `&after=${cursor}` : ''}`);
  const [pending, setPending] = useState<Command | null>(null);
  const [working, setWorking] = useState(false);
  const actionInFlight = useRef(false);
  const [actionError, setActionError] = useState('');

  async function execute(command: Command) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(command); setWorking(true); setActionError('');
    try {
      await request<KitchenOrder>(token, `/orders/${command.id}/kitchen`, command.body);
      setPending(null); await feed.refresh();
    } catch (cause) {
      const rejected = cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status);
      if (rejected) { setPending(null); await feed.refresh(); }
      setActionError(cause instanceof Error ? cause.message : 'Kitchen update failed.');
      // An unknown network/server outcome retains the exact target and version;
      // retry must never silently advance a second preparation stage.
    } finally { actionInFlight.current = false; setWorking(false); }
  }
  function advance(order: KitchenOrder) {
    const state = order.kitchen;
    const target = state && next[state.status];
    if (state && target && !pending) void execute({ id: order.bill.id, billNumber: order.bill.billNumber,
      body: { status: target, expectedVersion: state.version } });
  }

  return <section className="workspace" aria-label="Kitchen display">
    <div className="workspace-heading"><div><span className="eyebrow">FROM THE COUNTER TO THE PASS</span><h2>A clear view of the kitchen.</h2><p>Each takeaway bill or running-check batch creates one ticket, even before payment. Tickets refresh every 10 seconds while visible.</p></div><button className="secondary" disabled={feed.loading} onClick={() => void feed.refresh()}>{feed.loading ? 'Refreshing…' : 'Refresh kitchen'}</button></div>
    <div className="workspace-notice">Oldest active tickets first. Preparing, ready and served describe food—not whether the bill is paid. Old demo bills are not automatically sent to the kitchen.</div>
    {feed.error && <p className="error" role="alert">{feed.error} {feed.page ? 'Showing the last successful page; it may be out of date.' : 'No kitchen data could be loaded.'}</p>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {pending && !working && <div className="recovery-banner" role="status"><p>The outcome for <strong>{pending.billNumber}</strong> is uncertain. Retry the same “{actionLabels[pending.body.status]}” action; it will not skip a stage.</p><button className="secondary" onClick={() => void execute(pending)}>Retry kitchen action</button></div>}
    {feed.page ? <><div className="kitchen-board">{(['QUEUED', 'PREPARING', 'READY'] as const).map(status => {
      const orders = feed.page!.orders.filter(order => order.kitchen?.status === status);
      return <section className={`kitchen-lane lane-${status.toLowerCase()}`} aria-label={`${kitchenLabels[status]} tickets`} key={status}><div className="lane-heading"><h3>{kitchenLabels[status]}</h3><span>{orders.length} on this page</span></div>{orders.map(order => <article className="kitchen-card" key={order.bill.id} data-testid={`kitchen-${order.bill.id}`}><div className="kitchen-card-header"><h4>{order.bill.billNumber}</h4><span className={`state-badge payment-${order.status.toLowerCase()}`}>{order.status === 'OPEN' ? 'Unpaid' : 'Paid'}</span></div><strong className="kitchen-context">{orderContext(order)}</strong><small>Ordered {localTime(order.bill.createdAt)} IST</small><ul>{order.bill.lines.map((line, index) => <li key={index}><span>{line.quantity}</span>{line.name}</li>)}</ul><small>Updated {localTime(order.kitchen!.updatedAt)} IST</small><button className="primary full" disabled={!canWrite || working || pending !== null || feed.error !== ''} aria-label={`${actionLabels[next[status]!]} ${order.bill.billNumber}`} onClick={() => advance(order)}>{!canWrite ? 'Read-only for your role' : working && pending?.id === order.bill.id ? 'Updating…' : actionLabels[next[status]!]}</button></article>)}{orders.length === 0 && <p className="empty-lane">No {kitchenLabels[status].toLowerCase()} tickets on this page.</p>}</section>;
    })}</div><div className="pagination"><span>{feed.page.orders.length} active tickets shown · page {cursors.length}{feed.updatedAt ? ` · Updated ${localTime(feed.updatedAt)} IST` : ''}</span><div><button className="secondary" disabled={cursors.length === 1 || feed.loading || working} onClick={() => setCursors(previous => previous.slice(0, -1))}>← Earlier</button><button className="secondary" disabled={!feed.page.nextCursor || feed.loading || working} onClick={() => { const after = feed.page?.nextCursor; if (after) setCursors(previous => [...previous, after]); }}>Later →</button></div></div></> : !feed.error && <p className="workspace-notice">Loading kitchen tickets…</p>}
  </section>;
}
