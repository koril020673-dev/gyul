'use client';

import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { won, phone, date, kstDate, kstToday, addDays, trackingList } from '@/lib/format';
import { StatusPill } from '@/components/StatusSteps';
import { downloadLotteExcel, parseTrackingFile } from '@/lib/excel';
import { config } from '@/lib/config';

const FILTERS = ['전체', '접수', '발송중', '발송완료', '취소'];
const UNPAID = '미입금'; // 상태와 별개인 필터: 입금 안 됐고 취소가 아닌 주문
const NEXT = { 접수: '발송중', 발송중: '발송완료' };
const STAMP = { 발송중: 'shipped_at', 발송완료: 'delivered_at' };

const isUnpaid = (o) => !o.paid_at && o.status !== '취소';

const boxesOf = (o) => (o.shipments || []).reduce((n, s) => n + (s.shipment_items || []).reduce((m, it) => m + it.qty, 0), 0);
// 금액 = 박스 수 × 상품의 현재 가격 (상품·판매 탭과 같은 방식)
const wonOf = (o) => (o.shipments || []).reduce((n, s) => n + (s.shipment_items || []).reduce((m, it) => m + it.qty * (it.products?.price || 0), 0), 0);
// 엑셀 버튼·파일 이름용 날짜 표시
const md = (ymd) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '');

// 송장 업로드 짝 맞추기용
const personKey = (name, tel) => `${String(name || '').replace(/\s/g, '')}|${String(tel || '').replace(/\D/g, '')}`;
const addrKey = (v) => String(v || '').replace(/[\s,.()\-]/g, '');
const itemLabel = (it) => it.products?.ship_name?.trim() || `${it.products?.name}${Number(it.products?.weight_kg)}k`;

