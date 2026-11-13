// Service worker : garde une copie des fichiers de l'appli sur le téléphone,
// pour qu'elle s'ouvre même sans réseau. Les données (Supabase) ne passent jamais par ici.
const CACHE = "nous-deux";
const DELAI_RESEAU = 4000;   // ms : au-delà, réseau trop lent → on prend la copie

// Nouvelle version de ce fichier : on l'active tout de suite
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evenement) => evenement.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);

  if (requete.mode === "navigate") {
    // La page (index.html) : toujours la dernière version si le réseau répond
    evenement.respondWith(reseauDabord(requete));
  } else if (url.hostname === "cdn.jsdelivr.net" || (url.origin === location.origin && url.search.includes("v="))) {
    // Bibliothèques (version dans l'adresse) et nos fichiers avec ?v= : ne changent jamais
    evenement.respondWith(cacheDabord(requete));
  } else if (url.origin === location.origin) {
    // Le reste de nos fichiers (manifest, icônes) : réseau, sinon copie
    evenement.respondWith(reseauDabord(requete));
  }
  // Tout le reste (Supabase…) : le navigateur s'en occupe normalement, sans copie
});

// La page envoie la liste des fichiers déjà chargés (1re ouverture, avant que ce script soit actif)
self.addEventListener("message", (evenement) => {
  if (evenement.data?.type !== "copier") return;
  evenement.waitUntil(copierFichiers(evenement.data.adresses));
});

async function copierFichiers(adresses) {
  const cache = await caches.open(CACHE);
  for (const adresse of adresses) {
    if (await cache.match(adresse, { ignoreSearch: estPage(adresse) })) continue;
    try {
      const reponse = await fetch(adresse, { mode: "cors", credentials: "omit" });
      if (reponse.ok) await ranger(cache, adresse, reponse);
    } catch (erreur) { /* hors ligne : on réessaiera à la prochaine ouverture */ }
  }
}

async function reseauDabord(requete) {
  const cache = await caches.open(CACHE);
  // no-cache : on demande au serveur s'il y a du nouveau (évite la copie de 10 min du navigateur)
  const reseau = fetch(requete, { cache: "no-cache" }).then(async (reponse) => {
    if (reponse.ok) await ranger(cache, requete.url, reponse.clone());
    return reponse;
  });
  reseau.catch(() => {});   // l'erreur éventuelle est gérée plus bas
  try {
    return await avecDelai(reseau, DELAI_RESEAU);
  } catch (erreur) {
    // Pas de réseau ou trop lent : la copie (ignoreSearch : « ?debug » ou pas, c'est la même page).
    // Pas de copie (toute 1re ouverture) : on attend quand même le réseau.
    return (await cache.match(requete, { ignoreSearch: true })) ?? reseau;
  }
}

async function cacheDabord(requete) {
  const cache = await caches.open(CACHE);
  const copie = await cache.match(requete);
  if (copie) return copie;
  const reponse = await fetch(requete);
  if (reponse.ok) await ranger(cache, requete.url, reponse.clone());
  return reponse;
}

// Range une réponse et efface l'ancienne version du même fichier (ex. app.js?v=ancien)
async function ranger(cache, adresse, reponse) {
  const url = new URL(adresse);
  if (estPage(adresse)) url.search = "";   // une seule copie de la page
  for (const ancienne of await cache.keys()) {
    const urlAncienne = new URL(ancienne.url);
    if (urlAncienne.origin === url.origin && urlAncienne.pathname === url.pathname && urlAncienne.search !== url.search) {
      await cache.delete(ancienne);
    }
  }
  await cache.put(url.href, reponse);
}

function estPage(adresse) {
  const url = new URL(adresse);
  return url.origin === location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith(".html"));
}

function avecDelai(promesse, ms) {
  return Promise.race([promesse, new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("délai")), ms))]);
}
