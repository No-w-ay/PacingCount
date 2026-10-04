
// ============================================================
// 19. EXPORT CSV
// Nouveau format : Date ISO (AAAA-MM-JJ), colonnes TypeId + TypeLabel.
// Sans BOM UTF-8 : compatible Google Sheets ET Excel moderne.
// La colonne Minutes est conservée pour la lisibilité tableur.
// ============================================================
// Construit la chaîne CSV — séparée du téléchargement pour être réutilisable
// par le repli manuel (voir showManualExportModal()).
function buildCSVString() {
    let csv = "sep=,\n";
    csv += "Date,Start Hour,End Hour,TypeId,TypeLabel,Minutes (rounded)\n";

    let allPeriods = [...state.history];
    if (state.activeType) {
        allPeriods.push({ typeId: state.activeType, start: state.startTime, end: Date.now() });
    }

    allPeriods.forEach(e => {
        const d = new Date(e.start);
        // Format ISO AAAA-MM-JJ : meilleur tri et compatibilité internationale
        const dateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const label = getLabelForId(e.typeId);
        const minutes = Math.round((e.end - e.start) / 60000);
        csv += `${dateStr},${formatTime(e.start)},${formatTime(e.end)},${e.typeId},${label},${minutes}\n`;
    });

    return csv;
}

function exportCSV() {
    console.log("[exportCSV] Début de l'export");

    // Détection en amont, pas après-coup — le téléchargement blob est un mécanisme
    // "à l'aveugle" (aucun signal succès/échec renvoyé par le navigateur), donc pas
    // de détection fiable possible une fois la tentative faite. On sait par contre,
    // par construction, que ça échoue dans les navigateurs intégrés connus (Facebook, Reddit, etc.).
    if (isFacebookInAppBrowser()) {
        console.log(`[exportCSV] Navigateur intégré détecté (${getInAppBrowserName()}) — repli manuel direct`);
        showManualExportModal(buildCSVString());
        return;
    }

    try {
        const csv = buildCSVString();

        // BOM UTF-8 : assure la compatibilité Excel (Windows/Mac) et LibreOffice
        // const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });  
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });  // colonnes ok Excel et Sheet, mais pas accents
        // const blob = new Blob([csv], { type: 'text/csv;charset=windows-1252;' });  // test pour voir si améliore accents -> NON
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.style.display = 'none';
        a.href = url;
        a.download = `pacing_export_${new Date().toISOString().slice(0, 10)}.csv`;

        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        // Event export-csv pour statistiques GoatCounter
        //if (window.goatcounter && navigator.onLine) {
        //    window.goatcounter.count({ path: 'export-csv' });
        //}

        // Event export-csv pour statistiques GoatCounter
        if (navigator.onLine) {
            sendToGoatCounter('export-csv');
        }

        console.log("[exportCSV] Export terminé");
    } catch (err) {
        console.error("[exportCSV] Erreur :", err);
    }
}

// ============================================================
// 19a. EXPORT JSON (sauvegarde complète)
// Miroir direct des structures internes, sans transformation (voir synthèse notes/événements,
// §4) : ce qui est exporté = ce qui existe en mémoire à cet instant. Contrairement au CSV
// (périodes seules), contient aussi les événements journaliers, la définition des tags et la
// configuration des types. Les alertes et préférences d'affichage (propres à l'appareil) ne
// sont PAS exportées. Cas d'un navigateur intégré (webview) : pas de traitement particulier
// ici pour l'instant (décision reportée) — le téléchargement y est tenté normalement.
// ============================================================
const JSON_EXPORT_FORMAT_VERSION = 1; // incrémenter si la structure du fichier change de façon incompatible

function buildJSONExport() {
    // Périodes : historique tel quel (champ `note` conservé s'il existe) + période active
    // exportée comme période close (end = maintenant), comme le fait buildCSVString().
    const periodData = state.history.map(e => ({ ...e }));
    if (state.activeType !== null && state.startTime !== null) {
        periodData.push({ typeId: state.activeType, start: state.startTime, end: Date.now() });
    }
    return {
        format: 'pacingcount-export',
        formatVersion: JSON_EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        periodData,
        dailyData,
        eventTags: settings.eventTags,
        typesConfig: {
            activeProfile: settings.activeProfile,
            types: settings.types
        }
    };
}

function exportJSON() {
    console.log("[exportJSON] Début de l'export");
    try {
        const json = JSON.stringify(buildJSONExport());
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.style.display = 'none';
        a.href = url;
        a.download = `pacing_export_${new Date().toISOString().slice(0, 10)}.json`;

        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        if (navigator.onLine) sendToGoatCounter('export-json');
        console.log("[exportJSON] Export terminé");
    } catch (err) {
        console.error("[exportJSON] Erreur :", err);
    }
}

// ============================================================
// ⚠️ EXPORT MANUEL (navigateurs intégrés) — OUTIL DE DÉPANNAGE, PRATIQUEMENT INUTILISÉ
// Ce qu'il fait : dans un navigateur intégré (Facebook, Reddit…), le téléchargement de fichier
//   par blob échoue ("Impossible de charger la page"). Ce modal affiche donc le CSV en texte
//   à copier/coller.
// Pourquoi il est quasi inutilisé : un splash bloquant empêche tout nouvel utilisateur d'utiliser
//   l'app dans une webview, et les anciens utilisateurs webview ont migré. Seul le contournement
//   des 7 taps (attachFacebookBlockDebugBypass) permet encore d'y saisir des données.
// Où il reste branché (contextes webview uniquement) : détection au début de exportCSV() (donc
//   le bouton "Export CSV partiel" des Réglages), écran d'export du cas webview avec données
//   (renderFacebookExportScreen), carte Réglages tier F.
// Les boutons d'export généraux (footer, toasts de stockage, mise à jour, iOS) appellent
//   exportJSON() directement et ne passent PAS par ici : ils ne fonctionnent donc pas dans un
//   webview. Voulu (simplicité, comportement identique sur toutes les plateformes).
// Code volontairement conservé.
// ============================================================

// ============================================================
// 19b. REPLI EXPORT MANUEL (navigateurs intégrés — Facebook, Reddit, WhatsApp, etc.)
// Le presse-papier est lui-même documenté comme bloqué dans ce contexte (bug connu,
// certains navigateurs intégrés Android) — donc bouton "Copier" en tentative best-effort seulement,
// la vraie garantie reste le texte affiché en clair, sélectionnable manuellement,
// qui ne dépend d'aucune API susceptible d'être bridée.
// ============================================================

