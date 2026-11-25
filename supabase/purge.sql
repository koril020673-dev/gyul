-- =========================================================
-- 감귤 주문 웹 - 개인정보 자동 파기 (마이그레이션)
-- 이미 schema.sql 을 실행한 DB에서 SQL Editor 에 통째로 붙여넣고 한 번 실행
-- (여러 번 실행해도 안전)
--
-- 보관 기간이 지난 주문의 이름·연락처·주소만 '(파기)'로 덮어쓰고,
-- 주문번호·상태·날짜·금액·추천인·상품/수량/단가·송장번호는 집계용으로 남김. 행은 지우지 않음.
-- =========================================================

-- ---------- 1) 파기 시각 컬럼 ----------
alter table orders add column if not exists purged_at timestamptz;

-- ---------- 2) [고객] 주문 조회: 파기된 주문은 돌려주지 않음 ----------
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

grant execute on function lookup_orders(text, text) to anon, authenticated;

-- ---------- 3) 파기 함수 ----------
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

-- ---------- 4) 파기된 주문은 상태 변경 금지 ----------
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

-- ---------- 5) 매일 한국시간 새벽 3시(UTC 18:00) 자동 실행 ----------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-personal-data';
select cron.schedule('purge-personal-data', '0 18 * * *', $cron$select public.purge_personal_data(6);$cron$);
