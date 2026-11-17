// remboursements.js — Onglet Remboursements (mutuelle et DKV)
// Un dossier = un rendez-vous simple, ou une prescription avec plusieurs séances (kiné…).
// Chaque séance a ses 4 étapes (envoyé / remboursé, mutuelle / DKV), chacune avec sa date.
// Utilise ce que app.js a déjà préparé : client, lireReglage, ecrireReglage, estErreurReseau,
// afficherMessage, confirmer, horsLigne, passerHorsLigne, calendriers, utilisateurId.

const SEAU_PHOTOS = "documents-soins";   // espace de stockage privé (sql/06_remboursements.sql)
const CLE_COPIE_SOINS = "copieRemboursements";
const LARGEUR_PHOTO = 1600;              // photos réduites avant l'envoi (≈ 300 Ko)

let dossiers = [];          // lignes de dossiers_soins, chacune avec ses séances (seances_soins)
let membres = [];           // [{ user_id, prenom }] pour « Pour qui »
let filtreSoins = lireReglage("filtreSoins", "afaire");
let modeSelection = false;
const seancesCochees = new Set();
let canalSoins = null;

const zoneListe = document.getElementById("liste-soins");
const zoneResume = document.getElementById("resume-soins");
const erreurSoins = document.getElementById("erreur-soins");
const barreSelection = document.getElementById("barre-selection");

const formatEuros = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });
const formatDate = new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function euros(montant) { return formatEuros.format(Number(montant) || 0); }
function dateCourte(date) { return formatDate.format(new Date(`${date}T00:00:00Z`)); }
// Aujourd'hui à Bruxelles, ex. "2026-11-17"
function aujourdhui() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date()); }

// « 27,50 » ou « 27.5 » -> 27.5 ; vide -> null ; texte invalide -> NaN
function lireMontant(texte) {
  const propre = texte.trim().replace(/\s|€/g, "").replace(",", ".");
  if (propre === "") return null;
  const nombre = Number(propre);
  return /^\d+(\.\d{1,2})?$/.test(propre) && nombre <= 999999 ? nombre : NaN;
}
function ecrireMontant(montant) { return montant === null || montant === undefined ? "" : String(montant).replace(".", ","); }


// ---------- Où en est une séance ? ----------

// Mutuelle : "faite" (retirée sur place ou remboursée), "attente" (envoyée), "a_envoyer"
function etatMutuelle(s) {
  if (s.mutuelle_deduite || s.rembourse_mutuelle_le) return "faite";
  return s.envoye_mutuelle_le ? "attente" : "a_envoyer";
}
// DKV : "faite", "attente", "a_envoyer" (la mutuelle est faite), "apres" (attendre la mutuelle)
function etatDkv(s) {
  if (s.rembourse_dkv_le) return "faite";
  if (s.envoye_dkv_le) return "attente";
  return etatMutuelle(s) === "faite" ? "a_envoyer" : "apres";
}
function seanceTerminee(s) { return etatMutuelle(s) === "faite" && etatDkv(s) === "faite"; }

// Ce qui reste à ta charge, si les montants remboursés sont connus
function resteACharge(s) {
  const mutuelleConnue = s.mutuelle_deduite || s.montant_mutuelle !== null;
  if (!mutuelleConnue || s.montant_dkv === null) return null;
  return Number(s.montant_paye) - (s.mutuelle_deduite ? 0 : Number(s.montant_mutuelle)) - Number(s.montant_dkv);
}

function seancesDe(dossier) {
  return [...(dossier.seances_soins ?? [])].sort((a, b) => a.date_seance.localeCompare(b.date_seance) || a.id - b.id);
}
function dossierTermine(dossier) {
  const seances = seancesDe(dossier);
  return seances.length > 0 && seances.every(seanceTerminee);
}


// ---------- Chargement, copie hors connexion, temps réel ----------

function sauverCopieSoins() { ecrireReglage(CLE_COPIE_SOINS, { membres, dossiers, le: Date.now() }); }

async function demarrerRemboursements() {
  const copie = lireReglage(CLE_COPIE_SOINS, null);
  if (copie) {   // affichage immédiat de la copie, puis mise à jour par le réseau
    membres = copie.membres;
    dossiers = copie.dossiers;
    afficherSoins();
  }
  if (sansSession) return;   // la suite quand le réseau revient (chargerRemboursements)
  await chargerRemboursements();
  ecouterSoins();
}

function arreterRemboursements() {
  if (canalSoins) client.removeChannel(canalSoins);
  canalSoins = null;
  dossiers = [];
  membres = [];
  quitterSelection();
  afficherSoins();
}

