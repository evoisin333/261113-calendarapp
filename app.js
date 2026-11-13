// app.js — Calendrier partagé
// 3a : connexion, affichage (jour / semaine / mois), filtres, temps réel.
// 3b : formulaire (créer, modifier, supprimer), roue horaire.
// 3c : récurrences (répétition, supprimer ou détacher une seule date).
// 3d : recherche (titre, lieu, notes ; sans accents ni majuscules).
// 3e : glisser-déposer (déplacer, changer la durée).
// 3f : apparence (style C : pilules, bande semaine, menu calendriers, mois sans cases, zoom du mois).

const FUSEAU = "Europe/Brussels";
// Vue jour : une colonne par calendrier (vue « ressources » de FullCalendar Premium, licence AGPLv3)
const VUE_JOUR = "resourceTimeGridDay";
// Le calendrier « Nous » n'a pas de colonne : ses événements remplissent les colonnes Emma et Mattia
const ID_NOUS = 3;   // fixé par sql/02_base.sql
const client = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseCle);

const ecranConnexion = document.getElementById("ecran-connexion");
const ecranAppli = document.getElementById("ecran-appli");
const erreurConnexion = document.getElementById("erreur-connexion");
const erreurAppli = document.getElementById("erreur-appli");
const etatSynchro = document.getElementById("etat-synchro");

let appliDemarree = false;
let utilisateurId = null;     // identifiant de la personne connectée
let calendrierParDefaut = 3;  // son calendrier (sinon « Nous »)
let calendrier = null;        // l'objet FullCalendar
let calendriers = [];         // lignes de la table calendriers
let lignesEvenements = [];    // lignes de la table evenements
let canalTempsReel = null;
let calendriersMasques = new Set(lireReglage("calendriersMasques", []));
let prenomConnecte = "";
let moisDetaille = lireReglage("moisDetaille", false);   // vue mois zoomée (titres et heures)


// ---------- Réglages gardés sur ce téléphone (vue, calendriers masqués) ----------

function lireReglage(cle, parDefaut) {
  try {
    const valeur = localStorage.getItem(cle);
    return valeur === null ? parDefaut : JSON.parse(valeur);
  } catch {
    return parDefaut;
  }
}

function ecrireReglage(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // stockage indisponible : tant pis, le réglage ne sera pas gardé
  }
}


// ---------- Thème clair / sombre : suit le réglage du téléphone ----------

const themeSombre = window.matchMedia("(prefers-color-scheme: dark)");
function appliquerTheme() {
  document.documentElement.dataset.colorScheme = themeSombre.matches ? "dark" : "light";
}
appliquerTheme();
themeSombre.addEventListener("change", appliquerTheme);


// ---------- Dates : conversion base -> FullCalendar (validée par test/recurrence.html) ----------

// Instant UTC -> "2027-03-02T09:00:00" à l'heure de Bruxelles (sans fuseau)
function heureBruxelles(instant) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(new Date(instant)).replace(" ", "T");
}

// Une ligne de la table evenements -> un événement FullCalendar
function versFullCalendar(ligne) {
  const couleur = calendriers.find((c) => c.id === ligne.calendrier_id)?.couleur;
  const evenement = {
    id: String(ligne.id),
    title: ligne.titre,
    color: couleur,
    contrastColor: "#1f2937",   // texte foncé sur les couleurs pastel
    // sa colonne en vue jour (« Nous » : les deux colonnes)
    resourceIds: ligne.calendrier_id === ID_NOUS
      ? calendriers.filter((c) => c.id !== ID_NOUS).map((c) => String(c.id))
      : [String(ligne.calendrier_id)],
  };

  if (!ligne.regle_recurrence) {
    evenement.allDay = ligne.journee_entiere;
    evenement.start = ligne.journee_entiere ? ligne.date_debut : ligne.debut;
    evenement.end = ligne.journee_entiere ? ligne.date_fin : ligne.fin;
    return evenement;
  }

  if (ligne.journee_entiere) {
    const jours = (new Date(ligne.date_fin) - new Date(ligne.date_debut)) / 86400000;
    evenement.rrule = `DTSTART:${ligne.date_debut.replaceAll("-", "")}\nRRULE:${ligne.regle_recurrence}`;
    evenement.duration = { days: jours };
    evenement.exdate = ligne.dates_supprimees;
  } else {
    // Départ en heure de Bruxelles sans fuseau : 9h reste 9h après le changement d'heure
    const debutLocal = heureBruxelles(ligne.debut);
    const heureLocale = debutLocal.slice(11);
    evenement.rrule = `DTSTART:${debutLocal.replace(/[-:]/g, "")}\nRRULE:${ligne.regle_recurrence}`;
    evenement.duration = { milliseconds: new Date(ligne.fin) - new Date(ligne.debut) };
    evenement.exdate = ligne.dates_supprimees.map((date) => `${date}T${heureLocale}`);
  }
  return evenement;
}

// Heure de Bruxelles -> instant UTC. Ex. ("2027-03-02", "09:00") -> "2027-03-02T08:00:00.000Z"
// On part de « 9h00 UTC », on regarde l'heure affichée à Bruxelles à cet instant,
// et on corrige de l'écart. Deux passes pour tomber juste les jours de changement d'heure.
function versUtc(date, heure) {
  const [annee, mois, jour] = date.split("-").map(Number);
  const [h, min] = heure.split(":").map(Number);
  const cible = Date.UTC(annee, mois - 1, jour, h, min);
  let instant = cible;
  for (let passe = 0; passe < 2; passe++) {
    const afficheABruxelles = Date.parse(heureBruxelles(instant) + "Z");
    instant -= afficheABruxelles - cible;
  }
  return new Date(instant).toISOString();
}

// "2027-03-14" + 1 jour -> "2027-03-15"
function ajouterJours(date, jours) {
  const [annee, mois, jour] = date.split("-").map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + jours)).toISOString().slice(0, 10);
}

// Les événements à afficher (sans les calendriers masqués)
function evenementsAffiches() {
  return lignesEvenements
    .filter((ligne) => !calendriersMasques.has(ligne.calendrier_id))
    .map(versFullCalendar);
}


// ---------- Erreurs ----------

function afficherErreur(action, erreur) {
  console.error(action, erreur);
  erreurAppli.textContent = `${action} : ${erreur.message ?? erreur}`;
}


// ---------- Connexion ----------

document.getElementById("formulaire-connexion").addEventListener("submit", async (evenement) => {
  evenement.preventDefault();
  erreurConnexion.textContent = "";
  const bouton = document.getElementById("bouton-connexion");
  bouton.disabled = true;
  const { error } = await client.auth.signInWithPassword({
    email: document.getElementById("champ-email").value.trim(),
    password: document.getElementById("champ-mot-de-passe").value,
  });
  bouton.disabled = false;
  if (error) {
    erreurConnexion.textContent = error.message === "Invalid login credentials"
      ? "E-mail ou mot de passe incorrect."
      : `Connexion impossible : ${error.message}`;
  }
  // Si c'est bon, onAuthStateChange (plus bas) démarre l'appli
});

// "local" : déconnecte seulement ce téléphone, pas l'autre
document.getElementById("bouton-deconnexion").addEventListener("click", () => {
  client.auth.signOut({ scope: "local" });
});

