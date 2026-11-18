-- 07_anniversaires.sql
-- Un 4e calendrier « Anniversaires » (jaune pastel), commun à nous deux.
-- Rejouable sans erreur. À lancer dans Supabase → SQL Editor (après 02).
-- Rien d'autre à changer : mêmes règles de sécurité que les autres calendriers (02_base.sql).

insert into public.calendriers (id, nom, couleur) values
  (4, 'Anniversaires', '#F7E3A1')   -- jaune pastel
on conflict (id) do update set nom = excluded.nom, couleur = excluded.couleur;

-- Vérification. Attendu : 4 lignes, la dernière « 4 | Anniversaires | #F7E3A1 »
select id, nom, couleur from public.calendriers order by id;