function showManualExportModal(csv) {
    const filename = `pacing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.getElementById('manual-export-instructions').innerHTML =
        t('manualExportInstructions', { filename });
    const textarea = document.getElementById('manual-export-textarea');
    textarea.value = csv;
    document.getElementById('manualExportModal').style.display = 'flex';

    // Sélectionne tout le texte au premier tap/clic — facilite la copie manuelle
    textarea.onclick = () => textarea.select();
    setTimeout(() => textarea.select(), 50); // sélection immédiate à l'ouverture aussi

    if (navigator.onLine) sendToGoatCounter('export-csv-manual-fallback');
}

function closeManualExportModal() {
    document.getElementById('manualExportModal').style.display = 'none';
}

// Tentative presse-papier — best-effort, peut échouer silencieusement selon le contexte
// (voir commentaire de section ci-dessus). Le texte affiché reste la vraie garantie.
async function copyManualExportText() {
    const textarea = document.getElementById('manual-export-textarea');
    textarea.select();
    try {
        await navigator.clipboard.writeText(textarea.value);
        const btn = document.getElementById('manual-export-copy-btn');
        const original = btn.textContent;
        btn.textContent = t('manualExportCopied');
        setTimeout(() => { btn.textContent = original; }, 2000);
    } catch (e) {
        console.warn('[showManualExportModal] Copie presse-papier échouée (attendu dans ce contexte) :', e);
    }
}

// ============================================================
// 20. IMPORT CSV
// Détecte automatiquement l'ancien format (JJ/MM/AAAA, colonne Type texte)
// et le nouveau format (AAAA-MM-JJ, colonnes TypeId + TypeLabel).
// Résolution : TypeId en priorité, puis label en fallback.
// Affiche un tableau de correspondance avant de confirmer l'import.
// ============================================================

// Parsing d'une date CSV : détecte automatiquement le format ancien ou nouveau
function parseCSVDate(dateStr, timeStr) {
    const parts = dateStr.split(/[-\/]/);
    if (parts.length !== 3) return NaN;
    let y, m, d;
    // Format ISO AAAA-MM-JJ : l'année est en premier (4 chiffres)
    if (parts[0].length === 4) {
        [y, m, d] = parts;
    } else {
        // Ancien format JJ/MM/AAAA : le jour est en premier
        [d, m, y] = parts;
    }

    const [hr, min, sec = '0'] = timeStr.split(':');
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d),
        parseInt(hr), parseInt(min), parseInt(sec)).getTime();

}

// Stockage temporaire des données en attente de confirmation utilisateur
let pendingImportData = null; // tableau de périodes parsées { key, start, end }
let pendingImportMapping = null; // correspondance clé → résolution de type

function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    console.log(`[importCSV] Lecture du fichier : ${file.name}`);
    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const text = e.target.result;

            const lines = text.split('\n')
                .map(l => l.trim().replace(/^\uFEFF/, ''))  // retire le BOM éventuel
                .filter(l => l && !l.startsWith('sep='));   // ignore la ligne sep= si présente

            /*     const lines = text.split('\n')
                     .map(l => l.trim().replace(/^\uFEFF/, '')) // retire le BOM éventuel
                     .filter(l => l);
                 */

            if (lines.length < 2) throw new Error("Fichier vide");

            // Lecture des en-têtes pour déterminer le format (robuste à l'ordre des colonnes)
            const header = lines[0].split(',').map(h => h.trim().toLowerCase());
            const iDate = header.indexOf('date');

            //const iDebut = header.indexOf('debut');
            //const iFin = header.indexOf('fin');
            const iDebut = header.indexOf('start hour') !== -1 ? header.indexOf('start hour') : header.indexOf('debut');
            const iFin = header.indexOf('end hour') !== -1 ? header.indexOf('end hour') : header.indexOf('fin');

            const iTypeId = header.indexOf('typeid');
            // 'typelabel' (nouveau format) ou 'type' (ancien format)
            const iTypeLabel = header.indexOf('typelabel') !== -1
                ? header.indexOf('typelabel')
                : header.indexOf('type');

            const importedPeriods = [];
            const typesSeen = {}; // clé unique → infos de résolution du type

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 3) continue;

                // Lecture des colonnes (avec fallback sur position fixe si en-têtes absents)
                const dateStr = cols[iDate !== -1 ? iDate : 0].trim();
                const debutStr = cols[iDebut !== -1 ? iDebut : 1].trim();
                const finStr = cols[iFin !== -1 ? iFin : 2].trim();

                const start = parseCSVDate(dateStr, debutStr);
                const end = parseCSVDate(dateStr, finStr);
                if (isNaN(start) || isNaN(end) || start >= end) continue;

                let csvTypeId = null;
                let csvLabel = null;

                if (iTypeId !== -1 && cols[iTypeId]) {
                    const parsed = parseInt(cols[iTypeId].trim());
                    if (!isNaN(parsed)) csvTypeId = parsed;
                }
                if (iTypeLabel !== -1 && cols[iTypeLabel]) {
                    csvLabel = cols[iTypeLabel].trim();
                }

                // Clé unique pour identifier ce type dans le fichier
                const key = csvTypeId !== null ? `id_${csvTypeId}` : `label_${csvLabel}`;

                if (!typesSeen[key]) {
                    let resolved = null;

                    // Normalisation pour comparaison accent+casse insensible
                    const normLabel = (s) => (s || '').normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

                    // Résolution par typeId en priorité — actifs et inactifs inclus
                    if (csvTypeId !== null) {
                        resolved = settings.types.find(t => t.id === csvTypeId) || null;
                    }
                    // Fallback par label normalisé (casse et accents insensibles)
                    if (!resolved && csvLabel) {
                        resolved = settings.types.find(t =>
                            normLabel(t.label) === normLabel(csvLabel)
                        ) || null;
                    }

                    typesSeen[key] = {
                        csvTypeId,
                        csvLabel: csvLabel || `Type ${csvTypeId}`,
                        resolvedId: resolved ? resolved.id : null,
                        resolvedLabel: resolved ? resolved.label : null,
                        resolvedActive: resolved ? resolved.active : null,
                        isNew: !resolved
                    };
                }

                importedPeriods.push({ key, start, end });
            }

            if (importedPeriods.length === 0) throw new Error("Aucune période valide trouvée");

            console.log(`[importCSV] ${importedPeriods.length} périodes parsées, ${Object.keys(typesSeen).length} types détectés`);

            pendingImportData = importedPeriods;
            pendingImportMapping = typesSeen;
            showImportModal();

        } catch (err) {
            alert(t('importError'));
            console.error("[importCSV] Erreur :", err);
        }
        event.target.value = ''; // Reset du champ fichier pour permettre un re-import du même fichier
    };

    reader.readAsText(file, 'UTF-8');
    // reader.readAsText(file, 'windows-1252'); // test
}

// Affiche le modal d'import avec le tableau de correspondances des types.
// Chaque type du fichier a un <select> pré-rempli automatiquement si possible :
//   - correspondance exacte par typeId ou label → sélectionné automatiquement
//   - migration connue (ancien id 3 + label standard) → redirigé vers id 4
//   - type non reconnu → "Ignorer" pré-sélectionné, ⚠️ visible
// processImport() lit les valeurs des selects au moment du clic.
function showImportModal() {
    console.log("[showImportModal] Affichage du modal de confirmation");

    // Normalisation pour comparaison accent+casse insensible — même logique que importCSV
    const normLabel = (s) => (s || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // Labels connus de l'ancien typeId 3 avant migration v0.9.24
    const OLD_TYPE3_LABELS = ["Non couché", "Not lying down", "Niet liggend"];

    // Détermine la cible et si c'est une correspondance exacte
    // ✅ = typeId identique ET label normalisé identique
    // 🔍 = tout le reste
    function resolveTarget(m) {
        const normCsv = normLabel(m.csvLabel);

        // ✅ Exact : même typeId ET même label normalisé
        if (m.csvTypeId !== null && m.resolvedId === m.csvTypeId) {
            const appType = settings.types.find(tp => tp.id === m.csvTypeId);
            if (appType && normLabel(appType.label) === normCsv) {
                return { targetId: m.csvTypeId, isExact: true };
            }
        }

        // 🔍 Migration connue : ancien label type 3 → type 4
        if (m.csvTypeId === 3 && OLD_TYPE3_LABELS.some(l => normLabel(l) === normCsv)) {
            if (settings.types.find(tp => tp.id === 4)) return { targetId: 4, isExact: false };
        }

        // 🔍 Label normalisé identique, typeId différent (actifs en priorité)
        const labelMatchActive = settings.types.find(tp =>
            tp.active && normLabel(tp.label) === normCsv && tp.id !== m.csvTypeId);
        if (labelMatchActive) return { targetId: labelMatchActive.id, isExact: false };

        const labelMatchInactive = settings.types.find(tp =>
            !tp.active && normLabel(tp.label) === normCsv && tp.id !== m.csvTypeId);
        if (labelMatchInactive) return { targetId: labelMatchInactive.id, isExact: false };

        // 🔍 typeId identique mais label différent (déjà dans resolvedId)
        if (m.resolvedId) return { targetId: m.resolvedId, isExact: false };

        // 🔍 Aucune correspondance → Ignorer
        return { targetId: null, isExact: false };
    }

    // Construit les options du select (tous les types, actifs et inactifs)
    function buildSelectOptions(selectedId) {
        let opts = settings.types.map(tp => {
            const sel = selectedId === tp.id ? ' selected' : '';
            const inactifNote = tp.active ? '' : ` ${t('typeInactivePlaceholder')}`;
            // Point 5 : format #N pour les ids dans les options
            return `<option value="${tp.id}"${sel}>${tp.label || t('typeNoNameOption')}${inactifNote} #${tp.id}</option>`;
        }).join('');
        const ignoreSel = selectedId === null ? ' selected' : '';
        opts += `<option value="ignore"${ignoreSel}>${t('importIgnoreOption')}</option>`;
        return opts;
    }

    // Couleur de la flèche → selon le type cible (grise si Ignorer ou null)
    function arrowColor(targetId) {
        return targetId !== null ? getColorForId(targetId) : '#666';
    }

    // Couleur de la bordure du select :
    // Point 7 : un seul gris #666 pour inactif ET ignorer (supprime le test #555 vs #666)
    function borderColor(targetId) {
        if (targetId === null) return '#666';
        const tp = settings.types.find(tp => tp.id === targetId);
        return tp?.active ? getColorForId(targetId) : '#666';
    }

    // Tri des entrées par csvTypeId croissant (sans id à la fin)
    const sortedEntries = Object.entries(pendingImportMapping).sort(([, a], [, b]) => {
        const ai = a.csvTypeId ?? 9999;
        const bi = b.csvTypeId ?? 9999;
        return ai - bi;
    });

    // Construction des lignes
    let tableRows = '';
    sortedEntries.forEach(([key, m]) => {
        const { targetId, isExact } = resolveTarget(m);
        const icon = isExact ? '✅' : '🔍';
        // Point 3 : #N grisé via span opacity:0.65
        const idStr = m.csvTypeId !== null
            ? ` <span style="opacity:0.65">#${m.csvTypeId}</span>` : '';
        const selectId = `import-select-${key}`;
        const initBorder = borderColor(targetId);
        const initArrow = arrowColor(targetId);

        tableRows += `
                    <tr>
                        <td style="padding:3px 3px 3px 0; font-size:0.83rem; width:1px; white-space:nowrap;">${icon}</td>
                        <td style="padding:3px 0; font-size:0.83rem;">
                            ${m.csvLabel || ''}${idStr}
                        </td>
                        <td style="padding:3px 4px; color:${initArrow}; font-weight:bold;"
                            id="arrow-${key}">→</td>
                        <td style="padding:3px 0;">
                            <select id="${selectId}"
                                style="font-size:0.82rem; background:var(--input-bg,#222);
                                       color:var(--text-color); border:2px solid ${initBorder};
                                       border-radius:4px; padding:3px 5px; width:100%;
                                       outline:none;"
                                onchange="onImportSelectChange('${key}')">
                                ${buildSelectOptions(targetId)}
                            </select>
                        </td>
                    </tr>`;
    });

    document.getElementById('import-mapping-table').innerHTML = `
                <p style="font-size:0.85rem; opacity:0.82; margin:0 0 10px 0;">
                    ${t('importMappingDesc')}
                    ${t('importMappingLegend')}
                </p>
                <table style="width:100%; border-collapse:collapse;">
                    <colgroup>
                        <col>
                        <col>
                        <col style="width:1px">
                        <col style="width:40%">
                    </colgroup>
                    <thead>
                        <tr style="opacity:0.55; border-bottom:1px solid #444; font-size:0.78rem;">
                            <th></th>
                            <th style="padding:3px 0; text-align:left;">${t('importFileHeader')}</th>
                            <th></th>
                            <th style="padding:3px 4px; text-align:left;">${t('importAppHeader')}</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>`;

    checkImportFusion();
    document.getElementById('importModal').style.display = 'flex';
}

