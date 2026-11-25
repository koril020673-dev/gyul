'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { won, productLabel } from '@/lib/format';

const blank = { name: '', ship_name: '', weight_kg: '', price: '', is_active: false, sale_end: '' };
// 화면에서 고치는 값 형태로 맞춤 (null → 빈 글자)
const toRow = (p) => ({ ...p, ship_name: p.ship_name || '', sale_end: p.sale_end || '' });

export default function Products({ products, orders = [], reload, notify, onDirtyChange }) {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(blank);
  const [saving, setSaving] = useState(false);
  // 저장에 실패한 상품은 다시 불러와도 고친 값을 유지하기 위해 잠시 보관
  const keep = useRef({});

  useEffect(() => {
    setRows(products.map((p) => keep.current[p.id] || toRow(p)));
    keep.current = {};
  }, [products]);

  // 판매 현황: 취소를 뺀 주문(시즌 필터 적용, 파기된 주문 포함)의 박스 수.
  // 금액은 모두 "박스 수 × 상품의 현재 가격"으로 계산 (주문 당시 단가 unit_price 는 쓰지 않음)
  const sales = useMemo(() => {
    const boxes = {};
    for (const o of orders) {
      if (o.status === '취소') continue;
      for (const s of o.shipments || []) for (const it of s.shipment_items || []) {
        const b = (boxes[it.product_id] ||= { sold: 0, paid: 0, unpaid: 0 });
        b.sold += it.qty;
        if (o.paid_at) b.paid += it.qty; else b.unpaid += it.qty;
      }
    }
    const list = products.map((p) => {
      const b = boxes[p.id] || { sold: 0, paid: 0, unpaid: 0 };
      const price = p.price || 0;
      return { p, ...b, amount: b.sold * price, paidWon: b.paid * price, unpaidWon: b.unpaid * price };
    });
    const sum = (k) => list.reduce((n, r) => n + r[k], 0);
    return { list, total: { sold: sum('sold'), amount: sum('amount'), paidWon: sum('paidWon'), unpaidWon: sum('unpaidWon') } };
  }, [orders, products]);

  const edit = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const clean = (r) => ({
    name: r.name.trim(), ship_name: (r.ship_name || '').trim() || null, weight_kg: Number(r.weight_kg), price: Number(r.price) || 0,
    is_active: !!r.is_active, sale_end: r.sale_end || null,
  });

  // 원래 값과 달라진 상품 (저장할 값 기준으로 비교)
  const changedIds = useMemo(() => {
    const orig = Object.fromEntries(products.map((p) => [p.id, JSON.stringify(clean(toRow(p)))]));
    return new Set(rows.filter((r) => orig[r.id] !== JSON.stringify(clean(r))).map((r) => r.id));
  }, [rows, products]);
  const addingTouched = JSON.stringify(adding) !== JSON.stringify(blank);
  const changeCount = changedIds.size + (addingTouched ? 1 : 0);

  // 저장하지 않은 변경이 있는지 관리자 화면에 알림 (탭 이동·페이지 떠날 때 경고용)
  useEffect(() => { onDirtyChange?.(changeCount > 0); }, [changeCount, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function saveAll() {
    if (!changeCount || saving) return;
    const msgs = [];
    const failed = [];
    let saved = 0;

    // 새 상품: 이름과 중량이 둘 다 있어야 추가
    let insertNew = false;
    if (addingTouched) {
      if (adding.name.trim() && Number(adding.weight_kg)) insertNew = true;
      else msgs.push('새 상품은 이름과 중량을 넣어야 해요');
    }
    const changed = rows.filter((r) => changedIds.has(r.id));
    if (!changed.length && !insertNew) return notify(msgs.join(' · '));

    setSaving(true);
    const results = await Promise.all([
      ...changed.map(async (r) => {
        const { error } = await supabase.from('products').update(clean(r)).eq('id', r.id);
        return { r, error };
      }),
      ...(insertNew
        ? [(async () => {
            const { error } = await supabase.from('products').insert({ ...clean(adding), sort_order: rows.length + 1 });
            return { r: adding, error, isNew: true };
          })()]
        : []),
    ]);
    setSaving(false);

    for (const { r, error, isNew } of results) {
      if (!error) { saved++; if (isNew) setAdding(blank); continue; }
      failed.push(r.name.trim() || '새 상품');
      if (!isNew) keep.current[r.id] = r; // 실패한 상품은 고친 값 그대로 남김
    }
    if (saved) msgs.unshift(`${saved}개 저장했어요`);
    if (failed.length) msgs.push(`저장 실패: ${failed.join(', ')}`);
    notify(msgs.join(' · '));
    if (saved) reload();
    else keep.current = {};
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>판매 현황</h2>
          <span className="muted">취소를 뺀 주문 기준 · 금액은 박스 수 × 현재 가격 · 위쪽 시즌 설정 기준</span>
        </div>
        <table className="grid ptable">
          <thead>
            <tr>
              <th>상품</th><th>판매 박스</th><th>판매금액</th><th>입금확인 금액</th><th>미입금 금액</th>
            </tr>
          </thead>
          <tbody>
            {sales.list.map((r) => (
              <tr key={r.p.id} style={r.p.is_active ? undefined : { color: 'var(--sub)' }}>
                <td data-label="상품"><b>{productLabel(r.p)}</b>{!r.p.is_active && <span className="muted"> (판매 안 함)</span>}</td>
                <td data-label="판매 박스">{r.sold}박스</td>
                <td data-label="판매금액">{won(r.amount)}</td>
                <td data-label="입금확인 금액">{won(r.paidWon)}</td>
                <td data-label="미입금 금액">{won(r.unpaidWon)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td data-label="상품"><b>합계</b></td>
              <td data-label="판매 박스"><b>{sales.total.sold}박스</b></td>
              <td data-label="판매금액"><b style={{ color: 'var(--accent-text)' }}>{won(sales.total.amount)}</b></td>
              <td data-label="입금확인 금액"><b>{won(sales.total.paidWon)}</b></td>
              <td data-label="미입금 금액"><b>{won(sales.total.unpaidWon)}</b></td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>상품 설정</h2>
          <button className="btn btn-primary" style={{ height: 38 }} disabled={!changeCount || saving} onClick={saveAll}>
            {saving ? '저장 중…' : changeCount ? `변경 ${changeCount}개 저장` : '저장'}
          </button>
          <span className="muted">판매를 켜 두면 주문서에 보여요. 판매 종료일이 지나면 자동으로 주문서에서 빠져요. 맨 아래 줄에 쓰면 새 상품으로 추가돼요.</span>
        </div>
        <table className="grid ptable pset">
          <colgroup>
            <col style={{ width: '7%' }} /><col style={{ width: '23%' }} /><col style={{ width: '23%' }} />
            <col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>판매</th><th>상품명</th><th>택배 품목명</th><th>중량(kg)</th><th>가격(원)</th><th>판매 종료일 (비우면 계속 판매)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={changedIds.has(r.id) ? { background: 'var(--accent-soft)' } : undefined}>
                <td data-label="판매"><input type="checkbox" aria-label={`${r.name} 판매`} checked={r.is_active} onChange={(e) => edit(r.id, { is_active: e.target.checked })} style={{ width: 20, height: 20 }} /></td>
                <td data-label="상품명"><input className="small-input" aria-label="상품명" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} /></td>
                <td data-label="택배 품목명"><input className="small-input" aria-label={`${r.name} 택배 품목명`} placeholder={`${r.name}${Number(r.weight_kg) || ''}k`} value={r.ship_name} onChange={(e) => edit(r.id, { ship_name: e.target.value })} /></td>
                <td data-label="중량(kg)"><input className="small-input" aria-label="중량" type="number" value={r.weight_kg} onChange={(e) => edit(r.id, { weight_kg: e.target.value })} /></td>
                <td data-label="가격(원)"><input className="small-input" aria-label="가격" type="number" value={r.price} onChange={(e) => edit(r.id, { price: e.target.value })} /></td>
                <td data-label="판매 종료일"><input className="small-input" type="date" aria-label="판매 종료일" value={r.sale_end} onChange={(e) => edit(r.id, { sale_end: e.target.value })} /></td>
              </tr>
            ))}
            <tr style={addingTouched ? { background: 'var(--accent-soft)' } : undefined}>
              <td data-label="판매"><input type="checkbox" aria-label="판매" checked={adding.is_active} onChange={(e) => setAdding({ ...adding, is_active: e.target.checked })} style={{ width: 20, height: 20 }} /></td>
              <td data-label="상품명"><input className="small-input" aria-label="새 상품명" placeholder="새 상품" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></td>
              <td data-label="택배 품목명"><input className="small-input" aria-label="새 택배 품목명" placeholder="예: 밀감10k" value={adding.ship_name} onChange={(e) => setAdding({ ...adding, ship_name: e.target.value })} /></td>
              <td data-label="중량(kg)"><input className="small-input" aria-label="새 중량" type="number" value={adding.weight_kg} onChange={(e) => setAdding({ ...adding, weight_kg: e.target.value })} /></td>
              <td data-label="가격(원)"><input className="small-input" aria-label="새 가격" type="number" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} /></td>
              <td data-label="판매 종료일"><input className="small-input" type="date" aria-label="새 판매 종료일" value={adding.sale_end} onChange={(e) => setAdding({ ...adding, sale_end: e.target.value })} /></td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
