-- 06_remboursements.sql
-- Onglet Remboursements : dossiers de soins (un rendez-vous ou une prescription kiné),
-- leurs séances (chacune avec ses étapes mutuelle / DKV) et les photos des documents.
-- Rejouable sans erreur. À lancer dans Supabase → SQL Editor (après 02 et 03).


-- 1) Dossiers : un rendez-vous simple, ou une prescription avec plusieurs séances
create table if not exists public.dossiers_soins (
  id               bigint generated always as identity primary key,
  pour_qui         uuid not null default auth.uid() references public.membres (user_id),
  soin             text not null check (char_length(soin) between 1 and 100),   -- ex. « Kiné dos », « Dermato »
  seances_prevues  smallint check (seances_prevues between 1 and 200),          -- vide = rendez-vous simple
  notes            text check (char_length(notes) <= 2000),
  cree_par         uuid default auth.uid() references auth.users (id) on delete set null,
  cree_le          timestamptz not null default now(),
  modifie_le       timestamptz not null default now()
);

-- 2) Séances : un passage chez le soignant, payé, puis envoyé et remboursé
--    Les étapes sont des dates : vide = pas encore fait.
create table if not exists public.seances_soins (
  id                     bigint generated always as identity primary key,
  dossier_id             bigint not null references public.dossiers_soins (id) on delete cascade,
  date_seance            date not null,
  montant_paye           numeric(8,2) not null check (montant_paye >= 0),
  mutuelle_deduite       boolean not null default false,   -- part mutuelle déjà retirée sur place
  envoye_mutuelle_le     date,
  rembourse_mutuelle_le  date,
  montant_mutuelle       numeric(8,2) check (montant_mutuelle >= 0),   -- facultatif
  envoye_dkv_le          date,
  rembourse_dkv_le       date,
  montant_dkv            numeric(8,2) check (montant_dkv >= 0),        -- facultatif
  cree_le                timestamptz not null default now(),
  modifie_le             timestamptz not null default now()
);
create index if not exists seances_soins_dossier_idx on public.seances_soins (dossier_id);

-- modifie_le mis à jour automatiquement (fonction créée dans 02_base.sql)
drop trigger if exists dossiers_soins_modifie_le on public.dossiers_soins;
create trigger dossiers_soins_modifie_le
  before update on public.dossiers_soins
  for each row execute function prive.maj_modifie_le();

drop trigger if exists seances_soins_modifie_le on public.seances_soins;
create trigger seances_soins_modifie_le
  before update on public.seances_soins
  for each row execute function prive.maj_modifie_le();


-- 3) Sécurité : RLS, accès réservé aux membres (comme le calendrier)
alter table public.dossiers_soins enable row level security;
alter table public.seances_soins  enable row level security;

drop policy if exists "dossiers_soins : tout pour les membres" on public.dossiers_soins;
create policy "dossiers_soins : tout pour les membres" on public.dossiers_soins
  for all to authenticated
  using ((select prive.est_membre()))
  with check ((select prive.est_membre()));

drop policy if exists "seances_soins : tout pour les membres" on public.seances_soins;
create policy "seances_soins : tout pour les membres" on public.seances_soins
  for all to authenticated
  using ((select prive.est_membre()))
  with check ((select prive.est_membre()));

-- Droits par l'API : on repart de zéro, puis le strict nécessaire, colonne par colonne
revoke all on public.dossiers_soins, public.seances_soins from anon, authenticated;
grant select, delete on public.dossiers_soins, public.seances_soins to authenticated;
grant insert (pour_qui, soin, seances_prevues, notes),
      update (pour_qui, soin, seances_prevues, notes)
  on public.dossiers_soins to authenticated;
grant insert (dossier_id, date_seance, montant_paye, mutuelle_deduite,
              envoye_mutuelle_le, rembourse_mutuelle_le, montant_mutuelle,
              envoye_dkv_le, rembourse_dkv_le, montant_dkv),
      update (date_seance, montant_paye, mutuelle_deduite,
              envoye_mutuelle_le, rembourse_mutuelle_le, montant_mutuelle,
              envoye_dkv_le, rembourse_dkv_le, montant_dkv)
  on public.seances_soins to authenticated;


-- 4) Temps réel : une modification sur un téléphone apparaît sur l'autre
do $$
declare
  nom_table text;
begin
  foreach nom_table in array array['dossiers_soins', 'seances_soins'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = nom_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', nom_table);
    end if;
  end loop;
end $$;


-- 5) Photos des documents : espace de stockage PRIVÉ « documents-soins »
--    Rangement : <id du dossier>/<nom du fichier>. 5 Mo max par fichier (l'appli compresse avant),
--    seulement des images ou des PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-soins', 'documents-soins', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lire / ajouter / supprimer : seulement les membres, et seulement dans le dossier d'un soin existant
drop policy if exists "documents-soins : lecture membres" on storage.objects;
create policy "documents-soins : lecture membres" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents-soins' and (select prive.est_membre()));

drop policy if exists "documents-soins : ajout membres" on storage.objects;
create policy "documents-soins : ajout membres" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents-soins'
    and (select prive.est_membre())
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and exists (
      select 1 from public.dossiers_soins d
      where d.id = ((storage.foldername(name))[1])::bigint
    )
  );

drop policy if exists "documents-soins : suppression membres" on storage.objects;
create policy "documents-soins : suppression membres" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents-soins' and (select prive.est_membre()));


-- 6) Vérification (seul résultat affiché dans le SQL Editor)
-- Attendu : true | 2 | false | false | true | false | 3
select
  (select bool_and(relrowsecurity) from pg_class
     where oid in ('public.dossiers_soins'::regclass, 'public.seances_soins'::regclass)) as rls_partout,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename in ('dossiers_soins', 'seances_soins')) as nb_regles,
  has_table_privilege('anon', 'public.seances_soins', 'select') as anon_voit_seances,
  has_column_privilege('authenticated', 'public.dossiers_soins', 'cree_par', 'update') as cree_par_modifiable,
  (select count(*) = 2 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('dossiers_soins', 'seances_soins')) as temps_reel,
  (select public from storage.buckets where id = 'documents-soins') as photos_publiques,
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'documents-soins%') as regles_photos;