function onImportSelectChange(key) {
    const sel = document.getElementById(`import-select-${key}`);
    const arrow = document.getElementById(`arrow-${key}`);
    if (!sel || !arrow) return;
    const val = sel.value;
    if (val === 'ignore') {
        sel.style.borderColor = '#666';
        arrow.style.color = '#666';
    } else {
        const id = parseInt(val);
        const tp = settings.types.find(t => t.id === id);
        sel.style.borderColor = tp?.active ? getColorForId(id) : '#666';
        arrow.style.color = getColorForId(id);
    }
    checkImportFusion();
}

function processImport(mode) {
    console.log(`[processImport] Mode : ${mode}`);
    try {
        if (!pendingImportData || !pendingImportMapping) return;

        // Lecture des selects pour construire le mapping final (clé → typeId cible ou null)
        const finalMapping = {};
        Object.keys(pendingImportMapping).forEach(key => {
            const sel = document.getElementById(`import-select-${key}`);
            const val = sel ? sel.value : 'ignore';
            finalMapping[key] = val === 'ignore' ? null : parseInt(val);
        });

        // Résolution finale : conversion clé → typeId concret. Types ignorés exclus.
        const resolvedPeriods = pendingImportData
            .map(p => {
                const targetId = finalMapping[p.key];
                if (targetId === null || targetId === undefined) return null;
                return { typeId: targetId, start: p.start, end: p.end };
            })
            .filter(p => p !== null);

        if (resolvedPeriods.length === 0) {
            alert(t('importNoPeriods'));
            closeImportModal();
            return;
        }

        const successMessage = t('importSuccessCount', { n: resolvedPeriods.length });

        if (mode === 'replace') {
            reconstructHistory(resolvedPeriods);
            alert(successMessage);
        } else if (mode === 'merge') {
            let basePeriods = [...state.history];
            if (state.activeType !== null) {
                basePeriods.push({ typeId: state.activeType, start: state.startTime, end: Date.now(), isLive: true });
            }
            let finalPeriods = mergeAdjacentPeriods(
                snapAdjacentBorders(applySteamroller(basePeriods, resolvedPeriods), resolvedPeriods)
            );
            reconstructHistory(finalPeriods);
            alert(successMessage);
        }
    } catch (err) {
        console.error("[processImport] Erreur :", err);
    } finally {
        closeImportModal();
    }
}

