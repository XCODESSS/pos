import { useEffect, useState } from 'react';
import { request, type CartLine } from './api';
import { stockQuantity, type StockSnapshot } from './inventory';

export function StockWarnings({ snapshot, historical = false }: { snapshot: StockSnapshot | null; historical?: boolean }) {
  if (!snapshot) return historical ? <p className="catalog-note">Stock history is unknown for this older submission; no consumption was invented.</p> : null;
  const hasWarnings = snapshot.warnings.length > 0 || snapshot.missingRecipes.length > 0;
  return <section className={`stock-snapshot ${hasWarnings ? 'stock-warning' : 'catalog-note'}`} aria-label={historical ? 'Stock at submission' : 'Stock preview result'}>
    <h4>{historical ? 'Stock at submission' : hasWarnings ? 'Stock warnings · ordering is allowed' : 'Recipe stock check'}</h4>
    {snapshot.warnings.length > 0 && <ul>{snapshot.warnings.map(warning => <li key={warning.ingredientId}><strong>{warning.name}</strong>: needs {stockQuantity(warning.requiredMilli, warning.unit)}, recorded available {stockQuantity(warning.availableMilli, warning.unit)}, shortage {stockQuantity(warning.shortageMilli, warning.unit)}.</li>)}</ul>}
    {snapshot.missingRecipes.length > 0 && <p>Recipe coverage missing: {snapshot.missingRecipes.map(gap => gap.label).join('; ')}. Unmapped ingredients are not guessed or deducted.</p>}
    {historical ? <p>Snapshot from accepted submission, not today's balance. Retries, payment and preparation do not deduct again.</p> : <p>Warning only; no manager override required. A preview reserves nothing. Final stock is recorded when the server accepts the submission.</p>}
    {!hasWarnings && <p>{snapshot.requirements.length} ingredient(s) covered by saved recipes.</p>}
  </section>;
}
export function StockPreviewPanel({ token, lines, disabled }: { token: string; lines: CartLine[]; disabled: boolean }) {
  const key = JSON.stringify(lines);
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (key === '[]' || disabled) { setLoading(false); if (key === '[]') { setSnapshot(null); setError(''); } return; }
    const controller = new AbortController(); setLoading(true); setSnapshot(null); setError('');
    const timer = window.setTimeout(() => {
      void request<StockSnapshot>(token, '/orders/stock-preview', { lines: JSON.parse(key) }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setSnapshot(value); })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Stock preview unavailable.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [token, key, disabled, refresh]);
  if (key === '[]') return null;
  return <section className="stock-preview" aria-label="Stock preview"><button type="button" className="secondary" disabled={disabled || loading} onClick={() => setRefresh(value => value + 1)}>Refresh stock preview</button>{loading && <p>Checking recipe stock…</p>}{error && <p className="error" role="alert">Stock availability is unknown: {error} Final server validation still applies.</p>}<StockWarnings snapshot={snapshot}/></section>;
}
