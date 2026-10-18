import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request, money, kitchenLabels, localTime, ApiFailure, type MenuItem, type Order, type CreateOrder, type SalesReport, type StaffSession, type CartLine } from './api';
import { OrdersView } from './OrdersView';
import { KitchenView } from './KitchenView';
import { MenuView, StaffView } from './AdminViews';
import { SessionGate, PasswordView } from './Session';
import { MenuPicker, CartLines, addLine, quantityChange, describeLine } from './MenuComposer';
import { FrontDeskView } from './FrontDeskView';
import './frontdesk.css';
import './style.css';
import './workspaces.css';
import './administration.css';

const PENDING_KEY = 'counterline.pending';
const ORDER_KEY = 'counterline.currentOrder';
function savedRequest(): CreateOrder | null {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}

type View = 'pos' | 'tables' | 'orders' | 'kitchen' | 'menu' | 'staff' | 'account';
const viewLabels: Record<View, string> = { pos: 'Point of sale', tables: 'Tables & checks', orders: 'Orders & bills', kitchen: 'Kitchen display', menu: 'Menu management', staff: 'Staff accounts', account: 'Your account' };
function Workspace({ session, logout, suspended, passwordChanged }: { session: StaffSession; logout: () => Promise<void>; suspended: boolean; passwordChanged: () => void }) {
  const token = session.accessToken;
  const allowed = (permission: string) => session.permissions.includes(permission);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<View>('pos');
  const navigation = ([
    ['pos', '▦', 'Point of sale', 'ORDERS_WRITE'], ['tables', '⊞', 'Tables & checks', 'ORDERS_READ'], ['orders', '≡', 'Orders & bills', 'ORDERS_READ'],
    ['kitchen', '♧', 'Kitchen display', 'KITCHEN_READ'], ['menu', '☷', 'Menu management', 'MENU_MANAGE'],
    ['staff', '♙', 'Staff accounts', 'STAFF_MANAGE'], ['account', '○', 'Your account', ''],
  ] as const).filter(([, , , permission]) => !permission || allowed(permission));
  const shownView = navigation.some(([key]) => key === view) ? view : navigation[0][0];
  const actionInFlight = useRef(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkToOpen, setCheckToOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<CreateOrder | null>(savedRequest);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || pending !== null || order !== null;
  const latestCart = useRef(cart); latestCart.current = cart;
  const subtotal = cart.reduce((sum, line) => sum + describeLine(line, menu).price * line.quantity, 0);
  const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);

  async function perform(action: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection failed. Retry the same bill.');
    } finally { actionInFlight.current = false; setBusy(false); }
  }

  useEffect(() => { if (!suspended) void perform(connect); }, [token, suspended]);
  async function refreshMenu() {
    if (!allowed('MENU_READ')) return;
    const items = await request<MenuItem[]>(token, '/menu');
    setMenu(previous => [...items, ...previous.filter(item => latestCart.current.some(line => line.itemId === item.id) && !items.some(fresh => fresh.id === item.id)).map(item => ({ ...item, available: false }))]);
  }
  async function refreshReport() { setReport(await request<SalesReport>(token, '/reports/today')); }
  async function acceptOrder(value: Order) {
    sessionStorage.setItem(ORDER_KEY, value.bill.id);
    sessionStorage.removeItem(PENDING_KEY);
    setPending(null); setOrder(value);
  }
  async function createOrRecover(body: CreateOrder) {
    try { await acceptOrder(await request<Order>(token, '/orders', body)); }
    catch (cause) {
      // A 400 definitively rejected this cart. Network failures preserve its ID.
      if (cause instanceof ApiFailure && cause.status === 400) {
        sessionStorage.removeItem(PENDING_KEY); setPending(null);
      }
      throw cause;
    }
  }
  async function connect() {
    await refreshMenu();
    if (allowed('ORDERS_WRITE')) {
      const saved = savedRequest();
      const currentId = sessionStorage.getItem(ORDER_KEY);
      if (saved) await createOrRecover(saved);
      else if (currentId) setOrder(await request<Order>(token, `/orders/${currentId}`));
    }
    if (allowed('REPORTS_READ')) await refreshReport();
    setConnected(true);
  }
  async function signOut() {
    if ((pending || (!order && quantity > 0)) && !window.confirm(pending ? 'Sign out? The uncertain checkout ID is preserved for recovery after sign-in.' : 'Sign out and discard this unsaved cart?')) return;
    await logout();
  }
  async function checkout() {
    const body = pending ?? {
      id: crypto.randomUUID(), lines: cart,
      orderType: 'TAKEAWAY' as const, tableLabel: null,
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(body));
    setPending(body);
    await createOrRecover(body);
  }
  async function refreshBill() {
    if (order) setOrder(await request<Order>(token, `/orders/${order.bill.id}`));
  }
  async function pay() {
    if (!order) return;
    const value = await request<Order>(token, `/orders/${order.bill.id}/cash-payment`, { receivedPaise: order.bill.totalPaise });
    setOrder(value); await refreshReport();
  }
  const canOpenOrder = pending === null && (order !== null || quantity === 0);
  async function openOrder(id: string) {
    await perform(async () => {
      if (!canOpenOrder) throw new Error('Finish your unsaved cart or resolve the uncertain checkout first.');
      const value = await request<Order>(token, `/orders/${encodeURIComponent(id)}`);
      if (value.checkId) { setCheckToOpen(value.checkId); setView('tables'); }
      else { await acceptOrder(value); setView('pos'); }
    });
  }
  function newSale() {
    sessionStorage.removeItem(ORDER_KEY); setOrder(null); setCart([]); setError('');
  }
  function changeQuantity(key: string, change: number) {
    if (!locked) setCart(previous => quantityChange(previous, key, change));
  }

  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Counterline home"><span className="brandmark">c.</span>counterline</a>
      <div className="outlet"><span className="outlet-icon">⌂</span><div><strong>Demo kitchen</strong><small>India · Single outlet</small></div><span className="dot"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="workspace-nav" aria-label="Workspace">{navigation.map(([key, icon, label]) => <button key={key} className={`nav-link ${shownView === key ? 'active' : ''}`} aria-current={shownView === key ? 'page' : undefined} disabled={busy || !connected} onClick={() => { setView(key); setError(''); }}><span aria-hidden="true">{icon}</span>{label}<span className="nav-arrow" aria-hidden="true">↗</span></button>)}</nav>
      {allowed('REPORTS_READ') && <section className="sales">
        <div className="sales-heading"><h2>Today’s sales</h2><button className="icon-button" aria-label="Refresh sales" disabled={!connected || busy} onClick={() => void perform(refreshReport)}>↻</button></div>
        <strong className="sales-total">{report ? money(report.totalPaise) : '—'}</strong>
        <p>{report?.paidOrders ?? '—'} paid bills <span>· Asia/Kolkata</span></p>
        <small>{report?.date ?? 'Connect to view totals'}</small>
      </section>}
      <div className="sidebar-footer"><span className="demo-pill">DEVELOPMENT PREVIEW</span><p>Original restaurant software.<br/>Online checkout comes first.</p><small>Not a production tax-invoicing system.</small></div>
    </aside>
    <main>
      <header className="topbar"><div><span className="eyebrow">YOUR COUNTER, CONNECTED</span><h1>{viewLabels[shownView]}<span>.</span></h1></div><div className="connection"><span className={`dot ${connected ? '' : 'muted'}`}/>{connected ? 'Session connected' : 'Not connected'}</div></header>
      <div className="session-strip"><span>{session.staff.displayName} <small>· {session.staff.role.toLowerCase()}</small></span><button className="secondary" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
      {!connected ? <section className="connect-panel"><h2>{busy ? 'Opening your workspace…' : 'Workspace could not be loaded'}</h2><p>Signed in as {session.staff.username}. Existing checkout IDs will be recovered, not recreated.</p>{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={() => void perform(connect)}>Retry loading workspace</button></section> : <>
      {error && <div className="error" role="alert">{error} {pending && 'Your checkout ID is preserved. Retry this bill; do not create another.'}</div>}
      {suspended ? null : shownView === 'account' ? <PasswordView token={token} onChanged={passwordChanged}/> : shownView === 'staff' ? <StaffView token={token} ownId={session.staff.id}/> : shownView === 'menu' ? <MenuView token={token} onSaved={refreshMenu}/> : shownView === 'tables' ? <FrontDeskView token={token} canManage={allowed('TABLES_MANAGE')} canOrder={allowed('ORDERS_WRITE')} canPay={allowed('CASH_RECORD')} initialCheckId={checkToOpen} onOpened={() => setCheckToOpen(null)} onSettled={refreshReport}/> : shownView === 'orders' ? <OrdersView token={token} busy={busy} canOpen={canOpenOrder} onOpen={openOrder}/> : shownView === 'kitchen' ? <KitchenView token={token} canWrite={allowed('KITCHEN_WRITE')}/> : <div className="pos-layout">
        <MenuPicker menu={menu} locked={locked} onAdd={line => setCart(previous => addLine(previous, line))} refresh={() => void perform(refreshMenu)}/>
        <section className="ticket" aria-label="Current bill">
          <div className="ticket-heading"><div><span className="eyebrow">THE ORDER</span><h2>{order ? order.bill.billNumber : 'New bill'}</h2></div><span className="ticket-count">{order ? order.status : `${quantity} items`}</span></div>
          {!order && <div className="workspace-notice">Takeaway counter. For dine-in, use <button className="park-button" disabled={locked || quantity > 0} onClick={() => setView('tables')}>Tables & checks →</button></div>}
          {order && <p className="bill-context">{order.bill.orderType === 'DINE_IN' ? `Dine-in · ${order.bill.tableLabel}` : 'Takeaway'} · {localTime(order.bill.createdAt)} IST</p>}
          {order?.kitchen && <span className={`state-badge ticket-kitchen kitchen-${order.kitchen.status.toLowerCase()}`}>Kitchen · {kitchenLabels[order.kitchen.status]}</span>}
          <div className="ticket-lines">{order ? order.bill.lines.map((line, index) => <div className="ticket-line" key={index}><div><strong>{line.name}</strong><small>{line.quantity} × {money(line.unitPricePaise)}</small></div><strong>{money(line.subtotalPaise)}</strong></div>) : cart.length ? <CartLines lines={cart} menu={menu} locked={locked} onChange={changeQuantity}/> : <div className="empty-cart"><span>＋</span><h3>A little empty here</h3><p>Tap a menu item to<br/>start your next great order.</p></div>}</div>
          <div className="ticket-bottom"><div className="totals"><div><span>Subtotal</span><span>{money(order?.bill.subtotalPaise ?? subtotal)}</span></div>{order ? <><div><span>CGST</span><span>{money(order.bill.cgstPaise)}</span></div><div><span>SGST</span><span>{money(order.bill.sgstPaise)}</span></div><div className="grand-total"><span>Total payable</span><strong>{money(order.bill.totalPaise)}</strong></div></> : <p>Tax will be shown on the generated bill.</p>}</div>
          {order?.status === 'PAID' ? <><div className="paid-message" role="status">✓ Cash payment recorded</div><button className="primary full" disabled={busy} onClick={newSale}>Start next sale →</button></> : order ? <><button className="primary full" disabled={busy} onClick={() => void perform(pay)}>{busy ? 'Recording…' : `Record exact cash · ${money(order.bill.totalPaise)}`}</button><small className="payment-note">Confirm you have physically received the cash.</small></> : <button className="primary full" disabled={busy || (!pending && (!quantity || cart.some(line => !describeLine(line, menu).available)))} onClick={() => void perform(checkout)}>{busy ? 'Creating bill…' : pending ? 'Retry same bill →' : 'Create bill →'}</button>}
          {order && <button className="secondary full" disabled={busy} onClick={() => void perform(refreshBill)}>Refresh current bill</button>}
          {order?.status === 'OPEN' && <button className="park-button" disabled={busy} onClick={newSale}>Park bill & start next order</button>}
          {order && <><button className="print-button" onClick={() => window.print()}>Print demo bill</button><small className="order-id">Order ID: {order.bill.id}</small></>}
          <small className="demo-note">DEMO BILL · Not a GST tax invoice</small></div>
        </section>
      </div>}</>}
      <footer className="page-footer"><span>Made for a better service.</span><span>Counterline / v0.4 · Online preview</span></footer>
    </main>
  </div>;
}

function App() {
  return <SessionGate>{(session, logout, expired, passwordChanged) => <Workspace key={session.staff.id} session={session} logout={logout} suspended={expired} passwordChanged={passwordChanged}/>}</SessionGate>;
}
createRoot(document.getElementById('root')!).render(<App/>);