// Vérifie les sélections courantes : fusions (plusieurs → un) et correspondances exactes.
// Point 4 : affiche ✅ si tous les types sont résolus exactement, ⚠️ si fusion détectée.
function checkImportFusion() {
    const targets = {};
    let hasUnresolved = false;
    let allExact = true;

    Object.keys(pendingImportMapping).forEach(key => {
        const sel = document.getElementById(`import-select-${key}`);
        if (!sel) return;
        if (sel.value === 'ignore') { hasUnresolved = true; allExact = false; return; }
        if (!targets[sel.value]) targets[sel.value] = [];
        targets[sel.value].push(pendingImportMapping[key].csvLabel || key);
        // Vérifier si ce mapping est exact (même logique que resolveTarget isExact)
        const m = pendingImportMapping[key];
        const normL = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const appType = settings.types.find(tp => tp.id === parseInt(sel.value));
        const isExact = appType && parseInt(sel.value) === m.csvTypeId
            && normL(appType.label) === normL(m.csvLabel);
        if (!isExact) allExact = false;
    });

    const fusions = Object.entries(targets).filter(([, labels]) => labels.length > 1);
    const notice = document.getElementById('import-merge-notice');

    if (fusions.length > 0) {
        const tp = settings.types.find(tp => tp.id === parseInt(fusions[0][0]));
        const targetLabel = tp ? `"${tp.label}"` : `id ${fusions[0][0]}`;
        notice.style.display = 'block';
        notice.style.color = 'var(--orange)';
        notice.innerHTML = t('importFusionWarning', { target: targetLabel });
    } else if (allExact && Object.keys(pendingImportMapping).length > 0) {
        notice.style.display = 'block';
        notice.style.color = 'var(--green)';
        notice.innerHTML = t('importFusionOk');
    } else {
        notice.style.display = 'none';
    }
}

function closeImportModal() {
    console.log("[closeImportModal] Fermeture du modal d'import");
    const modal = document.getElementById('importModal');
    if (modal) modal.style.display = 'none';
    pendingImportData = null;
    pendingImportMapping = null;
}

// ============================================================
// 20b. IMPORT JSON (sauvegarde complète — Passe 2 du chantier notes/événements)
//
// Le bouton d'import (footer Historique + bloc Réglages) détecte le format PAR LE CONTENU
// (commence par "{" → JSON, sinon CSV) : certains sélecteurs de fichiers Android renvoient
// "text/plain" quelle que soit l'extension. Le modal JSON (#importJsonModal) est
// entièrement distinct du modal CSV (#importModal), aucun code partagé.
//
// Principe directeur : un import ne remplace que ce que son format contient.
//   - clé absente du fichier (periodData, dailyData, eventTags, typesConfig) → rien touché ;
//   - "Remplacer" : l'app devient le fichier pour les clés PRÉSENTES ;
//   - "Fusionner" : une absence dans le fichier n'efface jamais rien ; sur un désaccord
//     (même jour + même tag, valeur différente), le fichier gagne — comme pour les périodes.
// Toute la validation se fait en mémoire avant la moindre écriture ; l'écriture est
// protégée par un retour arrière (voir processImportJson / rollbackJsonImport).
// ============================================================

let pendingJsonImport = null; // données validées et nettoyées, en attente de confirmation

const IMPORT_MAX_TYPE_ID = 6;
const IMPORT_TAG_MODES = ['presence', 'tristate', 'numeric'];
const IMPORT_MAX_DAY_TEXT = 5000;

