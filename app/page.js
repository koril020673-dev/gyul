'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { won, productLabel } from '@/lib/format';

const emptyShipment = () => ({
  recipient_name: '', recipient_phone: '', zipcode: '', address1: '', address2: '', memo: '', qty: {},
});

export default function OrderPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buyer, setBuyer] = useState({ name: '', phone: '', payer: '', referrer: '' });
  const [shipments, setShipments] = useState([emptyShipment()]);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  async function loadProducts() {
    const { data, error } = await supabase.rpc('get_products');
    if (error) setError('상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    else setProducts(data || []);
    setLoading(false);
  }
  useEffect(() => { loadProducts(); }, []);

  const priceOf = (id) => products.find((p) => p.id === id)?.price || 0;
  const summary = useMemo(() => {
    let boxes = 0, kg = 0, total = 0;
    shipments.forEach((s) =>
      Object.entries(s.qty).forEach(([id, q]) => {
        const p = products.find((x) => x.id === Number(id));
        if (!p || !q) return;
        boxes += q; kg += q * Number(p.weight_kg); total += q * p.price;
      })
    );
    return { boxes, kg, total };
  }, [shipments, products]);

  const updateShip = (i, patch) =>
    setShipments((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const changeQty = (i, pid, d) =>
    setShipments((arr) =>
      arr.map((s, idx) => {
        if (idx !== i) return s;
        const q = Math.max(0, Math.min(99, (s.qty[pid] || 0) + d));
        return { ...s, qty: { ...s.qty, [pid]: q } };
      })
    );

  function openPostcode(i) {
    if (!window.daum?.Postcode) { setError('주소 검색을 불러오는 중이에요. 잠시 후 다시 눌러 주세요.'); return; }
    new window.daum.Postcode({
      oncomplete: (d) => updateShip(i, { zipcode: d.zonecode, address1: d.roadAddress || d.jibunAddress }),
    }).open();
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!buyer.name.trim() || buyer.phone.replace(/\D/g, '').length < 9) return setError('주문하시는 분 이름과 연락처를 입력해 주세요.');
    for (const [i, s] of shipments.entries()) {
      if (!s.recipient_name.trim() || !s.recipient_phone.trim()) return setError(`받는 분 ${i + 1}의 이름과 연락처를 입력해 주세요.`);
      if (!s.address1) return setError(`받는 분 ${i + 1}의 주소를 검색해 주세요.`);
      if (!Object.values(s.qty).some((q) => q > 0)) return setError(`받는 분 ${i + 1}에게 보낼 상품을 골라 주세요.`);
    }
    if (!agree) return setError('개인정보 수집에 동의해 주세요.');

    setSending(true);
    const payload = {
      buyer_name: buyer.name, buyer_phone: buyer.phone, payer_name: buyer.payer, referrer_name: buyer.referrer,
      shipments: shipments.map((s) => ({
        recipient_name: s.recipient_name, recipient_phone: s.recipient_phone, zipcode: s.zipcode,
        address1: s.address1, address2: s.address2, memo: s.memo,
        items: Object.entries(s.qty).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: Number(id), qty: q })),
      })),
    };
    const { data, error } = await supabase.rpc('place_order', { payload });
    setSending(false);
    if (error) {
      setError(error.message || '주문을 저장하지 못했어요.');
      loadProducts(); // 품절 상태 다시 반영
      return;
    }
    setDone({ ...data, name: buyer.name });
    window.scrollTo(0, 0);
  }

  if (done) {
    return (
      <main className="shop">
        <header className="hero">
          <small>{config.farmName} · 제주</small>
          <h1>주문이 접수됐어요</h1>
          <p>{done.name}님, 감사합니다.</p>
        </header>
        <div className="wrap">
          <section className="card">
            <div className="sum-line"><span>주문번호</span><strong>{done.order_id}</strong></div>
            <div className="total"><span>입금하실 금액</span><strong>{won(done.total_price)}</strong></div>
            <div className="note">{`입금 계좌: ${config.bankInfo}\n입금이 확인되면 순서대로 발송해요.`}</div>
          </section>
          <Link href="/lookup" className="btn btn-primary btn-big" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
            주문 상태 확인하기
          </Link>
          <p className="muted" style={{ textAlign: 'center', margin: 0 }}>주문하신 분 이름과 연락처로 언제든 조회할 수 있어요.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="shop">
      <Script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="lazyOnload" />
      <header className="hero">
        <small>{config.farmName} · 제주</small>
        <h1>감귤 주문서</h1>
        <p>작성하시면 바로 접수돼요. 카톡으로 따로 보내지 않으셔도 됩니다.</p>
        <nav><Link href="/lookup">이미 주문하셨나요? 주문 조회 →</Link></nav>
      </header>

      <form className="wrap" onSubmit={submit} noValidate>
        <section className="card">
          <h2>주문하시는 분</h2>
          <div className="field">
            <label htmlFor="buyer">이름</label>
            <input id="buyer" className="input" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="홍길동" autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="phone">연락처</label>
            <input id="phone" className="input" inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder="010-0000-0000" autoComplete="tel" />
          </div>
          <div className="field">
            <label htmlFor="payer">입금자명 <span>(주문자와 다를 때)</span></label>
            <input id="payer" className="input" value={buyer.payer} onChange={(e) => setBuyer({ ...buyer, payer: e.target.value })} placeholder="입금하실 이름" />
          </div>
          <ReferrerField value={buyer.referrer} onChange={(v) => setBuyer({ ...buyer, referrer: v })} />
        </section>

        {shipments.map((s, i) => (
          <section className="card" key={i}>
            <div className="row-between">
              <h2>받는 분 {i + 1}</h2>
              <div>
                {i === 0 && (
                  <button type="button" className="btn-text" onClick={() => updateShip(0, { recipient_name: buyer.name, recipient_phone: buyer.phone })}>
                    주문자와 같음
                  </button>
                )}
                {i > 0 && (
                  <button type="button" className="btn-text" onClick={() => setShipments((arr) => arr.filter((_, idx) => idx !== i))}>
                    삭제
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor={`rn${i}`}>이름</label>
              <input id={`rn${i}`} className="input" value={s.recipient_name} onChange={(e) => updateShip(i, { recipient_name: e.target.value })} placeholder="받는 분" />
            </div>
            <div className="field">
              <label htmlFor={`rp${i}`}>연락처</label>
              <input id={`rp${i}`} className="input" inputMode="tel" value={s.recipient_phone} onChange={(e) => updateShip(i, { recipient_phone: e.target.value })} placeholder="010-0000-0000" />
            </div>
            <div className="field">
              <span className="label">주소</span>
              <div className="addr-row">
                <input aria-label="우편번호" className="input" value={s.zipcode} readOnly placeholder="우편번호" />
                <button type="button" className="btn" style={{ flex: 1 }} onClick={() => openPostcode(i)}>주소 검색</button>
              </div>
              <input aria-label="기본주소" className="input" value={s.address1} readOnly placeholder="도로명 주소 (검색하면 자동 입력)" onClick={() => !s.address1 && openPostcode(i)} />
              <input aria-label="상세주소" className="input" value={s.address2} onChange={(e) => updateShip(i, { address2: e.target.value })} placeholder="상세주소 (동·호수)" />
            </div>
            <div className="field">
              <span className="label">상품 선택</span>
              {loading && <div className="muted">상품 불러오는 중…</div>}
              {!loading && products.length === 0 && <div className="muted">지금은 판매 중인 상품이 없어요.</div>}
              {products.map((p) => (
                <div className="product" key={p.id}>
                  <div className="info">
                    <div className="name">{p.name}</div>
                    <div className="meta">{Number(p.weight_kg)}kg · {won(p.price)}</div>
                    {p.sold_out && <div className="soldout">품절</div>}
                  </div>
                  <div className="stepper">
                    <button type="button" aria-label={`${productLabel(p)} 빼기`} onClick={() => changeQty(i, p.id, -1)} disabled={!s.qty[p.id]}>−</button>
                    <output aria-live="polite">{s.qty[p.id] || 0}</output>
                    <button type="button" aria-label={`${productLabel(p)} 더하기`} onClick={() => changeQty(i, p.id, 1)} disabled={p.sold_out}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`memo${i}`}>배송 메모</label>
              <input id={`memo${i}`} className="input" value={s.memo} onChange={(e) => updateShip(i, { memo: e.target.value })} placeholder="예: 부재 시 경비실" />
            </div>
          </section>
        ))}

        <button type="button" className="btn-dashed" onClick={() => setShipments((arr) => [...arr, emptyShipment()])}>
          + 받는 분 추가 (선물 보내기)
        </button>

        <section className="card">
          <h2>주문 요약</h2>
          <div className="sum-line"><span>받는 분</span><span>{shipments.length}곳</span></div>
          <div className="sum-line"><span>박스 / 중량</span><span>{summary.boxes}박스 · {summary.kg}kg</span></div>
          <div className="hr" />
          <div className="total"><span style={{ fontWeight: 700 }}>총 금액</span><strong>{won(summary.total)}</strong></div>
          <div className="note">{`입금 계좌: ${config.bankInfo}\n입금 확인 후 순서대로 발송해요.`}</div>
        </section>

        <label className="consent">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>배송을 위해 이름·연락처·주소를 수집하고, {config.retention} 뒤 파기하는 데 동의합니다. (필수)</span>
        </label>

        {error && <div className="error" role="alert">{error}</div>}

        <button type="submit" className="btn btn-primary btn-big" disabled={sending}>
          {sending ? '접수 중…' : `${won(summary.total)} 주문하기`}
        </button>
      </form>
    </main>
  );
}

function ReferrerField({ value, onChange }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef();

  useEffect(() => {
    clearTimeout(timer.current);
    if (!value.trim()) { setList([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('get_referrer_names', { q: value.trim() });
      setList((data || []).filter((n) => n !== value.trim()));
    }, 250);
  }, [value]);

  return (
    <div className="field">
      <label htmlFor="ref">추천인 이름 <span>(선택)</span></label>
      <input
        id="ref" className="input" value={value} autoComplete="off" placeholder="추천해 주신 분"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && list.length > 0 && (
        <div className="suggest">
          {list.map((n) => (
            <button type="button" key={n} onMouseDown={() => { onChange(n); setOpen(false); }}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}