async function chargerRemboursements() {
  if (!navigator.onLine) { passerHorsLigne(); return; }
  const [reponseMembres, reponseDossiers] = await Promise.all([
    client.from("membres").select("user_id, prenom").order("prenom"),
    client.from("dossiers_soins").select("*, seances_soins(*)").order("id"),
  ]);
  const erreur = reponseMembres.error ?? reponseDossiers.error;
  if (erreur && estErreurReseau(erreur)) { passerHorsLigne(); return; }   // on garde ce qui est affiché
  if (erreur) {
    erreurSoins.textContent = `Chargement des remboursements : ${erreur.message}`;
    return;
  }
  erreurSoins.textContent = "";
  membres = reponseMembres.data;
  dossiers = reponseDossiers.data;
  sauverCopieSoins();
  afficherSoins();
  // Un formulaire de dossier ouvert : ses photos et son bouton suivent
  if (fenetreDossier.open && dossierEnCours) {
    dossierEnCours = dossiers.find((d) => d.id === dossierEnCours.id) ?? dossierEnCours;
  }
}

function ecouterSoins() {
  if (canalSoins) return;
  canalSoins = client
    .channel("remboursements")
    .on("postgres_changes", { event: "*", schema: "public", table: "dossiers_soins" }, chargerRemboursements)
    .on("postgres_changes", { event: "*", schema: "public", table: "seances_soins" }, chargerRemboursements)
    .subscribe((statut) => { if (statut === "SUBSCRIBED") chargerRemboursements(); });
}

// Hors connexion : lecture seule (même règle que le calendrier)
function verifierEnLigne() {
  if (!horsLigne) return true;
  afficherMessage("Hors connexion : lecture seule.");
  return false;
}
function majLectureSeuleSoins() {
  document.getElementById("bouton-ajouter-soin").classList.toggle("eteint", horsLigne);
  document.getElementById("bouton-selectionner").classList.toggle("eteint", horsLigne);
}


// ---------- Affichage : résumé et liste ----------

function couleurDe(userId) {
  const prenom = membres.find((m) => m.user_id === userId)?.prenom;
  return calendriers.find((c) => c.nom === prenom)?.couleur ?? "#DDDDDD";
}
function prenomDe(userId) { return membres.find((m) => m.user_id === userId)?.prenom ?? "?"; }

function afficherResume() {
  const toutes = dossiers.flatMap(seancesDe);
  const compter = (test) => toutes.filter(test);
  const aEnvoyerMut = compter((s) => etatMutuelle(s) === "a_envoyer");
  const aEnvoyerDkv = compter((s) => etatDkv(s) === "a_envoyer");
  const attenteMut = compter((s) => etatMutuelle(s) === "attente");
  const attenteDkv = compter((s) => etatDkv(s) === "attente");
  const somme = (liste) => liste.reduce((total, s) => total + Number(s.montant_paye), 0);
  const attente = [...new Set([...attenteMut, ...attenteDkv])];
  zoneResume.replaceChildren(
    carteResume("À envoyer", aEnvoyerMut.length + aEnvoyerDkv.length,
      `mutuelle ${aEnvoyerMut.length} · DKV ${aEnvoyerDkv.length}`),
    carteResume("En attente", attenteMut.length + attenteDkv.length,
      `mutuelle ${attenteMut.length} · DKV ${attenteDkv.length}${attente.length ? ` · ${euros(somme(attente))} payés` : ""}`),
  );
}
function carteResume(titre, nombre, detail) {
  const carte = document.createElement("div");
  carte.className = "carte-resume";
  carte.innerHTML = `<span class="titre"></span><strong></strong><span class="detail"></span>`;
  carte.querySelector(".titre").textContent = titre;
  carte.querySelector("strong").textContent = nombre;
  carte.querySelector(".detail").textContent = detail;
  return carte;
}

// Date la plus récente d'un dossier (pour trier : le plus récent en haut)
function dateRecente(dossier) {
  const seances = seancesDe(dossier);
  return seances.length ? seances[seances.length - 1].date_seance : dossier.cree_le.slice(0, 10);
}

function afficherSoins() {
  afficherResume();
  for (const bouton of document.querySelectorAll("[data-filtre]")) {
    bouton.setAttribute("aria-pressed", String(bouton.dataset.filtre === filtreSoins));
  }
  const affiches = dossiers
    .filter((d) => filtreSoins === "tout" || !dossierTermine(d))
    .sort((a, b) => dateRecente(b).localeCompare(dateRecente(a)) || b.id - a.id);
  if (affiches.length === 0) {
    const vide = document.createElement("p");
    vide.className = "vide-onglet";
    vide.textContent = dossiers.length === 0
      ? "Aucun soin encodé. Touche + pour ajouter un rendez-vous ou une prescription."
      : "Rien à faire : tout est envoyé et remboursé 🎉";
    zoneListe.replaceChildren(vide);
  } else {
    zoneListe.replaceChildren(...affiches.map(carteDossier));
  }
  majBarreSelection();
}

