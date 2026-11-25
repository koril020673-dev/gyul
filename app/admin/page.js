'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import Orders from '@/components/admin/Orders';
import Referrals from '@/components/admin/Referrals';
import Products from '@/components/admin/Products';

const ORDER_SELECT =
  '*, shipments(*, shipment_items(id, qty, unit_price, product_id, products(name, weight_kg, ship_name)))';

export default function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const notify = useCallback((msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2500); }, []);

  const reload = useCallback(async () => {
    const [o, p, r] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).order('id', { ascending: false }).limit(2000),
      supabase.from('products').select('*').order('sort_order').order('id'),
      supabase.from('product_reserved').select('*'),
    ]);
    if (o.error || p.error) { notify('불러오기 실패: ' + (o.error || p.error).message); return; }
    const reserved = Object.fromEntries((r.data || []).map((x) => [x.product_id, x.reserved_boxes]));
    setOrders(o.data || []);
    setProducts((p.data || []).map((x) => ({ ...x, reserved: reserved[x.id] || 0 })));
  }, [notify]);

  useEffect(() => { if (session) reload(); }, [session, reload]);

  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <div className="admin">
      <header className="topbar">
        <div className="brand">{config.farmName} <b>관리자</b></div>
        <nav className="tabs">
          {[['orders', '주문'], ['referrals', '추천인'], ['products', '상품·재고']].map(([k, l]) => (
            <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <div className="right">
          <button className="btn" style={{ height: 36 }} onClick={reload}>새로고침</button>
          <button className="btn-text" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </header>
      <main className="container">
        {tab === 'orders' && <Orders orders={orders} reload={reload} notify={notify} />}
        {tab === 'referrals' && <Referrals orders={orders} products={products} reload={reload} notify={notify} />}
        {tab === 'products' && <Products products={products} reload={reload} notify={notify} />}
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