// Appelé au lancement (session gardée ou non), à la connexion et à la déconnexion.
// setTimeout : la doc Supabase déconseille d'appeler Supabase directement dans ce rappel.
client.auth.onAuthStateChange((_evenement, session) => {
  utilisateurId = session?.user?.id ?? null;
  setTimeout(() => {
    if (session && !appliDemarree) demarrerAppli();
    if (!session) afficherConnexion();
  }, 0);
});

function afficherConnexion() {
  arreterAppli();
  ecranAppli.hidden = true;
  ecranConnexion.hidden = false;
}


// ---------- L'appli ----------

async function demarrerAppli() {
  appliDemarree = true;
  ecranConnexion.hidden = true;
  ecranAppli.hidden = false;
  erreurAppli.textContent = "";

  const { data, error } = await client.from("calendriers").select("id, nom, couleur").order("id");
  if (error) return afficherErreur("Chargement des calendriers", error);
  calendriers = data;
  if (calendriers.length === 0) {
    erreurAppli.textContent = "Ce compte n'a accès à aucun calendrier.";
  }

  // Calendrier proposé par défaut : celui qui porte le prénom de la personne connectée
  const { data: moi } = await client.from("membres").select("prenom").eq("user_id", utilisateurId);
  prenomConnecte = moi?.[0]?.prenom ?? "";
  calendrierParDefaut = calendriers.find((c) => c.nom === prenomConnecte)?.id ?? 3;

  document.getElementById("bouton-ajouter").hidden = calendriers.length === 0;
  creerCalendrier();
  await chargerEvenements();
  ecouterTempsReel();
}

function arreterAppli() {
  appliDemarree = false;
  if (canalTempsReel) client.removeChannel(canalTempsReel);
  canalTempsReel = null;
  if (calendrier) calendrier.destroy();
  calendrier = null;
  calendriers = [];
  lignesEvenements = [];
}

// Heure de départ de l'affichage en vue jour/semaine : 1 h avant maintenant
function heureDeDepart() {
  const heure = Math.max(0, Number(heureBruxelles(Date.now()).slice(11, 13)) - 1);
  return `${String(heure).padStart(2, "0")}:00:00`;
}

function creerCalendrier() {
  calendrier = new FullCalendar.Calendar(document.getElementById("calendrier"), {
    timeZone: FUSEAU,
    locale: "fr",
    firstDay: 1,                                     // lundi
    initialView: lireReglage("vue", VUE_JOUR).replace(/^timeGridDay$/, VUE_JOUR),
    // FullCalendar Premium : gratuit pour les projets open source sous licence AGPLv3 (voir LICENSE)
    schedulerLicenseKey: "AGPL-My-Frontend-And-Backend-Are-Open-Source",
    // Colonnes de la vue jour : Emma et Mattia (si affichés). Pas de colonne « Nous ».
    resources: (_info, succes) => succes(calendriers
      .filter((c) => c.id !== ID_NOUS && !calendriersMasques.has(c.id))
      .map((c) => ({ id: String(c.id), title: c.nom, extendedProps: { couleur: c.couleur } }))),
    resourceOrder: "id",
    resourceDayHeaderClass: "entete-colonne",
    resourceDayHeaderContent: (info) => {
      const nom = document.createElement("span");
      nom.className = "nom-colonne";
      nom.style.setProperty("--couleur", info.resource.extendedProps.couleur);
      nom.textContent = info.resource.title;
      return { domNodes: [nom] };
    },
    headerToolbar: false,                            // nos propres pilules en haut et en bas
    footerToolbar: false,
    height: "100%",
    nowIndicator: true,
    scrollTime: heureDeDepart(),
    allDayText: "Journée",
    // Jour et semaine : la bande semaine remplace l'en-tête des colonnes
    views: {
      resourceTimeGridDay: { datesAboveResources: false },
      timeGridWeek: { dayHeaders: false, displayEventTime: false },   // colonnes étroites : le titre seul
      // eventDisplay "block" : tous les événements en étiquettes pleines (pas de point + heure)
      dayGridMonth: { dayHeaderFormat: { weekday: "narrow" }, fixedWeekCount: false, showNonCurrentDates: false,
                      displayEventTime: false },
    },
    dayMaxEvents: moisDetaille ? false : 3,          // vue mois compacte : « +2 » si trop d'événements
    // Nos propres noms de classes, pour le style (voir style.css)
    eventDisplay: "block",                           // étiquettes pleines partout (pas de point + heure)
    eventClass: "evenement",
    columnEventTitleClass: "titre-evt",
    columnEventTimeClass: "heure-evt",
    moreLinkClass: "lien-plus",
    rowEventClass: "evenement-mois",
    dayCellClass: (info) => ["mois-case", info.isToday && "aujourdhui", info.isOther && "autre-mois",
                             (info.dow === 0 || info.dow === 6) && "week-end"].filter(Boolean).join(" "),
    dayCellTopClass: "mois-numero",
    dayHeaderClass: "mois-entete",
    slotHeaderClass: "heure-libelle",
    // Vue mois détaillée : titre (2 lignes) et heure dessous
    eventContent: (info) => {
      if (!moisDetaille || info.view.type !== "dayGridMonth") return true;   // true = affichage normal
      const bloc = document.createElement("div");
      bloc.className = "detail-mois";
      bloc.append(Object.assign(document.createElement("span"), { className: "titre", textContent: info.event.title }));
      if (!info.event.allDay) {
        const heure = heureBruxelles(info.event.start).slice(11, 16);   // ex. "18:30"
        bloc.append(Object.assign(document.createElement("span"), { className: "heure", textContent: heure }));
      }
      return { domNodes: [bloc] };
    },
    events: (_periode, succes) => succes(evenementsAffiches()),
    datesSet: (info) => {
      ecrireReglage("vue", info.view.type);
      majEntete();
      requestAnimationFrame(fusionnerNous);
    },
    eventsSet: (evenements) => {
      majLigneJournee(evenements);
      requestAnimationFrame(fusionnerNous);
    },
    windowResize: () => requestAnimationFrame(fusionnerNous),
    // Création : appui long (puis glisser pour allonger), le formulaire s'ouvre au lâcher.
    // Pas d'« appui court » (dateClick) : sur iPhone il se déclenche dès que le doigt se pose
    // et empêche l'appui long. Comme dans le Calendrier de l'iPhone, toucher une case ne fait rien.
    selectable: true,
    selectMirror: true,            // la plage choisie s'affiche comme un événement, avec ses heures
    selectLongPressDelay: 400,     // durée de l'appui long sur téléphone (ms)
    select: (info) => {
      calendrier.unselect();
      const debut = heureBruxelles(info.start);
      // Appui long sans glisser = une seule case de 30 min : on propose 1 h
      const finChoisie = info.end - info.start <= 1800000 && !info.allDay
        ? info.start.getTime() + 3600000 : info.end;
      const fin = heureBruxelles(finChoisie);
      ouvrirFormulaire(null, {
        calendrierId: info.resource ? Number(info.resource.id) : null,   // colonne de la vue jour
        date: debut.slice(0, 10), heure: debut.slice(11, 16), journeeEntiere: info.allDay,
        // journée entière : la fin de FullCalendar est exclusive, le formulaire montre le dernier jour
        dateFin: info.allDay ? ajouterJours(fin.slice(0, 10), -1) : fin.slice(0, 10),
        heureFin: fin.slice(11, 16),
      });
    },
    // Glisser-déposer : appui long sur un événement, puis glisser (ou tirer son bord du bas)
    editable: true,
    eventLongPressDelay: 400,
    // Interdit : glisser un événement récurrent, ou passer de « journée entière » à une heure
    eventAllow: (cible, evenement) =>
      !ligneDe(evenement)?.regle_recurrence && cible.allDay === evenement.allDay,
    eventDragStart: (info) => prevenirSiRecurrent(info.event),
    eventResizeStart: (info) => prevenirSiRecurrent(info.event),
    eventDrop: enregistrerDeplacement,
    eventResize: enregistrerDeplacement,
    // Appui sur un événement : on l'ouvre pour le modifier
    eventClick: (info) => {
      const ligne = ligneDe(info.event);
      // Pour une série, on retient la date touchée (date locale de cette occurrence)
      const dateTouchee = heureBruxelles(info.event.start).slice(0, 10);
      if (ligne) ouvrirFormulaire(ligne, null, ligne.regle_recurrence ? dateTouchee : null);
    },
    // Petite marque 🔁 dans le coin des événements récurrents
    eventDidMount: (info) => {
      info.el.dataset.idEvenement = info.event.id;   // pour fusionnerNous()
      // (pas en vue mois : les étiquettes sont trop petites)
      if (!ligneDe(info.event)?.regle_recurrence || info.view.type === "dayGridMonth") return;
      info.el.style.position = "relative";
      info.el.append(Object.assign(document.createElement("span"),
        { className: "marque-serie", textContent: "🔁" }));
    },
  });
  calendrier.render();
  brancherDebugCalendrier();
  majEntete();
}

