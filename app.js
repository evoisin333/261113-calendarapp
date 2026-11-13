// app.js — Calendrier partagé
// 3a : connexion, affichage (jour / semaine / mois), filtres, temps réel.
// 3b : formulaire (créer, modifier, supprimer), roue horaire.

const FUSEAU = "Europe/Brussels";
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
  calendrierParDefaut = calendriers.find((c) => c.nom === moi?.[0]?.prenom)?.id ?? 3;

  document.getElementById("bouton-ajouter").hidden = calendriers.length === 0;
  afficherFiltres();
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
    initialView: lireReglage("vue", "timeGridDay"),
    headerToolbar: { left: "prev,next", right: "title" },
    footerToolbar: { left: "today", right: "timeGridDay,timeGridWeek,dayGridMonth" },
    height: "100%",
    nowIndicator: true,
    scrollTime: heureDeDepart(),
    dayMaxEvents: true,                              // vue mois : "+2" si trop d'événements
    events: (_periode, succes) => succes(evenementsAffiches()),
    datesSet: (info) => ecrireReglage("vue", info.view.type),
    // Appui sur une case vide : nouvel événement à cette heure (ou ce jour en vue mois)
    dateClick: (info) => {
      const local = heureBruxelles(info.date);
      ouvrirFormulaire(null, { date: local.slice(0, 10), heure: local.slice(11, 16),
                               journeeEntiere: info.allDay });
    },
    // Appui long puis glisser : on choisit une plage, le formulaire s'ouvre au lâcher
    selectable: true,
    selectMirror: true,            // la plage choisie s'affiche comme un événement, avec ses heures
    selectLongPressDelay: 400,     // durée de l'appui long sur téléphone (ms)
    select: (info) => {
      calendrier.unselect();
      const debut = heureBruxelles(info.start);
      const fin = heureBruxelles(info.end);
      ouvrirFormulaire(null, {
        date: debut.slice(0, 10), heure: debut.slice(11, 16), journeeEntiere: info.allDay,
        // journée entière : la fin de FullCalendar est exclusive, le formulaire montre le dernier jour
        dateFin: info.allDay ? ajouterJours(fin.slice(0, 10), -1) : fin.slice(0, 10),
        heureFin: fin.slice(11, 16),
      });
    },
    // Appui sur un événement : on l'ouvre pour le modifier
    eventClick: (info) => {
      const ligne = lignesEvenements.find((l) => String(l.id) === info.event.id);
      if (ligne) ouvrirFormulaire(ligne);
    },
  });
  calendrier.render();
}

// Un bouton par calendrier pour l'afficher ou le masquer
function afficherFiltres() {
  const zone = document.getElementById("filtres");
  zone.innerHTML = "";
  for (const cal of calendriers) {
    const bouton = document.createElement("button");
    bouton.className = "filtre";
    bouton.textContent = cal.nom;
    bouton.style.setProperty("--couleur", cal.couleur);
    bouton.setAttribute("aria-pressed", String(!calendriersMasques.has(cal.id)));
    bouton.addEventListener("click", () => {
      if (calendriersMasques.has(cal.id)) calendriersMasques.delete(cal.id);
      else calendriersMasques.add(cal.id);
      ecrireReglage("calendriersMasques", [...calendriersMasques]);
      afficherFiltres();
      calendrier.refetchEvents();
    });
    zone.append(bouton);
  }
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
function ouvrirFormulaire(ligne, depart = null) {
  if (calendriers.length === 0) return;
  ligneEnCours = ligne;
  erreurFormulaire.textContent = "";
  boutonSupprimer.hidden = !ligne;
  boutonSupprimer.classList.remove("confirmer");
  boutonSupprimer.textContent = "Supprimer";
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
  afficherChoixCalendrier(ligne?.calendrier_id ?? calendrierParDefaut);

  fenetre.showModal();
  // Les roues ne peuvent être positionnées qu'une fois la fenêtre affichée
  roueDebut.regler(heureDebut);
  roueFin.regler(heureFin);
  if (!ligne) champTitre.focus();
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
