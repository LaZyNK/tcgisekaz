-- Phase 2 : la table saves n'est plus accessible depuis le navigateur ; seule l'Edge Function "game" (service role) y écrit.
drop policy if exists "lire sa sauvegarde" on public.saves;
drop policy if exists "creer sa sauvegarde" on public.saves;
drop policy if exists "modifier sa sauvegarde" on public.saves;
revoke all on public.saves from anon, authenticated;
-- Le revoke a aussi retiré l'accès au service_role : on le redonne explicitement.
grant select, insert, update, delete on public.saves to service_role;
grant select, insert, update on public.bonus_claims to service_role;
grant select on public.cards_ref to service_role;
