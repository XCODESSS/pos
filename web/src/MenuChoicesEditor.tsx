import type { MenuChoice } from './api';

export type DraftChoice = { id: string; name: string; price: string; available: boolean };
export const draftChoices = (values: MenuChoice[]) => values.map(value => ({ ...value, price: (value.pricePaise / 100).toFixed(2) }));
export function parseChoices(values: DraftChoice[]): MenuChoice[] {
  return values.map(value => {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.price)) throw new Error('Enter choice prices in INR with at most two decimal places.');
    const [whole, fraction = ''] = value.price.split('.');
    return { id: value.id, name: value.name, available: value.available, pricePaise: Number(whole) * 100 + Number(fraction.padEnd(2, '0')) };
  });
}
export function MenuChoicesEditor({ label, values, onChange }: { label: 'Variants' | 'Add-ons'; values: DraftChoice[]; onChange: (values: DraftChoice[]) => void }) {
  function update(id: string, fields: Partial<DraftChoice>) { onChange(values.map(value => value.id === id ? { ...value, ...fields } : value)); }
  return <section className="choices-editor" aria-label={label}><h4>{label}</h4><p>{label === 'Variants' ? 'When variants exist, staff must choose one. Each price replaces the base dish price.' : 'Optional extras, once per serving, added to the chosen price. Extras inherit the dish’s demo tax rate.'}</p>{values.map((value, index) => <div className="choice-editor-row" key={value.id}><label>{label} name {index + 1}<input aria-label={`${label} name ${index + 1}`} value={value.name} required maxLength={60} onChange={event => update(value.id, { name: event.target.value })}/></label><label>Price INR<input aria-label={`${label} price ${index + 1}`} inputMode="decimal" value={value.price} required onChange={event => update(value.id, { price: event.target.value })}/></label><label className="check-label"><input type="checkbox" checked={value.available} onChange={event => update(value.id, { available: event.target.checked })}/>Available</label><button type="button" className="secondary" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter(item => item.id !== value.id))}>Remove</button></div>)}<button type="button" className="secondary" disabled={values.length >= 20} onClick={() => onChange([...values, { id: crypto.randomUUID(), name: '', price: '', available: true }])}>Add {label === 'Variants' ? 'variant' : 'add-on'}</button></section>;
}