// Recharge tous les événements (par paquets de 1000, la limite de l'API)
async function chargerEvenements() {
  const TAILLE_PAQUET = 1000;
  let toutes = [];
  for (let depart = 0; ; depart += TAILLE_PAQUET) {
    const { data, error } = await client
      .from("evenements")
      .select("*")
      .order("id")
      .range(depart, depart + TAILLE_PAQUET - 1);
    if (error) return afficherErreur("Chargement des événements", error);
    toutes = toutes.concat(data);
    if (data.length < TAILLE_PAQUET) break;
  }
  lignesEvenements = toutes;
  if (calendrier) calendrier.refetchEvents();
}

// Temps réel : à chaque changement, on recharge tout (simple et sûr, validé à l'étape 1)
function ecouterTempsReel() {
  canalTempsReel = client
    .channel("evenements")
    .on("postgres_changes", { event: "*", schema: "public", table: "evenements" }, chargerEvenements)
    .subscribe((statut) => {
      const connecte = statut === "SUBSCRIBED";
      etatSynchro.className = connecte ? "ok" : "probleme";
      etatSynchro.title = connecte ? "Synchronisé" : `Synchronisation : ${statut}`;
      if (connecte) chargerEvenements();   // rattrape ce qui a été raté pendant une coupure
    });
}

// Retour sur l'appli (le téléphone la met en pause en arrière-plan) : on recharge
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && appliDemarree) chargerEvenements();
});


// ---------- Roue horaire (heures + minutes par pas de 5) ----------

const HAUTEUR_LIGNE = 32;   // doit correspondre à .roue div dans style.css
const HEURES = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

// Construit une colonne qui défile ; à l'arrêt, appelle quandChange
function creerColonne(valeurs, quandChange) {
  const colonne = document.createElement("div");
  colonne.className = "roue";
  colonne.append(Object.assign(document.createElement("div"), { className: "espace" }));
  for (const valeur of valeurs) {
    colonne.append(Object.assign(document.createElement("div"), { textContent: valeur }));
  }
  colonne.append(Object.assign(document.createElement("div"), { className: "espace" }));
  let minuteur;
  colonne.addEventListener("scroll", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(quandChange, 150);   // attend la fin du défilement
  });
  colonne.valeurs = valeurs;
  return colonne;
}

function lireColonne(colonne) {
  const index = Math.round(colonne.scrollTop / HAUTEUR_LIGNE);
  return colonne.valeurs[Math.min(Math.max(index, 0), colonne.valeurs.length - 1)];
}

function reglerColonne(colonne, valeur) {
  colonne.scrollTop = Math.max(colonne.valeurs.indexOf(valeur), 0) * HAUTEUR_LIGNE;
}

function creerRoue(conteneur, quandChange) {
  const heures = creerColonne(HEURES, quandChange);
  const minutes = creerColonne(MINUTES, quandChange);
  conteneur.append(heures, minutes);
  return {
    lire: () => `${lireColonne(heures)}:${lireColonne(minutes)}`,
    regler: (heure) => {   // "09:07" -> roue sur 09:05 (minutes arrondies à 5)
      const [h, m] = heure.split(":").map(Number);
      const arrondi = Math.min(Math.round(m / 5) * 5, 55);
      reglerColonne(heures, String(h).padStart(2, "0"));
      reglerColonne(minutes, String(arrondi).padStart(2, "0"));
    },
  };
}


// ---------- Formulaire d'un événement ----------

const fenetre = document.getElementById("fenetre-evenement");
const champTitre = document.getElementById("champ-titre");
const champJournee = document.getElementById("champ-journee");
const champDateDebut = document.getElementById("champ-date-debut");
const champDateFin = document.getElementById("champ-date-fin");
const champLieu = document.getElementById("champ-lieu");
const champNotes = document.getElementById("champ-notes");
const erreurFormulaire = document.getElementById("erreur-formulaire");
const boutonSupprimer = document.getElementById("bouton-supprimer");
const boutonEnregistrer = document.getElementById("bouton-enregistrer");

const roueDebut = creerRoue(document.getElementById("roue-debut"), quandDebutChange);
const roueFin = creerRoue(document.getElementById("roue-fin"), quandFinChange);

let ligneEnCours = null;   // null = création, sinon la ligne modifiée
let dureeMs = 3600000;     // durée gardée quand on déplace le début (heure fixe)
let dureeJours = 0;        // idem en journée entière (0 = un seul jour)

function instantDebut() { return Date.parse(versUtc(champDateDebut.value, roueDebut.lire())); }
function instantFin() { return Date.parse(versUtc(champDateFin.value, roueFin.lire())); }
function joursEntre(date1, date2) { return (Date.parse(date2) - Date.parse(date1)) / 86400000; }

// Le début bouge : la fin suit, avec la même durée (14h05 -> 15h05 si l'événement dure 1 h)
function quandDebutChange() {
  if (!champDateDebut.value) return;
  if (champJournee.checked) {
    champDateFin.value = ajouterJours(champDateDebut.value, dureeJours);
    return;
  }
  const fin = heureBruxelles(instantDebut() + dureeMs);
  champDateFin.value = fin.slice(0, 10);
  roueFin.regler(fin.slice(11, 16));
}

// La fin bouge : on retient la nouvelle durée (si elle a un sens)
function quandFinChange() {
  if (!champDateDebut.value || !champDateFin.value) return;
  if (champJournee.checked) {
    const jours = joursEntre(champDateDebut.value, champDateFin.value);
    if (jours >= 0) dureeJours = jours;
    return;
  }
  const duree = instantFin() - instantDebut();
  if (duree > 0) dureeMs = duree;
}
champDateDebut.addEventListener("change", quandDebutChange);
champDateFin.addEventListener("change", quandFinChange);

