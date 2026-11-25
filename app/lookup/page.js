'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { config, LOTTE_TRACKING_URL } from '@/lib/config';
import { won, date } from '@/lib/format';
import StatusSteps, { StatusPill } from '@/components/StatusSteps';

export default function LookupPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  async function search(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || phone.replace(/\D/g, '').length < 9) return setError('주문하실 때 쓴 이름과 연락처를 입력해 주세요.');
    setBusy(true);
    const { data, error } = await supabase.rpc('lookup_orders', { p_name: name, p_phone: phone });
    setBusy(false);
    if (error) return setError('조회하지 못했어요. 잠시 후 다시 시도해 주세요.');
    setOrders(data || []);
  }

  async function copy(no) {
    try { await navigator.clipboard.writeText(no); setCopied(no); setTimeout(() => setCopied(''), 1500); } catch {}
  }

  return (
    <main className="shop">
      <header className="hero">
        <small>{config.farmName} · 제주</small>
        <h1>주문 조회</h1>
        <p>주문접수부터 배송까지 지금 어디쯤인지 볼 수 있어요.</p>
        <nav><Link href="/">← 주문서로 가기</Link></nav>
      </header>

      <div className="wrap">
        <form className="card" onSubmit={search} noValidate>
          <div className="field">
            <label htmlFor="lname">주문하신 분 이름</label>
            <input id="lname" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="lphone">연락처</label>
            <input id="lphone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" autoComplete="tel" />
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-big" disabled={busy}>{busy ? '조회 중…' : '조회하기'}</button>
        </form>

        {orders && orders.length === 0 && (
          <div className="card"><p style={{ margin: 0 }}>이 이름과 연락처로 된 주문이 없어요. 주문하실 때 입력한 그대로인지 확인해 주세요.</p></div>
        )}

        {orders?.map((o) => (
          <section className="card" key={o.id}>
            <div className="row-between">
              <h2>주문 {o.id}</h2>
              <StatusPill status={o.status} />
            </div>
            <div className="muted">{date(o.created_at)} 주문 · {won(o.total_price)}</div>
            <StatusSteps status={o.status} />
            {(o.shipments || []).map((s) => (
              <div key={s.seq} className="note" style={{ background: '#fff', border: '1px solid var(--line)', whiteSpace: 'normal' }}>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{s.recipient_name}님께</div>
                <div>{s.address1}</div>
                <div>{(s.items || []).map((it) => `${it.name} ${Number(it.weight_kg)}kg × ${it.qty}`).join(', ')}</div>
                {s.tracking_no ? (
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>롯데택배 <b>{s.tracking_no}</b></span>
                    <button type="button" className="btn" style={{ height: 36, fontSize: 13 }} onClick={() => copy(s.tracking_no)}>
                      {copied === s.tracking_no ? '복사됨' : '송장번호 복사'}
                    </button>
                    <a href={LOTTE_TRACKING_URL} target="_blank" rel="noreferrer">배송 추적</a>
                  </div>
                ) : (
                  <div style={{ marginTop: 6 }}>송장번호는 발송하면 여기에 나와요.</div>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
