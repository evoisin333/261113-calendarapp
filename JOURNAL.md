# 📝 Journal des décisions

Pour chaque choix : la raison, l'alternative écartée et la limite que ça induit.

## Cadrage

- **PWA plutôt qu'une appli native.** Raison : c'est gratuit, avec un seul code pour iPhone et Android. Alternative écartée : Flutter ou React Native publiés sur les stores. Limite : l'App Store est payant, et sur iPhone les notifications ne marchent que si l'appli est installée sur l'écran d'accueil.
- **Supabase pour la base de données.** Raison : SQL, comptes et temps réel inclus dans l'offre gratuite. Alternative écartée : Firebase (pas du SQL). Limite : on dépend d'un service tiers, et le projet se met en pause s'il reste inutilisé (durée à vérifier dans la doc officielle).
- **GitHub Pages pour l'hébergement.** Raison : gratuit et utilisable depuis l'interface web. Alternative écartée : Netlify. Limite : le dépôt est public, donc le code est visible.
- **FullCalendar et rrule pour le calendrier.** Raison : les vues jour, semaine et mois, le glisser-déposer et les récurrences sont déjà prêts. Alternative écartée : tout coder à la main. Limite : dépendance externe, et le comportement au changement d'heure est à tester.
- **Tout le monde modifie tout, pas d'événements privés.** Raison : simplicité. Alternative écartée : des droits par calendrier. Limite : aucune confidentialité entre vous deux.
- **Récurrences : une modification change toute la série, mais on peut supprimer une seule date.** Raison : simplicité. Alternative écartée : modifier « cette occurrence seulement ». Limite : pour changer une seule date, il faut la supprimer puis créer un événement séparé.
- **Hors connexion en lecture seule.** Raison : simplicité. Alternative écartée : écrire hors ligne et synchroniser plus tard. Limite : pas de modification sans réseau.

## Étape 1 : tests préalables (13/11/2026) ✅

- **Synchro en temps réel validée** entre l'iPhone (Safari) et l'Android (Chrome), y compris après un passage en arrière-plan.
- **Temps réel : à chaque changement, on recharge toute la liste**, et on la recharge aussi quand on revient sur la page. Raison : c'est simple, et ça rattrape ce qui a été raté quand le téléphone a coupé la connexion en arrière-plan. Alternative écartée : appliquer chaque changement un par un. Limite : un peu plus de données échangées à chaque modification (sans importance à deux).
- **supabase-js figé en version 2.119.0, avec une empreinte (`integrity`).** Raison : la même version partout, et le navigateur refuse le fichier s'il a été modifié sur le CDN. Alternative écartée : `supabase-js@2` (« la dernière 2.x »). Limite : pour mettre à jour, il faut changer à la main le numéro de version et l'empreinte.
- **Accès aux tables donnés par `grant` dans les scripts SQL.** Raison : les nouveaux projets Supabase n'ouvrent plus les tables automatiquement, et on garde la main sur ce qui est exposé. Alternative écartée : laisser « Automatically expose new tables » activé. Limite : chaque nouvelle table a besoin de sa ligne `grant`.
- **Dans `config.js`, l'URL Supabase est l'adresse de base** (`https://<id>.supabase.co`), sans `/rest/v1`. Avec `/rest/v1`, toutes les requêtes échouent (erreur PGRST125).
- **Table de test `test_synchro` ouverte à tous, puis supprimée** à la fin de l'étape. Raison : tester vite, sans comptes. Limite : n'importe qui avec la clé publique pouvait écrire dedans pendant le test.

## Étape 2 : base de données (13/11/2026) ✅

- **Accès réservé à une liste de membres** (table `membres`, vérifiée par la RLS sur chaque table). Raison : seuls nous deux voyons et modifions, même si un autre compte existait. Alternative écartée : faire confiance à « tout compte connecté ». Limite : un nouveau compte doit être ajouté dans `03_membres.sql` pour voir quelque chose.
- **Membres identifiés par leur identifiant Supabase, pas par leur e-mail.** Raison : le dépôt est public, nos e-mails n'ont rien à y faire. Limite : si le projet est recréé, il faut mettre les nouveaux identifiants dans `03_membres.sql`.
- **Comptes créés à la main, inscriptions fermées.** Raison : personne d'autre ne peut se créer un compte. Limite : pas de changement de mot de passe depuis l'appli en v1.
- **Connexion e-mail + mot de passe, une seule fois.** Raison : en offre gratuite, une session Supabase dure jusqu'à la déconnexion. Alternative écartée : lien magique par e-mail (il s'ouvre dans Safari, pas dans l'appli installée). Limite : sur iPhone, rester connecté suppose d'utiliser l'appli installée sur l'écran d'accueil (Safari efface les données d'un site après 7 jours sans visite).
- **3 calendriers fixes** : Emma (rose pastel), Mattia (vert pastel), Nous (bleu pastel). Un événement appartient à un seul calendrier. Limite : pas d'ajout de calendrier depuis l'appli.
- **Dates : heure fixe en UTC (`timestamptz`), journée entière en simples dates (`date`, fin exclusive).** Raison : une journée entière n'a pas d'heure, donc pas de décalage possible d'un jour à cause du fuseau. Alternative écartée : tout en `timestamptz`. Limite : deux façons de stocker, la contrainte `dates_coherentes` empêche de les mélanger.
- **Récurrence : une règle iCalendar (`FREQ=WEEKLY;BYDAY=TU`…) et une liste de dates supprimées (dates locales).** Raison : format standard, lu directement par FullCalendar. Limite : le calcul des occurrences se fait dans l'appli, en heure de Bruxelles ; le comportement au changement d'heure est à tester à l'étape 3.
- **Champs d'un événement : titre (obligatoire), lieu et notes (facultatifs).** Pas de notifications en v1.
- **Droits d'écriture colonne par colonne** : `cree_par`, `cree_le` et `modifie_le` sont remplis par la base, jamais par l'appli. Raison : impossible de falsifier qui a créé un événement.
- **Test de sécurité dans le SQL Editor** (`04_test_securite.sql`), en se faisant passer pour chaque compte. Résultat : nous deux voyons tout, le 3e compte et un visiteur non connecté ne voient rien et ne peuvent rien écrire ✅. Le compte de test est gardé pour les tests finaux.
