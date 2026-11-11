const parsed = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
export function formatDate(iso) {
  const date = parsed(iso);
  return date ? date.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}) : '';
}
export function formatDateTime(iso) {
  const date = parsed(iso);
  return date ? date.toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
}
export function fileSlug(title, fallback) {
  const slug = (title || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return slug.slice(0, 80).replace(/^-+|-+$/g, '') || fallback;
}
