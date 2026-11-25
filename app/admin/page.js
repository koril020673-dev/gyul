'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { kstDate, kstToday } from '@/lib/format';
import Orders from '@/components/admin/Orders';
import Referrals from '@/components/admin/Referrals';
import Products from '@/components/admin/Products';

const ORDER_SELECT =
  '*, shipments(*, shipment_items(id, qty, unit_price, product_id, products(name, weight_kg, ship_name, price)))';

export default function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [seasonStart, setSeasonStart] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [flash, setFlash] = useState('');
  const [dirty, setDirty] = useState(false); // 상품 설정에 저장하지 않은 변경이 있는지

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const notify = useCallback((msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2500); }, []);

  const reload = useCallback(async () => {
    const [o, p, st] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).order('id', { ascending: false }).limit(2000),
      supabase.from('products').select('*').order('sort_order').order('id'),
      supabase.from('settings').select('value').eq('key', 'season_start').maybeSingle(),
    ]);
    if (o.error || p.error) { notify('불러오기 실패: ' + (o.error || p.error).message); return; }
    setOrders(o.data || []);
    setProducts(p.data || []);
    setSeasonStart(st.data?.value || '');
  }, [notify]);

  useEffect(() => { if (session) reload(); }, [session, reload]);

  // 이번 시즌 주문만 (한국시간 주문일 >= 시즌 시작일). 지난 시즌 주문은 지우지 않고 숨기기만 함
  const seasonOrders = useMemo(
    () => (showPast || !seasonStart ? orders : orders.filter((o) => kstDate(o.created_at) >= seasonStart)),
    [orders, seasonStart, showPast]
  );

  // 저장하지 않은 변경이 있으면 페이지를 떠날 때 브라우저 경고
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function goTab(k) {
    if (k === tab) return;
    if (dirty && !confirm('저장하지 않은 변경이 있어요. 이동할까요?')) return;
    setTab(k);
  }

  async function startSeason() {
    const today = kstToday();
    const ask = seasonStart
      ? `오늘(${today})부터 새 시즌을 시작할까요?\n지난 주문은 지워지지 않고, "지난 시즌 보기"를 켜면 다시 볼 수 있어요.`
      : `오늘(${today})을 시즌 시작일로 정할까요?\n이전 주문은 지워지지 않고, "지난 시즌 보기"를 켜면 다시 볼 수 있어요.`;
    if (!confirm(ask)) return;
    // settings 에 season_start 행이 없어도 upsert 로 새로 만들어짐
    const { error } = await supabase.from('settings').upsert({ key: 'season_start', value: today }, { onConflict: 'key' });
    if (error) return notify('시즌 저장 실패: ' + error.message);
    notify(`${today}부터 시즌을 시작했어요`);
    setShowPast(false);
    reload();
  }

  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <div className="admin">
      <header className="topbar">
        <div className="brand">{config.farmName} <b>관리자</b></div>
        <nav className="tabs">
          {[['orders', '주문'], ['referrals', '추천인'], ['products', '상품·판매']].map(([k, l]) => (
            <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => goTab(k)}>{l}</button>
          ))}
        </nav>
        <div className="right">
          {seasonStart
            ? <span>이번 시즌: {seasonStart}부터</span>
            : <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>시즌 시작일을 정해 주세요</span>}
          <button className="btn" style={{ height: 36 }} onClick={startSeason}>{seasonStart ? '새 시즌 시작' : '시즌 시작'}</button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> 지난 시즌 보기
          </label>
          <button className="btn" style={{ height: 36 }} onClick={reload}>새로고침</button>
          <button className="btn-text" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </header>
      <main className="container">
        {tab === 'orders' && <Orders orders={seasonOrders} reload={reload} notify={notify} />}
        {tab === 'referrals' && <Referrals orders={seasonOrders} products={products} reload={reload} notify={notify} />}
        {tab === 'products' && <Products products={products} orders={seasonOrders} reload={reload} notify={notify} onDirtyChange={setDirty} />}
      </main>
      {flash && <div className="flash" role="status">{flash}</div>}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setError('이메일 또는 비밀번호가 맞지 않아요.');
  }
  return (
    <form className="card login" onSubmit={submit}>
      <h2>관리자 로그인</h2>
      <div className="field"><label htmlFor="em">이메일</label><input id="em" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
      <div className="field"><label htmlFor="pw">비밀번호</label><input id="pw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-primary btn-big">로그인</button>
    </form>
  );
}
