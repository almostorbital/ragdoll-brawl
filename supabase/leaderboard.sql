-- The public leaderboard (see js/leaderboard.js). Run this once in your Supabase project:
-- Dashboard → SQL Editor → New query → paste all of this → Run.
--
-- Anyone playing can read the scores and add one; nobody can change or delete them (only you, from the
-- dashboard). The checks below throw out names and numbers the game could never send.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 12 and name ~ '^[A-Z0-9_ .!?''-]+$'),
  wave       int  not null check (wave between 1 and 500),
  ringouts   int  not null default 0 check (ringouts >= 0 and ringouts <= wave * 6),   -- (never more than 6 fighters a wave)
  created_at timestamptz not null default now()
);

alter table public.scores enable row level security;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores for select to anon using (true);

drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score" on public.scores for insert to anon with check (true);

grant select, insert on public.scores to anon;

-- each name's best run (most waves, then most ring-outs), for the leaderboard
create or replace view public.leaderboard with (security_invoker = true) as
  select distinct on (name) name, wave, ringouts, created_at
  from public.scores
  order by name, wave desc, ringouts desc, created_at;

grant select on public.leaderboard to anon;
