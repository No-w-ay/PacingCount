// js/alerts.js — Alertes de périodes : partie commune aux canaux local et serveur.
// Réglages des alertes (settings.alerts[]), interface de la liste et de la fenêtre d'édition,
// plan d'alertes (séquences, vagues), registre « déjà jouée », textes des notifications,
// état des notifications (permission, iOS, installation).
//   Canal local (minuteries, Wake Lock, pseudo-veille, rattrapage) : js/alerts-local.js
//   Canal serveur (Web Push, Worker Cloudflare)                     : js/alerts-server.js
// Script classique, pas un module : les fonctions doivent rester globales (le HTML généré
// utilise des onclick="toggleAlert(...)"). Elles lisent settings, state, t()… définis dans
// index.html, mais seulement à l'exécution (jamais au chargement du fichier).

// ============================================================
// 7. GESTION DES ALERTES DE PÉRIODES (réglages)
// Lecture/écriture dans settings.alerts[].
// Structure d'une alerte :
//   { id, typeIds, enabled, threshold, interval, maxCount }
//   id        : identifiant stable (clé du registre « déjà jouée », balise des notifications)
//   typeIds   : ensemble de types ; le seuil se compte sur le temps CONTINU passé dans cet
//               ensemble (voir getRunStart). Un seul type = comportement historique.
//   threshold : minutes avant la 1re notification ; interval : minutes entre rappels ;
//   maxCount  : nombre total de notifications (1 à 5).
// Le nom d'une alerte n'est jamais stocké : il est calculé (getAlertName) et suit donc
// les renommages de types.
// ============================================================

// Identifiant court et unique pour une nouvelle alerte (lettres et chiffres uniquement).
function newAlertId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Met les alertes au format courant : typeId → typeIds, id ajouté, ancien champ « wave »
// (vagues croissantes, abandonné) retiré. Idempotent. Retourne true si quelque chose a changé
// (l'appelant enregistre alors les réglages).
function normalizeAlerts() {
    if (!Array.isArray(settings.alerts)) return false;
    let changed = false;
    settings.alerts.forEach(a => {
        if (!Array.isArray(a.typeIds)) {
            a.typeIds = Number.isInteger(a.typeId) ? [a.typeId] : [];
            changed = true;
        }
        if ('typeId' in a) { delete a.typeId; changed = true; }
        if ('wave' in a) { delete a.wave; changed = true; }
        if (!a.id) { a.id = newAlertId(); changed = true; }
    });
    return changed;
}

// Nom affiché d'une alerte : libellés des types joints par « + » (calculé, jamais stocké).
function getAlertName(a) {
    return a.typeIds.map(id => getLabelForId(id) || `#${id}`).join(' + ');
}

