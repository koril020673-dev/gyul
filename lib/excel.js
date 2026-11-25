import * as XLSX from 'xlsx';
import { config } from '@/lib/config';
import { phone } from '@/lib/format';

// 롯데택배 알프스(ALPS) 업로드용 엑셀.
// 알프스 > 거래처 관리 > 기초 관리 > 파일 형식 관리 에서 아래 열 순서로 한 번만 등록하면 됨.
export const LOTTE_COLUMNS = [
  '주문번호', '수하인명', '수하인전화', '수하인휴대폰', '우편번호', '수하인주소', '수하인상세주소',
  '품목명', '수량', '배송메시지', '송하인명', '송하인전화', '송하인주소',
];

const itemName = (it) => `${it.products.name} ${Number(it.products.weight_kg)}kg`;

export function buildLotteRows(orders, { splitBoxes = false } = {}) {
  const rows = [];
  for (const o of orders) {
    for (const s of [...(o.shipments || [])].sort((a, b) => a.seq - b.seq)) {
      const base = {
        주문번호: `${o.id}-${s.seq}`,
        수하인명: s.recipient_name,
        수하인전화: phone(s.recipient_phone),
        수하인휴대폰: phone(s.recipient_phone),
        우편번호: s.zipcode || '',
        수하인주소: s.address1,
        수하인상세주소: s.address2 || '',
        배송메시지: s.memo || '',
        송하인명: config.senderName,
        송하인전화: config.senderPhone,
        송하인주소: config.senderAddress,
      };
      const items = s.shipment_items || [];
      if (splitBoxes) {
        for (const it of items) for (let k = 0; k < it.qty; k++) rows.push({ ...base, 품목명: itemName(it), 수량: 1 });
      } else {
        rows.push({
          ...base,
          품목명: items.map((it) => `${itemName(it)}×${it.qty}`).join(', '),
          수량: items.reduce((n, it) => n + it.qty, 0),
        });
      }
    }
  }
  return rows;
}

export function downloadLotteExcel(orders, opts) {
  const rows = buildLotteRows(orders, opts);
  const ws = XLSX.utils.json_to_sheet(rows, { header: LOTTE_COLUMNS });
  ws['!cols'] = LOTTE_COLUMNS.map((c) => ({ wch: ['수하인주소', '품목명', '송하인주소'].includes(c) ? 36 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '롯데택배');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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