function carteDossier(dossier) {
  const carte = document.createElement("article");
  carte.className = "carte-soin";
  const seances = seancesDe(dossier);

  const entete = document.createElement("button");
  entete.className = "entete-soin";
  entete.innerHTML = `<span class="personne"></span><span class="nom-soin"></span><span class="compteur"></span>`;
  const personne = entete.querySelector(".personne");
  personne.textContent = prenomDe(dossier.pour_qui);
  personne.style.setProperty("--couleur", couleurDe(dossier.pour_qui));
  entete.querySelector(".nom-soin").textContent = dossier.soin;
  entete.querySelector(".compteur").textContent = dossier.seances_prevues
    ? `${seances.length} / ${dossier.seances_prevues}` : "";
  entete.addEventListener("click", () => ouvrirDossier(dossier));
  carte.append(entete);

  // En « À faire », on ne montre que les séances pas encore terminées
  const visibles = seances.map((s, i) => [s, i + 1])
    .filter(([s]) => filtreSoins === "tout" || !seanceTerminee(s));
  if (visibles.length) {
    const liste = document.createElement("div");
    liste.className = "seances";
    for (const [seance, numero] of visibles) liste.append(ligneSeance(dossier, seance, numero));
    carte.append(liste);
  }

  if (dossier.seances_prevues) {
    const ajout = document.createElement("button");
    ajout.className = "ajout-seance";
    ajout.textContent = "+ Séance";
    ajout.addEventListener("click", () => nouvelleSeance(dossier));
    carte.append(ajout);
  }
  return carte;
}

const TEXTES_MUTUELLE = { faite: "Mut. ✓", attente: "Mut. envoyée", a_envoyer: "Mut. à envoyer" };
const TEXTES_DKV = { faite: "DKV ✓", attente: "DKV envoyée", a_envoyer: "DKV à envoyer", apres: "DKV après" };

function ligneSeance(dossier, seance, numero) {
  const ligne = document.createElement("button");
  ligne.className = "ligne-seance";
  ligne.dataset.seance = seance.id;
  ligne.setAttribute("aria-pressed", String(seancesCochees.has(seance.id)));
  const mut = seance.mutuelle_deduite ? "faite" : etatMutuelle(seance);
  ligne.innerHTML = `<span class="case"></span><span class="quand"></span><span class="montant"></span>
    <span class="etats"><span class="etat"></span><span class="etat"></span></span>`;
  ligne.querySelector(".quand").textContent =
    (dossier.seances_prevues ? `n° ${numero} · ` : "") + dateCourte(seance.date_seance);
  ligne.querySelector(".montant").textContent = euros(seance.montant_paye);
  const [puceMut, puceDkv] = ligne.querySelectorAll(".etat");
  puceMut.textContent = seance.mutuelle_deduite ? "Mut. retirée" : TEXTES_MUTUELLE[mut];
  puceMut.dataset.etat = mut;
  puceDkv.textContent = TEXTES_DKV[etatDkv(seance)];
  puceDkv.dataset.etat = etatDkv(seance);
  ligne.addEventListener("click", () => {
    if (modeSelection) basculerSelection(seance.id, ligne);
    else ouvrirSeance(dossier, seance);
  });
  return ligne;
}

for (const bouton of document.querySelectorAll("[data-filtre]")) {
  bouton.addEventListener("click", () => {
    filtreSoins = bouton.dataset.filtre;
    ecrireReglage("filtreSoins", filtreSoins);
    afficherSoins();
  });
}


// ---------- Sélection de plusieurs séances (envoi groupé) ----------

const boutonSelectionner = document.getElementById("bouton-selectionner");

function basculerSelection(id, ligne) {
  if (seancesCochees.has(id)) seancesCochees.delete(id);
  else seancesCochees.add(id);
  ligne.setAttribute("aria-pressed", String(seancesCochees.has(id)));
  majBarreSelection();
}
function quitterSelection() {
  modeSelection = false;
  seancesCochees.clear();
  majBarreSelection();
}
function majBarreSelection() {
  barreSelection.hidden = !modeSelection;
  zoneListe.classList.toggle("en-selection", modeSelection);
  boutonSelectionner.textContent = modeSelection ? "Terminé" : "Sélectionner";
  const nombre = seancesCochees.size;
  document.getElementById("nb-selection").textContent = nombre === 0
    ? "Touche les séances à cocher" : `${nombre} séance${nombre > 1 ? "s" : ""} cochée${nombre > 1 ? "s" : ""}`;
  for (const bouton of barreSelection.querySelectorAll("button")) bouton.disabled = nombre === 0;
}

