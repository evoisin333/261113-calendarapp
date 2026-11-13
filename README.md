# 📅 Calendrier partagé

Une appli de calendrier pour nous deux : gratuite, sans pub, sur iPhone et Android.
C'est une appli web installable (PWA), hébergée sur GitHub Pages, avec les données dans Supabase.

## 📁 Organisation du dépôt

- `index.html`, `app.js`, `style.css` : l'appli (pas d'outil de compilation, les fichiers sont publiés tels quels).
- `config.js` : l'adresse du projet Supabase et la clé publique (publishable). **Jamais** de clé secrète ici.
- `sql/` : tous les scripts SQL, numérotés, à lancer dans l'ordre. Chacun peut être relancé sans erreur.
- `test/recurrence.html` : page de contrôle des récurrences et du changement d'heure (7 lignes vertes attendues).
- `JOURNAL.md` : les décisions prises, avec leurs raisons et leurs limites.

## 📚 Bibliothèques (versions figées, chargées depuis jsDelivr avec empreinte `integrity`)

- supabase-js 2.119.0
- FullCalendar 7.1.5 (+ thème classic, langue fr, extension rrule 7.1.5)
- FullCalendar Scheduler 7.1.5 (Premium, pour la vue jour en colonnes) : utilisé sous licence AGPLv3
- rrule 2.8.1

Pour changer de version : changer le numéro **et** l'empreinte dans `index.html`, puis relancer `test/recurrence.html` sur les deux téléphones.

## ⚖️ Licence

- Le projet est sous licence **GNU AGPLv3** (fichier `LICENSE`). C'est la condition pour utiliser gratuitement FullCalendar Premium (vue jour avec une colonne par calendrier), avec la clé `AGPL-My-Frontend-And-Backend-Are-Open-Source` dans `app.js`.
- Usage perso, non commercial. Si l'appli devenait commerciale, il faudrait une licence payante FullCalendar.

## 🛠️ Réglages faits à la main

**GitHub**
- Settings → Pages : source « Deploy from a branch », branche `main`, dossier `/ (root)`.

**Supabase**
- Integrations → Data API : Data API activée, schéma `public` exposé.
- Integrations → Data API : « Automatically expose new tables » **désactivé** (les accès sont donnés par `grant` dans les scripts).
- Authentication → Users → Add user → Create new user : 3 comptes créés à la main (Emma, Mattia, compte de test), avec « Auto Confirm User » coché.
- Authentication → Sign In / Providers : « Allow new users to sign up » **désactivé** (inscriptions fermées).

## 🚀 Tout réinstaller depuis zéro

1. Créer un projet Supabase et faire les réglages ci-dessus.
2. Dans Supabase → SQL Editor, lancer les scripts de `sql/` dans l'ordre. Avant `03_membres.sql`, y remplacer les identifiants par ceux des nouveaux comptes.
3. Mettre l'URL du projet et la clé publishable dans `config.js`.
4. Activer GitHub Pages comme ci-dessus.

## 💡 Bon à savoir

- Dans `config.js`, l'URL doit être l'adresse de base, `https://<id>.supabase.co`, **sans** `/rest/v1` (même si la page Data API de Supabase l'affiche avec). Sinon toutes les requêtes échouent avec l'erreur PGRST125.
- Après une modification sur GitHub, la mise en ligne prend une à deux minutes (onglet Actions), et l'ancienne version peut rester en cache quelques minutes. Pour être sûr de voir la nouvelle : Ctrl + Maj + R.
- Le SQL Editor de Supabase ignore la RLS (il tourne en administrateur) : les tests de sécurité se font depuis l'appli, avec un compte normal.
- **À chaque mise à jour de `app.js`, `style.css` ou `config.js` : changer le numéro `?v=…` dans `index.html`** (aux 3 endroits). Sinon le téléphone peut garder l'ancien fichier en mémoire et mélanger les versions (écran vide).
- Après une mise à jour sur GitHub, si un téléphone montre encore l'ancienne version : fermer l'onglet (ou l'appli) et la rouvrir.
- Mode diagnostic : ajouter `?debug` à l'adresse affiche en bas de l'écran le journal des gestes du doigt. À retirer avant la version finale.

## 👆 Utilisation

- Changer de jour, de semaine ou de mois : **glisser le doigt** vers la gauche ou la droite (ou les flèches ‹ ›).
- Vue jour : une colonne par calendrier. Glisser un événement dans une autre colonne change son calendrier.
- Vue mois : écarter deux doigts pour voir titres et heures (ou « Mois détaillé » dans le menu).
- Créer : **appui long** sur une heure (glisser pour allonger), ou le bouton **+**.
- Modifier : **appui court** sur un événement.
- Déplacer : **appui long** sur un événement puis glisser ; tirer le bord du bas pour la durée. Les événements récurrents ne se déplacent pas en glissant (passer par le formulaire).
- Une seule date d'une série : la toucher, puis « Supprimer cette date » ou « Détacher cette date ».
- Rechercher : la loupe 🔍 (titre, lieu, notes ; sans accents ni majuscules).
- Masquer un calendrier, se déconnecter : le menu (icône à gauche de la loupe).