// Point d'entrée commun du bouton d'import : lit les premiers octets pour deviner le format,
// puis aiguille vers importJSON() ou importCSV() (inchangée) qui relisent le fichier en entier.
function importFile(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const head = String(e.target.result || '').replace(/^\uFEFF/, '').trimStart();
        if (head.startsWith('{')) importJSON({ target: input });
        else importCSV({ target: input });
    };
    reader.onerror = function () {
        alert(t('importJsonUnreadable'));
        input.value = '';
    };
    reader.readAsText(file.slice(0, 512), 'UTF-8');
}

// Nettoyage d'un libellé venu d'un fichier (potentiellement d'un tiers) : les libellés sont
// injectés en innerHTML, en attributs title="..." et dans des gestionnaires onclick/onmouse*
// à chaînes JS entre apostrophes — donc < > & " ` \ sont retirés, et l'apostrophe droite est
// remplacée par l'apostrophe typographique (lisible en français, mais inoffensive).
function sanitizeImportedLabel(value, max = 30) {
    if (typeof value !== 'string') return '';
    return value.replace(/[<>&"`\\]/g, '').replace(/'/g, '\u2019').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isValidISODateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Reconnaît un profil prédéfini dans N'IMPORTE LAQUELLE des trois langues (même règle que
// detectProfile() : état actif identique, libellé comparé uniquement pour les slots actifs).
// Évite qu'une sauvegarde exportée depuis une app en anglais soit prise pour un profil
// "Personnalisé" avec des libellés anglais quand on l'importe dans une app française.
function matchProfileAnyLang(types) {
    for (const [profileId, profile] of Object.entries(PROFILES)) {
        if (!profile.types) continue;
        for (const lang of ['fr', 'en', 'nl']) {
            const ok = profile.types.every(pt => {
                const rt = types.find(x => x.id === pt.id);
                if (!rt || rt.active !== pt.active) return false;
                if (!pt.active) return true;
                const ptLabel = typeof pt.label === 'object' ? (pt.label[lang] || '') : (pt.label || '');
                return rt.label === ptLabel;
            });
            if (ok) return { profileId, lang };
        }
    }
    return null;
}

function getProfileDisplayName(profileId) {
    const p = PROFILES[profileId];
    if (!p) return String(profileId);
    return typeof p.name === 'object' ? (p.name[settings.lang] || p.name.fr) : p.name;
}

// Valide et nettoie le contenu d'un fichier JSON — RIEN n'est écrit ici, aucun effet de bord.
// Retourne { ok:false, errorKey } ou { ok:true, data } avec data = { periods, daily, tags,
// types, ignored } où chaque section vaut null si sa clé est ABSENTE du fichier (= "rien à
// remplacer"), et un tableau/objet (éventuellement vide) si la clé est présente.
function validateJSONImport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || raw.format !== 'pacingcount-export'
        || typeof raw.formatVersion !== 'number' || raw.formatVersion < 1) {
        return { ok: false, errorKey: 'importJsonNotPacing' };
    }
    if (raw.formatVersion > JSON_EXPORT_FORMAT_VERSION) return { ok: false, errorKey: 'importJsonTooNew' };

    let ignored = 0;
    const invalid = { ok: false, errorKey: 'importJsonInvalid' };

    // --- Périodes ---
    let periods = null;
    if ('periodData' in raw) {
        if (!Array.isArray(raw.periodData)) return invalid;
        periods = [];
        raw.periodData.forEach(p => {
            if (p && Number.isInteger(p.typeId) && p.typeId >= 1 && p.typeId <= IMPORT_MAX_TYPE_ID
                && Number.isInteger(p.start) && Number.isInteger(p.end) && p.start > 0 && p.start < p.end) {
                // Le champ optionnel `note` n'est volontairement pas repris : reconstructHistory()
                // → closePeriod() le perdrait de toute façon (point déjà noté, à traiter avec la
                // note de période).
                periods.push({ typeId: p.typeId, start: p.start, end: p.end });
            } else {
                ignored++;
            }
        });
        // Des périodes présentes mais toutes invalides = fichier abîmé : on refuse plutôt que
        // de risquer, en mode Remplacer, d'effacer l'historique pour rien.
        if (raw.periodData.length > 0 && periods.length === 0) return invalid;
    }

    // --- Définition des tags d'événements ---
    let tags = null;
    if ('eventTags' in raw) {
        if (!Array.isArray(raw.eventTags)) return invalid;
        tags = [];
        const seen = new Set();
        raw.eventTags.forEach(tg => {
            if (!tg || typeof tg.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(tg.id)
                || seen.has(tg.id) || !IMPORT_TAG_MODES.includes(tg.mode)) { ignored++; return; }
            seen.add(tg.id);
            tags.push({
                id: tg.id,
                label: sanitizeImportedLabel(tg.label) || tg.id,
                description: sanitizeImportedLabel(tg.description, 200),
                mode: tg.mode,
                // polarity : uniquement 'positive'/'negative' valides, sinon absente (undefined) —
                // jamais crue sur parole au-delà de ces deux valeurs.
                polarity: (tg.polarity === 'positive' || tg.polarity === 'negative') ? tg.polarity : undefined,
                active: tg.active !== false,
                timed: tg.timed === true,
                repeatable: tg.repeatable === true,
                builtin: BUILTIN_EVENT_TAGS.some(d => d.id === tg.id) // jamais cru sur parole
            });
        });
    }

    // Mode de chaque tag connu — priorité : app, puis builtin, puis fichier.
    const tagModeById = {};
    (tags || []).forEach(tg => { tagModeById[tg.id] = tg.mode; });
    BUILTIN_EVENT_TAGS.forEach(d => { tagModeById[d.id] = d.mode; });
    settings.eventTags.forEach(tg => { tagModeById[tg.id] = tg.mode; });

    // --- Données journalières ---
    let daily = null;
    if ('dailyData' in raw) {
        if (!raw.dailyData || typeof raw.dailyData !== 'object' || Array.isArray(raw.dailyData)) return invalid;
        daily = {};
        Object.keys(raw.dailyData).forEach(key => {
            const day = raw.dailyData[key];
            if (!isValidISODateKey(key) || !day || typeof day !== 'object') { ignored++; return; }
            const clean = {};
            // Texte libre du jour : conservé tel quel (longueur limitée) — quiconque l'affichera
            // devra l'échapper (innerText / échappement HTML), jamais en innerHTML brut.
            if (typeof day.text === 'string' && day.text.trim()) clean.text = day.text.slice(0, IMPORT_MAX_DAY_TEXT);
            if (Array.isArray(day.events)) {
                const byTag = new Map();
                day.events.forEach(ev => {
                    const mode = (ev && typeof ev.tagId === 'string') ? tagModeById[ev.tagId] : undefined;
                    if (mode === 'tristate' && (ev.value === 'yes' || ev.value === 'no')) {
                        byTag.set(ev.tagId, { tagId: ev.tagId, value: ev.value });
                    } else if (mode === 'presence' && ev.value === undefined) {
                        // Seule la présence de l'event compte — jamais de value pour ce mode.
                        byTag.set(ev.tagId, { tagId: ev.tagId });
                    } else {
                        ignored++;
                    }
                });
                if (byTag.size > 0) clean.events = [...byTag.values()];
            }
            if (clean.text || clean.events) daily[key] = clean;
        });
    }

    // --- Profil de types ---
    let types = null;
    if ('typesConfig' in raw) {
        const tc = raw.typesConfig;
        if (!tc || typeof tc !== 'object' || !Array.isArray(tc.types)) return invalid;
        const provided = {};
        tc.types.forEach(tp => {
            if (tp && Number.isInteger(tp.id) && tp.id >= 1 && tp.id <= IMPORT_MAX_TYPE_ID && !provided[tp.id]) {
                // Couleurs volontairement ignorées : fixes par typeId, jamais lues d'un fichier.
                provided[tp.id] = { id: tp.id, label: sanitizeImportedLabel(tp.label), active: tp.active === true };
            } else {
                ignored++;
            }
        });
        // Slot non fourni par le fichier → on garde celui de l'app (aucune différence à signaler).
        let resolved = settings.types.map(st => provided[st.id]
            ? { ...provided[st.id] }
            : { id: st.id, label: sanitizeImportedLabel(st.label), active: st.active });
        if (!resolved.some(rt => rt.active)) return invalid; // au moins un type actif, toujours
        const matched = matchProfileAnyLang(resolved);
        if (matched) {
            // Profil prédéfini reconnu : libellés des slots actifs réaffichés dans la langue de l'app.
            resolved = resolved.map(rt => {
                const pt = PROFILES[matched.profileId].types.find(p => p.id === rt.id);
                return (pt && pt.active && typeof pt.label === 'object')
                    ? { ...rt, label: pt.label[settings.lang] || pt.label.fr || rt.label }
                    : rt;
            });
        }
        types = { resolved, profileId: matched ? matched.profileId : 'custom' };
    }

    if (!periods && !daily && !tags && !types) return { ok: false, errorKey: 'importJsonNothing' };
    return { ok: true, data: { periods, daily, tags, types, ignored, typeDiffs: [] } };
}

// Différences de types à signaler à l'utilisateur. Un type est "pertinent" s'il est actif d'un
// côté OU s'il a des périodes (dans l'app ou dans le fichier) : un type inactif peut avoir des
// données dont le libellé donne le sens (ex. "Sieste" dans l'app, "Douleur" dans le fichier —
// fusionner relirait silencieusement les périodes "Sieste" comme "Douleur"). Un type inactif
// des deux côtés et sans aucune donnée est ignoré (un nom tapé à l'avance ne doit pas alerter).
function computeImportTypeDiffs(imp) {
    if (!imp.types) return [];
    const appCounts = {};
    state.history.forEach(e => { appCounts[e.typeId] = (appCounts[e.typeId] || 0) + 1; });
    if (state.activeType !== null) appCounts[state.activeType] = (appCounts[state.activeType] || 0) + 1;
    const fileCounts = {};
    (imp.periods || []).forEach(p => { fileCounts[p.typeId] = (fileCounts[p.typeId] || 0) + 1; });

    const diffs = [];
    imp.types.resolved.forEach(ft => {
        const at = settings.types.find(tp => tp.id === ft.id);
        if (!at) return;
        const aC = appCounts[ft.id] || 0;
        const fC = fileCounts[ft.id] || 0;
        if (!(at.active || ft.active || aC > 0 || fC > 0)) return;
        // Libellé de l'app passé par le même nettoyage que celui du fichier : évite une fausse
        // différence (apostrophe, etc.) quand on réimporte sa propre sauvegarde.
        const appLabel = sanitizeImportedLabel(at.label);
        if (at.active === ft.active && appLabel === ft.label) return;
        diffs.push({
            id: ft.id,
            app: { label: at.label || '', active: at.active, count: aC },
            file: { label: ft.label, active: ft.active, count: fC }
        });
    });
    return diffs;
}

// Fusion des événements journaliers : par jour ET par tag. Une absence dans le fichier
// n'efface rien ; sur un désaccord (même jour, même tag, valeur différente) le fichier gagne
// et le désaccord est compté. Pure : retourne une copie, ne modifie pas `base`.
function mergeDailyDataInto(base, fileDaily) {
    const result = JSON.parse(JSON.stringify(base));
    let conflicts = 0;
    Object.keys(fileDaily).forEach(key => {
        const f = fileDaily[key];
        const day = result[key] || (result[key] = {});
        if (f.text) day.text = f.text;
        if (f.events) {
            const events = Array.isArray(day.events) ? day.events : [];
            f.events.forEach(fe => {
                const ex = events.find(e => e.tagId === fe.tagId);
                if (!ex) events.push({ tagId: fe.tagId, value: fe.value });
                else if (ex.value !== fe.value) { ex.value = fe.value; conflicts++; }
            });
            day.events = events;
        }
    });
    return { result, conflicts };
}

function importJSON(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    console.log(`[importJSON] Lecture du fichier : ${file.name}`);
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const raw = JSON.parse(String(e.target.result).replace(/^\uFEFF/, ''));
            const res = validateJSONImport(raw);
            if (!res.ok) {
                alert(t(res.errorKey));
            } else {
                pendingJsonImport = res.data;
                showImportJsonModal();
            }
        } catch (err) {
            console.error('[importJSON] Erreur :', err);
            alert(t('importJsonUnreadable'));
        }
        input.value = ''; // permet de ré-importer le même fichier
    };
    reader.onerror = function () {
        alert(t('importJsonUnreadable'));
        input.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// Tableau des différences de types (modal JSON) — n'apparaît que s'il y en a.
function buildImportTypeDiffHTML(imp) {
    const cell = (x) => {
        const name = x.active
            ? (x.label || t('typeNoNameOption'))
            : (x.label ? `${x.label} ${t('typeInactivePlaceholder')}` : t('typeInactivePlaceholder'));
        const count = x.count > 0
            ? `<br><span style="opacity:0.65; font-size:0.75rem;">${t('importJsonPeriodsCount', { n: x.count })}</span>`
            : '';
        return name + count;
    };
    const rows = imp.typeDiffs.map(d => `
                <tr>
                    <td style="padding:4px 6px 4px 0; font-size:0.83rem; white-space:nowrap; vertical-align:top;"><span style="color:${getColorForId(d.id)};">●</span> #${d.id}</td>
                    <td style="padding:4px 6px; font-size:0.83rem; vertical-align:top;">${cell(d.app)}</td>
                    <td style="padding:4px 0; font-size:0.83rem; vertical-align:top;">${cell(d.file)}</td>
                </tr>`).join('');
    const from = getProfileDisplayName(settings.activeProfile);
    const to = getProfileDisplayName(imp.types.profileId);
    return `
                <p style="font-size:0.85rem; margin:0 0 8px 0; color:var(--orange);">${t('importJsonTypesTitle')}</p>
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="opacity:0.55; border-bottom:1px solid #444; font-size:0.78rem;">
                            <th></th>
                            <th style="padding:3px 6px; text-align:left;">${t('importAppHeader')}</th>
                            <th style="padding:3px 0; text-align:left;">${t('importFileHeader')}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <p style="font-size:0.85rem; margin:8px 0 0 0;">${t('importJsonProfileLine', { from, to })}</p>`;
}

function showImportJsonModal() {
    const imp = pendingJsonImport;
    if (!imp) return;
    imp.typeDiffs = computeImportTypeDiffs(imp);
    const hasTypeDiff = imp.typeDiffs.length > 0;
    const locale = getLocale();

    // Résumé du fichier
    const parts = [];
    if (imp.periods) {
        let s = t('importJsonSummaryPeriods', { n: imp.periods.length });
        if (imp.periods.length > 0) {
            let from = Infinity, to = -Infinity;
            imp.periods.forEach(p => { if (p.start < from) from = p.start; if (p.end > to) to = p.end; });
            s += ` (${new Date(from).toLocaleDateString(locale)} → ${new Date(to).toLocaleDateString(locale)})`;
        }
        parts.push(s);
    }
    if (imp.daily) parts.push(t('importJsonSummaryDays', { n: Object.keys(imp.daily).length }));

    // Chiffres pour les avertissements propres à chaque mode
    const appDays = Object.keys(dailyData).length;
    const fileDays = imp.daily ? Object.keys(imp.daily).length : 0;
    const lostDays = imp.daily ? Object.keys(dailyData).filter(k => !(k in imp.daily)).length : 0;
    const mergeConflicts = imp.daily ? mergeDailyDataInto(dailyData, imp.daily).conflicts : 0;

    const infoStyle = 'font-size:0.85rem; margin:0 0 6px 0; opacity:0.9;';
    const warnStyle = 'font-size:0.85rem; margin:0 0 6px 0; color:var(--orange);';

    let html = `<h3 style="margin-top:0;">${t('importJsonTitle')}</h3>`;
    if (parts.length > 0) html += `<p style="font-size:0.9rem; margin:0 0 12px 0; line-height:1.5;">${parts.join(' · ')}</p>`;
    if (imp.ignored > 0) html += `<p style="font-size:0.82rem; color:var(--orange); margin:0 0 12px 0;">${t('importJsonIgnored', { n: imp.ignored })}</p>`;
    if (hasTypeDiff) html += buildImportTypeDiffHTML(imp);
    html += `<div style="border-top:1px solid #444; margin:16px 0;"></div>`;

    // Remplacer
    html += `<button class="export-btn" style="background:var(--red); margin-bottom:6px;" onclick="processImportJson('replace')">${t('importJsonReplaceBtn')}</button>`;
    html += `<p style="${infoStyle}">${t('importJsonReplaceDetail')}</p>`;
    if (imp.daily && (appDays > 0 || fileDays > 0)) html += `<p style="${infoStyle}">${t('importJsonReplaceEvents', { a: appDays, f: fileDays })}</p>`;
    if (lostDays > 0) html += `<p style="${warnStyle}">${t('importJsonReplaceLost', { n: lostDays })}</p>`;
    if (hasTypeDiff) html += `<p style="${infoStyle}">${t('importJsonProfileWarnReplace')}</p>`;

    // Fusionner
    html += `<button class="export-btn" style="background:var(--blue); margin:16px 0 6px 0;" onclick="processImportJson('merge')">${t('importMergeBtn')}</button>`;
    html += `<p style="${infoStyle}">${t('importJsonMergeDetail')}</p>`;
    if (mergeConflicts > 0) html += `<p style="${warnStyle}">${t('importJsonMergeConflicts', { n: mergeConflicts })}</p>`;
    if (hasTypeDiff) html += `<p style="${warnStyle}">${t('importJsonProfileWarnMerge')}</p>`;

    html += `<button class="export-btn" style="background:#444; margin-top:16px;" onclick="closeImportJsonModal()">${t('btnCancel')}</button>`;

    document.getElementById('import-json-body').innerHTML = html;
    document.getElementById('importJsonModal').style.display = 'flex';
    console.log(`[importJSON] Modal affiché — périodes:${imp.periods ? imp.periods.length : '-'} jours:${imp.daily ? fileDays : '-'} diffTypes:${imp.typeDiffs.length} désaccords:${mergeConflicts}`);
}

function closeImportJsonModal() {
    const modal = document.getElementById('importJsonModal');
    if (modal) modal.style.display = 'none';
    pendingJsonImport = null;
}

// Applique le profil de types du fichier — uniquement les types listés dans les différences
// (les autres restent strictement intacts). Recalcule le profil actif avec detectProfile() au
// lieu de croire le fichier, et crée le snapshot "Personnalisé" si besoin (même règle que
// saveSettings(), qu'on ne peut pas appeler ici car elle relit les champs de saisie).
function applyImportedTypes(imp) {
    imp.typeDiffs.forEach(d => {
        const rt = imp.types.resolved.find(x => x.id === d.id);
        const st = settings.types.find(x => x.id === d.id);
        if (rt && st) { st.label = rt.label; st.active = rt.active; }
    });
    settings.labels = getActiveTypes().map(tp => tp.label);
    const detected = detectProfile();
    if (detected === 'custom') {
        if (!settings.customProfiles) settings.customProfiles = [];
        settings.customProfiles[0] = { name: 'Personnalisé', types: JSON.parse(JSON.stringify(settings.types)) };
    }
    settings.activeProfile = detected;
}

// Définition des tags : Fusionner → on n'ajoute que les tags inconnus (l'app gagne pour les
// tags qu'elle connaît : sinon une sauvegarde anglaise renommerait "MPE" en "PEM" sur un
// téléphone français). Remplacer → tags du fichier, mais les tags builtin sont reconstruits
// dans la langue de l'app, et tout builtin manquant est ré-ajouté.
function applyImportedEventTags(imp, mode) {
    if (!imp.tags) return;
    if (mode === 'merge') {
        imp.tags.forEach(ft => {
            if (!settings.eventTags.some(tg => tg.id === ft.id)) settings.eventTags.push({ ...ft });
        });
        return;
    }
    const next = imp.tags.map(ft => {
        const def = BUILTIN_EVENT_TAGS.find(d => d.id === ft.id);
        return def ? { ...buildEventTagFromBuiltin(def, settings.lang), active: ft.active } : { ...ft };
    });
    BUILTIN_EVENT_TAGS.forEach(def => {
        if (!next.some(tg => tg.id === def.id)) next.push(buildEventTagFromBuiltin(def, settings.lang));
    });
    settings.eventTags = next;
}

// Retour arrière complet (mémoire + localStorage) si une écriture échoue en cours d'import
// (typiquement quota dépassé) : jamais de réglages du fichier avec un historique de l'app.
function rollbackJsonImport(raw, mem) {
    // Deux passes : si un état intermédiaire dépasse le quota, la clé qui a échoué est
    // retentée une fois les autres restaurées (l'état final, lui, est celui d'avant l'import).
    let pending = [['pacingSettings', raw.settings], ['pacingDailyData', raw.daily], ['pacingState', raw.state]];
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
        const failed = [];
        pending.forEach(([key, val]) => {
            try {
                if (val === null) localStorage.removeItem(key);
                else localStorage.setItem(key, val);
            } catch (e) {
                failed.push([key, val]);
            }
        });
        pending = failed;
    }
    if (pending.length > 0) console.error('[rollbackJsonImport] Restauration localStorage incomplète :', pending.map(x => x[0]));
    settings = mem.settings;
    dailyData = mem.dailyData;
    state = mem.state;
    // reconstructHistory() a pu reprogrammer/annuler des alertes : on remet celles de l'état restauré.
    if (state.activeType !== null && state.startTime !== null) {
        const savedSent = [...(state.sentAlerts || [])];
        scheduleAlerts(state.activeType, state.startTime);
        state.sentAlerts = savedSent;
        saveState();
    } else {
        cancelAlerts();
        releaseWakeLock();
    }
    refreshAfterJsonImport();
}

