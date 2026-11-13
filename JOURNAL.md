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

## Étape 3 : l'appli, fonctionnalités (13/11/2026) ✅

- **FullCalendar 7 plutôt que 6.** Raison : il gère le fuseau Europe/Brussels tout seul (sans extension). Alternative écartée : FullCalendar 6 + extension luxon. Limite : version récente, moins d'exemples sur internet, et un fichier lourd (~950 Ko).
- **Récurrences calculées en heure de Bruxelles** (départ donné sans fuseau). Testé avec `test/recurrence.html` sur iPhone et Android : 9h reste 9h après le changement d'heure ✅.
- **Pas d'outil de compilation, bibliothèques depuis jsDelivr avec versions figées et empreintes.** Raison : simple à publier depuis GitHub web. Limite : dépend de jsDelivr ; le hors connexion viendra avec la PWA (étape 4).
- **Thème clair/sombre qui suit le téléphone.** Les calendriers masqués et la dernière vue sont gardés sur chaque téléphone.
- **Tous les événements chargés d'un coup, par paquets de 1 000** (limite de l'API), et rechargés en entier à chaque changement en temps réel. Raison : simple et sûr à deux. Limite : avec des milliers d'événements, le chargement serait plus long.
- **Déconnexion de ce téléphone seulement** (l'autre reste connecté).
- **Création par appui long (+ glisser) ou bouton « + ».** Raison : sur iPhone, l'appui court se déclenchait dès que le doigt se posait et empêchait l'appui long. Limite : toucher une case vide ne fait rien (comme dans le Calendrier de l'iPhone).
- **Roue horaire maison, identique sur les deux téléphones, par pas de 5 minutes ; date avec le sélecteur du téléphone.** Limite : une heure comme 10h07 s'affiche arrondie à 10h05.
- **La fin suit le début en gardant la durée.**
- **Le clavier ne s'ouvre pas tout seul dans le formulaire**, mais il s'ouvre pour la recherche (astuce nécessaire sur iPhone).
- **Suppression en deux appuis** (« Supprimer » puis « Confirmer »).
- **Répétition : jamais, chaque jour, chaque semaine (un ou plusieurs jours), chaque mois (même date), chaque année ; pour toujours ou jusqu'à une date incluse.** Alternative écartée : « toutes les 2 semaines », « le 2e mardi du mois ». Limite : un événement le 31 saute les mois sans 31.
- **« Détacher cette date » ajouté en v1** (c'était la limite du cadrage) : la date est retirée de la série et devient un événement à part. Deux écritures ; si la deuxième échoue, la copie est supprimée pour éviter un doublon.
- **Glisser-déposer par appui long**, durée en tirant le bord du bas. Les événements récurrents sont bloqués avec un message, et on ne passe pas de « journée entière » à une heure en glissant.
- **Marque 🔁 dans le coin des événements récurrents.**
- **Recherche dans le téléphone** (titre, lieu, notes ; sans accents ni majuscules ; une ligne par série avec sa prochaine date). Raison : instantané, rien côté Supabase, marchera hors connexion.
- **Mode diagnostic `?debug`** gardé jusqu'aux tests finaux. Il a permis de régler l'appui long sur iPhone.

## Étape 3 : l'appli, apparence (13/11/2026) ✅

- **Style « C » choisi sur maquettes** : fond gris, blocs pastel pleins avec texte foncé, bande de la semaine en carte, grand titre du mois, boutons en pilules (« + » et recherche en haut). Clair/sombre suit le téléphone.
- **Vue jour en colonnes Emma | Mattia** (comme Cupla), avec la vue « ressources » de FullCalendar Premium. Raison : on voit d'un coup qui fait quoi. Alternative écartée : une seule colonne avec les couleurs. Limite : FullCalendar Premium est gratuit seulement si le projet est open source sous licence **AGPLv3** → fichier `LICENSE` dans le dépôt, et le code doit rester public.
- **Pas de colonne « Nous » : un événement Nous s'étale en bleu sur les deux colonnes, en un seul bloc.** Raison : plus lisible. Limite : si un événement Nous chevauche un autre événement, il reste affiché en deux morceaux (un par colonne).
- **Glisser un événement d'une colonne à l'autre change son calendrier** (Emma ↔ Mattia). Un événement Nous garde son calendrier.
- **Glisser le doigt à gauche/droite pour changer de jour, semaine ou mois.** Limite : dans Safari (pas l'appli installée), glisser depuis le bord gauche fait « page précédente ».
- **Vue mois : pincer/écarter pour passer en mois détaillé** (titres visibles), réglage aussi dans le menu.
- **Rebond et « retour arrière » du navigateur bloqués** (`overscroll-behavior: none`).
- **Numéro de version `?v=` sur les fichiers dans `index.html`.** Raison : sans ça, les téléphones gardaient l'ancien `style.css` ou `app.js` en mémoire et l'appli s'affichait cassée. Limite : il faut changer ce numéro à chaque mise à jour.

## Étape 4 : appli installable et hors connexion (13/11/2026)

- **Appli installable (PWA)** : `manifest.json` (nom « Nous deux », plein écran), icônes PNG (trois ronds pastel sur fond gris foncé), dont une version « masquable » pour les icônes rondes d'Android et une 180 px pour l'iPhone.
- **Service worker `sw.js`** : la page est toujours redemandée au serveur (copie seulement sans réseau ou après 4 s d'attente) ; les fichiers avec numéro `?v=` et les bibliothèques sont pris dans la copie. Raison : l'appli s'ouvre sans réseau et les mises à jour arrivent seules à l'ouverture suivante. Alternative écartée : un bandeau « Nouvelle version, toucher pour recharger ». Limite : la nouvelle version n'apparaît qu'à la 2e ouverture si le réseau est très lent.
- **Les données Supabase ne passent jamais par le service worker.** La copie hors ligne des événements est dans le stockage du téléphone (`localStorage`). Raison : simple, et les droits restent vérifiés par Supabase à chaque échange. Limite vie privée : une copie des événements reste sur le téléphone ; elle est effacée à la déconnexion.
- **Hors connexion : lecture seule** (bandeau, « + », glisser et « Enregistrer » bloqués), comme prévu au cadrage.
- **Sans réseau, l'appli s'ouvre tout de suite avec la copie.** Raison : supabase-js réessaie pendant plusieurs secondes (jusqu'à ~30 s pour renouveler une session expirée) avant d'abandonner : sans ça, écran vide. Limite : sur un wifi sans internet, l'appli attend 3 s avant de prendre la copie.
- **Rotation de l'écran** : la fusion des blocs « Nous » est refaite après chaque changement de taille (l'option `windowResize` n'existe plus dans FullCalendar 7).

## Idées pour la v2 💡

- **Voir nos événements dans le Calendrier Apple** : un lien d'abonnement `.ics` secret, fabriqué par une Edge Function Supabase (gratuit). Limite : sens unique (lecture seule dans Apple), mise à jour avec du retard, et quiconque a le lien voit les événements.
- **Widget** : impossible pour une appli web (ni iPhone ni Android) ; avec l'abonnement `.ics`, le widget du Calendrier Apple afficherait nos événements. Alternative écartée : appli native (compte développeur Apple payant).
