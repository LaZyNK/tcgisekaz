-- Phase 2 : la table saves n'est plus accessible depuis le navigateur ; seule l'Edge Function "game" (service role) y écrit.
drop policy if exists "lire sa sauvegarde" on public.saves;
drop policy if exists "creer sa sauvegarde" on public.saves;
drop policy if exists "modifier sa sauvegarde" on public.saves;
revoke all on public.saves from anon, authenticated;
