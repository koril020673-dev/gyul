export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

export const phone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
};

export const productLabel = (p) => `${p.name} ${Number(p.weight_kg)}kg`;

export const date = (s) =>
  s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
