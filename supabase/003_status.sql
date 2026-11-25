-- =========================================================
-- 감귤 주문 웹 - 배송 상태와 입금 여부 분리 (마이그레이션)
-- 이미 schema.sql 을 실행한 DB에서 SQL Editor 에 통째로 붙여넣고 한 번 실행
-- (여러 번 실행해도 안전)
--
-- 배송 상태(orders.status): 접수 → 발송중 → 발송완료 (+ 취소)
-- 입금 여부: orders.paid_at (null = 미입금, 값 있음 = 입금확인)
-- =========================================================

-- ---------- 1) 기존 status check 제약 지우기 (이름은 DB마다 다를 수 있어서 찾아서 지움) ----------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;
end;
$$;

-- ---------- 2) 값 변환 ----------
-- 입금확인 → 접수 (입금 시각이 비어 있으면 지금으로 채움)
update orders set status = '접수', paid_at = coalesce(paid_at, now()) where status = '입금확인';
-- 입금대기 → 접수 (미입금 그대로)
update orders set status = '접수' where status = '입금대기';
-- 발송중 · 발송완료 · 취소는 그대로

-- ---------- 3) 새 제약과 기본값 ----------
alter table orders alter column status set default '접수';
alter table orders add constraint orders_status_check
  check (status in ('접수','발송중','발송완료','취소'));

-- ---------- 4) 상품 순서: 노지감귤 10kg → 5kg → 한라봉 ----------
update products set sort_order = 1 where name = '노지감귤' and weight_kg = 10;
update products set sort_order = 2 where name = '노지감귤' and weight_kg = 5;
update products set sort_order = 3 where name = '한라봉';
