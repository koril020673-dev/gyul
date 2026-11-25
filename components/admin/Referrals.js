'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { productLabel } from '@/lib/format';

// 취소를 뺀 모든 주문(접수·발송중·발송완료)을 셈. 입금 여부와 무관, 파기된 주문도 포함

export default function Referrals({ orders, products, reload, notify }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { rows, names } = useMemo(() => {
    const map = {};
    const all = new Set();
    for (const o of orders) {
      if (!o.referrer_name) continue;
      all.add(o.referrer_name);
      if (o.status === '취소') continue;
      const r = (map[o.referrer_name] ||= { name: o.referrer_name, orders: 0, byProduct: {}, boxes: 0, kg: 0 });
      r.orders++;
      for (const s of o.shipments || []) for (const it of s.shipment_items || []) {
        r.byProduct[it.product_id] = (r.byProduct[it.product_id] || 0) + it.qty;
        r.boxes += it.qty;
        r.kg += it.qty * Number(it.products.weight_kg);
      }
    }
    return { rows: Object.values(map).sort((a, b) => b.kg - a.kg), names: [...all].sort() };
  }, [orders]);

  async function merge() {
    if (!from || !to || from === to) return;
    if (!confirm(`'${from}' 추천을 모두 '${to}'(으)로 합칠까요?`)) return;
    const { error } = await supabase.from('orders').update({ referrer_name: to }).eq('referrer_name', from);
    if (error) return notify('합치기 실패: ' + error.message);
    notify('합쳤어요');
    setFrom(''); setTo('');
    reload();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>추천인별 판매</h2>
          <span className="muted">취소를 뺀 모든 주문(접수·발송중·발송완료) 집계</span>
        </div>
        <div className="scroll">
          <table className="grid" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>추천인</th>
                <th>주문 수</th>
                {products.map((p) => <th key={p.id}>{productLabel(p)}</th>)}
                <th>합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td><b>{r.name}</b></td>
                  <td>{r.orders}건</td>
                  {products.map((p) => <td key={p.id}>{r.byProduct[p.id] ? `${r.byProduct[p.id]}박스` : '-'}</td>)}
                  <td><b style={{ color: 'var(--accent-text)' }}>{r.boxes}박스 · {r.kg}kg</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={products.length + 3} className="muted" style={{ padding: 24, textAlign: 'center' }}>아직 집계할 추천 주문이 없어요.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>이름 합치기</h2><span className="muted">오타로 따로 잡힌 추천인을 하나로</span></div>
        <div className="actions" style={{ background: '#fff', borderBottom: 0 }}>
          <select aria-label="합칠 이름" className="small-input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">이 이름을…</option>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
          <span>→</span>
          <select aria-label="남길 이름" className="small-input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">…이 이름으로</option>
            {names.filter((n) => n !== from).map((n) => <option key={n}>{n}</option>)}
          </select>
          <button className="btn" onClick={merge} disabled={!from || !to}>합치기</button>
        </div>
      </section>
    </>
  );
}
