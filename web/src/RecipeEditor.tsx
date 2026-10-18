import { useEffect, useRef, useState } from 'react';
import { ApiFailure, localTime, request, type MenuItem } from './api';
import { storageKey } from './Tenant';
import { parseQuantity, quantityInput, unitLabels, type Ingredient, type Recipe, type RecipeKind } from './inventory';

type Body = { itemId: string; kind: RecipeKind; choiceId: string | null; expectedVersion: number; components: { ingredientId: string; quantityMilli: number }[] };
type Draft = { ingredientId: string; quantity: string };
function saved(): Body | null { try { return JSON.parse(sessionStorage.getItem(storageKey('inventory.recipe.pending')) || 'null'); } catch { return null; } }
export function RecipeEditor({ token, ingredients, disabled }: { token: string; ingredients: Ingredient[]; disabled: boolean }) {
  const [pending, setPending] = useState<Body | null>(saved); const [menu, setMenu] = useState<MenuItem[]>([]);
  const [itemId, setItemId] = useState(() => saved()?.itemId ?? '');
  const [choice, setChoice] = useState(() => { const value = saved(); return value ? `${value.kind}:${value.choiceId ?? ''}` : 'BASE:'; });
  const [recipe, setRecipe] = useState<Recipe | null>(null); const [components, setComponents] = useState<Draft[]>([]);
  const [viewVersion, setViewVersion] = useState(''); const [versionInput, setVersionInput] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0); const lock = useRef(false);
  const dish = menu.find(value => value.id === itemId);
  const [kind, choiceId] = choice.split(':') as [RecipeKind, string];
  const blocked = disabled || loading || busy || pending !== null;
  const targetMatches = recipe?.itemId === itemId && recipe?.kind === kind && (recipe?.choiceId ?? '') === choiceId;
  useEffect(() => {
    const controller = new AbortController();
    void request<MenuItem[]>(token, '/admin/menu', undefined, controller.signal).then(value => { if (!controller.signal.aborted) setMenu(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Menu unavailable.'); });
    return () => controller.abort();
  }, [token, reload]);
  useEffect(() => {
    if (!itemId) { setRecipe(null); setComponents([]); return; }
    const controller = new AbortController(); setLoading(true); setError(''); setRecipe(null);
    const query = new URLSearchParams({ itemId, kind, ...(choiceId ? { choiceId } : {}), ...(viewVersion ? { version: viewVersion } : {}) });
    void request<Recipe>(token, `/inventory/recipes?${query}`, undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setRecipe(value);
      const retained = pending && pending.itemId === itemId && pending.kind === kind && (pending.choiceId ?? '') === choiceId ? pending.components : value.components;
      setComponents(retained.map(component => ({ ingredientId: component.ingredientId, quantity: quantityInput(component.quantityMilli) })));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Recipe unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, itemId, choice, viewVersion, reload]);
  async function save() {
    if (lock.current || disabled) return;
    let body = pending;
    try {
      if (!body) {
        if (!recipe || !targetMatches || viewVersion) return;
        const rows = components.map(component => ({ ingredientId: component.ingredientId, quantityMilli: parseQuantity(component.quantity) }));
        if (rows.some(component => !component.ingredientId || component.quantityMilli < 1) || new Set(rows.map(component => component.ingredientId)).size !== rows.length) throw new Error('Choose each ingredient once and enter positive per-serving quantities.');
        body = { itemId, kind, choiceId: choiceId || null, expectedVersion: recipe.version, components: rows };
      }
      sessionStorage.setItem(storageKey('inventory.recipe.pending'), JSON.stringify(body));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retain recipe intent. No save sent.'); return; }
    lock.current = true; setBusy(true); setPending(body); setError(''); setNotice('');
    try {
      const result = await request<Recipe>(token, '/inventory/recipes', body);
      sessionStorage.removeItem(storageKey('inventory.recipe.pending')); setPending(null); setRecipe(result);
      setComponents(result.components.map(component => ({ ingredientId: component.ingredientId, quantity: quantityInput(component.quantityMilli) })));
      setNotice(`Recipe version ${result.version} saved. Earlier submission snapshots and recipe versions are unchanged.`);
    } catch (cause) {
      if (cause instanceof ApiFailure && [400, 403, 404, 409].includes(cause.status)) { sessionStorage.removeItem(storageKey('inventory.recipe.pending')); setPending(null); }
      setError(cause instanceof Error ? cause.message : 'Recipe outcome uncertain. Retry the same intent.');
    } finally { lock.current = false; setBusy(false); }
  }
  function update(index: number, fields: Partial<Draft>) { setComponents(value => value.map((component, i) => i === index ? { ...component, ...fields } : component)); }
  return <section className="recipe-editor" aria-label="Recipe management"><h3>Recipes per serving</h3><p>A chosen variant uses its own recipe instead of the base recipe. Add-ons contribute extra ingredients. Unmapped/cleared recipes warn during ordering; they do not invent stock consumption.</p>
    <div className="recipe-context admin-form"><label>Recipe dish<select id="recipe-dish" value={itemId} disabled={blocked} onChange={event => { setItemId(event.target.value); setChoice('BASE:'); setViewVersion(''); setNotice(''); }}><option value="">Choose a dish</option>{menu.map(value => <option key={value.id} value={value.id}>{value.name}{!value.available && ' · Unavailable'}</option>)}</select></label><label>Recipe target<select id="recipe-target" value={choice} disabled={blocked || !dish} onChange={event => { setChoice(event.target.value); setViewVersion(''); setNotice(''); }}><option value="BASE:">Base dish</option>{dish?.variants.map(value => <option key={`v-${value.id}`} value={`VARIANT:${value.id}`}>Variant · {value.name}</option>)}{dish?.addons.map(value => <option key={`a-${value.id}`} value={`ADDON:${value.id}`}>Add-on · {value.name}</option>)}</select></label><button className="secondary" disabled={busy || pending !== null || disabled} onClick={() => { setViewVersion(''); setReload(value => value + 1); }}>Reload current recipe</button></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}{pending && <div className="recovery-banner"><p>Recipe intent is retained for this business. Retry unchanged after an uncertain response.</p><button className="primary" disabled={busy || disabled} onClick={() => void save()}>Retry same recipe save</button></div>}
    {recipe && <><p className="recipe-version">{viewVersion ? 'Historical · read-only · ' : ''}Recipe version {recipe.version}{recipe.updatedAt && ` · ${localTime(recipe.updatedAt)} IST`}{recipe.version === 0 && ' · No recipe mapped'}</p><form className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={blocked || !!viewVersion || !targetMatches}><div className="recipe-components">{components.map((component, index) => {
      const ingredient = ingredients.find(value => value.id === component.ingredientId);
      return <div className="recipe-component" key={index}><label>Ingredient {index + 1}<select aria-label={`Recipe ingredient ${index + 1}`} value={component.ingredientId} required onChange={event => update(index, { ingredientId: event.target.value })}><option value="">Choose an ingredient</option>{ingredients.map(value => <option key={value.id} value={value.id}>{value.name} ({unitLabels[value.unit]})</option>)}</select></label><label>Per serving ({ingredient ? unitLabels[ingredient.unit] : 'base unit'})<input aria-label={`Recipe quantity ${index + 1}`} inputMode="decimal" value={component.quantity} required onChange={event => update(index, { quantity: event.target.value })}/></label><button type="button" className="secondary" aria-label={`Remove recipe ingredient ${index + 1}`} onClick={() => setComponents(value => value.filter((_, i) => i !== index))}>Remove</button></div>;
    })}</div><button type="button" className="secondary" disabled={components.length >= 40 || !ingredients.length} onClick={() => setComponents(value => [...value, { ingredientId: '', quantity: '' }])}>Add recipe ingredient</button><button className="primary">Save recipe version</button></fieldset></form><p>Saving an empty list clears recipe coverage for future submissions; previous versions remain readable.</p>
    <form className="recover-form" onSubmit={event => { event.preventDefault(); if (/^[1-9]\d{0,15}$/.test(versionInput)) { setViewVersion(versionInput); setNotice(''); } else setError('Choose a positive recipe version.'); }}><label>Historical recipe version<input aria-label="Historical recipe version" inputMode="numeric" value={versionInput} onChange={event => setVersionInput(event.target.value)} required/></label><button className="secondary" disabled={blocked}>View recipe version</button></form></>}
  </section>;
}
