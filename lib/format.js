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

// ---------- 한국시간 날짜 (YYYY-MM-DD). 한국은 서머타임이 없어서 +9시간이면 정확 ----------
const KST = 9 * 60 * 60 * 1000;
export const kstDate = (s) => new Date(new Date(s).getTime() + KST).toISOString().slice(0, 10);
export const kstToday = () => kstDate(Date.now());
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