champJournee.addEventListener("change", () => {
  fenetre.classList.toggle("journee-entiere", champJournee.checked);
});

// Pastilles de choix du calendrier
function afficherChoixCalendrier(idChoisi) {
  const zone = document.getElementById("choix-calendrier");
  zone.innerHTML = "";
  for (const cal of calendriers) {
    const label = document.createElement("label");
    label.style.setProperty("--couleur", cal.couleur);
    const radio = Object.assign(document.createElement("input"),
      { type: "radio", name: "calendrier", value: cal.id, checked: cal.id === idChoisi });
    label.append(radio, cal.nom);
    zone.append(label);
  }
}

// ligne = événement existant, ou null pour en créer un (avec depart = { date, heure, journeeEntiere })
// occurrence = date touchée dans une série ("2026-11-17"), sinon null
function ouvrirFormulaire(ligne, depart = null, occurrence = null) {
  if (calendriers.length === 0) return;
  ligneEnCours = ligne;
  occurrenceEnCours = occurrence;
  afficherBlocOccurrence();
  erreurFormulaire.textContent = "";
  boutonSupprimer.hidden = !ligne;
  boutonSupprimer.classList.remove("confirmer");
  boutonSupprimer.textContent = ligne?.regle_recurrence ? "Supprimer la série" : "Supprimer";
  document.getElementById("titre-fenetre").textContent = ligne ? "Modifier" : "Nouvel événement";
  document.getElementById("note-serie").hidden = !ligne?.regle_recurrence;

  let dateDebut, heureDebut, dateFin, heureFin, journeeEntiere;
  if (ligne && ligne.journee_entiere) {
    journeeEntiere = true;
    dateDebut = ligne.date_debut;
    dateFin = ajouterJours(ligne.date_fin, -1);       // fin exclusive en base, inclusive à l'écran
    heureDebut = "09:00"; heureFin = "10:00";
  } else if (ligne) {
    journeeEntiere = false;
    const debutLocal = heureBruxelles(ligne.debut);
    const finLocale = heureBruxelles(ligne.fin);
    [dateDebut, heureDebut] = [debutLocal.slice(0, 10), debutLocal.slice(11, 16)];
    [dateFin, heureFin] = [finLocale.slice(0, 10), finLocale.slice(11, 16)];
  } else {
    journeeEntiere = depart.journeeEntiere;
    dateDebut = depart.date;
    heureDebut = journeeEntiere ? "09:00" : depart.heure;
    if (depart.dateFin && !journeeEntiere) {
      [dateFin, heureFin] = [depart.dateFin, depart.heureFin];      // plage choisie au doigt
    } else {
      const uneHeurePlusTard = heureBruxelles(Date.parse(versUtc(dateDebut, heureDebut)) + 3600000);
      dateFin = journeeEntiere ? (depart.dateFin ?? dateDebut) : uneHeurePlusTard.slice(0, 10);
      heureFin = uneHeurePlusTard.slice(11, 16);
    }
  }
  dureeJours = Math.max(joursEntre(dateDebut, dateFin), 0);
  const dureeDepart = Date.parse(versUtc(dateFin, heureFin)) - Date.parse(versUtc(dateDebut, heureDebut));
  dureeMs = dureeDepart > 0 ? dureeDepart : 3600000;

  champTitre.value = ligne?.titre ?? "";
  champLieu.value = ligne?.lieu ?? "";
  champNotes.value = ligne?.notes ?? "";
  champJournee.checked = journeeEntiere;
  fenetre.classList.toggle("journee-entiere", journeeEntiere);
  champDateDebut.value = dateDebut;
  champDateFin.value = dateFin;
  afficherChoixCalendrier(ligne?.calendrier_id ?? depart?.calendrierId ?? calendrierParDefaut);
  remplirRepetition(ligne?.regle_recurrence ?? null, dateDebut);

  fenetre.showModal();
  // Les roues ne peuvent être positionnées qu'une fois la fenêtre affichée
  roueDebut.regler(heureDebut);
  roueFin.regler(heureFin);
}

// Bouton « + » : prochaine heure pleine, aujourd'hui
document.getElementById("bouton-ajouter").addEventListener("click", () => {
  const dansUneHeure = heureBruxelles(Date.now() + 3600000);
  ouvrirFormulaire(null, { date: dansUneHeure.slice(0, 10),
                           heure: `${dansUneHeure.slice(11, 13)}:00`, journeeEntiere: false });
});

document.getElementById("bouton-annuler").addEventListener("click", () => fenetre.close());

// Ce que le formulaire va écrire dans la base (ou un message d'erreur)
function lireFormulaire() {
  const titre = champTitre.value.trim();
  if (!titre) return { erreur: "Il faut un titre." };
  if (!champDateDebut.value || !champDateFin.value) return { erreur: "Il faut une date de début et de fin." };

  const donnees = {
    titre,
    lieu: champLieu.value.trim() || null,
    notes: champNotes.value.trim() || null,
    calendrier_id: Number(document.querySelector('input[name="calendrier"]:checked').value),
    journee_entiere: champJournee.checked,
    debut: null, fin: null, date_debut: null, date_fin: null,
  };
  if (champJournee.checked) {
    if (champDateFin.value < champDateDebut.value) return { erreur: "La fin est avant le début." };
    donnees.date_debut = champDateDebut.value;
    donnees.date_fin = ajouterJours(champDateFin.value, 1);   // fin exclusive en base
  } else {
    donnees.debut = versUtc(champDateDebut.value, roueDebut.lire());
    donnees.fin = versUtc(champDateFin.value, roueFin.lire());
    if (donnees.fin <= donnees.debut) return { erreur: "La fin doit être après le début." };
  }
  const { regle, erreur } = lireRepetition();
  if (erreur) return { erreur };
  donnees.regle_recurrence = regle;
  if (!regle) donnees.dates_supprimees = [];   // plus de série = plus de dates supprimées
  return { donnees };
}

boutonEnregistrer.addEventListener("click", async () => {
  const { donnees, erreur } = lireFormulaire();
  if (erreur) { erreurFormulaire.textContent = erreur; return; }

  boutonEnregistrer.disabled = true;
  const requete = ligneEnCours
    ? client.from("evenements").update(donnees).eq("id", ligneEnCours.id)
    : client.from("evenements").insert(donnees);
  const { error } = await requete;
  boutonEnregistrer.disabled = false;

  if (error) { erreurFormulaire.textContent = `Enregistrement impossible : ${error.message}`; return; }
  fenetre.close();
  chargerEvenements();   // sans attendre le temps réel
});

// Suppression en deux appuis : « Supprimer » puis « Confirmer la suppression »
boutonSupprimer.addEventListener("click", async () => {
  if (!boutonSupprimer.classList.contains("confirmer")) {
    boutonSupprimer.classList.add("confirmer");
    boutonSupprimer.textContent = ligneEnCours.regle_recurrence
      ? "Confirmer (toute la série)" : "Confirmer la suppression";
    return;
  }
  const { error } = await client.from("evenements").delete().eq("id", ligneEnCours.id);
  if (error) { erreurFormulaire.textContent = `Suppression impossible : ${error.message}`; return; }
  fenetre.close();
  chargerEvenements();
});

