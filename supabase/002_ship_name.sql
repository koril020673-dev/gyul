-- =========================================================
-- 감귤 주문 웹 - 상품별 택배 품목명 (마이그레이션)
-- 이미 schema.sql 을 실행한 DB에서 SQL Editor 에 붙여넣고 한 번 실행 (여러 번 실행해도 안전)
-- 롯데택배 엑셀의 '상품명1' 열에 들어가는 이름. 비어 있으면 '노지감귤10k'처럼 자동으로 만듦
-- =========================================================
alter table products add column if not exists ship_name text;

-- 기존 상품 기본값 (비어 있는 행만)
update products set ship_name = '밀감5k'   where ship_name is null and name = '노지감귤' and weight_kg = 5;
update products set ship_name = '밀감10k'  where ship_name is null and name = '노지감귤' and weight_kg = 10;
update products set ship_name = '한라봉3k' where ship_name is null and name = '한라봉'   and weight_kg = 3;