boutonSelectionner.addEventListener("click", () => {
  if (modeSelection) { quitterSelection(); afficherSoins(); return; }
  if (!verifierEnLigne()) return;
  modeSelection = true;
  afficherSoins();
});

// Les 4 actions : colonne de date et, pour un remboursement, colonne de montant
const ACTIONS = {
  envoye_mutuelle:    { titre: "Envoyé à la mutuelle", date: "envoye_mutuelle_le" },
  rembourse_mutuelle: { titre: "Remboursé par la mutuelle", date: "rembourse_mutuelle_le", montant: "montant_mutuelle" },
  envoye_dkv:         { titre: "Envoyé à la DKV", date: "envoye_dkv_le" },
  rembourse_dkv:      { titre: "Remboursé par la DKV", date: "rembourse_dkv_le", montant: "montant_dkv" },
};
const fenetreAction = document.getElementById("fenetre-action");
const champDateAction = document.getElementById("champ-date-action");
const champMontantAction = document.getElementById("champ-montant-action");
let actionEnCours = null;

for (const bouton of barreSelection.querySelectorAll("[data-action]")) {
  bouton.addEventListener("click", () => {
    if (!verifierEnLigne()) return;
    actionEnCours = ACTIONS[bouton.dataset.action];
    const nombre = seancesCochees.size;
    document.getElementById("titre-action").textContent = actionEnCours.titre;
    document.getElementById("note-action").textContent = `${nombre} séance${nombre > 1 ? "s" : ""}.` +
      (actionEnCours.montant && nombre > 1 ? " Le total est réparti à parts égales (corrigeable séance par séance)." : "");
    document.getElementById("ligne-montant-action").hidden = !actionEnCours.montant;
    champDateAction.value = aujourdhui();
    champMontantAction.value = "";
    document.getElementById("erreur-action").textContent = "";
    fenetreAction.showModal();
  });
}
document.getElementById("bouton-annuler-action").addEventListener("click", () => fenetreAction.close());

// Répartit un total en parts égales au centime près (le reste sur les premières)
function repartir(total, nombre) {
  const centimes = Math.round(total * 100);
  const part = Math.floor(centimes / nombre);
  return Array.from({ length: nombre }, (_, i) => (part + (i < centimes - part * nombre ? 1 : 0)) / 100);
}

document.getElementById("bouton-valider-action").addEventListener("click", async () => {
  const erreur = document.getElementById("erreur-action");
  const montant = actionEnCours.montant ? lireMontant(champMontantAction.value) : null;
  if (!champDateAction.value) { erreur.textContent = "Choisis une date."; return; }
  if (Number.isNaN(montant)) { erreur.textContent = "Montant invalide (ex. 54,30)."; return; }
  const ids = [...seancesCochees];
  const parts = montant === null ? null : repartir(montant, ids.length);
  const resultats = await Promise.all(ids.map((id, i) => {
    const changement = { [actionEnCours.date]: champDateAction.value };
    if (parts) changement[actionEnCours.montant] = parts[i];
    return client.from("seances_soins").update(changement).eq("id", id);
  }));
  const echec = resultats.find((r) => r.error);
  if (echec) { erreur.textContent = `Enregistrement impossible : ${texteErreur(echec.error)}`; return; }
  fenetreAction.close();
  afficherMessage(`${actionEnCours.titre} : ${ids.length} séance${ids.length > 1 ? "s" : ""}.`);
  quitterSelection();
  await chargerRemboursements();
});


// ---------- Formulaire d'un dossier ----------

const fenetreDossier = document.getElementById("fenetre-dossier");
const champSoin = document.getElementById("champ-soin");
const champPrescription = document.getElementById("champ-prescription");
const champSeancesPrevues = document.getElementById("champ-seances-prevues");
const champNotesDossier = document.getElementById("champ-notes-dossier");
const champDateRdv = document.getElementById("champ-date-rdv");
const champMontantRdv = document.getElementById("champ-montant-rdv");
const champDeduiteRdv = document.getElementById("champ-deduite-rdv");
const erreurDossier = document.getElementById("erreur-dossier");
const boutonSupprimerDossier = document.getElementById("bouton-supprimer-dossier");
let dossierEnCours = null;   // null = création

function afficherChoixPourQui(idChoisi) {
  const zone = document.getElementById("choix-pour-qui");
  zone.replaceChildren(...membres.map((m) => {
    const choix = document.createElement("label");
    choix.style.setProperty("--couleur", couleurDe(m.user_id));
    choix.innerHTML = `<input type="radio" name="pour-qui"><span></span>`;
    choix.querySelector("input").value = m.user_id;
    choix.querySelector("input").checked = m.user_id === idChoisi;
    choix.querySelector("span").textContent = m.prenom;
    return choix;
  }));
}