// Touche Entrée dans un champ : on enregistre au lieu de fermer la fenêtre
document.getElementById("formulaire-evenement").addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  boutonEnregistrer.click();
});


// ---------- Glisser-déposer ----------

// La ligne de la base qui correspond à un événement affiché
function ligneDe(evenement) {
  return lignesEvenements.find((l) => String(l.id) === evenement.id);
}

// Message temporaire en haut de l'écran
let minuteurMessage;
function afficherMessage(texte) {
  const zone = document.getElementById("message");
  zone.textContent = texte;
  zone.hidden = false;
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => { zone.hidden = true; }, 4000);
}

function prevenirSiRecurrent(evenement) {
  if (ligneDe(evenement)?.regle_recurrence) {
    afficherMessage("🔁 Événement récurrent : on ne peut pas le déplacer en le glissant. Touche-le pour le modifier.");
  }
}

// Après un déplacement ou un changement de durée : on enregistre la nouvelle position
async function enregistrerDeplacement(info) {
  const ligne = ligneDe(info.event);
  if (!ligne || ligne.regle_recurrence) { info.revert(); return; }

  const { start, end, allDay } = info.event;
  let donnees;
  if (allDay) {
    const dateDebut = heureBruxelles(start).slice(0, 10);
    // fin exclusive, comme en base ; absente = un seul jour
    const dateFin = end ? heureBruxelles(end).slice(0, 10) : ajouterJours(dateDebut, 1);
    donnees = { date_debut: dateDebut, date_fin: dateFin };
  } else {
    const dureeAvant = Date.parse(ligne.fin) - Date.parse(ligne.debut);
    donnees = {
      debut: start.toISOString(),
      fin: (end ?? new Date(start.getTime() + dureeAvant)).toISOString(),
    };
  }

  // Autre colonne = autre calendrier (Emma <-> Mattia). Un événement « Nous » reste « Nous ».
  if (info.newResource && ligne.calendrier_id !== ID_NOUS) donnees.calendrier_id = Number(info.newResource.id);

  const { error } = await client.from("evenements").update(donnees).eq("id", ligne.id);
  if (error) {
    info.revert();   // l'événement revient à sa place
    afficherMessage(`Déplacement impossible : ${error.message}`);
    return;
  }
  chargerEvenements();
}


// ---------- Mode diagnostic : ajouter ?debug à l'adresse pour voir les gestes à l'écran ----------

const modeDebug = new URLSearchParams(location.search).has("debug");
if (modeDebug) {
  const panneau = document.createElement("pre");
  panneau.id = "journal-debug";
  document.body.append(panneau);
  const lignesJournal = [];
  let debutGeste = 0;
  let nbMouvements = 0;
  let aDefile = false;
  window.noterDebug = (texte) => {
    lignesJournal.push(`${Math.round(performance.now() - debutGeste)}ms ${texte}`);
    panneau.textContent = lignesJournal.slice(-16).join("\n");
  };
  const nomCible = (cible) => String(cible.className || cible.tagName || "?").slice(0, 22);
  document.addEventListener("touchstart", (e) => {
    debutGeste = performance.now(); nbMouvements = 0; aDefile = false;
    noterDebug(`--- touchstart sur ${nomCible(e.target)}`);
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", () => { nbMouvements++; }, { capture: true, passive: true });
  for (const type of ["touchend", "touchcancel", "pointercancel", "contextmenu", "selectstart"]) {
    document.addEventListener(type, (e) => noterDebug(`${type} (mouvements: ${nbMouvements})`),
      { capture: true, passive: true });
  }
  document.addEventListener("scroll", () => {
    if (!aDefile) { aDefile = true; noterDebug("la page défile"); }
  }, { capture: true, passive: true });
}

// Rappels FullCalendar notés dans le journal
function brancherDebugCalendrier() {
  if (!modeDebug) return;
  for (const nom of ["eventDragStart", "eventDragStop", "eventDrop", "eventResizeStart",
                     "eventClick", "select", "unselect"]) {
    calendrier.on(nom, () => noterDebug(`FullCalendar : ${nom}`));
  }
}


// ---------- Répétition (récurrences) ----------

const champRepetition = document.getElementById("champ-repetition");
const zoneJours = document.getElementById("jours-semaine");
const ligneFinRepetition = document.getElementById("ligne-fin-repetition");
const champFinRepetition = document.getElementById("champ-fin-repetition");
const champDateFinRepetition = document.getElementById("champ-date-fin-repetition");
const boutonSupprimerDate = document.getElementById("bouton-supprimer-date");
const boutonDetacher = document.getElementById("bouton-detacher");
const JOURS = [["MO", "L"], ["TU", "M"], ["WE", "M"], ["TH", "J"], ["FR", "V"], ["SA", "S"], ["SU", "D"]];
let occurrenceEnCours = null;   // date touchée dans une série, ex. "2026-11-17"

// "2026-11-17" -> "TU" (code iCalendar du jour de la semaine)
function codeJour(date) {
  const [annee, mois, jour] = date.split("-").map(Number);
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay()];
}

// Pastilles L M M J V S D (appui = coché / décoché)
for (const [code, lettre] of JOURS) {
  const bouton = Object.assign(document.createElement("button"), { type: "button", textContent: lettre });
  bouton.dataset.jour = code;
  bouton.setAttribute("aria-pressed", "false");
  bouton.addEventListener("click", () => {
    bouton.setAttribute("aria-pressed", String(bouton.getAttribute("aria-pressed") !== "true"));
  });
  zoneJours.append(bouton);
}
function joursCoches() {
  return [...zoneJours.children].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.jour);
}
function cocherJours(codes) {
  for (const bouton of zoneJours.children) bouton.setAttribute("aria-pressed", String(codes.includes(bouton.dataset.jour)));
}

// Montre seulement ce qui sert pour la répétition choisie
function majAffichageRepetition() {
  const frequence = champRepetition.value;
  zoneJours.hidden = frequence !== "WEEKLY";
  ligneFinRepetition.hidden = !frequence;
  champDateFinRepetition.hidden = champFinRepetition.value !== "date";
  if (frequence === "WEEKLY" && joursCoches().length === 0) cocherJours([codeJour(champDateDebut.value)]);
}
champRepetition.addEventListener("change", majAffichageRepetition);
champFinRepetition.addEventListener("change", () => {
  if (champFinRepetition.value === "date" && !champDateFinRepetition.value) {
    champDateFinRepetition.value = champDateDebut.value;
  }
  majAffichageRepetition();
});

// Règle de la base -> formulaire. Ex. "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20271231T235959"
// (une règle écrite à la main avec d'autres options, ex. INTERVAL, perdrait ces options à l'enregistrement)
function remplirRepetition(regle, dateDebut) {
  const parties = Object.fromEntries((regle ?? "").split(";").filter(Boolean).map((p) => p.split("=")));
  champRepetition.value = parties.FREQ ?? "";
  cocherJours(parties.BYDAY ? parties.BYDAY.split(",") : [codeJour(dateDebut)]);
  const jusqua = parties.UNTIL
    ? `${parties.UNTIL.slice(0, 4)}-${parties.UNTIL.slice(4, 6)}-${parties.UNTIL.slice(6, 8)}` : "";
  champFinRepetition.value = jusqua ? "date" : "";
  champDateFinRepetition.value = jusqua;
  majAffichageRepetition();
}

