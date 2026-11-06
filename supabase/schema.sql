-- ポスト検索：Supabase の SQL Editor に貼って実行する
-- サーバー（Netlify Functions）が service_role キーで読み書きする。
-- RLS を有効にしてポリシーを作らないので、anon キーからは読めない。

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  keywords text[] not null,
  days int not null,
  max_replies int not null,
  fetched int not null default 0,
  shown int not null default 0,
  excluded int not null default 0,
  credits int not null default 0
);

create table if not exists public.authors (
  username text primary key,
  full_name text,
  first_seen_at timestamptz not null default now(),
  is_vendor boolean not null default false,
  last_contacted_at timestamptz,
  note text
);

create table if not exists public.candidates (
  code text primary key,
  url text not null,
  caption text,
  posted_at timestamptz,
  username text references public.authors(username) on delete set null,
  search_id uuid references public.searches(id) on delete set null,
  found_at timestamptz not null default now(),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'replied', 'meeting', 'won', 'skip', 'vendor')),
  contacted_at timestamptz,
  note text,
  updated_at timestamptz not null default now()
);
create index if not exists candidates_status_found_idx on public.candidates (status, found_at desc);

-- 1日の上限を守るための、throk の呼び出しごとの使用量
create table if not exists public.usage_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('search', 'live')),
  credits int not null
);
create index if not exists usage_log_at_idx on public.usage_log (at);

alter table public.searches enable row level security;
alter table public.authors enable row level security;
alter table public.candidates enable row level security;
alter table public.usage_log enable row level security;

-- 存在確認で外れた投稿（業者・削除済み）。次の検索では確認せずに外す
create table if not exists public.skipped_posts (
  code text primary key,
  reason text not null check (reason in ('vendor', 'deleted')),
  username text,
  at timestamptz not null default now()
);
alter table public.skipped_posts enable row level security;

-- 画面から変える設定（1日の上限など）
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- AIが投稿から読み取った内容（職種・地域・悩み・転職の段階）。同じ投稿は二度分析しない
create table if not exists public.post_insights (
  code text primary key,
  is_seeker boolean not null,
  stage text not null,
  job text not null,
  area text not null,
  worries text[] not null default '{}',
  summary text not null,
  model text,
  at timestamptz not null default now()
);
alter table public.post_insights enable row level security;

-- キーワードの成績表：同じキーワードの組み合わせごとに、使ったクレジットと見つかった求職者を集計する
create or replace function public.keyword_report()
returns table (
  keywords text, searches bigint, credits bigint, shown bigint, excluded bigint,
  seekers bigint, active bigint, not_seekers bigint, analyzed bigint, last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with s as (
    select id, array_to_string(keywords, ' / ') as kw, credits, shown, excluded, created_at from searches
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
    left join post_insights i on i.code = c.code
    group by s.kw
  )
  select a.kw, a.searches, a.credits, a.shown, a.excluded,
    coalesce(b.seekers, 0), coalesce(b.active, 0), coalesce(b.not_seekers, 0), coalesce(b.analyzed, 0), a.last_at
  from agg_s a left join agg_c b on b.kw = a.kw
  order by a.last_at desc;
$$;
revoke execute on function public.keyword_report() from public, anon, authenticated;
grant execute on function public.keyword_report() to service_role;

-- 心の不調のサイン：none（なし）／caution（つらさ・不調がうかがえる）／urgent（死にたい・消えたいなど、命に関わる表現）
alter table public.post_insights add column if not exists distress text not null default 'none'
  check (distress in ('none', 'caution', 'urgent'));
