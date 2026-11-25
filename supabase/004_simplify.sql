-- =========================================================
-- 감귤 주문 웹 - 재고 제한·판매 시작일 제거, 시즌 설정 (마이그레이션)
-- 이미 schema.sql 을 실행한 DB에서 SQL Editor 에 통째로 붙여넣고 한 번 실행
-- (여러 번 실행해도 안전)
-- =========================================================

-- ---------- 1) 판매 중인지: 판매 체크 + 종료일(한국시간 오늘 <= 종료일) ----------
create or replace function is_on_sale(p products) returns boolean
language sql stable as $$
  select p.is_active
     and (p.sale_end is null or (now() at time zone 'Asia/Seoul')::date <= p.sale_end);
$$;

-- ---------- 2) [고객] 주문서 상품 (품절 여부 없음) ----------
-- 반환 열이 바뀌므로 지우고 다시 만듦
drop function if exists get_products();
create function get_products()
returns table (id bigint, name text, weight_kg numeric, price integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.weight_kg, p.price
  from products p
  where is_on_sale(p)
  order by p.sort_order, p.id;
$$;
grant execute on function get_products() to anon, authenticated;

-- ---------- 3) [고객] 주문 접수: 재고 확인·상품 잠금 없이 판매 중인지만 확인 ----------
create or replace function place_order(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order_id bigint;
  v_ship_id  bigint;
  v_total    integer := 0;
  v_seq      integer := 0;
  v_ship     jsonb;
  v_item     jsonb;
  v_prod     products;
  v_phone    text := regexp_replace(coalesce(payload->>'buyer_phone',''), '\D', '', 'g');
begin
  if coalesce(trim(payload->>'buyer_name'),'') = '' or length(v_phone) < 9 then
    raise exception '주문자 이름과 연락처를 확인해 주세요';
  end if;
  if jsonb_array_length(coalesce(payload->'shipments','[]'::jsonb)) = 0 then
    raise exception '받는 분을 한 명 이상 입력해 주세요';
  end if;

  -- 1) 주문에 들어있는 상품이 모두 판매 중인지 확인 (재고 제한 없음)
  if exists (
    select 1
    from jsonb_array_elements(payload->'shipments') s
    cross join lateral jsonb_array_elements(s->'items') i
    left join products p on p.id = (i->>'product_id')::bigint
    where coalesce((i->>'qty')::int, 0) > 0
      and (p.id is null or not is_on_sale(p))
  ) then
    raise exception '판매하지 않는 상품이 포함되어 있어요';
  end if;

  -- 2) 주문 저장
  insert into orders (buyer_name, buyer_phone, payer_name, referrer_name)
  values (trim(payload->>'buyer_name'), v_phone,
          nullif(trim(coalesce(payload->>'payer_name','')), ''),
          nullif(trim(coalesce(payload->>'referrer_name','')), ''))
  returning id into v_order_id;

  for v_ship in select * from jsonb_array_elements(payload->'shipments') loop
    if coalesce(trim(v_ship->>'recipient_name'),'') = '' or coalesce(trim(v_ship->>'address1'),'') = '' then
      raise exception '받는 분 이름과 주소를 확인해 주세요';
    end if;
    v_seq := v_seq + 1;
    insert into shipments (order_id, seq, recipient_name, recipient_phone, zipcode, address1, address2, memo)
    values (v_order_id, v_seq, trim(v_ship->>'recipient_name'),
            regexp_replace(coalesce(v_ship->>'recipient_phone',''), '\D', '', 'g'),
            v_ship->>'zipcode', trim(v_ship->>'address1'),
            nullif(trim(coalesce(v_ship->>'address2','')), ''),
            nullif(trim(coalesce(v_ship->>'memo','')), ''))
    returning id into v_ship_id;

    for v_item in select * from jsonb_array_elements(v_ship->'items') loop
      if coalesce((v_item->>'qty')::int, 0) > 0 then
        select * into v_prod from products where id = (v_item->>'product_id')::bigint;
        insert into shipment_items (shipment_id, product_id, qty, unit_price)
        values (v_ship_id, v_prod.id, (v_item->>'qty')::int, v_prod.price);
        v_total := v_total + v_prod.price * (v_item->>'qty')::int;
      end if;
    end loop;

    if not exists (select 1 from shipment_items where shipment_id = v_ship_id) then
      raise exception '받는 분 %에게 보낼 상품을 선택해 주세요', v_seq;
    end if;
  end loop;

  update orders set total_price = v_total where id = v_order_id;
  return jsonb_build_object('order_id', v_order_id, 'total_price', v_total);
end;
$$;

-- ---------- 4) 재고 뷰와 안 쓰는 컬럼 삭제 (위에서 이 컬럼들을 쓰던 함수를 먼저 바꿨음) ----------
drop view if exists product_reserved;
alter table products drop column if exists stock_boxes;
alter table products drop column if exists sale_start;

-- ---------- 5) 설정 (시즌 시작일 등). 로그인한 관리자만 읽기·쓰기 ----------
create table if not exists settings (
  key   text primary key,
  value text
);
alter table settings enable row level security;
drop policy if exists admin_all on settings;
create policy admin_all on settings for all to authenticated using (true) with check (true);
grant select, insert, update, delete on settings to authenticated;
revoke all on settings from anon;

-- 이번 시즌 시작일: 없을 때만 한국시간 오늘로
insert into settings (key, value)
values ('season_start', ((now() at time zone 'Asia/Seoul')::date)::text)
on conflict (key) do nothing;

-- 참고: 주문 삭제는 orders 의 admin_all 정책(for all = 삭제 포함)으로 관리자만 가능하고,
-- shipments·shipment_items 는 on delete cascade 로 같이 지워짐.
-- 파기된 주문 상태 변경 차단 트리거는 update of status 에만 걸려 있어서 삭제는 막지 않음.
