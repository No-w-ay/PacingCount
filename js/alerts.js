// js/alerts.js — Alertes de périodes : partie commune aux deux modes (local / serveur).
// Réglages des alertes (settings.alerts[]), interface de la liste et de la fenêtre d'édition,
// état des notifications (permission, iOS, installation).
//   Mode local (minuteries, Wake Lock, pseudo-veille, rattrapage) : js/alerts-local.js
//   Mode serveur (Web Push, Worker Cloudflare)                     : js/alerts-server.js
// Script classique, pas un module : les fonctions doivent rester globales (le HTML généré
// utilise des onclick="toggleAlert(...)"). Elles lisent settings, state, t()… définis dans
// index.html, mais seulement à l'exécution (jamais au chargement du fichier).

// ============================================================
// 7. GESTION DES ALERTES DE PÉRIODES (réglages)
// Lecture/écriture dans settings.alerts[].
// Le fonctionnement effectif (notifications SW) sera implémenté séparément.
// Structure d'une alerte :
//   { typeId, enabled, threshold, interval, maxCount, wave }
// ============================================================

// Rendu de la liste des alertes dans l'onglet réglages
function renderAlertsList() {
    const container = document.getElementById('alerts-list');
    if (!container) return;
    const active = getActiveTypes();

    if (!settings.alerts || settings.alerts.length === 0) {
        container.innerHTML = `<p style="opacity:0.5; font-size:0.85rem; margin:0 0 6px 0;">
                    ${t('alertNoAlerts')}</p>`;
        return;
    }

    container.innerHTML = settings.alerts.map((alert, idx) => {
        const alertColor = getColorForId(alert.typeId);
        const label = getLabelForId(alert.typeId);
        const waveLabel = alert.wave ? t('alertModeWave') : t('alertModeSingle');
        const toggleBg = alert.enabled ? 'var(--green)' : '#555';
        const togglePos = alert.enabled ? '22px' : '2px';

        return `
                <div style="display:flex; align-items:center; justify-content:space-between;
                            padding:10px 0; border-bottom:1px solid var(--border);">
                    <div style="flex-grow:1;">
                        <span style="color: ${alertColor}; font-weight:bold;">●</span>
                        <span style="font-weight:bold; margin-left:4px;">${label}</span>
                        <br>
                        <span style="font-size:0.8rem; opacity:0.7;">
                            ${t('alertThreshold')} ${alert.threshold} min ·
                            +${alert.interval} min · ${alert.maxCount}x · ${waveLabel}
                        </span>
                    </div>
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
                    <div style="display:flex; gap:4px;">
                        <button class="btn-icon" onclick="openAlertModal(${idx})">✏️</button>
                        <button class="btn-icon" onclick="deleteAlert(${idx})">🗑️</button>
                    </div>
                </div>`;
    }).join('');
}

