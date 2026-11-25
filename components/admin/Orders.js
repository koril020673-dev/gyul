'use client';

import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { won, phone, date } from '@/lib/format';
import { StatusPill } from '@/components/StatusSteps';
import { downloadLotteExcel, parseTrackingFile } from '@/lib/excel';
import { config } from '@/lib/config';

const FILTERS = ['전체', '입금대기', '입금확인', '발송중', '발송완료', '취소'];
const NEXT = { 입금대기: '입금확인', 입금확인: '발송중', 발송중: '발송완료' };
const STAMP = { 입금확인: 'paid_at', 발송중: 'shipped_at', 발송완료: 'delivered_at' };

const boxesOf = (o) => (o.shipments || []).reduce((n, s) => n + (s.shipment_items || []).reduce((m, it) => m + it.qty, 0), 0);
const kgOf = (o) => (o.shipments || []).reduce((n, s) => n + (s.shipment_items || []).reduce((m, it) => m + it.qty * Number(it.products.weight_kg), 0), 0);

export default function Orders({ orders, reload, notify }) {
  const [filter, setFilter] = useState('입금대기');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [split, setSplit] = useState(false);
  const fileRef = useRef();

  const shown = useMemo(() => {
    const k = q.trim().replace(/-/g, '');
    return orders.filter((o) => {
      if (filter !== '전체' && o.status !== filter) return false;
      if (!k) return true;
      const hay = [o.id, o.buyer_name, o.buyer_phone, o.payer_name, ...(o.shipments || []).flatMap((s) => [s.recipient_name, s.recipient_phone])].join(' ');
      return hay.includes(k);
    });
  }, [orders, filter, q]);

  const stats = useMemo(() => {
    const paid = orders.filter((o) => o.status === '입금확인');
    return {
      wait: orders.filter((o) => o.status === '입금대기').length,
      paid: paid.length,
      boxes: paid.reduce((n, o) => n + boxesOf(o), 0),
      kg: paid.reduce((n, o) => n + kgOf(o), 0),
    };
  }, [orders]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((o) => sel.has(o.id));
  const toggleAll = () => setSel(allOn ? new Set() : new Set(shown.map((o) => o.id)));

  async function setStatus(picked, status) {
    if (!picked.length) return;
    // 개인정보가 파기된 주문은 상태를 바꾸지 않음 (DB 트리거에서도 거부)
    const purged = new Set(orders.filter((o) => o.purged_at).map((o) => o.id));
    const ids = picked.filter((id) => !purged.has(id));
    const skipped = picked.length - ids.length;
    if (!ids.length) return notify(`파기된 주문 ${skipped}건은 상태를 바꿀 수 없어요.`);
    if (status === '취소' && !confirm(`${ids.length}건을 취소할까요? 잡아둔 재고가 풀려요.`)) return;
    const patch = { status };
    if (STAMP[status]) patch[STAMP[status]] = new Date().toISOString();
    const { error } = await supabase.from('orders').update(patch).in('id', ids);
    if (error) return notify('변경 실패: ' + error.message);
    notify(`${ids.length}건 → ${status}${skipped ? ` · 파기된 주문 ${skipped}건 제외` : ''}`);
    setSel(new Set());
    reload();
  }

  async function saveTracking(order, s, value) {
    if (order.purged_at) return; // 파기된 주문은 송장 수정 안 함
    const v = value.replace(/[^0-9,\s]/g, '').trim();
    if ((s.tracking_no || '') === v) return;
    const { error } = await supabase.from('shipments').update({ tracking_no: v || null }).eq('id', s.id);
    if (error) return notify('송장 저장 실패: ' + error.message);
    if (v && order.status === '입금확인') await setStatus([order.id], '발송중');
    else { notify('송장번호 저장'); reload(); }
  }

  function exportExcel() {
    const picked = sel.size ? orders.filter((o) => sel.has(o.id)) : orders.filter((o) => o.status === '입금확인');
    // 개인정보가 파기된 주문은 주소가 없으므로 엑셀에서 제외
    const target = picked.filter((o) => !o.purged_at);
    const skipped = picked.length - target.length;
    if (!target.length) return notify(skipped ? '선택한 주문은 모두 개인정보가 파기되어 내보낼 수 없어요.' : '내보낼 주문이 없어요. 입금확인 주문이 있거나 선택해야 해요.');
    const n = downloadLotteExcel(target, { splitBoxes: split });
    notify(`${target.length}건 · ${n}줄 다운로드${skipped ? ` · 파기된 주문 ${skipped}건 제외` : ''}`);
  }

  async function purgeNow() {
    if (!confirm('보관 기간(6개월)이 지난 발송완료·취소 주문의 이름·연락처·주소를 지금 지울까요?\n지운 개인정보는 되돌릴 수 없어요. (주문번호·금액·상품·추천인 집계는 남아요)')) return;
    const { data, error } = await supabase.rpc('purge_personal_data', { p_months: 6 });
    if (error) return notify('정리 실패: ' + error.message);
    notify(data ? `개인정보 ${data}건 파기했어요` : '정리할 주문이 없어요');
    setSel(new Set());
    reload();
  }

  async function uploadTracking(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const map = await parseTrackingFile(file);
      const keys = Object.keys(map);
      if (!keys.length) return notify('주문번호(예: 1024-1)와 송장번호가 있는 줄이 없어요.');
      // 파기된 주문은 매칭 대상에서 제외 (못 찾음으로 셈)
      const byId = Object.fromEntries(orders.filter((o) => !o.purged_at).map((o) => [o.id, o]));
      let ok = 0, miss = 0;
      const shippedOrders = new Set();
      for (const key of keys) {
        const [oid, seq] = key.split('-').map(Number);
        const s = byId[oid]?.shipments?.find((x) => x.seq === seq);
        if (!s) { miss++; continue; }
        const { error } = await supabase.from('shipments').update({ tracking_no: map[key].join(', ') }).eq('id', s.id);
        if (error) { miss++; continue; }
        ok++;
        if (byId[oid].status === '입금확인') shippedOrders.add(oid);
      }
      if (shippedOrders.size) {
        await supabase.from('orders').update({ status: '발송중', shipped_at: new Date().toISOString() }).in('id', [...shippedOrders]);
      }
      notify(`송장 ${ok}곳 입력${shippedOrders.size ? `, ${shippedOrders.size}건 발송중` : ''}${miss ? ` · 못 찾음 ${miss}` : ''}`);
      reload();
    } catch (err) {
      notify(err.message);
    }
  }

  const ids = [...sel];

  return (
    <>
      <div className="stats">
        <div className="stat"><div>입금대기</div><strong>{stats.wait}건</strong></div>
        <div className="stat"><div>발송 대기 (입금확인)</div><strong>{stats.paid}건</strong></div>
        <div className="stat"><div>발송할 박스</div><strong>{stats.boxes}박스</strong></div>
        <div className="stat"><div>발송할 중량</div><strong>{stats.kg}kg</strong></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="muted">{config.retention} 지난 주문은 매일 새벽 3시에 자동으로 정리돼요.</span>
        <button className="btn" onClick={purgeNow}>보관 기간 지난 개인정보 지금 정리</button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>주문 목록</h2>
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => { setFilter(f); setSel(new Set()); }}>
                {f}{f !== '전체' && ` ${orders.filter((o) => o.status === f).length}`}
              </button>
            ))}
          </div>
          <input aria-label="검색" className="small-input" placeholder="이름·연락처·주문번호" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> 박스별로 한 줄씩
            </label>
            <button className="btn" onClick={() => fileRef.current?.click()}>송장 엑셀 업로드</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={uploadTracking} />
            <button className="btn btn-primary" onClick={exportExcel}>
              롯데택배 엑셀 {sel.size ? `(선택 ${sel.size}건)` : '(입금확인 전체)'}
            </button>
          </div>
        </div>

        {sel.size > 0 && (
          <div className="actions">
            <b>선택 {sel.size}건</b>
            <button className="btn btn-primary" onClick={() => setStatus(ids, '입금확인')}>입금확인</button>
            <button className="btn" onClick={() => setStatus(ids, '발송중')}>발송중</button>
            <button className="btn" onClick={() => setStatus(ids, '발송완료')}>발송완료</button>
            <button className="btn" onClick={() => setStatus(ids, '입금대기')}>입금대기로 되돌리기</button>
            <button className="btn" onClick={() => setStatus(ids, '취소')}>취소</button>
          </div>
        )}

        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="전체 선택" checked={allOn} onChange={toggleAll} /></th>
                <th>주문</th>
                <th>주문자</th>
                <th>받는 분 · 주소 · 상품</th>
                <th>금액</th>
                <th>상태</th>
                <th>송장번호</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td><input type="checkbox" aria-label={`${o.id} 선택`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td className="nowrap"><b>{o.id}</b><div className="muted">{date(o.created_at)}</div></td>
                  <td className="nowrap">
                    {o.purged_at ? (
                      <div className="muted">개인정보 파기됨 ({date(o.purged_at)})</div>
                    ) : (
                      <>
                        <b>{o.buyer_name}</b>
                        <div className="muted">{phone(o.buyer_phone)}</div>
                        {o.payer_name && <div className="muted">입금자 {o.payer_name}</div>}
                      </>
                    )}
                  </td>
                  <td>
                    {[...(o.shipments || [])].sort((a, b) => a.seq - b.seq).map((s) => (
                      <div className="ship-line" key={s.id}>
                        {o.purged_at ? (
                          <div className="muted">받는 분 {s.seq} · 개인정보 파기됨 ({date(o.purged_at)})</div>
                        ) : (
                          <>
                            <div><b>{s.recipient_name}</b> <span className="muted">{phone(s.recipient_phone)}</span></div>
                            <div className="muted">({s.zipcode}) {s.address1} {s.address2}</div>
                          </>
                        )}
                        <div>{(s.shipment_items || []).map((it) => `${it.products.name} ${Number(it.products.weight_kg)}kg×${it.qty}`).join(', ')}</div>
                        {!o.purged_at && s.memo && <div className="muted">메모: {s.memo}</div>}
                      </div>
                    ))}
                  </td>
                  <td className="nowrap">{won(o.total_price)}<div className="muted">{boxesOf(o)}박스</div></td>
                  <td className="nowrap">
                    <StatusPill status={o.status} />
                    {NEXT[o.status] && !o.purged_at && (
                      <div style={{ marginTop: 6 }}>
                        <button className="btn" style={{ height: 34, fontSize: 13, padding: '0 10px' }} onClick={() => setStatus([o.id], NEXT[o.status])}>
                          → {NEXT[o.status]}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {[...(o.shipments || [])].sort((a, b) => a.seq - b.seq).map((s) => (
                      <div className="ship-line" key={s.id}>
                        <input
                          className="tracking-input" aria-label={o.purged_at ? `${o.id}-${s.seq} 송장번호` : `${s.recipient_name} 송장번호`}
                          defaultValue={s.tracking_no || ''} placeholder={`${o.id}-${s.seq}`}
                          key={s.tracking_no || 'empty'}
                          onBlur={(e) => saveTracking(o, s, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          disabled={o.status === '취소' || !!o.purged_at}
                        />
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ padding: 24, textAlign: 'center' }}>해당하는 주문이 없어요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          엑셀은 받는 분 한 곳당 한 줄이고, 주문번호는 &quot;주문-받는분순서&quot;(예: 1024-1)로 나가요. 추천인은 엑셀에 포함되지 않아요.
          송장번호를 넣거나 송장 엑셀을 올리면 입금확인 주문이 자동으로 발송중이 돼요.
        </div>
      </section>
    </>
  );
}
