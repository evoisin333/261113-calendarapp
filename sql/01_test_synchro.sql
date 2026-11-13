-- 01_test_synchro.sql
-- Étape 1 (tests préalables) : table jetable pour tester la synchro en temps réel
-- entre l'iPhone et l'Android, depuis la page test (sans connexion).
-- Rejouable sans erreur. Table à supprimer à la fin de l'étape 1 (voir tout en bas).

create table if not exists public.test_synchro (
  id        bigint generated always as identity primary key,
  texte     text not null,
  appareil  text,
  cree_le   timestamptz not null default now()   -- stocké en UTC
);

-- Ouverte à tous : OK pour un test, PAS pour la vraie appli
alter table public.test_synchro enable row level security;
drop policy if exists "test ouvert" on public.test_synchro;
create policy "test ouvert" on public.test_synchro
  for all using (true) with check (true);

-- Droits d'accès par l'API : les nouveaux projets Supabase (depuis mai 2026)
-- n'ouvrent plus les nouvelles tables automatiquement, il faut le dire.
-- La page test n'a pas de connexion : elle utilise le rôle "anon".
grant select, insert, delete on public.test_synchro to anon;

-- Active le temps réel sur cette table (seulement si pas déjà fait)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'test_synchro'
  ) then
    alter publication supabase_realtime add table public.test_synchro;
  end if;
end $$;

-- Vérification (seul résultat affiché dans le SQL Editor)
-- Attendu : rls_active = true | nb_regles = 1 | anon_peut_ecrire = true | temps_reel_actif = true
select
  (select relrowsecurity from pg_class where oid = 'public.test_synchro'::regclass) as rls_active,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'test_synchro') as nb_regles,
  has_table_privilege('anon', 'public.test_synchro', 'insert') as anon_peut_ecrire,
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'test_synchro'
  ) as temps_reel_actif;

-- À la fin de l'étape 1, pour nettoyer (à lancer à part, pas maintenant) :
-- drop table if exists public.test_synchro;