function majAffichagePrescription() {
  document.getElementById("ligne-seances-prevues").hidden = !champPrescription.checked;
  // Rendez-vous simple à la création : on encode la séance en même temps
  document.getElementById("bloc-premiere-seance").hidden = champPrescription.checked || dossierEnCours !== null;
}
champPrescription.addEventListener("change", majAffichagePrescription);

function ouvrirDossier(dossier) {
  if (!dossier && !verifierEnLigne()) return;
  dossierEnCours = dossier;
  erreurDossier.textContent = "";
  document.getElementById("titre-dossier").textContent = dossier ? "Soin" : "Nouveau soin";
  document.getElementById("bouton-annuler-dossier").textContent = dossier ? "Fermer" : "Annuler";
  champSoin.value = dossier?.soin ?? "";
  champPrescription.checked = Boolean(dossier?.seances_prevues);
  champSeancesPrevues.value = dossier?.seances_prevues ?? "";
  champNotesDossier.value = dossier?.notes ?? "";
  afficherChoixPourQui(dossier?.pour_qui ?? utilisateurId);
  champDateRdv.value = aujourdhui();
  champMontantRdv.value = "";
  champDeduiteRdv.checked = false;
  majAffichagePrescription();
  boutonSupprimerDossier.hidden = !dossier;
  boutonSupprimerDossier.classList.remove("confirmer");
  boutonSupprimerDossier.textContent = "Supprimer";
  document.getElementById("bouton-enregistrer-dossier").disabled = horsLigne;
  afficherPhotos();
  fenetreDossier.showModal();
}

document.getElementById("bouton-ajouter-soin").addEventListener("click", () => ouvrirDossier(null));
document.getElementById("bouton-annuler-dossier").addEventListener("click", () => fenetreDossier.close());

document.getElementById("bouton-enregistrer-dossier").addEventListener("click", async () => {
  if (!verifierEnLigne()) return;
  const soin = champSoin.value.trim();
  const pourQui = document.querySelector('input[name="pour-qui"]:checked')?.value;
  const prevues = champPrescription.checked ? Number(champSeancesPrevues.value) : null;
  if (!soin) { erreurDossier.textContent = "Donne un nom au soin (ex. Kiné dos)."; return; }
  if (!pourQui) { erreurDossier.textContent = "Choisis pour qui."; return; }
  if (prevues !== null && !(Number.isInteger(prevues) && prevues >= 1 && prevues <= 200)) {
    erreurDossier.textContent = "Nombre de séances prévues : entre 1 et 200."; return;
  }
  const champs = { soin, pour_qui: pourQui, seances_prevues: prevues, notes: champNotesDossier.value.trim() || null };

  if (dossierEnCours) {
    const { error } = await client.from("dossiers_soins").update(champs).eq("id", dossierEnCours.id);
    if (error) { erreurDossier.textContent = `Enregistrement impossible : ${texteErreur(error)}`; return; }
    fenetreDossier.close();
    await chargerRemboursements();
    return;
  }

  // Création. Rendez-vous simple : la séance est encodée en même temps.
  let seance = null;
  if (prevues === null) {
    const montant = lireMontant(champMontantRdv.value);
    if (!champDateRdv.value) { erreurDossier.textContent = "Choisis la date du rendez-vous."; return; }
    if (montant === null || Number.isNaN(montant)) { erreurDossier.textContent = "Montant payé invalide (ex. 27,50)."; return; }
    seance = { date_seance: champDateRdv.value, montant_paye: montant, mutuelle_deduite: champDeduiteRdv.checked };
  }
  const { data, error } = await client.from("dossiers_soins").insert(champs).select().single();
  if (error) { erreurDossier.textContent = `Enregistrement impossible : ${texteErreur(error)}`; return; }
  if (seance) {
    const reponse = await client.from("seances_soins").insert({ ...seance, dossier_id: data.id });
    if (reponse.error) {
      // Pas de dossier vide qui traîne : on annule la création
      await client.from("dossiers_soins").delete().eq("id", data.id);
      erreurDossier.textContent = `Enregistrement impossible : ${texteErreur(reponse.error)}`;
      return;
    }
  }
  await chargerRemboursements();
  // On reste dans le dossier : on peut tout de suite ajouter les photos
  ouvrirDossierApresCreation(data.id);
});