// Formulaire -> règle pour la base (null = pas de répétition)
function lireRepetition() {
  const frequence = champRepetition.value;
  if (!frequence) return { regle: null };
  let regle = `FREQ=${frequence}`;
  if (frequence === "WEEKLY") {
    const jours = joursCoches();
    if (jours.length === 0) return { erreur: "Choisis au moins un jour de la semaine." };
    regle += `;BYDAY=${jours.join(",")}`;
  }
  if (champFinRepetition.value === "date") {
    const jusqua = champDateFinRepetition.value;
    if (!jusqua) return { erreur: "Choisis la date de fin de la répétition." };
    if (jusqua < champDateDebut.value) return { erreur: "La répétition se termine avant le début." };
    // jour de fin inclus : jusqu'à 23:59:59 heure de Bruxelles (ou la date seule en journée entière)
    const date = jusqua.replaceAll("-", "");
    regle += champJournee.checked ? `;UNTIL=${date}` : `;UNTIL=${date}T235959`;
  }
  return { regle };
}


// ---------- Une seule date d'une série : supprimer ou détacher ----------

// Premier appui : le bouton demande confirmation ; deuxième appui : renvoie true
function confirmer(bouton, texteConfirmation) {
  if (bouton.classList.contains("confirmer")) return true;
  bouton.classList.add("confirmer");
  bouton.textContent = texteConfirmation;
  return false;
}

function afficherBlocOccurrence() {
  const bloc = document.getElementById("bloc-occurrence");
  bloc.hidden = !occurrenceEnCours;
  if (!occurrenceEnCours) return;
  const [annee, mois, jour] = occurrenceEnCours.split("-").map(Number);
  const dateLisible = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(annee, mois - 1, jour)));
  document.getElementById("texte-occurrence").textContent = `📅 Date touchée : ${dateLisible}`;
  boutonSupprimerDate.classList.remove("confirmer");
  boutonSupprimerDate.textContent = "Supprimer cette date";
  boutonDetacher.disabled = false;
}

// Ajoute une date aux dates supprimées de la série
function avecDateSupprimee(serie, date) {
  return [...new Set([...(serie.dates_supprimees ?? []), date])].sort();
}

boutonSupprimerDate.addEventListener("click", async () => {
  if (!confirmer(boutonSupprimerDate, "Confirmer : seulement cette date")) return;
  const { error } = await client.from("evenements")
    .update({ dates_supprimees: avecDateSupprimee(ligneEnCours, occurrenceEnCours) })
    .eq("id", ligneEnCours.id);
  if (error) { erreurFormulaire.textContent = `Suppression impossible : ${error.message}`; return; }
  fenetre.close();
  chargerEvenements();
});

// Détacher : la date est retirée de la série et devient un événement à part, prêt à modifier
boutonDetacher.addEventListener("click", async () => {
  const serie = ligneEnCours;
  const date = occurrenceEnCours;
  const copie = {
    titre: serie.titre, lieu: serie.lieu, notes: serie.notes,
    calendrier_id: serie.calendrier_id, journee_entiere: serie.journee_entiere,
    debut: null, fin: null, date_debut: null, date_fin: null, regle_recurrence: null,
  };
  if (serie.journee_entiere) {
    copie.date_debut = date;
    copie.date_fin = ajouterJours(date, joursEntre(serie.date_debut, serie.date_fin));
  } else {
    copie.debut = versUtc(date, heureBruxelles(serie.debut).slice(11, 16));
    const duree = Date.parse(serie.fin) - Date.parse(serie.debut);
    copie.fin = new Date(Date.parse(copie.debut) + duree).toISOString();
  }

  boutonDetacher.disabled = true;
  // 1) créer l'événement à part
  const { data: nouvelle, error } = await client.from("evenements").insert(copie).select().single();
  if (error) {
    boutonDetacher.disabled = false;
    erreurFormulaire.textContent = `Détachement impossible : ${error.message}`;
    return;
  }
  // 2) retirer la date de la série ; si ça échoue, on supprime la copie pour ne pas avoir de doublon
  const { error: erreurSerie } = await client.from("evenements")
    .update({ dates_supprimees: avecDateSupprimee(serie, date) }).eq("id", serie.id);
  if (erreurSerie) {
    await client.from("evenements").delete().eq("id", nouvelle.id);
    boutonDetacher.disabled = false;
    erreurFormulaire.textContent = `Détachement impossible : ${erreurSerie.message}`;
    return;
  }
  fenetre.close();
  await chargerEvenements();
  ouvrirFormulaire(nouvelle);
  afficherMessage("✂️ Date détachée : c'est maintenant un événement à part.");
});


// ---------- Recherche ----------

const fenetreRecherche = document.getElementById("fenetre-recherche");
const champRecherche = document.getElementById("champ-recherche");
const zoneResultats = document.getElementById("resultats-recherche");
const NOMS_REPETITION = { DAILY: "chaque jour", WEEKLY: "chaque semaine", MONTHLY: "chaque mois", YEARLY: "chaque année" };

