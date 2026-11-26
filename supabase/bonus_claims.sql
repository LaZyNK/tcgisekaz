-- Bonus uniques (ex : rejoindre le serveur Discord), un par compte Discord
create table if not exists public.bonus_claims (
  discord_id text not null,
  bonus text not null,
  claimed_at timestamptz not null default now(),
  primary key (discord_id, bonus)
);
alter table public.bonus_claims enable row level security;  -- aucune politique : seule la fonction (service_role) y accède
grant select, insert on public.bonus_claims to service_role;