// Deux alertes portent-elles sur le même ensemble de types ?
function sameTypeSet(a, b) {
    const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

function isTypeActiveId(id) {
    const tp = settings.types.find(x => x.id === id);
    return !!(tp && tp.active);
}

// Affichage d'un ensemble de types (liste des alertes et récapitulatif du modal) :
// un seul type = une ligne « ● Libellé » ; plusieurs = ligne 1 les ronds reliés par « + »,
// ligne 2 les libellés reliés par « + » (retour à la ligne si trop long, sans troncature).
function renderAlertSetHtml(typeIds) {
    const dot = id => `<span style="color: ${getColorForId(id)};">●</span>`;
    if (typeIds.length === 1) {
        return `<div class="alert-set"><span class="alert-set-dots">${dot(typeIds[0])}</span>
                <span style="font-weight:bold; margin-left:4px;">${escapeHtml(getLabelForId(typeIds[0]))}</span></div>`;
    }
    if (typeIds.length === 0) return '';
    return `<div class="alert-set">
                <div class="alert-set-dots">${typeIds.map(dot).join(' + ')}</div>
                <div class="alert-set-labels">${typeIds.map(id => escapeHtml(getLabelForId(id))).join(' + ')}</div>
            </div>`;
}

// Rendu de la liste des alertes dans l'onglet réglages
function renderAlertsList() {
    const container = document.getElementById('alerts-list');
    if (!container) return;

    if (!settings.alerts || settings.alerts.length === 0) {
        container.innerHTML = `<p style="opacity:0.5; font-size:0.85rem; margin:0 0 6px 0;">
                    ${t('alertNoAlerts')}</p>`;
        return;
    }

    container.innerHTML = settings.alerts.map((alert, idx) => {
        const toggleBg = alert.enabled ? 'var(--green)' : '#555';
        const togglePos = alert.enabled ? '22px' : '2px';

        return `
                <div style="padding:10px 0; border-bottom:1px solid var(--border);">
                    ${renderAlertSetHtml(alert.typeIds)}
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px;">
                        <span style="font-size:0.8rem; opacity:0.7;">
                            <span style="white-space:nowrap;">${t('alertThreshold')} ${alert.threshold} min</span> ·
                            <span style="white-space:nowrap;">+${alert.interval} min</span> ·
                            <span style="white-space:nowrap;">${alert.maxCount}x</span>
                        </span>
                        <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                            <!-- Toggle ON/OFF -->
                            <div onclick="toggleAlert(${idx})"
                                 style="position:relative; width:44px; height:24px; border-radius:12px;
                                        background:${toggleBg}; cursor:pointer; flex-shrink:0;
                                        margin:0 8px; transition:background 0.2s;">
                                <div style="position:absolute; top:2px; left:${togglePos}; width:20px; height:20px;
                                            border-radius:50%; background:white;
                                            transition:left 0.2s;"></div>
                            </div>
                            <!-- Boutons édition / suppression -->
                            <button class="btn-icon" onclick="openAlertModal(${idx})">✏️</button>
                            <button class="btn-icon" onclick="deleteAlert(${idx})">🗑️</button>
                        </div>
                    </div>
                </div>`;
    }).join('');
}

// Fenêtre d'édition : types proposés ({ id, label, active }) et types cochés.
// Les types inactifs ne sont proposés que s'ils font déjà partie de l'alerte éditée.
let alertModalTypes = [];
let alertModalSelected = new Set();

function renderAlertModalTypes() {
    document.getElementById('alert-types-picker').innerHTML = alertModalTypes.map(tp => {
        const on = alertModalSelected.has(tp.id);
        const tag = tp.active ? '' : ` (${t('alertInactiveTag')})`;
        return `<button type="button" class="alert-chip${on ? ' on' : ''}${tp.active ? '' : ' inactive'}"
                    style="--chip-color: ${getColorForId(tp.id)};" data-chip="${tp.id}" aria-pressed="${on}"
                    onclick="toggleAlertModalType(${tp.id})">
                    <span class="alert-chip-check">✓</span><span style="color: ${getColorForId(tp.id)};">●</span>
                    ${escapeHtml(tp.label)}${tag}</button>`;
    }).join('');
    // Récapitulatif en direct, dans l'ordre des pastilles
    document.getElementById('alert-types-recap').innerHTML =
        renderAlertSetHtml(alertModalTypes.filter(tp => alertModalSelected.has(tp.id)).map(tp => tp.id));
}

function toggleAlertModalType(id) {
    if (alertModalSelected.has(id)) alertModalSelected.delete(id); else alertModalSelected.add(id);
    renderAlertModalTypes();
    const chip = document.querySelector(`#alert-types-picker [data-chip="${id}"]`);
    if (chip) chip.focus(); // garde le focus clavier après le rendu
}

// Ouvre le modal pour ajouter (idx=-1) ou éditer (idx≥0) une alerte
function openAlertModal(idx) {
    if (idx === -1) {
        alert(t('alertDevWarning', { notifParen: getNotifParenText(), iosLine: getIosLineText() }));
    }
    // Modifier une alerte dont tous les types sont inactifs est refusé (le menu ne les listerait
    // pas, et l'enregistrement produirait une alerte sans type valide) — elle reste supprimable.
    if (idx !== -1) {
        const a0 = settings.alerts[idx];
        if (!a0.typeIds.some(isTypeActiveId)) {
            alert(t('alertTypeInactiveEdit', { label: getAlertName(a0) }));
            return;
        }
    }
    const active = getActiveTypes();
    const prevIds = idx !== -1 ? settings.alerts[idx].typeIds : [];

    // Types proposés : les types actifs, plus ceux (même inactifs) déjà présents dans l'alerte éditée
    alertModalTypes = settings.types
        .filter(tp => tp.active || prevIds.includes(tp.id))
        .sort((a, b) => a.id - b.id)
        .map(tp => ({ id: tp.id, label: tp.label, active: !!tp.active }));

    // Valeurs par défaut ou existantes
    if (idx === -1) {
        document.getElementById('alert-modal-title').innerText = t('alertNewTitle');
        document.getElementById('alert-edit-index').value = -1;
        // Préremplissage : type de la période en cours (à défaut le type 4, puis le premier type actif),
        // 30 min, rappel 10 min, 3 alertes
        const preId = active.some(tp => tp.id === state.activeType) ? state.activeType
            : (active.some(tp => tp.id === 4) ? 4 : active[0]?.id);
        alertModalSelected = new Set(preId !== undefined ? [preId] : []);
        document.getElementById('alert-threshold').value = 30;
        document.getElementById('alert-interval').value = 10;
        document.getElementById('alert-maxcount').value = 3;
    } else {
        const a = settings.alerts[idx];
        document.getElementById('alert-modal-title').innerText = t('alertEditTitle');
        document.getElementById('alert-edit-index').value = idx;
        alertModalSelected = new Set(a.typeIds);
        document.getElementById('alert-threshold').value = a.threshold;
        document.getElementById('alert-interval').value = a.interval;
        document.getElementById('alert-maxcount').value = a.maxCount;
    }

    renderAlertModalTypes();
    document.getElementById('alertModal').style.display = 'flex';
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

// Reprogramme les alertes de la période en cours après un changement de réglages.
// scheduleAlerts() conserve le registre « déjà jouée » et relâche lui-même le Wake Lock
// s'il ne reste aucune alerte active.
function rescheduleAlertsForActivePeriod() {
    if (state.activeType === null || state.startTime === null) return;
    scheduleAlerts(state.activeType, state.startTime);
}

// Sauvegarde une alerte (nouvelle ou éditée)
function saveAlert() {
    requestNotificationPermission(); // Demande liée au geste "Enregistrer" — requis par iOS/Safari
    const idx = parseInt(document.getElementById('alert-edit-index').value);
    const threshold = parseInt(document.getElementById('alert-threshold').value);
    const interval = parseInt(document.getElementById('alert-interval').value);
    const maxCount = parseInt(document.getElementById('alert-maxcount').value);

    // Types cochés, dans l'ordre des pastilles. Au moins un doit être actif : une alerte
    // dont tous les types sont inactifs ne se déclencherait jamais.
    const typeIds = alertModalTypes.filter(tp => alertModalSelected.has(tp.id)).map(tp => tp.id);
    if (!typeIds.some(isTypeActiveId)) return alert(t('alertValidTypes'));

    // Validation minimale
    if (isNaN(threshold) || threshold < 1) return alert(t('alertValidThreshold'));
    if (isNaN(interval) || interval < 1) return alert(t('alertValidInterval'));
    if (isNaN(maxCount) || maxCount < 1 || maxCount > 5)
        return alert(t('alertValidMaxCount'));

    // Une autre alerte porte déjà sur exactement le même ensemble de types : confirmation avant de la remplacer
    const dup = settings.alerts.findIndex((a, i) => i !== idx && sameTypeSet(a.typeIds, typeIds));
    if (dup !== -1) {
        const d = settings.alerts[dup];
        const details = `${d.threshold} min · +${d.interval} min · ${d.maxCount}x`;
        if (!confirm(t('alertReplaceConfirm', { details }))) return; // le modal reste ouvert
    }

    const prev = idx !== -1 ? settings.alerts[idx] : null;
    const newAlert = { id: prev ? prev.id : newAlertId(), typeIds, enabled: true, threshold, interval, maxCount };

    if (idx === -1) {
        if (dup !== -1) {
            newAlert.id = settings.alerts[dup].id;
            settings.alerts[dup] = newAlert;
        } else {
            settings.alerts.push(newAlert);
        }
    } else {
        settings.alerts[idx] = newAlert;
        if (dup !== -1) {
            const removedId = settings.alerts[dup].id;
            settings.alerts.splice(dup, 1);
            forgetSentAlerts(removedId);
        }
    }

    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    closeAlertModal();
    renderAlertsList();
    console.log(`[saveAlert] Alerte sauvegardée : ${newAlert.id} (typeIds=${typeIds.join(',')})`);

    // Alerte redéfinie : ses vagues déjà jouées ne comptent plus. scheduleAlerts() décide
    // lui-même de tenir ou relâcher le Wake Lock selon les vagues restantes.
    forgetSentAlerts(newAlert.id);
    rescheduleAlertsForActivePeriod();
}

// Supprime une alerte
function deleteAlert(idx) {
    if (!confirm(t('alertDeleteConfirm'))) return;

    const id = settings.alerts[idx].id;
    settings.alerts.splice(idx, 1);
    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    renderAlertsList();
    console.log(`[deleteAlert] Alerte supprimée (index ${idx})`);

    forgetSentAlerts(id);
    rescheduleAlertsForActivePeriod();
}

// Règle : quand TOUS les types d'une alerte sont inactifs (quel que soit le mécanisme : toggle,
// profil, import), l'alerte passe automatiquement à inactive (même toggle que d'habitude — un
// seul moyen d'avoir une alerte inactive) ; on ne la réactive pas seule quand un type revient.
// Tant qu'un type de l'ensemble reste actif, la définition n'est pas modifiée.
// Retire aussi les types qui n'existent plus (typeId null/NaN, hérité d'un ancien bug
// d'édition d'alerte) ; une alerte sans aucun type valide est supprimée.
// persist=false : l'appelant écrit lui-même les réglages (import JSON, toggle de type...).
// Retourne true si une alerte de la période EN COURS vient d'être désactivée (l'appelant
// doit alors appeler rescheduleAlertsForActivePeriod()).
function syncAlertsWithTypes(persist = true) {
    if (!Array.isArray(settings.alerts)) return false;
    let changed = false;
    let activeTypeAffected = false;

    settings.alerts.forEach(a => {
        const valid = a.typeIds.filter(id => settings.types.some(tp => tp.id === id));
        if (valid.length !== a.typeIds.length) { a.typeIds = valid; changed = true; }
    });
    const before = settings.alerts.length;
    settings.alerts = settings.alerts.filter(a => a.typeIds.length > 0);
    if (settings.alerts.length !== before) changed = true;

    settings.alerts.forEach(a => {
        if (a.enabled && !a.typeIds.some(isTypeActiveId)) {
            a.enabled = false;
            changed = true;
            if (a.typeIds.includes(state.activeType)) activeTypeAffected = true;
        }
    });

    if (changed) {
        console.log('[syncAlertsWithTypes] Alertes ajustées (types inactifs ou invalides)');
        if (persist) {
            safeSave('pacingSettings', JSON.stringify(settings));
            if (document.getElementById('page-settings').classList.contains('active')) renderAlertsList();
        }
    }
    return activeTypeAffected;
}

// Active/désactive une alerte via le toggle
function toggleAlert(idx) {
    const a = settings.alerts[idx];
    // Activer une alerte dont tous les types sont inactifs est refusé : un type doit d'abord être réactivé.
    if (!a.enabled && !a.typeIds.some(isTypeActiveId)) {
        alert(t('alertTypeInactiveToggle', { label: getAlertName(a) }));
        return;
    }
    a.enabled = !a.enabled;
    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    renderAlertsList();
    console.log(`[toggleAlert] Alerte ${a.id} : enabled=${a.enabled}`);
    forgetSentAlerts(a.id);
    rescheduleAlertsForActivePeriod();
}

// Demande la permission notifications — appelée depuis un geste utilisateur (ex: saveAlert())
async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        console.log('[Notif] Permission :', perm);
    }
}

