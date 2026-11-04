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
