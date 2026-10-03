export const DEFAULT_AUTOMATIC = Object.freeze({
  enabled: false, scope: 'selected', domains: Object.freeze(['youtube.com', 'youtu.be']),
});

export function normalizeDomain(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const text = value.trim();
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) ||
        host.split('.').some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
    return host;
  } catch { return null; }
}

export function sanitizeAutomatic(value) {
  const v = value && typeof value === 'object' ? value : {};
  const domains = Array.isArray(v.domains) ? v.domains : DEFAULT_AUTOMATIC.domains;
  return {
    enabled: v.enabled === true,
    scope: v.scope === 'all' ? 'all' : 'selected',
    domains: [...new Set(domains.map(normalizeDomain).filter(Boolean))].slice(0, 50),
  };
}

export function website(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  return normalizeDomain(url);
}

export function matchesAutomatic(url, policy) {
  const host = website(url);
  if (!host || !policy.enabled) return false;
  return policy.scope === 'all' || policy.domains.some(domain => host === domain || host.endsWith('.' + domain));
}