// Retourne un texte lisible décrivant l'état actuel de la permission notif,
// pour affichage dans alertDevWarning (clé {status}).
function getNotifStatusLabel() {
    if (!('Notification' in window)) return t('notifStatusUnsupported');
    if (Notification.permission === 'granted') return t('notifStatusGranted');
    if (Notification.permission === 'denied') return t('notifStatusDenied');
    return t('notifStatusDefault');
}

// Détecte iOS/iPadOS (iPadOS 13+ se présente comme "MacIntel" avec support tactile)
function isIOSDevice() {
    const ua = navigator.userAgent;
    if (/iPhone|iPod|iPad/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Détecte si l'app tourne en mode installé (standalone) — navigator.standalone est spécifique iOS
function isPWAInstalled() {
    return window.navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
}

// Construit la ligne iOS pour alertDevWarning — 1er tiret, vide si pas sur iOS (clé {iosLine})
function getIosLineText() {
    if (!isIOSDevice()) return '';
    const status = isPWAInstalled() ? t('iosInstallDone') : t('iosInstallTodo');
    return `- ${t('iosLineLabel')} : ${status}\n`;
}

// Construit la parenthèse de statut notif — masquée si iOS et pas encore installé
// (le 1er tiret l'indique déjà, pas la peine de la répéter ici)
function getNotifParenText() {
    if (isIOSDevice() && !isPWAInstalled()) return '';
    return ` (${getNotifStatusLabel()})`;
}


// ============================================================
// PLAN D'ALERTES — calcul commun aux canaux local et serveur
// ============================================================

const RUN_GAP_TOLERANCE_MS = 1; // closePeriod() coupe à 23:59:59.999 : la suite démarre 1 ms plus tard

// Début de la séquence sur laquelle une alerte compte son seuil : temps CONTINU passé dans
// l'ensemble de types de l'alerte. On remonte l'historique depuis le début de la période en
// cours tant que les périodes sont accolées (fin = début de la suivante, à 1 ms près) et d'un
// type de l'ensemble. Changer de type à l'intérieur de l'ensemble ne remet donc rien à zéro ;
// arrêter l'enregistrement (ou passer par un type hors ensemble) coupe la séquence.
// Retourne null si le type actif n'appartient pas à l'ensemble (pas d'alerte).
// Ne dépend pas de l'ordre de state.history (suppressions, imports).
function getRunStart(config, activeType, startTime) {
    if (!config.typeIds.includes(activeType)) return null;
    const hist = state.history;
    let cursor = startTime;
    for (let guard = 0; guard < 100000; guard++) {
        let found = null;
        for (let i = hist.length - 1; i >= 0; i--) {
            const e = hist[i];
            if (e.start < cursor && e.end <= cursor && cursor - e.end <= RUN_GAP_TOLERANCE_MS
                && config.typeIds.includes(e.typeId)) { found = e; break; }
        }
        if (!found) break;
        cursor = found.start;
    }
    return cursor;
}

// Liste des vagues d'une alerte : { index, fireAt (ms), mins (minutes depuis le début) }.
// Fonction pure : ne lit ni l'état, ni l'heure, ni le DOM. Les vagues déjà passées sont incluses,
// c'est à l'appelant de les écarter (programmation) ou de les rattraper (retour au premier plan).
function computeAlertPlan(config, runStart) {
    const plan = [];
    for (let i = 0; i < config.maxCount; i++) {
        plan.push({
            index: i,
            fireAt: runStart + config.threshold * 60000 + i * config.interval * 60000,
            mins: config.threshold + i * config.interval
        });
    }
    return plan;
}

// Alertes actives qui concernent le type en cours : [{ config, runStart, plan }].
// Plusieurs alertes peuvent s'appliquer en même temps (ensembles qui se chevauchent).
function getAlertRuns(typeId, startTime) {
    const runs = [];
    (settings.alerts || []).forEach(config => {
        if (!config.enabled) return;
        const runStart = getRunStart(config, typeId, startTime);
        if (runStart === null) return;
        runs.push({ config, runStart, plan: computeAlertPlan(config, runStart) });
    });
    return runs;
}

// ============================================================
// REGISTRE « DÉJÀ JOUÉE » — state.sentAlerts (partagé par les canaux)
// Une entrée par vague jouée : { alertId, runStart, waveIndex, firedAt, source }
// source : 'timer' (rappel à l'heure) ou 'catchup' (couvert par un rattrapage).
// La clé (alertId, runStart, waveIndex) ne dépend pas du type en cours : elle survit aux
// changements de type à l'intérieur d'une séquence.
// ============================================================

function isWavePlayed(alertId, runStart, waveIndex) {
    return state.sentAlerts.some(s => s.alertId === alertId && s.runStart === runStart && s.waveIndex === waveIndex);
}

// Le registre existe en deux copies : state.sentAlerts (celle de la page, synchrone : une vague est
// marquée avant l'attente du service worker) et IndexedDB, clé 'played' (lisible par le service
// worker). Chaque changement de la page est recopié dans IndexedDB ; mergePlayedFromStore() ajoute à
// la copie de la page ce que le service worker a joué. Voir js/alerts-shared-sw.js.
function markWavePlayed(alertId, runStart, waveIndex, source) {
    const entry = { alertId, runStart, waveIndex, firedAt: Date.now(), source };
    state.sentAlerts.push(entry);
    return entry;
}

// Retire du registre des entrées (retournées par markWavePlayed) : la notification n'a pas pu être envoyée.
function unmarkWavePlayed(entries) {
    state.sentAlerts = state.sentAlerts.filter(s => !entries.includes(s));
    const keys = new Set(entries.map(e => alertsWaveKey(e.alertId, e.runStart, e.waveIndex)));
    mirrorPlayedFilter(s => !keys.has(alertsWaveKey(s.alertId, s.runStart, s.waveIndex)));
}

// Recopie dans IndexedDB (sans attendre ; une erreur n'empêche pas l'app de fonctionner).
function mirrorPlayedAdd(entries) {
    alertsPlayedAdd(entries).catch(e => console.warn('[registre] ⚠️ Copie IndexedDB (ajout) impossible :', e));
}

function mirrorPlayedFilter(keep) {
    alertsPlayedFilter(keep).catch(e => console.warn('[registre] ⚠️ Copie IndexedDB (nettoyage) impossible :', e));
}

// Ajoute à la copie de la page les vagues jouées par un autre acteur (service worker). Appelée au début de
// playDueWaves, donc avant toute décision d'affichage. Attente limitée : une IndexedDB qui ne répond pas
// ne doit jamais empêcher une notification.
async function mergePlayedFromStore() {
    let timer = null;
    try {
        const stored = await Promise.race([
            alertsPlayedRead(),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), 800); })
        ]);
        if (!stored) return;
        const merged = alertsMergePlayed(state.sentAlerts, stored);
        if (merged.length !== state.sentAlerts.length) {
            console.log(`[registre] 🔄 ${merged.length - state.sentAlerts.length} vague(s) jouée(s) ailleurs ajoutée(s)`);
            state.sentAlerts = merged;
            saveState();
        }
    } catch (e) {
        console.warn('[registre] ⚠️ Lecture IndexedDB impossible :', e);
    } finally {
        clearTimeout(timer);
    }
}

