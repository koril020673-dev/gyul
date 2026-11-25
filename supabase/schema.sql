-- =========================================================
-- 감귤 주문 웹 - Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 실행
-- =========================================================

-- ---------- 상품 ----------
create table if not exists products (
  id          bigint generated always as identity primary key,
  name        text    not null,            -- 노지감귤, 한라봉
  ship_name   text,                        -- 택배 품목명 (밀감10k). 비우면 '노지감귤10k'처럼 자동
  weight_kg   numeric not null,            -- 5, 10, 3
  price       integer not null default 0,  -- 원
  stock_boxes integer not null default 0,  -- 관리자가 입력하는 "남은 박스"
  is_active   boolean not null default true,
  sale_start  date,                        -- 비우면 기간 제한 없음
  sale_end    date,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
-- 예전에 만든 DB에서 다시 실행할 때를 위해 (supabase/002_ship_name.sql 과 같음)
alter table products add column if not exists ship_name text;

-- ---------- 주문 ----------
-- 배송 상태: 접수 → 발송중 → 발송완료 (취소는 별도)
-- 입금 여부는 상태와 따로: paid_at (null = 미입금, 값 있음 = 입금확인). 입금 전에 발송해도 됨
create table if not exists orders (
  id            bigint generated always as identity (start with 1001) primary key,
  buyer_name    text not null,
  buyer_phone   text not null,             -- 숫자만 저장 (01012345678)
  payer_name    text,
  referrer_name text,
  total_price   integer not null default 0,
  status        text not null default '접수'
                constraint orders_status_check check (status in ('접수','발송중','발송완료','취소')),
  paid_at       timestamptz,
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);
-- 개인정보 파기 시각 (파기된 주문은 이름·연락처·주소가 '(파기)'로 덮어써짐. 맨 아래 purge_personal_data 참고)
-- lookup_orders 가 이 컬럼을 쓰므로 함수보다 먼저 추가
alter table orders add column if not exists purged_at timestamptz;
create index if not exists orders_phone_idx on orders (buyer_phone);
create index if not exists orders_status_idx on orders (status);

-- ---------- 배송지 (주문 1 : 배송지 N) ----------
create table if not exists shipments (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references orders(id) on delete cascade,
  seq             integer not null,         -- 주문 안에서 1, 2, 3...
  recipient_name  text not null,
  recipient_phone text not null,
  zipcode         text,
  address1        text not null,            -- 도로명 주소
  address2        text,                     -- 상세주소
  memo            text,
  tracking_no     text,
  unique (order_id, seq)
);

-- ---------- 배송지별 상품 (배송지 1 : 상품 N) ----------
create table if not exists shipment_items (
  id          bigint generated always as identity primary key,
  shipment_id bigint not null references shipments(id) on delete cascade,
  product_id  bigint not null references products(id),
  qty         integer not null check (qty > 0),
  unit_price  integer not null              -- 주문 시점 가격
);

-- =========================================================
-- 보안: 테이블은 로그인한 관리자만 직접 접근
-- 고객은 아래 함수(RPC)로만 주문/조회 가능
-- (Supabase > Authentication 에서 가족 계정만 만들고 회원가입은 끌 것)
-- =========================================================
alter table products       enable row level security;
alter table orders         enable row level security;
alter table shipments      enable row level security;
alter table shipment_items enable row level security;

drop policy if exists admin_all on products;
drop policy if exists admin_all on orders;
drop policy if exists admin_all on shipments;
drop policy if exists admin_all on shipment_items;
create policy admin_all on products       for all to authenticated using (true) with check (true);
create policy admin_all on orders         for all to authenticated using (true) with check (true);
create policy admin_all on shipments      for all to authenticated using (true) with check (true);
create policy admin_all on shipment_items for all to authenticated using (true) with check (true);

-- ---------- 상품별 접수된 박스 수 (취소 제외) ----------
create or replace view product_reserved
with (security_invoker = true) as
select p.id as product_id,
       coalesce(sum(si.qty) filter (where o.status <> '취소'), 0)::int as reserved_boxes
from products p
left join shipment_items si on si.product_id = p.id
left join shipments s on s.id = si.shipment_id
left join orders o on o.id = s.order_id
group by p.id;

-- ---------- 오늘(한국시간) 판매 중인지 ----------
create or replace function is_on_sale(p products) returns boolean
language sql stable as $$
  select p.is_active
     and (p.sale_start is null or (now() at time zone 'Asia/Seoul')::date >= p.sale_start)
     and (p.sale_end   is null or (now() at time zone 'Asia/Seoul')::date <= p.sale_end);
$$;

-- ---------- [고객] 주문서에 보여줄 상품 (재고 수량은 숨기고 품절 여부만) ----------
create or replace function get_products()
returns table (id bigint, name text, weight_kg numeric, price integer, sold_out boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.weight_kg, p.price,
         (r.reserved_boxes >= p.stock_boxes) as sold_out
  from products p
  join product_reserved r on r.product_id = p.id
  where is_on_sale(p)
  order by p.sort_order, p.id;
$$;

-- ---------- [고객] 추천인 자동완성 ----------
create or replace function get_referrer_names(q text)
returns setof text
language sql stable security definer set search_path = public as $$
  select distinct referrer_name from orders
  where referrer_name is not null and referrer_name <> ''
    and q is not null and length(q) >= 1
    and referrer_name ilike q || '%'
  order by 1 limit 8;
$$;

-- ---------- [고객] 주문 접수 ----------
-- 재고 규칙: 남은 박스가 1개라도 있으면 그 주문은 전부 받는다(재고를 넘어도 OK).
--            접수 박스 >= 재고가 되면 그 다음부터 품절.
-- 동시에 들어온 주문은 상품 행 잠금(for update)으로 한 줄로 세워서 처리.
--
-- payload 예시:
-- { "buyer_name":"홍길동", "buyer_phone":"010-1234-5678", "payer_name":"", "referrer_name":"김철수",
--   "shipments":[ { "recipient_name":"이민수", "recipient_phone":"010...", "zipcode":"12345",
--                   "address1":"서울 ...", "address2":"301호", "memo":"",
--                   "items":[ {"product_id":1, "qty":2} ] } ] }
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
  v_reserved integer;
  v_pid      bigint;
  v_phone    text := regexp_replace(coalesce(payload->>'buyer_phone',''), '\D', '', 'g');
begin
  if coalesce(trim(payload->>'buyer_name'),'') = '' or length(v_phone) < 9 then
    raise exception '주문자 이름과 연락처를 확인해 주세요';
  end if;
  if jsonb_array_length(coalesce(payload->'shipments','[]'::jsonb)) = 0 then
    raise exception '받는 분을 한 명 이상 입력해 주세요';
  end if;

  -- 1) 주문에 들어있는 상품들을 잠그고 재고 확인
  for v_pid in
    select distinct (i->>'product_id')::bigint
    from jsonb_array_elements(payload->'shipments') s,
         jsonb_array_elements(s->'items') i
    where coalesce((i->>'qty')::int, 0) > 0
    order by 1
  loop
    select * into v_prod from products where id = v_pid for update;
    if not found or not is_on_sale(v_prod) then
      raise exception '판매하지 않는 상품이 포함되어 있어요';
    end if;
    select reserved_boxes into v_reserved from product_reserved where product_id = v_pid;
    if v_reserved >= v_prod.stock_boxes then
      raise exception '% %kg 상품이 품절되었어요', v_prod.name, v_prod.weight_kg;
    end if;
  end loop;

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

-- ---------- [고객] 주문 조회 (주문자 이름 + 연락처) ----------
create or replace function lookup_orders(p_name text, p_phone text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(o_json order by created_at desc), '[]'::jsonb)
  from (
    select o.created_at,
           jsonb_build_object(
             'id', o.id, 'status', o.status, 'total_price', o.total_price,
             'created_at', o.created_at,
             'shipments', (
               select jsonb_agg(jsonb_build_object(
                        'seq', s.seq, 'recipient_name', s.recipient_name,
                        'address1', s.address1, 'tracking_no', s.tracking_no,
                        'items', (select jsonb_agg(jsonb_build_object(
                                    'name', p.name, 'weight_kg', p.weight_kg, 'qty', si.qty))
                                  from shipment_items si join products p on p.id = si.product_id
                                  where si.shipment_id = s.id)
                      ) order by s.seq)
               from shipments s where s.order_id = o.id)
           ) as o_json
    from orders o
    where o.buyer_name = trim(p_name)
      and o.buyer_phone = regexp_replace(coalesce(p_phone,''), '\D', '', 'g')
      and length(regexp_replace(coalesce(p_phone,''), '\D', '', 'g')) >= 9
      and o.purged_at is null   -- 개인정보가 파기된 주문은 조회에서 제외
  ) t;
$$;

-- 관리자(로그인) 권한. 새 프로젝트는 테이블이 자동 공개되지 않을 수 있어서 명시
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on products, orders, shipments, shipment_items to authenticated;
grant select on product_reserved to authenticated;
revoke all on products, orders, shipments, shipment_items, product_reserved from anon;

grant execute on function get_products()              to anon, authenticated;
grant execute on function get_referrer_names(text)    to anon, authenticated;
grant execute on function place_order(jsonb)          to anon, authenticated;
grant execute on function lookup_orders(text, text)   to anon, authenticated;

-- ---------- 처음 상품 (가격·재고는 관리자 화면에서 수정) ----------
insert into products (name, ship_name, weight_kg, price, stock_boxes, is_active, sort_order)
select * from (values
  ('노지감귤', '밀감10k',  10, 0, 0, true,  1),
  ('노지감귤', '밀감5k',   5,  0, 0, true,  2),
  ('한라봉',   '한라봉3k', 3,  0, 0, false, 3)
) v(name, ship_name, weight_kg, price, stock_boxes, is_active, sort_order)
where not exists (select 1 from products);

-- =========================================================
-- 개인정보 자동 파기 (supabase/purge.sql 과 같은 내용)
-- 보관 기간이 지난 주문의 이름·연락처·주소만 '(파기)'로 덮어쓰고,
-- 주문번호·상태·날짜·금액·추천인·상품/수량/단가·송장번호는 집계용으로 남김. 행은 지우지 않음.
-- =========================================================
alter table orders add column if not exists purged_at timestamptz;

create or replace function purge_personal_data(p_months int default 6)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids bigint[];
begin
  if p_months is null or p_months < 1 then
    raise exception '보관 기간(개월)은 1 이상이어야 해요';
  end if;

  -- 대상: 아직 파기 안 된 주문 중
  --   발송완료 → 발송완료 시각(delivered_at) 기준, 취소 → 주문일(created_at) 기준으로 p_months개월 지난 것
  with t as (
    select id from orders
    where purged_at is null
      and ((status = '발송완료' and delivered_at < now() - make_interval(months => p_months))
        or (status = '취소'     and created_at   < now() - make_interval(months => p_months)))
    for update
  )
  select coalesce(array_agg(id), '{}') into v_ids from t;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  -- 배송지: NOT NULL 컬럼은 대체값, 나머지는 null
  update shipments
     set recipient_name = '(파기)', recipient_phone = '', zipcode = null,
         address1 = '(파기)', address2 = null, memo = null
   where order_id = any(v_ids);

  -- 주문자
  update orders
     set buyer_name = '(파기)', buyer_phone = '', payer_name = null, purged_at = now()
   where id = any(v_ids);

  return cardinality(v_ids);
end;
$$;

-- 실행 권한: 로그인한 관리자만 (고객/익명은 불가)
revoke all on function purge_personal_data(int) from public, anon;
grant execute on function purge_personal_data(int) to authenticated;

-- 파기된 주문은 상태 변경 금지
create or replace function block_purged_status_change() returns trigger
language plpgsql as $$
begin
  raise exception '개인정보가 파기된 주문(%)은 상태를 바꿀 수 없어요', old.id;
end;
$$;

drop trigger if exists orders_block_purged_status on orders;
create trigger orders_block_purged_status
  before update of status on orders
  for each row
  when (old.purged_at is not null and new.status is distinct from old.status)
  execute function block_purged_status_change();

-- 매일 한국시간 새벽 3시(UTC 18:00) 자동 실행
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-personal-data';
select cron.schedule('purge-personal-data', '0 18 * * *', $cron$select public.purge_personal_data(6);$cron$);
