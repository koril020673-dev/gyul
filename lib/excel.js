import * as XLSX from 'xlsx';
import { config } from '@/lib/config';
import { phone } from '@/lib/format';

// 롯데택배 업로드용 엑셀 (시트 1개, 1행 열 제목, 2행부터 데이터, A~Q 17열).
// 열 제목은 실제 업로드 양식과 글자 그대로 같아야 함. 순서도 바꾸지 말 것.
// 보내는 사람 = 주문한 사람, 보내는 사람 주소만 농장 주소(NEXT_PUBLIC_SENDER_ADDRESS)로 고정.
export const LOTTE_COLUMNS = [
  '주문번호',             // A 열 제목만 두고 값은 항상 빈칸
  '보내는사람(지정)',     // B
  '전화번호1(지정)',      // C
  '전화번호2(지정)',      // D
  '우편번호(지정)',       // E
  '보내는사람주소(지정)', // F
  '받는사람',             // G
  '전화번호1',            // H
  '전화번호2',            // I
  '우편번호',             // J
  '받는사람주소',         // K
  '상품명1',              // L
  '상품상세1',            // M
  '수량(A타입)',          // N
  '배송메시지',           // O
  '운임구분',             // P
  '운임',                 // Q
];

// 택배 품목명: 상품에 지정한 ship_name, 없으면 '노지감귤10k' 형태
const itemName = (it) => it.products.ship_name?.trim() || `${it.products.name}${Number(it.products.weight_kg)}k`;

// 상품 순서: sort_order, 없으면 이름
const byProduct = (a, b) =>
  (a.products.sort_order ?? Infinity) - (b.products.sort_order ?? Infinity) ||
  String(a.products.name).localeCompare(String(b.products.name), 'ko');

export function buildLotteRows(orders) {
  const rows = [];
  for (const o of orders) {
    for (const s of [...(o.shipments || [])].sort((a, b) => a.seq - b.seq)) {
      const base = {
        주문번호: '',
        '보내는사람(지정)': o.buyer_name,
        '전화번호1(지정)': phone(o.buyer_phone),
        '전화번호2(지정)': '',
        '우편번호(지정)': '',
        '보내는사람주소(지정)': config.senderAddress,
        받는사람: s.recipient_name,
        전화번호1: phone(s.recipient_phone),
        전화번호2: '',
        우편번호: s.zipcode || '',
        받는사람주소: [s.address1, s.address2].map((v) => (v || '').trim()).filter(Boolean).join(' '),
        상품상세1: '',
        배송메시지: s.memo || '',
        운임구분: '',
        운임: '',
      };
      // 배송지 하나 안에서 같은 상품(product_id)은 한 줄로 합치고 수량은 합계.
      // 상품 종류가 다르면 줄을 나눔 (상품명을 합치지 않음)
      const merged = {};
      for (const it of s.shipment_items || []) {
        if (merged[it.product_id]) merged[it.product_id].qty += it.qty;
        else merged[it.product_id] = { ...it };
      }
      for (const it of Object.values(merged).sort(byProduct)) {
        rows.push({ ...base, 상품명1: itemName(it), '수량(A타입)': it.qty });
      }
    }
  }
  return rows;
}

export function downloadLotteExcel(orders, opts) {
  const rows = buildLotteRows(orders, opts);
  const ws = XLSX.utils.json_to_sheet(rows, { header: LOTTE_COLUMNS });
  ws['!cols'] = LOTTE_COLUMNS.map((c) => ({ wch: c === '받는사람주소' ? 52 : c === '보내는사람주소(지정)' ? 20 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  // 파일 이름: 기간이 있으면 롯데택배_20261124-20261125.xlsx (한쪽만 있으면 20261124부터 / 20261125까지), 없으면 오늘 날짜
  const ymd = (s) => s.replace(/-/g, '');
  const { from, to } = opts || {};
  let stamp;
  if (from && to) stamp = `${ymd(from)}-${ymd(to)}`;
  else if (from) stamp = `${ymd(from)}부터`;
  else if (to) stamp = `${ymd(to)}까지`;
  else {
    const d = new Date();
    stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
  XLSX.writeFile(wb, `롯데택배_${stamp}.xlsx`);
  return rows.length;
}

// 송장번호 칸 값: 공백·하이픈을 빼고 숫자 10~14자리면 송장번호, 아니면 ''
const trackingOf = (v) => {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  return /^\d{10,14}$/.test(d) ? d : '';
};

// 택배사에서 송장번호를 붙여 돌려준 엑셀(우리가 보낸 A~Q + 오른쪽에 송장번호)을 읽어서
// 받는 사람 묶음 배열로 돌려줌.
// [{ row, name, phone, address, product, qty, trackings: ['2601...'], mismatch }]
// - 박스마다 송장이 하나라서 수량이 2 이상이면 바로 아래에 "이어지는 줄"(송장번호만 있는 줄)이 붙음
// - A열(주문번호)은 메모가 들어올 수 있어서 보지 않음
export async function parseTrackingFile(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    .map((r) => r.map((c) => String(c ?? '').trim()));

  // 제목 줄: 1~10행 중 '받는사람' 칸이 있는 줄
  let hi = -1;
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    if (grid[r].some((c) => c.replace(/\s/g, '') === '받는사람')) { hi = r; break; }
  }
  const head = hi >= 0 ? grid[hi].map((c) => c.replace(/\s/g, '')) : [];
  // 제목으로 찾고, 없으면 위치(G·H·K·L·N)로. 받는 사람 전화는 '(지정)'이 없는 '전화번호1'
  const col = (title, pos) => { const i = head.indexOf(title); return i >= 0 ? i : pos; };
  const C = {
    name: col('받는사람', 6), phone: col('전화번호1', 7), address: col('받는사람주소', 10),
    product: col('상품명1', 11), qty: col('수량(A타입)', 13),
  };

  // 송장 열: 제목에 '송장'(운송장 포함)이 있으면 그 열, 없으면 Q열보다 오른쪽에서 송장번호가 가장 많은 열
  const body = grid.slice(hi + 1);
  let trackCol = head.findIndex((c) => /송장/.test(c));
  if (trackCol < 0) {
    const width = Math.max(0, ...body.map((r) => r.length));
    let best = 0;
    for (let c = 17; c < width; c++) {
      const n = body.filter((r) => trackingOf(r[c])).length;
      if (n > best) { best = n; trackCol = c; }
    }
  }
  if (trackCol < 0) throw new Error('송장번호(숫자 10~14자리)가 들어 있는 열을 찾지 못했어요.');

  const groups = [];
  let cur = null;
  body.forEach((r, i) => {
    const no = trackingOf(r[trackCol]);
    const name = r[C.name] || '';
    if (!no) { if (name) cur = null; return; } // 송장이 없는 줄은 건너뜀 (그 아래 이어지는 줄도 붙이지 않음)
    if (name) {
      cur = {
        row: hi + 2 + i, // 엑셀 행 번호 (1부터)
        name,
        phone: String(r[C.phone] || '').replace(/\D/g, ''),
        address: r[C.address] || '',
        product: r[C.product] || '',
        qty: Number(String(r[C.qty] || '').replace(/[^0-9]/g, '')) || 1,
        trackings: [no],
      };
      groups.push(cur);
    } else if (cur && !cur.trackings.includes(no)) {
      cur.trackings.push(no); // 이어지는 줄
    }
  });
  for (const g of groups) if (g.trackings.length !== g.qty) g.mismatch = true;
  return groups;
}