function refreshAfterJsonImport() {
    renderMeasureButtons();
    renderTypesSettings();
    renderProfileSelector();
    updateUI();
    const activeId = document.querySelector('.page.active')?.id;
    if (activeId === 'page-results') {
        populateResultsMonthDropdown();
        updateResultsNavButtons();
        updateResultsFooterRange();
        renderDailyCharts();
        renderWeeklyCharts();
        renderResults();
    } else if (activeId === 'page-timeline') {
        populateHistoryDropdowns();
        updateNavButtons();
        renderTimelineChart();
        renderHistory();
    }
}

// mode : 'replace' | 'merge'. Ordre d'écriture : réglages → jours → périodes.
function processImportJson(mode) {
    const imp = pendingJsonImport;
    if (!imp) return;
    console.log(`[processImportJson] Mode : ${mode}`);

    // Copies de sécurité (localStorage brut + mémoire) pour un retour arrière en cas d'échec.
    const raw = {
        settings: localStorage.getItem('pacingSettings'),
        daily: localStorage.getItem('pacingDailyData'),
        state: localStorage.getItem('pacingState')
    };
    const mem = {
        settings: JSON.parse(JSON.stringify(settings)),
        dailyData: JSON.parse(JSON.stringify(dailyData)),
        state: JSON.parse(JSON.stringify(state))
    };

    let alertsAffected = false;
    try {
        // 1. Réglages : profil de types + définition des tags
        const hasTypeDiff = imp.typeDiffs.length > 0;
        if (hasTypeDiff) {
            applyImportedTypes(imp);
            alertsAffected = syncAlertsWithTypes(false); // écrit avec les réglages plus bas
        }
        applyImportedEventTags(imp, mode);
        if (hasTypeDiff || imp.tags) localStorage.setItem('pacingSettings', JSON.stringify(settings));

        // 2. Événements journaliers
        if (imp.daily) {
            dailyData = mode === 'replace'
                ? JSON.parse(JSON.stringify(imp.daily))
                : mergeDailyDataInto(dailyData, imp.daily).result;
            localStorage.setItem('pacingDailyData', JSON.stringify(dailyData));
        }

        // 3. Périodes (même chaîne que l'import CSV : steamroller → snap → merge)
        if (imp.periods) {
            if (mode === 'replace') {
                reconstructHistory(imp.periods.map(p => ({ ...p })));
            } else if (imp.periods.length > 0) {
                const basePeriods = [...state.history];
                if (state.activeType !== null) {
                    basePeriods.push({ typeId: state.activeType, start: state.startTime, end: Date.now(), isLive: true });
                }
                const incoming = imp.periods.map(p => ({ ...p }));
                reconstructHistory(mergeAdjacentPeriods(
                    snapAdjacentBorders(applySteamroller(basePeriods, incoming), incoming)
                ));
            }
            // saveState()/safeSave() ne lèvent pas d'erreur (simple toast) : on vérifie l'écriture.
            if (localStorage.getItem('pacingState') !== JSON.stringify(state)) {
                throw new Error('pacingState non écrit (quota ?)');
            }
        }
    } catch (err) {
        console.error('[processImportJson] Échec — retour arrière :', err);
        rollbackJsonImport(raw, mem);
        alert(t('importJsonWriteError'));
        closeImportJsonModal();
        return;
    }

    refreshAfterJsonImport();
    if (alertsAffected) rescheduleAlertsForActivePeriod();
    if (navigator.onLine) sendToGoatCounter('import-json');
    const p = imp.periods ? imp.periods.length : 0;
    const d = imp.daily ? Object.keys(imp.daily).length : 0;
    closeImportJsonModal();
    alert(t('importJsonSuccess', { p, d }));
}