// Ne garde que les entrées des séquences en cours (les autres ne servent plus).
// Retourne true si le registre a changé (l'appelant fait saveState()).
function pruneSentAlerts(runs) {
    const before = state.sentAlerts.length;
    const keep = s => runs.some(r => r.config.id === s.alertId && r.runStart === s.runStart);
    state.sentAlerts = state.sentAlerts.filter(keep);
    if (state.sentAlerts.length === before) return false;
    mirrorPlayedFilter(keep);
    return true;
}

// Oublie les vagues jouées d'une alerte (redéfinie, activée/désactivée, supprimée).
function forgetSentAlerts(alertId) {
    state.sentAlerts = state.sentAlerts.filter(s => s.alertId !== alertId);
    mirrorPlayedFilter(s => s.alertId !== alertId);
    saveState();
}

// ============================================================
// TEXTES DES NOTIFICATIONS
// ============================================================

// Rappel à l'heure : titre = nom de l'alerte, corps = « 30 min (rappel 1/3) ».
function buildReminderText(config, wave) {
    return {
        title: getAlertName(config),
        body: t('alertNotifBody', { mins: wave.mins, n: wave.index + 1, total: config.maxCount })
    };
}

// ============================================================
// PLAN DES ALERTES POUR LE SERVICE WORKER (stocké dans IndexedDB, clé 'plan')
// Toutes les vagues (passées et futures) de la séquence en cours, avec leur texte déjà traduit :
// le service worker n'a ni translations.js ni les réglages. Les modèles du rattrapage sont
// stockés tels quels (avec leurs {variables}) : seuls le nom, la durée et le rang sont connus
// au moment de l'affichage. alertOrder = position de l'alerte dans les réglages (ordre des lignes
// du rattrapage à durée égale). Le plan est lu par la page (playDueWaves) comme par le service worker. Aucun horodatage de construction : deux plans identiques donnent
// le même JSON, ce qui permet de ne pas réécrire inutilement.
// ============================================================

