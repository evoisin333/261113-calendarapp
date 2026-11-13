// app.js — Calendrier partagé
// Étape 3a : connexion, affichage (jour / semaine / mois), filtres, temps réel.

const FUSEAU = "Europe/Brussels";
const client = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseCle);

const ecranConnexion = document.getElementById("ecran-connexion");
const ecranAppli = document.getElementById("ecran-appli");
const erreurConnexion = document.getElementById("erreur-connexion");
const erreurAppli = document.getElementById("erreur-appli");
const etatSynchro = document.getElementById("etat-synchro");

let appliDemarree = false;
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
