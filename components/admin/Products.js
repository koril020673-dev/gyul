'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const blank = { name: '', ship_name: '', weight_kg: '', price: '', stock_boxes: '', is_active: false, sale_start: '', sale_end: '' };

export default function Products({ products, reload, notify }) {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(blank);

  useEffect(() => { setRows(products.map((p) => ({ ...p, ship_name: p.ship_name || '', sale_start: p.sale_start || '', sale_end: p.sale_end || '' }))); }, [products]);

  const edit = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const clean = (r) => ({
    name: r.name.trim(), ship_name: (r.ship_name || '').trim() || null, weight_kg: Number(r.weight_kg), price: Number(r.price) || 0,
    stock_boxes: Number(r.stock_boxes) || 0, is_active: !!r.is_active,
    sale_start: r.sale_start || null, sale_end: r.sale_end || null,
  });

  async function save(r) {
    const { error } = await supabase.from('products').update(clean(r)).eq('id', r.id);
    if (error) return notify('저장 실패: ' + error.message);
    notify(`${r.name} ${r.weight_kg}kg 저장`);
    reload();
  }
  async function add() {
    if (!adding.name.trim() || !Number(adding.weight_kg)) return notify('이름과 중량을 넣어 주세요.');
    const { error } = await supabase.from('products').insert({ ...clean(adding), sort_order: rows.length + 1 });
    if (error) return notify('추가 실패: ' + error.message);
    setAdding(blank);
    reload();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>상품 · 재고</h2>
        <span className="muted">남은 박스가 1개라도 있으면 그 주문은 다 받고, 접수 박스가 재고 이상이 되면 주문서에 품절이 떠요. 고객에게 수량은 안 보여요.</span>
      </div>
      <div className="scroll">
        <table className="grid" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th>판매</th><th>상품명</th><th>택배 품목명</th><th>중량(kg)</th><th>가격(원)</th><th>재고(박스)</th>
              <th>접수 / 남음</th><th>판매 기간 (비우면 제한 없음)</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const left = (Number(r.stock_boxes) || 0) - r.reserved;
              return (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`${r.name} 판매`} checked={r.is_active} onChange={(e) => edit(r.id, { is_active: e.target.checked })} style={{ width: 20, height: 20 }} /></td>
                  <td><input className="small-input" aria-label="상품명" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} style={{ width: 110 }} /></td>
                  <td><input className="small-input" aria-label={`${r.name} 택배 품목명`} placeholder={`${r.name}${Number(r.weight_kg) || ''}k`} value={r.ship_name} onChange={(e) => edit(r.id, { ship_name: e.target.value })} style={{ width: 100 }} /></td>
                  <td><input className="small-input" aria-label="중량" type="number" value={r.weight_kg} onChange={(e) => edit(r.id, { weight_kg: e.target.value })} style={{ width: 70 }} /></td>
                  <td><input className="small-input" aria-label="가격" type="number" value={r.price} onChange={(e) => edit(r.id, { price: e.target.value })} style={{ width: 100 }} /></td>
                  <td><input className="small-input" aria-label="재고" type="number" value={r.stock_boxes} onChange={(e) => edit(r.id, { stock_boxes: e.target.value })} style={{ width: 80 }} /></td>
                  <td className="nowrap">
                    {r.reserved}박스 / <b style={{ color: left < 0 ? '#8A3A06' : left === 0 ? 'var(--sub)' : 'var(--green)' }}>{left}박스</b>
                    {left <= 0 && <div className="soldout">품절 {left < 0 && `(${-left}박스 초과 접수)`}</div>}
                  </td>
                  <td className="nowrap">
                    <input className="small-input" type="date" aria-label="시작일" value={r.sale_start} onChange={(e) => edit(r.id, { sale_start: e.target.value })} />
                    {' ~ '}
                    <input className="small-input" type="date" aria-label="종료일" value={r.sale_end} onChange={(e) => edit(r.id, { sale_end: e.target.value })} />
                  </td>
                  <td><button className="btn btn-primary" style={{ height: 38 }} onClick={() => save(r)}>저장</button></td>
                </tr>
              );
            })}
            <tr>
              <td><input type="checkbox" aria-label="판매" checked={adding.is_active} onChange={(e) => setAdding({ ...adding, is_active: e.target.checked })} style={{ width: 20, height: 20 }} /></td>
              <td><input className="small-input" aria-label="새 상품명" placeholder="새 상품" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} style={{ width: 110 }} /></td>
              <td><input className="small-input" aria-label="새 택배 품목명" placeholder="예: 밀감10k" value={adding.ship_name} onChange={(e) => setAdding({ ...adding, ship_name: e.target.value })} style={{ width: 100 }} /></td>
              <td><input className="small-input" aria-label="새 중량" type="number" value={adding.weight_kg} onChange={(e) => setAdding({ ...adding, weight_kg: e.target.value })} style={{ width: 70 }} /></td>
              <td><input className="small-input" aria-label="새 가격" type="number" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} style={{ width: 100 }} /></td>
              <td><input className="small-input" aria-label="새 재고" type="number" value={adding.stock_boxes} onChange={(e) => setAdding({ ...adding, stock_boxes: e.target.value })} style={{ width: 80 }} /></td>
              <td></td>
              <td className="nowrap">
                <input className="small-input" type="date" aria-label="새 시작일" value={adding.sale_start} onChange={(e) => setAdding({ ...adding, sale_start: e.target.value })} />
                {' ~ '}
                <input className="small-input" type="date" aria-label="새 종료일" value={adding.sale_end} onChange={(e) => setAdding({ ...adding, sale_end: e.target.value })} />
              </td>
              <td><button className="btn" style={{ height: 38 }} onClick={add}>추가</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
