# 📅 Calendrier partagé

Une appli de calendrier pour nous deux : gratuite, sans pub, sur iPhone et Android.
C'est une appli web installable (PWA), hébergée sur GitHub Pages, avec les données dans Supabase.

## 📁 Organisation du dépôt

- `config.js` : l'adresse du projet Supabase et la clé publique (publishable). **Jamais** de clé secrète ici.
- `sql/` : tous les scripts SQL, numérotés, à lancer dans l'ordre. Chacun peut être relancé sans erreur.
- `JOURNAL.md` : les décisions prises, avec leurs raisons et leurs limites.

## 🛠️ Réglages faits à la main

**GitHub**
- Settings → Pages : source « Deploy from a branch », branche `main`, dossier `/ (root)`.

**Supabase**
- Integrations → Data API : Data API activée, schéma `public` exposé.
- « Automatically expose new tables » : encore activé, à désactiver à l'étape 2 (les accès sont donnés par `grant` dans les scripts).

## 🚀 Tout réinstaller depuis zéro

1. Créer un projet Supabase et faire les réglages ci-dessus.
2. Dans Supabase → SQL Editor, lancer les scripts de `sql/` dans l'ordre.
3. Mettre l'URL du projet et la clé publishable dans `config.js`.
4. Activer GitHub Pages comme ci-dessus.

## 💡 Bon à savoir

- Dans `config.js`, l'URL doit être l'adresse de base, `https://<id>.supabase.co`, **sans** `/rest/v1` (même si la page Data API de Supabase l'affiche avec). Sinon toutes les requêtes échouent avec l'erreur PGRST125.
- Après une modification sur GitHub, la mise en ligne prend une à deux minutes (onglet Actions), et l'ancienne version peut rester en cache quelques minutes. Pour être sûr de voir la nouvelle : Ctrl + Maj + R.
- Le SQL Editor de Supabase ignore la RLS (il tourne en administrateur) : les tests de sécurité se font depuis l'appli, avec un compte normal.
