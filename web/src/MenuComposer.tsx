import { useEffect, useRef, useState } from 'react';
import { money, type CartLine, type MenuItem } from './api';

export const lineKey = (line: CartLine) => `${line.itemId}|${line.variantId ?? ''}|${[...(line.addonIds ?? [])].sort().join(',')}`;
export function describeLine(line: CartLine, menu: MenuItem[]) {
  const item = menu.find(value => value.id === line.itemId);
  const variant = item?.variants.find(value => value.id === line.variantId);
  const addons = (line.addonIds ?? []).map(id => item?.addons.find(value => value.id === id));
  return {
    name: (item?.name ?? 'Unavailable dish') + (variant ? ` · ${variant.name}` : '') + addons.map(value => ` + ${value?.name ?? 'Unavailable add-on'}`).join(''),
    price: (variant?.pricePaise ?? item?.pricePaise ?? 0) + addons.reduce((sum, value) => sum + (value?.pricePaise ?? 0), 0),
    available: !!item?.available && (!item.variants.length || !!variant?.available) && (!line.variantId || !!variant?.available) && addons.every(value => !!value?.available),
  };
}
export function addLine(lines: CartLine[], line: CartLine) {
  const key = lineKey(line); const current = lines.find(value => lineKey(value) === key);
  return current ? lines.map(value => lineKey(value) === key ? { ...value, quantity: Math.min(99, value.quantity + 1) } : value) : [...lines, line];
}
export function quantityChange(lines: CartLine[], key: string, change: number) {
  return lines.map(line => lineKey(line) === key ? { ...line, quantity: Math.min(99, line.quantity + change) } : line).filter(line => line.quantity > 0);
}
export function CartLines({ lines, menu, locked, onChange }: { lines: CartLine[]; menu: MenuItem[]; locked: boolean; onChange: (key: string, change: number) => void }) {
  return <>{lines.map(line => {
    const item = describeLine(line, menu); const key = lineKey(line);
    return <div className="ticket-line" key={key}><div><strong>{item.name}</strong><small>{money(item.price)}{!item.available && ' · Unavailable — remove to continue'}</small><div className="stepper"><button aria-label={`Remove one ${item.name}`} disabled={locked} onClick={() => onChange(key, -1)}>−</button><span>{line.quantity}</span><button aria-label={`Add one ${item.name}`} disabled={locked || !item.available || line.quantity >= 99} onClick={() => onChange(key, 1)}>+</button></div></div><strong>{money(item.price * line.quantity)}</strong></div>;
  })}</>;
}

function Choices({ item, onAdd, onClose }: { item: MenuItem; onAdd: (line: CartLine) => void; onClose: () => void }) {
  const [variant, setVariant] = useState(''); const [addons, setAddons] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const line = { itemId: item.id, quantity: 1, variantId: variant || null, addonIds: [...addons].sort() };
  const preview = describeLine(line, [item]);
  return <dialog className="choice-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="choice-heading"><form onSubmit={event => { event.preventDefault(); onAdd(line); onClose(); }}><h2 id="choice-heading">{item.name}</h2><p>Choose one variant when offered. Add-ons apply to each serving and inherit the dish’s demo tax rate.</p>{item.variants.length > 0 && <fieldset><legend>Variant · required</legend>{item.variants.map(value => <label className="choice-row" key={value.id}><input type="radio" name="variant" value={value.id} checked={variant === value.id} disabled={!value.available} required onChange={() => setVariant(value.id)}/><span>{value.name}{!value.available && ' · Unavailable'}</span><strong>{money(value.pricePaise)}</strong></label>)}</fieldset>}{item.addons.length > 0 && <fieldset><legend>Add-ons · optional</legend>{item.addons.map(value => <label className="choice-row" key={value.id}><input type="checkbox" checked={addons.includes(value.id)} disabled={!value.available} onChange={event => setAddons(previous => event.target.checked ? [...previous, value.id] : previous.filter(id => id !== value.id))}/><span>{value.name}{!value.available && ' · Unavailable'}</span><strong>+ {money(value.pricePaise)}</strong></label>)}</fieldset>}<div className="choice-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!preview.available}>Add to order · {money(preview.price)}</button></div></form></dialog>;
}

export function MenuPicker({ menu, locked, onAdd, refresh }: { menu: MenuItem[]; locked: boolean; onAdd: (line: CartLine) => void; refresh?: () => void }) {
  const [category, setCategory] = useState('All items'); const [search, setSearch] = useState(''); const [choice, setChoice] = useState<MenuItem | null>(null);
  const available = menu.filter(item => item.available);
  const categories = ['All items', ...new Set(available.map(item => item.category))];
  const visible = available.filter(item => (category === 'All items' || category === item.category) && item.name.toLowerCase().includes(search.toLowerCase()));
  return <section className="catalog" aria-label="Menu"><div className="catalog-heading"><div><h2>Good food, ready to go</h2><p>Choose a dish, size and extras.</p></div>{refresh && <button className="secondary" disabled={locked} onClick={refresh}>Refresh menu</button>}</div><label className="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search menu" placeholder="Search dishes, drinks and more…" value={search} onChange={event => setSearch(event.target.value)}/></label><div className="categories" aria-label="Menu categories">{categories.map(value => <button key={value} className={category === value ? 'selected' : ''} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><div className="menu-grid">{visible.map(item => {
    const prices = item.variants.filter(value => value.available).map(value => value.pricePaise);
    return <button className="menu-card" key={item.id} disabled={locked || (item.variants.length > 0 && !prices.length)} aria-label={`Add ${item.name}`} onClick={() => item.variants.length || item.addons.length ? setChoice(item) : onAdd({ itemId: item.id, quantity: 1 })}><span className={`food-tag ${item.vegetarian ? 'veg' : 'nonveg'}`} aria-label={item.vegetarian ? 'Vegetarian' : 'Non-vegetarian'}><i/></span><small>{item.category}</small><h3>{item.name}</h3><div className="card-bottom"><strong>{item.variants.length ? 'From ' : ''}{money(prices.length ? Math.min(...prices) : item.pricePaise)}</strong><span className="add">+</span></div>{(item.variants.length > 0 || item.addons.length > 0) && <small>Customize →</small>}</button>;
  })}</div>{!visible.length && <p className="empty-results">No dishes match. Try another search.</p>}<p className="catalog-note">Prices exclude tax. Final prices, CGST and SGST are calculated by the server.</p>{choice && !locked && <Choices key={choice.id} item={choice} onAdd={onAdd} onClose={() => setChoice(null)}/>}</section>;
}
