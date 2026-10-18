import { useState } from 'react';

const match = /^\/t\/([a-z][a-z0-9-]{2,62})(?:\/|$)/.exec(window.location.pathname);
export const tenantSlug = match?.[1] ?? null;
export const tenantPath = tenantSlug ? `/t/${tenantSlug}` : null;
export function storageKey(name: string) {
  if (!tenantSlug) throw new Error('Select a business workspace first.');
  return `counterline.tenant.${tenantSlug}.${name}`;
}
export function TenantLanding() {
  const [slug, setSlug] = useState('');
  return <main className="identity-page"><a className="identity-brand" href="/">c. counterline</a><section className="connect-panel"><span className="eyebrow">YOUR BUSINESS. YOUR WORKSPACE.</span><h2>Open your restaurant workspace.</h2><p>Enter the business code provided by your operator. Each business has independent staff accounts and restaurant data.</p><form onSubmit={event => { event.preventDefault(); if (/^[a-z][a-z0-9-]{2,62}$/.test(slug)) window.location.assign(`/t/${slug}/`); }}><label htmlFor="business-code">Business code</label><input id="business-code" value={slug} autoComplete="organization" required pattern="[a-z][a-z0-9-]{2,62}" maxLength={63} onChange={event => setSlug(event.target.value.trim().toLowerCase())}/><button className="primary full">Open workspace</button></form><small>The local development business code is demo. This is not public self-service registration.</small></section></main>;
}
