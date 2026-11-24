// ============================================================
// ALERTES — STOCKAGE INDEXEDDB (clé → valeur), partagé page / service worker
// Contient notamment le plan des alertes (clé 'plan') écrit par la page (voir
// refreshAlertPlanStore dans alerts.js) et destiné à être lu par le service worker.
// Écrit sans window ni document : utilisable tel quel dans un service worker (importScripts).
// Ne lève jamais d'erreur bloquante pour l'app : les appelants gèrent le refus par try/catch.
// ============================================================

const ALERTS_STORE_DB = 'pacingcount-alerts';
const ALERTS_STORE_NAME = 'kv';
let alertsStoreDbPromise = null;

function alertsStoreOpen() {
    if (alertsStoreDbPromise) return alertsStoreDbPromise;
    alertsStoreDbPromise = new Promise((resolve, reject) => {
        const idb = globalThis.indexedDB;
        if (!idb) { reject(new Error('IndexedDB indisponible')); return; }
        const req = idb.open(ALERTS_STORE_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(ALERTS_STORE_NAME);
        req.onsuccess = () => {
            const db = req.result;
            // Autre onglet / mise à jour de schéma : on libère la connexion, elle sera rouverte au besoin
            db.onversionchange = () => { db.close(); alertsStoreDbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB bloquée'));
    });
    alertsStoreDbPromise.catch(() => { alertsStoreDbPromise = null; }); // nouvel essai au prochain appel
    return alertsStoreDbPromise;
}

// Exécute une opération sur le magasin et attend la fin de la transaction (données écrites).
async function alertsStoreRun(mode, operation) {
    const db = await alertsStoreOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ALERTS_STORE_NAME, mode);
        const request = operation(tx.objectStore(ALERTS_STORE_NAME));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
    });
}

function alertsStoreGet(key) { return alertsStoreRun('readonly', store => store.get(key)); }
function alertsStoreSet(key, value) { return alertsStoreRun('readwrite', store => store.put(value, key)); }
function alertsStoreDelete(key) { return alertsStoreRun('readwrite', store => store.delete(key)); }