// Ouvre le modal pour ajouter (idx=-1) ou éditer (idx≥0) une alerte
function openAlertModal(idx) {
    if (idx === -1) {
        alert(t('alertDevWarning', { notifParen: getNotifParenText(), iosLine: getIosLineText() }));
    }
    // Modifier l'alerte d'un type inactif est refusé (le menu ne listerait pas ce type, et
    // l'enregistrement produirait une alerte sans type valide) — elle reste supprimable.
    if (idx !== -1) {
        const a0 = settings.alerts[idx];
        const tp0 = settings.types.find(x => x.id === a0.typeId);
        if (!tp0 || !tp0.active) {
            alert(t('alertTypeInactiveEdit', { label: getLabelForId(a0.typeId) || `#${a0.typeId}` }));
            return;
        }
    }
    const active = getActiveTypes();

    // Rempli le select des types
    const sel = document.getElementById('alert-type');
    sel.innerHTML = active.map(tp => {
        return `<option value="${tp.id}">${tp.label}</option>`;
    }).join('');

    // Valeurs par défaut ou existantes
    if (idx === -1) {
        document.getElementById('alert-modal-title').innerText = t('alertNewTitle');
        document.getElementById('alert-edit-index').value = -1;
        // Préremplissage : type 4 (à défaut, le premier type actif), 30 min, rappel 10 min, 3 alertes
        document.getElementById('alert-type').value = active.some(tp => tp.id === 4) ? 4 : (active[0]?.id || 1);
        document.getElementById('alert-threshold').value = 30;
        document.getElementById('alert-interval').value = 10;
        document.getElementById('alert-maxcount').value = 3;
        // document.getElementById('alert-wave-single').checked = true;
    } else {
        const a = settings.alerts[idx];
        document.getElementById('alert-modal-title').innerText = t('alertEditTitle');
        document.getElementById('alert-edit-index').value = idx;
        document.getElementById('alert-type').value = a.typeId;
        document.getElementById('alert-threshold').value = a.threshold;
        document.getElementById('alert-interval').value = a.interval;
        document.getElementById('alert-maxcount').value = a.maxCount;
        /*  if (a.wave) {
              document.getElementById('alert-wave-multi').checked = true;
          } else {
              document.getElementById('alert-wave-single').checked = true;
          }
              */
    }

    document.getElementById('alertModal').style.display = 'flex';
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

// Sauvegarde une alerte (nouvelle ou éditée)
function saveAlert() {
    requestNotificationPermission(); // Demande liée au geste "Enregistrer" — requis par iOS/Safari
    const idx = parseInt(document.getElementById('alert-edit-index').value);
    const typeId = parseInt(document.getElementById('alert-type').value);
    const threshold = parseInt(document.getElementById('alert-threshold').value);
    const interval = parseInt(document.getElementById('alert-interval').value);
    const maxCount = parseInt(document.getElementById('alert-maxcount').value);
    //const wave = document.getElementById('alert-wave-multi').checked;
    const wave = false; //désactivation du mode


    // Validation minimale
    if (isNaN(threshold) || threshold < 1) return alert(t('alertValidThreshold'));
    if (isNaN(interval) || interval < 1) return alert(t('alertValidInterval'));
    if (isNaN(maxCount) || maxCount < 1 || maxCount > 5)
        return alert(t('alertValidMaxCount'));

    // Type invalide ou inactif : ne devrait pas arriver (le menu ne liste que les types actifs),
    // mais ne jamais enregistrer une alerte sans type valide.
    if (!settings.types.some(tp => tp.id === typeId && tp.active)) {
        console.warn('[saveAlert] typeId invalide ou inactif :', typeId);
        closeAlertModal();
        return;
    }

    const newAlert = { typeId, enabled: true, threshold, interval, maxCount, wave };

    if (idx === -1) {
        // Ajout — vérifie si une alerte pour ce type existe déjà et la remplace
        const existing = settings.alerts.findIndex(a => a.typeId === typeId);
        if (existing !== -1) {
            settings.alerts[existing] = newAlert;
        } else {
            settings.alerts.push(newAlert);
        }
    } else {
        // Édition
        settings.alerts[idx] = newAlert;
    }

    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    closeAlertModal();
    renderAlertsList();
    console.log(`[saveAlert] Alerte sauvegardée pour typeId=${typeId}`);

    // Si on modifie une alerte qui concerne la période EN COURS — scheduleAlerts()
    // décide lui-même de tenir ou relâcher le Wake Lock selon les vagues restantes,
    // pas besoin de requestWakeLock() séparé ici.
    if (state.activeType === typeId) {
        cancelAlerts();
        scheduleAlerts(state.activeType, state.startTime); // Met à jour le programme des notifs
    }
}

// Supprime une alerte
function deleteAlert(idx) {
    if (!confirm(t('alertDeleteConfirm'))) return;

    const typeId = settings.alerts[idx].typeId; // On mémorise le type avant suppression
    settings.alerts.splice(idx, 1);
    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    renderAlertsList();
    console.log(`[deleteAlert] Alerte supprimée (index ${idx})`);

    // Réagir si on supprime l'alerte de la période en cours
    if (state.activeType === typeId) {
        cancelAlerts();
        scheduleAlerts(state.activeType, state.startTime);
    }
}

// Règle : quand un type devient inactif (quel que soit le mécanisme : toggle, profil, import),
// ses alertes passent automatiquement à inactif (même toggle que d'habitude — un seul
// moyen d'avoir une alerte inactive) ; on ne les réactive pas seul quand le type revient.
// Supprime aussi les alertes sans type valide (typeId null/NaN, hérité d'un ancien bug
// d'édition d'alerte). persist=false : l'appelant écrit lui-même les réglages (import JSON,
// toggle de type...). Retourne true si l'alerte de la période EN COURS vient d'être
// désactivée (l'appelant doit alors appeler rescheduleAlertsForActivePeriod()).
function syncAlertsWithTypes(persist = true) {
    if (!Array.isArray(settings.alerts)) return false;
    let changed = false;
    let activeTypeAffected = false;

    const before = settings.alerts.length;
    settings.alerts = settings.alerts.filter(a => settings.types.some(tp => tp.id === a.typeId));
    if (settings.alerts.length !== before) changed = true;

    settings.alerts.forEach(a => {
        const tp = settings.types.find(x => x.id === a.typeId);
        if (a.enabled && tp && !tp.active) {
            a.enabled = false;
            changed = true;
            if (a.typeId === state.activeType) activeTypeAffected = true;
        }
    });

    if (changed) {
        console.log('[syncAlertsWithTypes] Alertes ajustées (type inactif ou type invalide)');
        if (persist) {
            safeSave('pacingSettings', JSON.stringify(settings));
            if (document.getElementById('page-settings').classList.contains('active')) renderAlertsList();
        }
    }
    return activeTypeAffected;
}

// Reprogramme les alertes de la période en cours après un changement de réglages (même
// schéma que le retour au premier plan : sentAlerts conservé autour de scheduleAlerts()).
// scheduleAlerts() relâche lui-même le Wake Lock s'il ne reste aucune alerte active.
function rescheduleAlertsForActivePeriod() {
    if (state.activeType === null || state.startTime === null) return;
    const savedSent = [...(state.sentAlerts || [])];
    scheduleAlerts(state.activeType, state.startTime);
    state.sentAlerts = savedSent;
    saveState();
}

// Active/désactive une alerte via le toggle
function toggleAlert(idx) {
    // Activer l'alerte d'un type inactif est refusé : le type doit d'abord être réactivé.
    if (!settings.alerts[idx].enabled) {
        const tp = settings.types.find(x => x.id === settings.alerts[idx].typeId);
        if (!tp || !tp.active) {
            alert(t('alertTypeInactiveToggle', { label: getLabelForId(settings.alerts[idx].typeId) || `#${settings.alerts[idx].typeId}` }));
            return;
        }
    }
    settings.alerts[idx].enabled = !settings.alerts[idx].enabled;
    localStorage.setItem('pacingSettings', JSON.stringify(settings));
    renderAlertsList();
    console.log(`[toggleAlert] Alerte ${idx} : enabled=${settings.alerts[idx].enabled}`);
    // Réagir si on désactive/réactive l'alerte de la période en cours
    if (state.activeType === settings.alerts[idx].typeId) {
        cancelAlerts();
        scheduleAlerts(state.activeType, state.startTime);
    }
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

// Début de la séquence à partir de laquelle on compte le seuil d'une alerte.
// Aujourd'hui : début de la période en cours (une alerte = un type). Point d'entrée prévu pour
// les combinaisons de types (séquence continue de périodes accolées, calcul depuis l'historique).
function getRunStart(config, activeType, startTime) {
    return startTime;
}

// Liste des vagues d'une alerte : { index, fireAt (ms), mins (minutes depuis le début), isLast }.
// Fonction pure : ne lit ni l'état, ni l'heure, ni le DOM. Les vagues déjà passées sont incluses,
// c'est à l'appelant de les écarter (programmation) ou de les rattraper (retour au premier plan).
function computeAlertPlan(config, runStart) {
    const plan = [];
    for (let i = 0; i < config.maxCount; i++) {
        plan.push({
            index: i,
            fireAt: runStart + config.threshold * 60000 + i * config.interval * 60000,
            mins: config.threshold + i * config.interval,
            isLast: i === config.maxCount - 1
        });
    }
    return plan;
}