function buildServerPlan(typeId, startTime) {
    const waves = [];
    if (typeId !== null && startTime !== null) {
        getAlertRuns(typeId, startTime).forEach(run => {
            const name = getAlertName(run.config);
            const alertOrder = settings.alerts.indexOf(run.config);
            run.plan.forEach(wave => {
                const text = buildReminderText(run.config, wave);
                waves.push({
                    alertId: run.config.id, alertOrder, name, runStart: run.runStart,
                    index: wave.index, total: run.config.maxCount, mins: wave.mins, fireAt: wave.fireAt,
                    tag: `pacing-${run.config.id}-w${wave.index}`, title: text.title, body: text.body
                });
            });
        });
        waves.sort((a, b) => a.fireAt - b.fireAt);
    }
    return {
        v: 1, lang: settings.lang,
        texts: {
            notifBody: t('alertNotifBody'), catchupTitle1: t('alertCatchupTitle1'),
            catchupTitleN: t('alertCatchupTitleN'), catchupLine: t('alertCatchupLine')
        },
        waves
    };
}

let alertPlanLastJson = null; // dernier plan écrit (ou en cours d'écriture) : évite les écritures inutiles

// Enregistre le plan courant s'il a changé. Appelée à chaque (re)programmation des alertes,
// quand la page passe en arrière-plan et au changement de langue. Sans effet bloquant :
// si IndexedDB est indisponible, l'app continue normalement (canal local).
async function refreshAlertPlanStore(typeId, startTime) {
    try {
        if (typeId === undefined) { typeId = state.activeType; startTime = state.startTime; } // sans argument : période en cours
        const plan = buildServerPlan(typeId, startTime);
        const json = JSON.stringify(plan);
        if (json === alertPlanLastJson) return;
        alertPlanLastJson = json; // avant l'attente : deux appels rapprochés ne doublent pas l'écriture
        await alertsStoreSet('plan', plan);
        console.log(`[plan] 💾 Plan des alertes enregistré (${plan.waves.length} vague(s))`);
    } catch (e) {
        alertPlanLastJson = null; // prochain appel : nouvel essai
        console.warn('[plan] ⚠️ Plan des alertes non enregistré :', e);
    }
}