function ouvrirDossierApresCreation(id) {
  const dossier = dossiers.find((d) => d.id === id);
  fenetreDossier.close();
  if (dossier) {
    ouvrirDossier(dossier);
    afficherMessage("Enregistré. Tu peux ajouter les documents.");
  }
}

boutonSupprimerDossier.addEventListener("click", async () => {
  if (!verifierEnLigne()) return;
  if (!confirmer(boutonSupprimerDossier, "Confirmer : soin, séances et documents")) return;
  // D'abord les photos (la base ne les supprime pas toute seule), puis le dossier et ses séances
  const photos = await listerPhotos(dossierEnCours.id);
  if (photos === null) { erreurDossier.textContent = "Suppression des documents impossible."; return; }
  if (photos.length) {
    const { error } = await client.storage.from(SEAU_PHOTOS).remove(photos.map((p) => p.chemin));
    if (error) { erreurDossier.textContent = `Suppression des documents impossible : ${texteErreur(error)}`; return; }
  }
  const { error } = await client.from("dossiers_soins").delete().eq("id", dossierEnCours.id);
  if (error) { erreurDossier.textContent = `Suppression impossible : ${texteErreur(error)}`; return; }
  fenetreDossier.close();
  await chargerRemboursements();
});


// ---------- Photos des documents ----------

const champPhoto = document.getElementById("champ-photo");
const zonePhotos = document.getElementById("liste-photos");
const notePhotos = document.getElementById("note-photos");
const boutonSupprimerPhotos = document.getElementById("bouton-supprimer-photos");

// [{ nom, chemin }] ou null en cas d'erreur
async function listerPhotos(dossierId) {
  const { data, error } = await client.storage.from(SEAU_PHOTOS).list(String(dossierId), { limit: 100 });
  if (error) return null;
  return data.filter((f) => f.id !== null).map((f) => ({ nom: f.name, chemin: `${dossierId}/${f.name}` }));
}

async function afficherPhotos() {
  const bloc = document.getElementById("bloc-photos");
  zonePhotos.replaceChildren();
  boutonSupprimerPhotos.hidden = true;
  boutonSupprimerPhotos.classList.remove("confirmer");
  boutonSupprimerPhotos.textContent = "Supprimer les documents";
  if (!dossierEnCours) { bloc.hidden = true; return; }
  bloc.hidden = false;
  if (horsLigne) { notePhotos.textContent = "Documents indisponibles hors connexion."; return; }
  notePhotos.textContent = "Chargement…";
  const dossierAffiche = dossierEnCours;
  const photos = await listerPhotos(dossierAffiche.id);
  if (dossierEnCours !== dossierAffiche) return;   // fenêtre changée entre-temps
  if (photos === null) { notePhotos.textContent = "Documents indisponibles pour le moment."; return; }
  notePhotos.textContent = photos.length ? "" : "Aucun document (attestation, facture, décompte…).";
  if (photos.length) {
    const { data: liens } = await client.storage.from(SEAU_PHOTOS).createSignedUrls(photos.map((p) => p.chemin), 3600);
    zonePhotos.replaceChildren(...photos.map((photo, i) => vignette(photo, liens?.[i]?.signedUrl)));
  }
  // Tout est remboursé : on propose de libérer la place
  boutonSupprimerPhotos.hidden = !(photos.length && dossierTermine(dossierAffiche));
}

function vignette(photo, lien) {
  const cadre = document.createElement("div");
  cadre.className = "vignette";
  const ouvrir = document.createElement("a");
  ouvrir.href = lien ?? "#";
  ouvrir.target = "_blank";
  ouvrir.rel = "noopener";
  if (photo.nom.endsWith(".pdf")) {
    ouvrir.textContent = "PDF";
    ouvrir.className = "vignette-pdf";
  } else {
    const image = document.createElement("img");
    image.src = lien ?? "";
    image.alt = "Document";
    image.loading = "lazy";
    ouvrir.append(image);
  }
  const retirer = document.createElement("button");
  retirer.type = "button";
  retirer.className = "retirer-photo";
  retirer.setAttribute("aria-label", "Supprimer ce document");
  retirer.textContent = "×";
  retirer.addEventListener("click", async () => {
    if (!verifierEnLigne()) return;
    if (!confirmer(retirer, "Suppr. ?")) return;
    const { error } = await client.storage.from(SEAU_PHOTOS).remove([photo.chemin]);
    if (error) { erreurDossier.textContent = `Suppression impossible : ${texteErreur(error)}`; return; }
    afficherPhotos();
  });
  cadre.append(ouvrir, retirer);
  return cadre;
}

