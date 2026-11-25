-- 複数アカウント対応：アプリのデータに owner（main / hgf）を付け、アカウントごとに分ける
-- それまでのデータはすべて main（メインアカウント）のものにする
begin;
alter table public.searches add column if not exists owner text not null default 'main';
alter table public.authors add column if not exists owner text not null default 'main';
alter table public.candidates add column if not exists owner text not null default 'main';
alter table public.skipped_posts add column if not exists owner text not null default 'main';
alter table public.post_insights add column if not exists owner text not null default 'main';
alter table public.labels add column if not exists owner text not null default 'main';
alter table public.candidate_labels add column if not exists owner text not null default 'main';
alter table public.usage_log add column if not exists owner text not null default 'main';
alter table public.access_log add column if not exists owner text;

alter table public.candidate_labels drop constraint if exists candidate_labels_code_fkey;
alter table public.candidate_labels drop constraint if exists candidate_labels_label_id_fkey;
alter table public.candidates drop constraint if exists candidates_username_fkey;

alter table public.authors drop constraint authors_pkey, add primary key (owner, username);
alter table public.candidates drop constraint candidates_pkey, add primary key (owner, code);
alter table public.skipped_posts drop constraint skipped_posts_pkey, add primary key (owner, code);
alter table public.post_insights drop constraint post_insights_pkey, add primary key (owner, code);
alter table public.labels drop constraint labels_name_key, add constraint labels_owner_name_key unique (owner, name),
  add constraint labels_owner_id_key unique (owner, id);
alter table public.candidate_labels drop constraint candidate_labels_pkey, add primary key (owner, code, label_id);

-- 別のアカウントの投稿者・候補・ラベルには結び付けられない
alter table public.candidates add constraint candidates_author_fkey
  foreign key (owner, username) references public.authors(owner, username);
alter table public.candidate_labels add constraint candidate_labels_candidate_fkey
  foreign key (owner, code) references public.candidates(owner, code) on delete cascade;
alter table public.candidate_labels add constraint candidate_labels_label_fkey
  foreign key (owner, label_id) references public.labels(owner, id) on delete cascade;

-- 付け忘れたら保存できないように、既定値は外す
alter table public.searches alter column owner drop default;
alter table public.authors alter column owner drop default;
alter table public.candidates alter column owner drop default;
alter table public.skipped_posts alter column owner drop default;
alter table public.post_insights alter column owner drop default;
alter table public.labels alter column owner drop default;
alter table public.candidate_labels alter column owner drop default;
alter table public.usage_log alter column owner drop default;

create index if not exists searches_owner_created_idx on public.searches (owner, created_at desc);
create index if not exists candidates_owner_posted_idx on public.candidates (owner, posted_at desc);

-- キーワードの成績表：アカウントごと
drop function if exists public.keyword_report();
create or replace function public.keyword_report(p_owner text)
returns table (
  keywords text, searches bigint, credits bigint, shown bigint, excluded bigint,
  seekers bigint, active bigint, not_seekers bigint, analyzed bigint, last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with s as (
    select id, array_to_string(keywords, ' / ') as kw, credits, shown, excluded, created_at from searches where owner = p_owner
  ),
  agg_s as (
    select kw, count(*) as searches, sum(credits) as credits, sum(shown) as shown, sum(excluded) as excluded, max(created_at) as last_at
    from s group by kw
  ),
  agg_c as (
    select s.kw,
      count(*) filter (where i.is_seeker and c.status <> 'vendor') as seekers,
      count(*) filter (where i.is_seeker and c.status <> 'vendor' and i.stage in ('活動中', '内定・退職決定')) as active,
      count(*) filter (where c.status = 'vendor' or i.is_seeker = false) as not_seekers,
      count(*) filter (where i.code is not null or c.status = 'vendor') as analyzed
    from candidates c
    join s on s.id = c.search_id
    left join post_insights i on i.owner = c.owner and i.code = c.code
    where c.owner = p_owner
    group by s.kw
  )
  select a.kw, a.searches, a.credits, a.shown, a.excluded,
    coalesce(b.seekers, 0), coalesce(b.active, 0), coalesce(b.not_seekers, 0), coalesce(b.analyzed, 0), a.last_at
  from agg_s a left join agg_c b on b.kw = a.kw
  order by a.last_at desc;
$$;
revoke execute on function public.keyword_report(text) from public, anon, authenticated;
grant execute on function public.keyword_report(text) to service_role;

-- 日ごとのクレジット使用量：合計と、アカウントごとの内訳
drop function if exists public.credit_daily();
create or replace function public.credit_daily()
returns table (day date, search bigint, live bigint, total bigint, calls bigint, by_owner jsonb)
language sql stable security definer set search_path = public as $$
  with d as (
    select (at at time zone 'Asia/Tokyo')::date as day, owner, kind, credits from usage_log
  )
  select day,
    coalesce(sum(credits) filter (where kind = 'search'), 0),
    coalesce(sum(credits) filter (where kind = 'live'), 0),
    coalesce(sum(credits), 0),
    count(*),
    (select jsonb_object_agg(o.owner, o.c) from (select owner, sum(credits) c from d d2 where d2.day = d.day group by owner) o)
  from d
  group by day
  order by day desc;
$$;
revoke execute on function public.credit_daily() from public, anon, authenticated;
grant execute on function public.credit_daily() to service_role;
commit;
notify pgrst, 'reload schema';
