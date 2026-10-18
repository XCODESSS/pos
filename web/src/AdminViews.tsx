import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, money, request, type MenuItem, type MenuWrite, type StaffMember, type StaffRole } from './api';

import { MenuChoicesEditor, draftChoices, parseChoices, type DraftChoice } from './MenuChoicesEditor';

function useAdminList<T>(token: string, path: string) {
  const [data, setData] = useState<T[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    current.current?.abort(); const controller = new AbortController(); current.current = controller; setLoading(true);
    try { const value = await request<T[]>(token, path, undefined, controller.signal); if (!controller.signal.aborted) { setData(value); setError(''); } }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load data.'); }
    finally { if (current.current === controller) { current.current = null; setLoading(false); } }
  }, [token, path]);
  useEffect(() => { void refresh(); return () => { current.current?.abort(); current.current = null; }; }, [refresh]);
  return { data, loading, error, refresh };
}
const definitive = (cause: unknown) => cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status);
const roles: StaffRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'];

type StaffCommand = { path: string; body: unknown };
export function StaffView({ token, ownId }: { token: string; ownId: string }) {
  const list = useAdminList<StaffMember>(token, '/admin/staff');
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [username, setUsername] = useState(''); const [name, setName] = useState(''); const [role, setRole] = useState<StaffRole>('CASHIER');
  const [active, setActive] = useState(true); const [password, setPassword] = useState(''); const [resetPassword, setResetPassword] = useState('');
  const [pending, setPending] = useState<StaffCommand | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  function edit(value: StaffMember | null) { if (pending || busy) return; setEditing(value); setUsername(value?.username ?? ''); setName(value?.displayName ?? ''); setRole(value?.role ?? 'CASHIER'); setActive(value?.active ?? true); setPassword(''); setResetPassword(''); setError(''); setNotice(''); }
  async function execute(command: StaffCommand) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPending(command); setError(''); setNotice('');
    try { await request(token, command.path, command.body); setPending(null); setPassword(''); setResetPassword(''); setEditing(null); setUsername(''); setName(''); setRole('CASHIER'); setActive(true); setNotice('Staff account saved. Role, status and password changes revoke existing sessions.'); await list.refresh(); }
    catch (cause) { if (definitive(cause)) setPending(null); setError(cause instanceof Error ? cause.message : 'Could not save staff account.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function save() {
    void execute(pending ?? (editing
      ? { path: `/admin/staff/${editing.id}`, body: { displayName: name, role, active, expectedVersion: editing.version } }
      : { path: '/admin/staff', body: { id: crypto.randomUUID(), username, displayName: name, role, password } }));
  }
  const disabled = busy || pending !== null;
  return <section className="workspace" aria-label="Staff management"><div className="workspace-heading"><div><span className="eyebrow">THE RIGHT ACCESS, FOR EVERY SHIFT</span><h2>Your team. Individual accounts.</h2><p>Owner: all access. Manager: operations and menu. Cashier: sales and read-only kitchen. Kitchen: preparation only, without financial details.</p></div><button className="secondary" disabled={list.loading} onClick={() => void list.refresh()}>Refresh staff</button></div>
    {list.error && <p className="error" role="alert">{list.error} Previously loaded accounts may be stale.</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    <div className="admin-layout"><div className="admin-records">{list.data.map(person => <article className="admin-card" key={person.id}><div><h3>{person.displayName}</h3><p>@{person.username} · {person.role.toLowerCase()} · {person.active ? 'Active' : 'Disabled'}</p></div><button className="secondary" disabled={disabled} aria-label={`Edit staff ${person.username}`} onClick={() => edit(person)}>Edit</button></article>)}</div><section className="admin-editor"><h3>{editing ? `Edit @${editing.username}` : 'Add staff account'}</h3><form className="admin-form" onSubmit={event => { event.preventDefault(); save(); }}><fieldset disabled={disabled}><label>Display name<input id="staff-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80}/></label>{!editing && <><label>Username<input id="staff-username" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z][a-zA-Z0-9._-]{2,31}"/></label><label>Initial password<input id="staff-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={128}/></label></>}<label>Role<select id="staff-role" value={role} onChange={event => setRole(event.target.value as StaffRole)} disabled={editing?.id === ownId}>{roles.map(value => <option key={value}>{value}</option>)}</select></label>{editing && <label className="check-label"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={editing.id === ownId}/>Account active</label>}</fieldset><button className="primary full" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same staff action' : editing ? 'Save account changes' : 'Create staff account'}</button></form>
    {editing && editing.id !== ownId && !pending && <form className="admin-form password-reset-form" onSubmit={event => { event.preventDefault(); void execute({ path: `/admin/staff/${editing.id}/password`, body: { newPassword: resetPassword, expectedVersion: editing.version } }); }}><label>Reset this account’s password<input type="password" autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} required minLength={12} maxLength={128} disabled={busy}/></label><button className="secondary" disabled={busy}>Reset password & revoke sessions</button></form>}
    {editing && <button className="print-button" disabled={disabled} onClick={() => edit(null)}>Back to new account</button>}
    {error && <p className="error" role="alert">{error}</p>}{pending && !busy && <p className="workspace-notice">The response was uncertain. Retry the same action before editing or creating another account.</p>}<p className="admin-hint">Passwords are never displayed after saving. Share initial credentials securely; staff can change their password in Account.</p></section></div></section>;
}

type MenuCommand = { path: string; body: unknown };
export function MenuView({ token, onSaved }: { token: string; onSaved: () => Promise<void> }) {
  const list = useAdminList<MenuItem>(token, '/admin/menu');
  const [editing, setEditing] = useState<MenuItem | null>(null); const [name, setName] = useState(''); const [category, setCategory] = useState('');
  const [price, setPrice] = useState(''); const [rate, setRate] = useState(250); const [vegetarian, setVegetarian] = useState(true); const [available, setAvailable] = useState(true);
  const [variants, setVariants] = useState<DraftChoice[]>([]); const [addons, setAddons] = useState<DraftChoice[]>([]);
  const [search, setSearch] = useState(''); const [pending, setPending] = useState<MenuCommand | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  function edit(value: MenuItem | null) {
    if (pending || busy) return;
    setVariants(draftChoices(value?.variants ?? [])); setAddons(draftChoices(value?.addons ?? []));
    setEditing(value); setName(value?.name ?? ''); setCategory(value?.category ?? ''); setPrice(value ? (value.pricePaise / 100).toFixed(2) : ''); setRate(value?.cgstBps ?? 250); setVegetarian(value?.vegetarian ?? true); setAvailable(value?.available ?? true); setError(''); setNotice('');
  }
  async function save() {
    if (lock.current) return;
    let command = pending;
    if (!command) {
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(price)) { setError('Enter a rupee price with at most two decimal places.'); return; }
      const [rupees, fraction = ''] = price.split('.');
      let choiceFields: Pick<MenuWrite, 'variants' | 'addons'>;
      try { choiceFields = { variants: parseChoices(variants), addons: parseChoices(addons) }; }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid choice prices.'); return; }
      const item: MenuWrite = { name, category, pricePaise: Number(rupees) * 100 + Number(fraction.padEnd(2, '0')), cgstBps: rate, sgstBps: rate, vegetarian, available, ...choiceFields };
      command = editing ? { path: `/admin/menu/${editing.id}`, body: { expectedVersion: editing.version, item } } : { path: '/admin/menu', body: { id: crypto.randomUUID(), item } };
    }
    lock.current = true; setPending(command); setBusy(true); setError(''); setNotice('');
    try {
      await request(token, command.path, command.body); setPending(null); setEditing(null); setName(''); setCategory(''); setPrice(''); setRate(250); setVegetarian(true); setAvailable(true); setVariants([]); setAddons([]);
      setNotice('Menu saved. Future bills use the new values; previous bill snapshots are unchanged.'); await list.refresh(); await onSaved();
    } catch (cause) { if (definitive(cause)) setPending(null); setError(cause instanceof Error ? cause.message : 'Could not save menu item.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const disabled = busy || pending !== null;
  const displayed = list.data.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="workspace" aria-label="Menu management"><div className="workspace-heading"><div><span className="eyebrow">THE MENU BEHIND EVERY GREAT SERVICE</span><h2>Keep your counter up to date.</h2><p>Manage dishes, categories, tax-exclusive prices and availability. Existing bills never change when you edit the menu.</p></div><button className="secondary" disabled={list.loading} onClick={() => void list.refresh()}>Refresh menu records</button></div><div className="workspace-notice">Tax rates are development configuration, not GST compliance advice. Inclusive pricing, IGST and cess are not supported yet.</div>
    {list.error && <p className="error" role="alert">{list.error} Previously loaded dishes may be stale.</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    <div className="admin-layout"><section><label className="search"><input type="search" aria-label="Search menu records" placeholder="Search dishes and categories…" value={search} onChange={event => setSearch(event.target.value)}/></label><div className="admin-records">{displayed.map(item => <article className="admin-card" key={item.id}><div><h3>{item.name}</h3><p>{item.category} · {money(item.pricePaise)} before tax</p><small>{item.vegetarian ? 'Vegetarian' : 'Non-vegetarian'} · {item.available ? 'Available' : 'Unavailable'} · version {item.version}</small></div><button className="secondary" disabled={disabled} aria-label={`Edit dish ${item.name}`} onClick={() => edit(item)}>Edit</button></article>)}</div>{!list.loading && displayed.length === 0 && <p className="workspace-notice">No matching dishes.</p>}</section>
    <section className="admin-editor"><h3>{editing ? `Edit ${editing.name}` : 'Add a dish'}</h3><form className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={disabled}><label>Dish name<input id="dish-name" value={name} onChange={event => setName(event.target.value)} required maxLength={120}/></label><label>Category<input id="dish-category" value={category} onChange={event => setCategory(event.target.value)} required maxLength={60} list="menu-categories"/><datalist id="menu-categories">{[...new Set(list.data.map(item => item.category))].map(value => <option key={value} value={value}/>)}</datalist></label><label>Price in INR, excluding tax<input id="dish-price" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} required maxLength={10} placeholder="140.00"/></label><label>Demo GST rate (equal CGST + SGST)<select id="dish-tax" value={rate} onChange={event => setRate(Number(event.target.value))}>{[[0, '0%'], [250, '5%'], [600, '12%'], [900, '18%'], [1400, '28%']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={vegetarian} onChange={event => setVegetarian(event.target.checked)}/>Vegetarian</label><label className="check-label"><input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)}/>Available at the counter</label><MenuChoicesEditor label="Variants" values={variants} onChange={setVariants}/><MenuChoicesEditor label="Add-ons" values={addons} onChange={setAddons}/></fieldset><button className="primary full" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same menu action' : editing ? 'Save dish changes' : 'Create dish'}</button></form>{editing && <button className="print-button" disabled={disabled} onClick={() => edit(null)}>Back to new dish</button>}{error && <p className="error" role="alert">{error}</p>}{pending && !busy && <p className="workspace-notice">The save outcome is uncertain. Retry the same request; do not create another dish.</p>}<p className="admin-hint">Use availability instead of deleting historical dish identities. Version conflicts require refresh and review before another save.</p></section></div></section>;
}