// Réduit une photo (1600 px de large max, JPEG) : moins de place dans l'espace gratuit
async function compresser(fichier) {
  const image = await createImageBitmap(fichier);
  const echelle = Math.min(1, LARGEUR_PHOTO / Math.max(image.width, image.height));
  const toile = document.createElement("canvas");
  toile.width = Math.round(image.width * echelle);
  toile.height = Math.round(image.height * echelle);
  toile.getContext("2d").drawImage(image, 0, 0, toile.width, toile.height);
  image.close?.();
  return new Promise((ok, echec) => toile.toBlob((blob) => blob ? ok(blob) : echec(new Error("compression")), "image/jpeg", 0.75));
}

champPhoto.addEventListener("change", async () => {
  const fichier = champPhoto.files[0];
  champPhoto.value = "";
  if (!fichier || !dossierEnCours || !verifierEnLigne()) return;
  erreurDossier.textContent = "";
  const estPdf = fichier.type === "application/pdf";
  if (!estPdf && !fichier.type.startsWith("image/")) { erreurDossier.textContent = "Seulement des photos ou des PDF."; return; }
  notePhotos.textContent = "Envoi…";
  let contenu = fichier;
  try {
    if (!estPdf) contenu = await compresser(fichier);
  } catch {
    notePhotos.textContent = "";
    erreurDossier.textContent = "Cette image ne peut pas être lue (essaie en JPEG ou en capture d'écran).";
    return;
  }
  if (contenu.size > 5 * 1024 * 1024) { notePhotos.textContent = ""; erreurDossier.textContent = "Fichier trop lourd (5 Mo maximum)."; return; }
  const nom = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${estPdf ? "pdf" : "jpg"}`;
  const { error } = await client.storage.from(SEAU_PHOTOS)
    .upload(`${dossierEnCours.id}/${nom}`, contenu, { contentType: estPdf ? "application/pdf" : "image/jpeg" });
  if (error) { notePhotos.textContent = ""; erreurDossier.textContent = `Envoi impossible : ${texteErreur(error)}`; return; }
  afficherPhotos();
});

boutonSupprimerPhotos.addEventListener("click", async () => {
  if (!verifierEnLigne()) return;
  if (!confirmer(boutonSupprimerPhotos, "Confirmer : supprimer tous les documents")) return;
  const photos = await listerPhotos(dossierEnCours.id);
  if (photos?.length) {
    const { error } = await client.storage.from(SEAU_PHOTOS).remove(photos.map((p) => p.chemin));
    if (error) { erreurDossier.textContent = `Suppression impossible : ${texteErreur(error)}`; return; }
  }
  afficherMessage("Documents supprimés.");
  afficherPhotos();
});


// ---------- Formulaire d'une séance ----------

const fenetreSeance = document.getElementById("fenetre-seance");
const champDateSeance = document.getElementById("champ-date-seance");
const champMontantSeance = document.getElementById("champ-montant-seance");
const champDeduiteSeance = document.getElementById("champ-deduite-seance");
const zoneEtapes = document.getElementById("etapes-seance");
const erreurSeance = document.getElementById("erreur-seance");
const boutonSupprimerSeance = document.getElementById("bouton-supprimer-seance");
let seanceEnCours = null;        // null = nouvelle séance
let dossierDeLaSeance = null;

// Les 4 étapes, construites une fois : interrupteur, date, et montant pour les remboursements
const ETAPES = Object.values(ACTIONS).map((action) => {
  const bloc = document.createElement("div");
  bloc.className = "etape";
  bloc.innerHTML = `<label class="ligne-groupe"><span></span><input type="checkbox" class="interrupteur"></label>
    <div class="ligne-champ details-etape"><span>Le</span><input type="date"></div>`;
  bloc.querySelector("span").textContent = action.titre;
  const interrupteur = bloc.querySelector(".interrupteur");
  const champDate = bloc.querySelector('input[type="date"]');
  let champMontant = null;
  if (action.montant) {
    const ligne = document.createElement("div");
    ligne.className = "ligne-champ details-etape";
    ligne.innerHTML = `<span>Montant (€)</span><input inputmode="decimal" placeholder="facultatif" autocomplete="off">`;
    champMontant = ligne.querySelector("input");
    bloc.append(ligne);
  }
  // Cocher : la date du jour se met toute seule (modifiable)
  interrupteur.addEventListener("change", () => {
    if (interrupteur.checked && !champDate.value) champDate.value = aujourdhui();
    majEtapes();
  });
  champMontant?.addEventListener("input", majResteSeance);
  zoneEtapes.append(bloc);
  return { action, bloc, interrupteur, champDate, champMontant };
});

function majEtapes() {
  for (const etape of ETAPES) {
    const mutuelle = etape.action.date.includes("mutuelle");
    etape.bloc.hidden = mutuelle && champDeduiteSeance.checked;   // retirée sur place : pas d'envoi
    for (const detail of etape.bloc.querySelectorAll(".details-etape")) detail.hidden = !etape.interrupteur.checked;
  }
  majResteSeance();
}
champDeduiteSeance.addEventListener("change", majEtapes);
champMontantSeance.addEventListener("input", majResteSeance);

function majResteSeance() {
  const brouillon = lireSeance(false);
  const reste = brouillon ? resteACharge(brouillon) : null;
  document.getElementById("reste-seance").textContent = reste === null ? "" : `Reste à ta charge : ${euros(reste)}`;
}

function ouvrirSeance(dossier, seance, modele = null) {
  dossierDeLaSeance = dossier;
  seanceEnCours = seance;
  const base = seance ?? modele;
  erreurSeance.textContent = "";
  document.getElementById("titre-seance").textContent = seance ? "Séance" : "Nouvelle séance";
  document.getElementById("soin-seance").textContent = `${dossier.soin} · ${prenomDe(dossier.pour_qui)}`;
  champDateSeance.value = seance?.date_seance ?? aujourdhui();
  champMontantSeance.value = ecrireMontant(base?.montant_paye);
  champDeduiteSeance.checked = Boolean(base?.mutuelle_deduite);
  for (const etape of ETAPES) {
    const date = seance?.[etape.action.date] ?? "";
    etape.interrupteur.checked = Boolean(date);
    etape.champDate.value = date;
    if (etape.champMontant) etape.champMontant.value = ecrireMontant(seance?.[etape.action.montant]);
  }
  majEtapes();
  boutonSupprimerSeance.hidden = !seance;
  boutonSupprimerSeance.classList.remove("confirmer");
  boutonSupprimerSeance.textContent = "Supprimer la séance";
  document.getElementById("bouton-enregistrer-seance").disabled = horsLigne;
  fenetreSeance.showModal();
}

// + Séance : même prix et même « mutuelle retirée » que la dernière séance
function nouvelleSeance(dossier) {
  if (!verifierEnLigne()) return;
  const seances = seancesDe(dossier);
  ouvrirSeance(dossier, null, seances[seances.length - 1] ?? null);
}

// Lit le formulaire. strict = false : brouillon pour le calcul du reste (pas d'erreur affichée)
function lireSeance(strict = true) {
  const echouer = (texte) => { if (strict) erreurSeance.textContent = texte; return null; };
  const montant = lireMontant(champMontantSeance.value);
  if (!champDateSeance.value) return echouer("Choisis la date de la séance.");
  if (montant === null || Number.isNaN(montant)) return echouer("Montant payé invalide (ex. 27,50).");
  const seance = { date_seance: champDateSeance.value, montant_paye: montant, mutuelle_deduite: champDeduiteSeance.checked };
  for (const etape of ETAPES) {
    const ignoree = etape.bloc.hidden || !etape.interrupteur.checked;
    if (!ignoree && !etape.champDate.value) return echouer(`${etape.action.titre} : choisis une date.`);
    seance[etape.action.date] = ignoree ? null : etape.champDate.value;
    if (etape.champMontant) {
      const valeur = ignoree ? null : lireMontant(etape.champMontant.value);
      if (Number.isNaN(valeur)) return echouer(`${etape.action.titre} : montant invalide.`);
      seance[etape.action.montant] = valeur;
    }
  }
  return seance;
}

document.getElementById("bouton-annuler-seance").addEventListener("click", () => fenetreSeance.close());

document.getElementById("bouton-enregistrer-seance").addEventListener("click", async () => {
  if (!verifierEnLigne()) return;
  erreurSeance.textContent = "";
  const seance = lireSeance();
  if (!seance) return;
  const requete = seanceEnCours
    ? client.from("seances_soins").update(seance).eq("id", seanceEnCours.id)
    : client.from("seances_soins").insert({ ...seance, dossier_id: dossierDeLaSeance.id });
  const { error } = await requete;
  if (error) { erreurSeance.textContent = `Enregistrement impossible : ${texteErreur(error)}`; return; }
  fenetreSeance.close();
  await chargerRemboursements();
});

boutonSupprimerSeance.addEventListener("click", async () => {
  if (!verifierEnLigne()) return;
  if (!confirmer(boutonSupprimerSeance, "Confirmer la suppression")) return;
  const { error } = await client.from("seances_soins").delete().eq("id", seanceEnCours.id);
  if (error) { erreurSeance.textContent = `Suppression impossible : ${texteErreur(error)}`; return; }
  fenetreSeance.close();
  await chargerRemboursements();
});


// L'appli a pu démarrer avant que ce fichier soit chargé (lancement sans réseau)
if (appliDemarree) demarrerRemboursements();
majLectureSeuleSoins();