// "Réveillon de Noël" -> "reveillon de noel" (sans accents ni majuscules)
function normaliser(texte) {
  return (texte ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Date « flottante » : les chiffres UTC de l'objet Date = l'heure de Bruxelles (c'est ce qu'utilise rrule)
function flottante(texteLocal) { return new Date(Date.parse(texteLocal + "Z")); }
function texteLocal(dateFlottante) { return dateFlottante.toISOString().slice(0, 19); }

// Date de référence d'un événement pour la recherche : prochaine occurrence, sinon la dernière passée
// Renvoie { debut: "2026-11-17T09:00:00", aVenir: true/false }
function dateReperes(ligne) {
  const maintenant = heureBruxelles(Date.now());
  const debutLocal = ligne.journee_entiere ? `${ligne.date_debut}T00:00:00` : heureBruxelles(ligne.debut);
  const finLocale = ligne.journee_entiere ? `${ligne.date_fin}T00:00:00` : heureBruxelles(ligne.fin);

  if (!ligne.regle_recurrence) return { debut: debutLocal, aVenir: finLocale > maintenant };

  // Série : on rejoue la règle en heure de Bruxelles, sans les dates supprimées
  const depart = ligne.journee_entiere ? ligne.date_debut.replaceAll("-", "") : debutLocal.replace(/[-:]/g, "");
  const serie = rrule.rrulestr(`DTSTART:${depart}\nRRULE:${ligne.regle_recurrence}`, { forceset: true });
  for (const date of ligne.dates_supprimees) serie.exdate(flottante(`${date}T${debutLocal.slice(11)}`));
  // une occurrence en cours compte comme « à venir »
  const duree = flottante(finLocale) - flottante(debutLocal);
  const prochaine = serie.after(new Date(flottante(maintenant) - duree), false);
  if (prochaine) return { debut: texteLocal(prochaine), aVenir: true };
  const derniere = serie.before(flottante(maintenant), true);
  return { debut: derniere ? texteLocal(derniere) : debutLocal, aVenir: false };
}

function dateLisible(texte, journeeEntiere) {
  const jour = new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(flottante(texte));
  return journeeEntiere ? `${jour} · journée` : `${jour} · ${texte.slice(11, 16)}`;
}

function afficherResultats() {
  const recherche = normaliser(champRecherche.value.trim());
  zoneResultats.innerHTML = "";
  if (!recherche) {
    zoneResultats.append(Object.assign(document.createElement("p"), { className: "vide", textContent: "Tape un mot du titre, du lieu ou des notes." }));
    return;
  }
  const trouves = lignesEvenements
    .filter((l) => normaliser(`${l.titre} ${l.lieu ?? ""} ${l.notes ?? ""}`).includes(recherche))
    .map((ligne) => ({ ligne, ...dateReperes(ligne) }));
  const aVenir = trouves.filter((r) => r.aVenir).sort((a, b) => a.debut.localeCompare(b.debut));
  const passes = trouves.filter((r) => !r.aVenir).sort((a, b) => b.debut.localeCompare(a.debut));

  if (trouves.length === 0) {
    zoneResultats.append(Object.assign(document.createElement("p"), { className: "vide", textContent: "Aucun résultat." }));
    return;
  }
  for (const [titre, liste] of [["À venir", aVenir], ["Passés", passes]]) {
    if (liste.length === 0) continue;
    zoneResultats.append(Object.assign(document.createElement("h3"), { textContent: titre }));
    for (const { ligne, debut, aVenir: futur } of liste) {
      const resultat = creerResultat(ligne, debut);
      resultat.classList.toggle("passe", !futur);
      zoneResultats.append(resultat);
    }
  }
}

function creerResultat(ligne, debut) {
  const bouton = Object.assign(document.createElement("button"), { type: "button", className: "resultat" });
  const pastille = Object.assign(document.createElement("span"), { className: "pastille" });
  pastille.style.background = calendriers.find((c) => c.id === ligne.calendrier_id)?.couleur ?? "#999";
  const texte = document.createElement("span");
  const details = [dateLisible(debut, ligne.journee_entiere)];
  const frequence = ligne.regle_recurrence?.match(/FREQ=(\w+)/)?.[1];
  if (frequence) details.push(`🔁 ${NOMS_REPETITION[frequence]}`);
  if (ligne.lieu) details.push(ligne.lieu);
  texte.append(ligne.titre,
    Object.assign(document.createElement("span"), { className: "details", textContent: details.join(" · ") }));
  bouton.append(pastille, texte);
  // Toucher un résultat : on va à ce jour, en vue jour, à l'heure de l'événement
  bouton.addEventListener("click", () => {
    fenetreRecherche.close();
    calendrier.changeView(VUE_JOUR, debut.slice(0, 10));
    if (!ligne.journee_entiere) calendrier.scrollToTime(`${String(Math.max(Number(debut.slice(11, 13)) - 1, 0)).padStart(2, "0")}:00:00`);
  });
  return bouton;
}

document.getElementById("bouton-recherche").addEventListener("click", () => {
  champRecherche.value = "";
  afficherResultats();
  // Ici le clavier est voulu. Mais iPhone ne l'ouvre que si un champ VISIBLE reçoit le focus
  // pendant le toucher lui-même. Astuce : un champ invisible prend le focus tout de suite
  // (le clavier s'ouvre), puis on passe le focus au vrai champ une fois la fenêtre affichée.
  const leurre = document.createElement("input");
  leurre.style.cssText = "position:fixed; top:0; left:0; width:1px; height:1px; opacity:0; font-size:16px;";
  document.body.append(leurre);
  leurre.focus();
  fenetreRecherche.showModal();
  champRecherche.focus();
  leurre.remove();
});
document.getElementById("bouton-fermer-recherche").addEventListener("click", () => fenetreRecherche.close());
champRecherche.addEventListener("input", afficherResultats);



// ---------- En-tête : titre, bande semaine, boutons (style C) ----------

const titrePeriode = document.getElementById("titre-periode");
const bandeSemaine = document.getElementById("bande-semaine");
const NOMS_MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
                   "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const LETTRES_JOURS = ["L", "M", "M", "J", "V", "S", "D"];

// Met à jour le titre, la bande semaine et le bouton de vue actif
function majEntete() {
  if (!calendrier) return;
  const vue = calendrier.view.type;
  const dateAffichee = heureBruxelles(calendrier.getDate()).slice(0, 10);   // "2026-11-13"
  const aujourdhui = heureBruxelles(Date.now()).slice(0, 10);

  // Titre : le mois, et l'année seulement si ce n'est pas l'année en cours
  const [annee, mois] = dateAffichee.split("-").map(Number);
  titrePeriode.textContent = NOMS_MOIS[mois - 1];
  if (String(annee) !== aujourdhui.slice(0, 4)) {
    titrePeriode.append(" ", Object.assign(document.createElement("span"), { className: "annee", textContent: annee }));
  }

  // Bande semaine (jour et semaine) : du lundi au dimanche autour de la date affichée
  bandeSemaine.hidden = vue === "dayGridMonth";
  bandeSemaine.classList.toggle("vue-semaine", vue === "timeGridWeek");
  bandeSemaine.innerHTML = "";
  const lundi = ajouterJours(dateAffichee, -((new Date(dateAffichee + "T00:00:00Z").getUTCDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const date = ajouterJours(lundi, i);
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.setAttribute("aria-label", date);
    if (i >= 5) bouton.classList.add("week-end");
    if (date === aujourdhui) bouton.classList.add("aujourdhui");
    if (vue === VUE_JOUR && date === dateAffichee) bouton.classList.add("choisi");
    bouton.append(Object.assign(document.createElement("span"), { className: "lettre", textContent: LETTRES_JOURS[i] }),
                  Object.assign(document.createElement("span"), { className: "num", textContent: Number(date.slice(8)) }));
    // Toucher un jour : vue jour sur ce jour
    bouton.addEventListener("click", () => calendrier.changeView(VUE_JOUR, date));
    bandeSemaine.append(bouton);
  }

  // Bouton de vue actif
  for (const bouton of document.querySelectorAll(".choix-vue button")) {
    bouton.setAttribute("aria-pressed", String(bouton.dataset.vue === vue));
  }
}

document.getElementById("bouton-precedent").addEventListener("click", () => calendrier?.prev());
document.getElementById("bouton-suivant").addEventListener("click", () => calendrier?.next());
document.getElementById("bouton-aujourdhui").addEventListener("click", () => {
  calendrier?.today();
  calendrier?.scrollToTime(heureDeDepart());
});
for (const bouton of document.querySelectorAll(".choix-vue button")) {
  bouton.addEventListener("click", () => calendrier?.changeView(bouton.dataset.vue));
}

// Ligne « Journée » des vues jour et semaine : seulement s'il y a un événement journée entière
function majLigneJournee(evenements) {
  if (!calendrier || calendrier.view.type === "dayGridMonth") return;
  const { activeStart, activeEnd } = calendrier.view;
  const ilYEnA = evenements.some((ev) => ev.allDay && ev.start < activeEnd && (ev.end ?? ev.start) >= activeStart);
  if (calendrier.getOption("allDaySlot") !== ilYEnA) calendrier.setOption("allDaySlot", ilYEnA);
}


// ---------- Menu : calendriers affichés, mois détaillé, compte ----------

const fenetreMenu = document.getElementById("fenetre-menu");
const champMoisDetaille = document.getElementById("champ-mois-detaille");

function afficherMenuCalendriers() {
  const zone = document.getElementById("liste-calendriers");
  zone.innerHTML = "";
  for (const cal of calendriers) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "ligne-groupe ligne-calendrier";
    bouton.style.setProperty("--couleur", cal.couleur);
    const affiche = !calendriersMasques.has(cal.id);
    bouton.setAttribute("aria-pressed", String(affiche));
    bouton.append(Object.assign(document.createElement("span"), { className: "rond", textContent: affiche ? "✓" : "" }), cal.nom);
    if (!affiche) bouton.append(Object.assign(document.createElement("span"), { className: "discret", textContent: "masqué", style: "margin-left:auto;font-size:13px" }));
    bouton.style.justifyContent = "flex-start";
    bouton.addEventListener("click", () => {
      if (calendriersMasques.has(cal.id)) calendriersMasques.delete(cal.id);
      else calendriersMasques.add(cal.id);
      changerCalendriersMasques();
    });
    zone.append(bouton);
  }
}

function changerCalendriersMasques() {
  ecrireReglage("calendriersMasques", [...calendriersMasques]);
  afficherMenuCalendriers();
  calendrier?.refetchResources();
  calendrier?.refetchEvents();
}

document.getElementById("bouton-menu").addEventListener("click", () => {
  afficherMenuCalendriers();
  champMoisDetaille.checked = moisDetaille;
  document.getElementById("prenom-connecte").textContent = prenomConnecte;
  fenetreMenu.showModal();
});
document.getElementById("bouton-fermer-menu").addEventListener("click", () => fenetreMenu.close());
document.getElementById("bouton-tout-afficher").addEventListener("click", () => {
  calendriersMasques.clear();
  changerCalendriersMasques();
});
champMoisDetaille.addEventListener("change", () => changerMoisDetaille(champMoisDetaille.checked));
document.getElementById("bouton-deconnexion").addEventListener("click", () => fenetreMenu.close());


// ---------- Vue mois : compacte ou détaillée (zoom à deux doigts) ----------

function changerMoisDetaille(detaille) {
  if (detaille === moisDetaille) return;
  moisDetaille = detaille;
  ecrireReglage("moisDetaille", detaille);
  if (!calendrier) return;
  calendrier.setOption("dayMaxEvents", detaille ? false : 3);
  calendrier.render();   // redessine les événements avec le nouveau contenu
}

// Écarter deux doigts : vue détaillée ; les pincer : vue compacte (seulement en vue mois)
const zoneCalendrier = document.getElementById("calendrier");
let ecartDepart = null;
function ecartDoigts(evenement) {
  const [a, b] = evenement.touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
zoneCalendrier.addEventListener("touchstart", (evenement) => {
  ecartDepart = evenement.touches.length === 2 ? ecartDoigts(evenement) : null;
}, { passive: true });
zoneCalendrier.addEventListener("touchmove", (evenement) => {
  if (ecartDepart === null || evenement.touches.length !== 2 || calendrier?.view.type !== "dayGridMonth") return;
  const rapport = ecartDoigts(evenement) / ecartDepart;
  if (rapport > 1.25) { changerMoisDetaille(true); ecartDepart = null; }
  if (rapport < 0.8) { changerMoisDetaille(false); ecartDepart = null; }
}, { passive: true });
// Safari : empêche le zoom de toute la page quand on écarte deux doigts sur le calendrier
zoneCalendrier.addEventListener("gesturestart", (evenement) => evenement.preventDefault());



// ---------- Glisser le doigt à gauche / à droite : jour, semaine ou mois suivant / précédent ----------

let departGlisse = null;
function debutGlisse(evenement) {
  departGlisse = evenement.touches.length === 1
    ? { x: evenement.touches[0].clientX, y: evenement.touches[0].clientY, t: Date.now() } : null;
}
function finGlisse(evenement) {
  if (!departGlisse || !calendrier) return;
  const doigt = evenement.changedTouches[0];
  const dx = doigt.clientX - departGlisse.x;
  const dy = doigt.clientY - departGlisse.y;
  const duree = Date.now() - departGlisse.t;
  departGlisse = null;
  // Un geste rapide (pas un appui long, qui sert à créer ou déplacer), surtout horizontal
  if (duree < 400 && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
    if (dx < 0) calendrier.next(); else calendrier.prev();
  }
}
for (const zone of [zoneCalendrier, bandeSemaine]) {
  zone.addEventListener("touchstart", debutGlisse, { passive: true });
  zone.addEventListener("touchend", finGlisse, { passive: true });
}



// ---------- Vue jour : un événement « Nous » = un seul bloc sur les deux colonnes ----------
// FullCalendar l'affiche deux fois (une copie par colonne). Quand les deux copies ont toute la
// largeur de leur colonne (aucun autre événement en même temps), on étire une copie sur les deux
// colonnes et on cache l'autre. Sinon, on garde les deux copies (chacune dans sa colonne).
// On ne touche jamais aux positions calculées par FullCalendar : seulement à des réglages
// qu'on peut défaire (marge, largeur, visibilité), notés dans data-* pour les remettre.

function remettreCopie(support) {
  if (support.dataset.margeOrigine !== undefined) {
    support.style.marginInlineStart = support.dataset.margeOrigine;
    delete support.dataset.margeOrigine;
  }
  if (support.dataset.largeurOrigine !== undefined) {
    support.style.width = support.dataset.largeurOrigine;
    delete support.dataset.largeurOrigine;
  }
  support.style.visibility = "";
}

function fusionnerNous() {
  if (!calendrier) return;
  const copies = {};
  for (const el of zoneCalendrier.querySelectorAll("[data-id-evenement]")) {
    const support = el.parentElement;               // l'élément positionné par FullCalendar
    remettreCopie(support);
    if (calendrier.view.type !== VUE_JOUR) continue;
    const ligne = lignesEvenements.find((l) => String(l.id) === el.dataset.idEvenement);
    if (ligne?.calendrier_id !== ID_NOUS) continue;
    const cle = `${el.dataset.idEvenement}|${support.style.top}`;
    (copies[cle] ??= []).push(support);
  }
  for (const paire of Object.values(copies)) {
    if (paire.length !== 2) continue;
    paire.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const [gauche, droite] = paire;
    const ecart = droite.getBoundingClientRect().left - gauche.getBoundingClientRect().left;

    if (gauche.style.width === "100%" && droite.style.width === "100%") {
      // Ligne « Journée » : la copie de gauche s'élargit sur les deux colonnes
      gauche.dataset.largeurOrigine = gauche.style.width;
      gauche.style.width = `calc(100% + ${ecart}px)`;
      droite.style.visibility = "hidden";
    } else if (gauche.style.insetInline === "0%" && droite.style.insetInline === "0%") {
      // Grille des heures : la copie de droite s'étire vers la gauche (elle passe ainsi
      // par-dessus la colonne de gauche et son trait de séparation)
      droite.dataset.margeOrigine = droite.style.marginInlineStart;
      droite.style.marginInlineStart = `${-ecart}px`;
      gauche.style.visibility = "hidden";
    }
  }
}
