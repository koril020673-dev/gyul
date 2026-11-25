import * as XLSX from 'xlsx';
import { config } from '@/lib/config';
import { phone } from '@/lib/format';

// 롯데택배 업로드용 엑셀 (시트 1개, 1행 열 제목, 2행부터 데이터, A~Q 17열).
// 열 제목은 실제 업로드 양식과 글자 그대로 같아야 함. 순서도 바꾸지 말 것.
// 보내는 사람 = 주문한 사람, 보내는 사람 주소만 농장 주소(NEXT_PUBLIC_SENDER_ADDRESS)로 고정.
export const LOTTE_COLUMNS = [
  '주문번호',             // A 송장 업로드 매칭용 (주문-받는분순서)
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
        주문번호: `${o.id}-${s.seq}`,
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

// 알프스에서 출력 후 받은 엑셀(주문번호 + 운송장번호)을 읽어서 { "1024-1": ["2501..."] } 형태로
export async function parseTrackingFile(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  let hi = -1, orderCol = -1, trackCol = -1;
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r].map((c) => String(c).replace(/\s/g, ''));
    const oc = row.findIndex((c) => /주문번호/.test(c));
    const tc = row.findIndex((c) => /운송장|송장/.test(c));
    if (oc >= 0 && tc >= 0) { hi = r; orderCol = oc; trackCol = tc; break; }
  }
  if (hi < 0) throw new Error("엑셀 첫 줄 근처에서 '주문번호'와 '운송장번호' 열을 찾지 못했어요.");
  const map = {};
  for (const row of grid.slice(hi + 1)) {
    const key = String(row[orderCol] || '').trim();
    const no = String(row[trackCol] || '').replace(/[^0-9]/g, '');
    if (!/^\d+-\d+$/.test(key) || !no) continue;
    (map[key] ||= []).includes(no) || map[key].push(no);
  }
  return map;
}