export default function Orders({ orders, reload, notify }) {
  const [filter, setFilter] = useState('접수');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [from, setFrom] = useState(''); // 엑셀 주문일 시작 (한국시간, 비우면 제한 없음)
  const [to, setTo] = useState('');     // 엑셀 주문일 끝 (그날 포함)
  const [withShipped, setWithShipped] = useState(false);
  const [upload, setUpload] = useState(null);   // 송장 엑셀 업로드 결과 (닫기 전까지 보임)
  const [editing, setEditing] = useState(null); // 송장이 여러 개인 배송지를 고치는 중이면 그 배송지 id
  const fileRef = useRef();

  const shown = useMemo(() => {
    const k = q.trim().replace(/-/g, '');
    return orders.filter((o) => {
      if (filter === UNPAID) { if (!isUnpaid(o)) return false; }
      else if (filter !== '전체' && o.status !== filter) return false;
      if (!k) return true;
      const hay = [o.id, o.buyer_name, o.buyer_phone, o.payer_name, ...(o.shipments || []).flatMap((s) => [s.recipient_name, s.recipient_phone])].join(' ');
      return hay.includes(k);
    });
  }, [orders, filter, q]);

  const stats = useMemo(() => {
    const ready = orders.filter((o) => o.status === '접수');
    const unpaid = orders.filter(isUnpaid);
    return {
      ready: ready.length,
      boxes: ready.reduce((n, o) => n + boxesOf(o), 0),
      unpaid: unpaid.length,
      unpaidWon: unpaid.reduce((n, o) => n + wonOf(o), 0),
    };
  }, [orders]);

  // 롯데택배 엑셀 대상
  // - 선택한 주문이 있으면 그것만 (기간·상태 무시)
  // - 없으면 주문일(한국시간)이 기간 안이고 '접수'인 주문 (+ 체크 시 '발송중'·'발송완료')
  // - 취소·개인정보 파기된 주문은 항상 제외
  const excel = useMemo(() => {
    const ok = (o) => o.status !== '취소' && !o.purged_at;
    if (sel.size) {
      const picked = orders.filter((o) => sel.has(o.id));
      const target = picked.filter(ok);
      return { target, skipped: picked.length - target.length, label: `선택 ${sel.size}건` };
    }
    const statuses = withShipped ? ['접수', '발송중', '발송완료'] : ['접수'];
    const target = orders.filter((o) => {
      if (!ok(o) || !statuses.includes(o.status)) return false;
      const d = kstDate(o.created_at);
      return (!from || d >= from) && (!to || d <= to);
    });
    const what = withShipped ? '접수·발송' : '접수';
    const range = from || to ? `${md(from)}~${md(to)} ${what}` : `${what} 전체`;
    return { target, skipped: 0, label: `${range} ${target.length}건` };
  }, [orders, sel, from, to, withShipped]);

  const quick = (a, b) => { setFrom(a); setTo(b); };

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
    if (status === '취소' && !confirm(`${ids.length}건을 취소할까요?`)) return;
    const patch = { status };
    if (STAMP[status]) patch[STAMP[status]] = new Date().toISOString();
    const { error } = await supabase.from('orders').update(patch).in('id', ids);
    if (error) return notify('변경 실패: ' + error.message);
    notify(`${ids.length}건 → ${status}${skipped ? ` · 파기된 주문 ${skipped}건 제외` : ''}`);
    setSel(new Set());
    reload();
  }

  // 입금 여부는 배송 상태와 따로 저장 (파기된 주문도 가능)
  async function setPaid(ids, paid) {
    if (!ids.length) return;
    const { error } = await supabase.from('orders').update({ paid_at: paid ? new Date().toISOString() : null }).in('id', ids);
    if (error) return notify('입금 저장 실패: ' + error.message);
    notify(`${ids.length}건 입금확인 ${paid ? '체크' : '해제'}`);
    reload();
  }

  async function saveTracking(order, s, value) {
    setEditing(null);
    if (order.purged_at) return; // 파기된 주문은 송장 수정 안 함
    // 쉼표로 구분해 입력 → 숫자 묶음만 남겨 ", " 로 정리
    const v = trackingList(value).join(', ');
    if ((s.tracking_no || '') === v) return;
    const { error } = await supabase.from('shipments').update({ tracking_no: v || null }).eq('id', s.id);
    if (error) return notify('송장 저장 실패: ' + error.message);
    if (v && order.status === '접수') await setStatus([order.id], '발송중');
    else { notify('송장번호 저장'); reload(); }
  }

  function exportExcel() {
    const { target, skipped } = excel;
    if (!target.length) {
      return notify(skipped ? '선택한 주문은 모두 취소됐거나 개인정보가 파기되어 내보낼 수 없어요.' : '내보낼 주문이 없어요. 기간과 상태를 확인하거나 주문을 선택해 주세요.');
    }
    // 선택했을 때는 기간을 무시하므로 파일 이름에도 기간을 넣지 않음
    const range = sel.size ? {} : { from, to };
    const n = downloadLotteExcel(target, range);
    notify(`${target.length}건 · ${n}줄 다운로드${skipped ? ` · 취소·파기된 주문 ${skipped}건 제외` : ''}`);
  }

  async function deleteSelected() {
    const ids = [...sel];
    if (!ids.length) return;
    if (!confirm(`선택한 ${ids.length}건을 완전히 삭제할까요? 되돌릴 수 없어요.`)) return;
    // 배송지·상품은 DB에서 함께 지워짐 (on delete cascade)
    const { data, error } = await supabase.from('orders').delete().in('id', ids).select('id');
    if (error) return notify('삭제 실패: ' + error.message);
    notify(`${data?.length ?? ids.length}건 삭제했어요`);
    setSel(new Set());
    reload();
  }

  async function purgeNow() {
    if (!confirm('보관 기간(6개월)이 지난 발송완료·취소 주문의 이름·연락처·주소를 지금 지울까요?\n지운 개인정보는 되돌릴 수 없어요. (주문번호·금액·상품·추천인 집계는 남아요)')) return;
    const { data, error } = await supabase.rpc('purge_personal_data', { p_months: 6 });
    if (error) return notify('정리 실패: ' + error.message);
    notify(data ? `개인정보 ${data}건 파기했어요` : '정리할 주문이 없어요');
    setSel(new Set());
    reload();
  }

  // 택배사에서 받은 송장 엑셀 → 받는 사람 이름 + 전화번호로 배송지를 찾아 송장번호 입력
  async function uploadTracking(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let groups;
    try { groups = await parseTrackingFile(file); } catch (err) { return notify(err.message); }
    if (!groups.length) return notify('받는 사람과 송장번호가 함께 있는 줄이 없어요.');

    // 짝을 찾는 대상: 취소·파기가 아니고 접수·발송중인 주문의 배송지
    const byKey = {};
    for (const o of orders) {
      if (o.purged_at || !['접수', '발송중'].includes(o.status)) continue;
      for (const s of o.shipments || []) {
        (byKey[personKey(s.recipient_name, s.recipient_phone)] ||= []).push({ o, s, addr: addrKey(`${s.address1 || ''}${s.address2 || ''}`) });
      }
    }

    const picked = {}; // 배송지 id → { o, s, nos: Set, mismatch }
    const missed = [];
    for (const g of groups) {
      let cands = byKey[personKey(g.name, g.phone)] || [];
      if (cands.length > 1) {
        // 0) 이미 이 송장번호가 들어 있는 배송지가 있으면 그곳 (같은 파일을 다시 올린 경우)
        const already = cands.filter((c) => trackingList(c.s.tracking_no).some((no) => g.trackings.includes(no)));
        if (already.length) cands = already;
      }
      if (cands.length > 1) {
        // a) 주소가 같거나 한쪽이 다른 쪽을 포함
        const ga = addrKey(g.address);
        const a = cands.filter((c) => ga && c.addr && (c.addr === ga || c.addr.includes(ga) || ga.includes(c.addr)));
        if (a.length) cands = a;
      }
      if (cands.length > 1) {
        // b) 같은 상품이 있고 그 상품 박스 수가 엑셀 수량과 같음
        const b = cands.filter((c) => {
          const qty = (c.s.shipment_items || []).filter((it) => itemLabel(it) === g.product).reduce((n, it) => n + it.qty, 0);
          return qty > 0 && qty === g.qty;
        });
        if (b.length) cands = b;
      }
      if (cands.length > 1) {
        // c) 송장이 아직 없는(이번에 넣은 것도 없는) 배송지 중 주문번호가 가장 작은 곳
        const empty = cands.filter((c) => !c.s.tracking_no && !picked[c.s.id]).sort((x, y) => x.o.id - y.o.id || x.s.seq - y.s.seq);
        cands = empty.slice(0, 1);
      }
      if (cands.length !== 1) { missed.push(g); continue; }
      const { o, s } = cands[0];
      const p = (picked[s.id] ||= { o, s, nos: new Set(), mismatch: false });
      g.trackings.forEach((no) => p.nos.add(no));
      if (g.mismatch) p.mismatch = true;
    }

    // 저장: 이미 있던 송장과 합치고 중복은 뺌. 바뀐 게 없으면 저장하지 않음
    const list = Object.values(picked);
    const failed = [];
    await Promise.all(list.map(async (p) => {
      const merged = [...new Set([...trackingList(p.s.tracking_no), ...p.nos])].join(', ');
      if (merged === (p.s.tracking_no || '')) return;
      const { error } = await supabase.from('shipments').update({ tracking_no: merged }).eq('id', p.s.id);
      if (error) { failed.push(p.s.recipient_name); p.failed = true; }
    }));
    const ok = list.filter((p) => !p.failed);
    const toShip = [...new Set(ok.filter((p) => p.o.status === '접수').map((p) => p.o.id))];
    let shipped = 0;
    if (toShip.length) {
      const { data, error } = await supabase.from('orders')
        .update({ status: '발송중', shipped_at: new Date().toISOString() })
        .in('id', toShip).eq('status', '접수').select('id');
      if (error) failed.push('발송중으로 바꾸기 실패: ' + error.message);
      else shipped = data?.length ?? toShip.length;
    }

    setUpload({
      file: file.name,
      trackings: ok.reduce((n, p) => n + p.nos.size, 0),
      places: ok.length,
      shipped,
      missed: missed.map((g) => ({ name: g.name, row: g.row })),
      mismatch: ok.filter((p) => p.mismatch).map((p) => p.s.recipient_name),
      failed,
    });
    reload();
  }

  const ids = [...sel];

  return (
    <>
      <div className="stats">
        <div className="stat"><div>발송 대기 (접수)</div><strong>{stats.ready}건</strong></div>
        <div className="stat"><div>포장할 박스</div><strong>{stats.boxes}박스</strong></div>
        <div className="stat"><div>미입금</div><strong>{stats.unpaid}건</strong><div>{won(stats.unpaidWon)}</div></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="muted">{config.retention} 지난 주문은 매일 새벽 3시에 자동으로 정리돼요.</span>
        <button className="btn" onClick={purgeNow}>보관 기간 지난 개인정보 지금 정리</button>
      </div>

      {upload && (
        <section className="panel" role="status" style={{ padding: '14px 18px', marginBottom: 12, background: 'var(--accent-soft)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b>송장 {upload.trackings}개 · 배송지 {upload.places}곳 입력 · 발송중으로 바뀐 주문 {upload.shipped}건</b>
            <button className="btn-text" onClick={() => setUpload(null)}>닫기</button>
          </div>
          <div className="muted">{upload.file}</div>
          {upload.missed.length > 0 && (
            <div>
              <b>못 찾음 {upload.missed.length}줄</b>:{' '}
              {upload.missed.slice(0, 20).map((m) => `${m.name} (${m.row}행)`).join(', ')}
              {upload.missed.length > 20 && ` 외 ${upload.missed.length - 20}명`}
            </div>
          )}
          {upload.mismatch.length > 0 && (
            <div><b>박스 수와 송장 수가 다름 {upload.mismatch.length}곳</b>: {upload.mismatch.join(', ')}</div>
          )}
          {upload.failed.length > 0 && (
            <div style={{ color: '#B42318' }}><b>저장 실패</b>: {upload.failed.join(', ')}</div>
          )}
          <div className="muted">못 찾은 송장은 주문 표의 송장 칸에 직접 넣을 수 있어요. 여러 개면 쉼표로 구분해요.</div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>주문 목록</h2>
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => { setFilter(f); setSel(new Set()); }}>
                {f}{f !== '전체' && ` ${orders.filter((o) => o.status === f).length}`}
              </button>
            ))}
            <button className="chip" aria-pressed={filter === UNPAID} onClick={() => { setFilter(UNPAID); setSel(new Set()); }}>
              {UNPAID} {orders.filter(isUnpaid).length}
            </button>
            <button
              type="button" onClick={deleteSelected} disabled={!sel.size}
              style={{ height: 36, padding: '0 12px', border: 0, borderRadius: 4, background: '#B42318', color: '#fff', fontSize: 13, fontWeight: 700, cursor: sel.size ? 'pointer' : 'not-allowed', opacity: sel.size ? 1 : 0.4 }}
            >
              선택 삭제
            </button>
          </div>
          <input aria-label="검색" className="small-input" placeholder="이름·연락처·주문번호" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>송장 엑셀 업로드</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={uploadTracking} />
          </div>
          <div style={{ width: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span className="muted">주문일</span>
            <input className="small-input" type="date" aria-label="엑셀 주문일 시작" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>~</span>
            <input className="small-input" type="date" aria-label="엑셀 주문일 끝" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="chip" onClick={() => quick(kstToday(), kstToday())}>오늘</button>
            <button className="chip" onClick={() => quick(addDays(kstToday(), -1), addDays(kstToday(), -1))}>어제</button>
            <button className="chip" onClick={() => quick(addDays(kstToday(), -6), kstToday())}>최근 7일</button>
            {(from || to) && <button className="btn-text" onClick={() => quick('', '')}>기간 지우기</button>}
            <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={withShipped} onChange={(e) => setWithShipped(e.target.checked)} /> 이미 발송한 주문도 포함
            </label>
            <button className="btn btn-primary" onClick={exportExcel}>
              롯데택배 엑셀 ({excel.label})
            </button>
          </div>
        </div>

        {sel.size > 0 && (
          <div className="actions">
            <b>선택 {sel.size}건</b>
            <button className="btn btn-primary" onClick={() => setStatus(ids, '발송중')}>발송중</button>
            <button className="btn" onClick={() => setStatus(ids, '발송완료')}>발송완료</button>
            <button className="btn" onClick={() => setStatus(ids, '접수')}>접수로 되돌리기</button>
            <button className="btn" onClick={() => setStatus(ids, '취소')}>취소</button>
            <button className="btn" onClick={() => setPaid(ids, true)}>입금확인 체크</button>
            <button className="btn" onClick={() => setPaid(ids, false)}>입금확인 해제</button>
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
                <th>입금확인</th>
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
                  <td className="nowrap">
                    <input
                      type="checkbox" aria-label={`${o.id} 입금확인`} checked={!!o.paid_at}
                      onChange={(e) => setPaid([o.id], e.target.checked)} style={{ width: 20, height: 20 }}
                    />
                    {o.paid_at && <div className="muted" style={{ fontSize: 12 }}>{date(o.paid_at)}</div>}
                  </td>
                  <td>
                    {[...(o.shipments || [])].sort((a, b) => a.seq - b.seq).map((s) => {
                      const nos = trackingList(s.tracking_no);
                      const locked = o.status === '취소' || !!o.purged_at;
                      // 송장이 여러 개면 한 줄에 하나씩 보여주고, "고치기"를 누르면 쉼표로 이은 입력칸
                      if (nos.length > 1 && editing !== s.id) {
                        return (
                          <div className="ship-line" key={s.id}>
                            {nos.map((no) => <span key={no} className="nowrap" style={{ fontSize: 13 }}>{no}</span>)}
                            {!locked && <button className="btn-text" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setEditing(s.id)}>고치기</button>}
                          </div>
                        );
                      }
                      return (
                        <div className="ship-line" key={s.id}>
                          <input
                            className="tracking-input" aria-label={o.purged_at ? `${o.id}-${s.seq} 송장번호` : `${s.recipient_name} 송장번호`}
                            defaultValue={nos.join(', ')} placeholder={nos.length ? '' : '쉼표로 여러 개'}
                            key={s.tracking_no || 'empty'}
                            autoFocus={editing === s.id}
                            onBlur={(e) => saveTracking(o, s, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                            disabled={locked}
                          />
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ padding: 24, textAlign: 'center' }}>해당하는 주문이 없어요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          엑셀은 받는 분 한 곳·상품 한 종류당 한 줄이고, A열(주문번호)은 빈칸으로 나가요. 추천인은 엑셀에 포함되지 않아요.
          택배사에서 송장번호를 붙여 돌려준 엑셀을 그대로 &quot;송장 엑셀 업로드&quot;로 올리면 받는 사람 이름 + 전화번호로 배송지를 찾아 송장이 들어가요(박스마다 송장 하나).
          못 찾은 건 표의 송장 칸에 직접 넣으면 되고, 여러 개는 쉼표로 구분해요. 송장이 들어가면 접수 주문이 자동으로 발송중이 돼요. 입금 여부는 배송과 따로 체크해요.
        </div>
      </section>
    </>
  );
}
