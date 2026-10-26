// results.js — onglet Résultats : détails chiffrés, graphiques journalier et hebdomadaire.


// ============================================================
// 13. RENDU DES RÉSULTATS CHIFFRÉS (onglet Résultats)
// Affiche par jour :
//   - totaux par type
//   - sous-total repos (types 1+2) + moyenne mobile centrée sur 3 jours
//   - métriques des périodes actives (type 3) : nombre, moy/max/min
//   - avertissement si journée terminée et < 23h enregistrées
// Le profil par défaut utilise type 1+2 comme "repos" et type 3 comme "actif".
// Ces paramètres seront externalisés dans la définition de profil à l'avenir.
// ============================================================

// Convertit une durée en minutes en {h, m} — un seul arrondi sur le TOTAL, puis
// floor/modulo (jamais un round séparé sur les minutes restantes, qui peut sinon donner
// "60" au lieu de remonter la retenue vers les heures — ex. 659.6 min →
// floor(659.6/60)=10h + round(59.6)=60min donnerait à tort "10h60" au lieu de "11h00").
// Utilisée par formatMins() et par tout endroit ayant besoin de h/m séparément (ex. pour
// une mise en forme HTML personnalisée du padding des heures).
function splitMinutesHM(mins) {
    const totalMin = Math.round(mins);
    return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

// Formate une durée en minutes → toujours "0h00"
function formatMins(mins) {
    const { h, m } = splitMinutesHM(mins);
    return `${h}h${m.toString().padStart(2, '0')}`;
}

// Bascule un type "déplié" dans les détails chiffrés (Chantier 1B) — état global,
// persisté, valable pour tous les jours affichés (pas un état par jour).
function toggleResultsTypeExpanded(typeId) {
    const idx = settings.resultsExpandedTypes.indexOf(typeId);
    if (idx === -1) settings.resultsExpandedTypes.push(typeId);
    else settings.resultsExpandedTypes.splice(idx, 1);
    safeSave('pacingSettings', JSON.stringify(settings));
    renderResults();
}

// Bascule un type dans/hors de la combinaison "repos" personnalisable (Chantier 1B,
// suite — points blancs/gris sous les totaux). Combinaison globale (pas par jour) :
// un clic sur un jour affecte donc l'affichage de tous les jours visibles, ainsi que
// le point blanc de moyenne mobile dans renderDailyCharts() (même source de données).
function toggleCombinedType(typeId) {
    const idx = settings.combinedTypeIds.indexOf(typeId);
    if (idx === -1) settings.combinedTypeIds.push(typeId);
    else settings.combinedTypeIds.splice(idx, 1);
    settings.combinedTypeIds.sort((a, b) => a - b); // ordre stable (id croissant)
    safeSave('pacingSettings', JSON.stringify(settings));
    renderResults();
    renderDailyCharts();
}


function renderResults() {
    console.log("[renderResults] Rendu des résultats");
    cleanupCombinedTypeIds(); // retire les typeIds fantômes avant tout calcul/affichage
    const container = document.getElementById('results-list');
    container.innerHTML = "";
    const locale = getLocale();
    // Point 4 : tous les types (actifs et inactifs) pour cohérence avec l'export.
    // Pas de filtre sur .label : un type sans nom peut avoir des données réelles
    // (ex. activé puis renommage pas encore fait) — displayedTypes filtre déjà sur
    // la présence de minutes >0, donc les slots vides ne s'affichent pas de toute façon.
    const allTypes = settings.types;

    // Chantier 1B (suite) : "repos" n'est plus [1,2] en dur — c'est la combinaison
    // personnalisable par l'utilisateur, persistée dans settings.combinedTypeIds.
    const reposIds = settings.combinedTypeIds;

    // --- FENÊTRAGE (Chantier 1A) ---
    // Fenêtre officielle d'affichage : 14 jours glissants sur resultsEndDate.
    // Plage élargie de ±1 jour pour l'agrégation : la moyenne mobile centrée sur 3 jours
    // a besoin d'un voisin de chaque côté, y compris pour les 2 jours en bord de fenêtre
    // (voir Handoff, section 5 — pièges techniques).
    const ed = window.resultsEndDate;
    const windowStartTs = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() - (RESULTS_WINDOW_DAYS - 1)).getTime();
    const windowEndTs = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() + 1).getTime(); // exclusif
    const aggStartTs = windowStartTs - 86400000;
    const aggEndTs = windowEndTs + 86400000;

    // Clé du jour "aujourd'hui" — même format ISO que dateKey plus bas, pour remplacer
    // l'ancienne comparaison sur libellé localisé (devenue inadaptée : daysData est
    // maintenant indexé par clé ISO pour un tri/filtrage fiable, voir plus bas).
    const now0 = new Date();
    const todayKey = `${now0.getFullYear()}-${(now0.getMonth() + 1).toString().padStart(2, '0')}-${now0.getDate().toString().padStart(2, '0')}`;

    let all = [...state.history];
    if (state.activeType) {
        // Découpe à minuit (comme closePeriod()) — sans quoi une période en cours
        // chevauchant minuit reste entièrement comptée sur son jour de départ (total
        // pouvant dépasser 24h, rien sur aujourd'hui tant qu'elle n'est pas close).
        splitPeriodIntoDayFragments(state.startTime, Date.now()).forEach(frag => {
            all.push({ typeId: state.activeType, start: frag.start, end: frag.end });
        });
    }
    // Filtre sur la plage élargie (voir commentaire fenêtrage ci-dessus)
    all = all.filter(e => e.start >= aggStartTs && e.start < aggEndTs);
    all.sort((a, b) => a.start - b.start);

    const daysData = {};
    all.forEach(e => {
        const dObj = new Date(e.start);
        // Clé ISO (AAAA-MM-JJ) — triable directement en chaîne, contrairement à l'ancienne
        // clé en libellé localisé qui nécessitait un re-parsing fragile pour le tri/filtre.
        const dateKey = `${dObj.getFullYear()}-${(dObj.getMonth() + 1).toString().padStart(2, '0')}-${dObj.getDate().toString().padStart(2, '0')}`;
        const mins = (e.end - e.start) / 60000;
        if (!daysData[dateKey]) {
            daysData[dateKey] = {
                displayDate: dObj.toLocaleDateString(locale),
                totals: {},
                reposMins: 0,
                periodsByType: {},
                totalMins: 0
            };
            // Initialiser tous les types (pas seulement actifs)
            allTypes.forEach(tp => { daysData[dateKey].totals[tp.id] = 0; });
        }
        if (daysData[dateKey].totals[e.typeId] !== undefined) {
            daysData[dateKey].totals[e.typeId] += mins;
        }
        daysData[dateKey].totalMins += mins;
        if (reposIds.includes(e.typeId)) daysData[dateKey].reposMins += mins;
        // Chantier 1B : durées individuelles collectées pour TOUS les types (pas
        // seulement l'ancien "type actif" hardcodé) — sert aux lignes de détail dépliables.
        if (!daysData[dateKey].periodsByType[e.typeId]) daysData[dateKey].periodsByType[e.typeId] = [];
        daysData[dateKey].periodsByType[e.typeId].push(mins);
    });

    const isIncomplete = (key) => {
        return daysData[key].totalMins < 23 * 60 - 1;
    };

    const dateKeys = Object.keys(daysData).sort(); // tri lexical fiable sur clés ISO
    const moyMobile = {};
    dateKeys.forEach((key, idx) => {
        if (idx === 0 || idx === dateKeys.length - 1) {
            moyMobile[key] = null;
            return;
        }
        const kPrev = dateKeys[idx - 1];
        const kNext = dateKeys[idx + 1];
        if (isIncomplete(kPrev) || isIncomplete(key) || isIncomplete(kNext)) {
            moyMobile[key] = null;
            return;
        }
        moyMobile[key] = (daysData[kPrev].reposMins + daysData[key].reposMins + daysData[kNext].reposMins) / 3;
    });

    // Jours de la fenêtre officielle uniquement — la plage élargie ci-dessus ne sert
    // qu'au calcul de la moyenne mobile en bord de fenêtre, jamais à l'affichage.
    const displayKeys = dateKeys.filter(key => {
        const [yy, mm, dd] = key.split('-').map(Number);
        const ts = new Date(yy, mm - 1, dd).getTime();
        return ts >= windowStartTs && ts < windowEndTs;
    });

    // --- ÉTAPE 4 : rendu, du plus récent au plus ancien ---
    [...displayKeys].reverse().forEach(key => {
        const day = daysData[key];
        const div = document.createElement('div');
        div.className = "results-day-item";
        let html = '';

        // Ligne 1 : date — + pastilles d'événements journaliers à droite si présents ce
        // jour (voir buildDailyEventPillsHTML()), sinon la date seule comme avant.
        const pillsHTML = buildDailyEventPillsHTML(key);
        html += pillsHTML
            ? `<div class="results-date-pills-row"><strong>${day.displayDate}</strong><div class="results-event-pills">${pillsHTML}</div></div>`
            : `<div><strong>${day.displayDate}</strong></div>`;

        // Note du jour — en dessous, uniquement si une note existe ce jour (indépendant
        // des pastilles : un jour peut avoir l'une, l'autre, les deux, ou aucune des deux).
        // DÉSACTIVÉ (beta.29) : la section est jugée trop chargée avec la note. La note reste
        // lisible dans le tableau journalier ; à réactiver (ou à remplacer par un tap vers
        // l'overlay, voir TODO) selon l'usage. Le style .results-day-note est conservé.
        /*
        const dayNoteText = getDailyNote(key);
        if (dayNoteText) {
            html += `<div class="results-day-note">${escapeHtml(dayNoteText)}</div>`;
        }
        */

        // Ligne 2 : totaux par type — uniquement ceux qui ont des données ce jour.
        // Chantier 1B : chaque total est cliquable (▸ + valeur, un seul élément englobant)
        // et bascule l'affichage de sa ligne de détail dépliable. ▸ dans la couleur du
        // type si déplié, noir pur si replié (effet "creux" dans le fond gris voulu).
        // Chantier 1B (suite) : chiffres en tabular-nums (.tab-num) + heure toujours sur
        // 2 chiffres (le premier en "0" transparent si <10h) + ▸/h en .fix-char (1ch
        // chacun) → chaque bloc total fait toujours exactement 6ch. Ça permet de calculer
        // la position des points de combinaison (ligne juste en dessous) par simple rang
        // (rang × 7ch, séparateur inclus), sans mesurer le rendu réel.
        const displayedTypes = allTypes.filter(tp => (day.totals[tp.id] || 0) > 0);
        let ligne2 = '';
        displayedTypes.forEach((tp, idx) => {
            const mins = day.totals[tp.id];
            const isExpanded = settings.resultsExpandedTypes.includes(tp.id);
            const arrowColor = isExpanded ? getColorForId(tp.id) : getCSSColor('--chart-gray-bar');
            const { h, m } = splitMinutesHM(mins);
            // Padding par "0" transparent (pas un espace-chiffre) : garantit une largeur
            // identique aux vrais chiffres, puisque c'est le même glyphe sous tabular-nums.
            const hStr = h < 10 ? `<span style="color:transparent;">0</span>${h}` : `${h}`;
            ligne2 += `<span style="cursor:pointer; color: ${getColorForId(tp.id)};" onclick="toggleResultsTypeExpanded(${tp.id})">`;
            ligne2 += `<span class="fix-char" style="color: ${arrowColor};">▸</span>${hStr}<span class="fix-char">h</span>${m.toString().padStart(2, '0')}</span>`;
            // Espace-chiffre (U+2007) entre les blocs — largeur de séparation cohérente,
            // pas critique pour l'alignement (seul le pas fixe de 7ch/bloc compte).
            if (idx < displayedTypes.length - 1) ligne2 += '&#x2007;';
        });
        html += `<div class="results-line2-scroll"><div class="tab-num" style="position:relative;">${ligne2}</div>`;

        // Rangée de points de combinaison (Chantier 1B, suite) — un point sous chaque
        // total affiché ce jour : blanc = type inclus dans la combinaison "repos"
        // (settings.combinedTypeIds — compose aussi le point blanc de renderDailyCharts()),
        // gris creux = type disponible ce jour mais exclu de la combinaison. Position
        // calculée à plat (rang × 7ch + 3.5ch pour tomber sous le centre du "h" du bloc),
        // pas de mesure DOM. Cliquable : bascule la combinaison globale (voir
        // toggleCombinedType()), indépendant du clic sur le total juste au-dessus.
        if (displayedTypes.length > 0) {
            let dotsRow = '';

            // Trait reliant les deux points blancs les plus éloignés — uniquement s'il y
            // en a au moins 2 (sinon rien à relier). Traverse les points gris/blocs vides
            // entre les deux sans s'y arrêter (un seul segment, pas un tracé point à point).
            let minIdx = null, maxIdx = null;
            displayedTypes.forEach((tp, idx) => {
                if (reposIds.includes(tp.id)) {
                    if (minIdx === null) minIdx = idx;
                    maxIdx = idx;
                }
            });
            if (minIdx !== null && maxIdx !== null && maxIdx > minIdx) {
                const lineLeft = minIdx * 7 + 3.5;
                const lineWidth = (maxIdx - minIdx) * 7;
                dotsRow += `<div class="results-combo-line" style="left:${lineLeft}ch; width:${lineWidth}ch;"></div>`;
            }

            displayedTypes.forEach((tp, idx) => {
                const isCombined = reposIds.includes(tp.id);
                const leftCh = idx * 7 + 3.5;
                dotsRow += `<div class="results-combo-dot-hit${isCombined ? ' results-combo-dot-hit-active' : ''}" style="left:${leftCh}ch;" onclick="toggleCombinedType(${tp.id})">`;
                dotsRow += `<div class="results-combo-dot ${isCombined ? 'results-combo-dot-active' : 'results-combo-dot-inactive'}"></div>`;
                dotsRow += `</div>`;
            });
            html += `<div class="results-combo-row">${dotsRow}</div>`;
        }
        html += `</div>`;

        // Ligne 3 : sous-total de la combinaison + moyenne mobile 3 jours — masquée
        // entièrement si la combinaison est vide (aucun type sélectionné). Un seul ●
        // blanc (écho aux points blancs de la rangée ci-dessus, plus lisible qu'une
        // bullet colorée par type composant la combinaison) + libellé "Total" explicite.
        if (reposIds.length > 0) {
            const moy3j = moyMobile[key];
            const moy3jStr = moy3j !== null
                ? `&nbsp;&nbsp;~${t('resMoy3j')} : ${formatMins(moy3j)}`
                : '';
            html += `<span style="color:white;">●</span> ${t('resComboTotal')} : ${formatMins(day.reposMins)}${moy3jStr}<br>`;
        }

        // Lignes de détail dépliables (Chantier 1B) — une par type "déplié" (état global
        // persisté, voir toggleResultsTypeExpanded) ayant des données ce jour-là, dans
        // l'ordre d'affichage des totaux. Toute la ligne dans la couleur du type ;
        // formatage gras/souligné/italique identique à l'ancien modèle pour moy/max/min.
        allTypes.forEach(tp => {
            if (!settings.resultsExpandedTypes.includes(tp.id)) return;
            const periods = day.periodsByType[tp.id];
            if (!periods || periods.length === 0) return;
            const moy = periods.reduce((a, b) => a + b, 0) / periods.length;
            const max = Math.max(...periods);
            const min = Math.min(...periods);
            const periodLabel = periods.length > 1 ? t('resPeriodePlur') : t('resPeriodeSing');
            html += `<span style="font-size:0.9rem; color: ${getColorForId(tp.id)};">`;
            html += `▸${periods.length} ${periodLabel} : `;
            html += `<b>${t('resMoy')} ${formatMins(moy)}</b> · `;
            html += `<u>${t('resMax')} ${formatMins(max)}</u> · `;
            html += `<i>${t('resMin')} ${formatMins(min)}</i>`;
            html += `</span><br>`;
        });

        // Ligne 5 : avertissement données incomplètes (rouge, journée terminée uniquement)
        // Seuil aligné sur celui de isIncomplete() ci-dessus (23*60-1, même logique que
        // la moyenne mobile) — un jour à exactement 22h59m00s ou plus est donc considéré
        // complet ici aussi, cohérent avec le reste de l'app.
        if (key !== todayKey && day.totalMins < 23 * 60 - 1) {
            const enregistrees = formatMins(day.totalMins);
            html += `<span style="color:var(--red); font-size:0.85rem;">⚠ ${t('resIncomplet')} (${enregistrees})</span>`;
        }

        div.innerHTML = html;
        container.appendChild(div);
    });
}

// ============================================================
// 14. GRAPHIQUE JOURNALIER (onglet Résultats)
// Barres horizontales représentant le temps passé par type et par jour.
// ============================================================

function renderDailyCharts() {
    console.log("[renderDailyCharts] Rendu du graphique journalier");

    // --- État d'affichage des points de moyenne mobile ---
    if (typeof window.showMoyDots === 'undefined') window.showMoyDots = true;
    window.toggleMoyDots = function () {
        window.showMoyDots = !window.showMoyDots;
        renderDailyCharts(); // On redessine le graphique avec le nouvel état
    };

    const container = document.getElementById('daily-charts-container');
    if (!container) return;
    container.innerHTML = '';

    // --- GESTION DU TOOLTIP ---
    let tooltip = document.getElementById('custom-chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'custom-chart-tooltip';
        tooltip.style.cssText = 'position: fixed; background: rgba(30, 30, 30, 0.95); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; pointer-events: none; z-index: 9999; display: none; transform: translate(-50%, -120%); white-space: nowrap; box-shadow: 0 4px 8px rgba(0,0,0,0.5); border: 1px solid #444;';
        document.body.appendChild(tooltip);
    }

    window.showBarTooltip = function (e, text) {
        const tt = document.getElementById('custom-chart-tooltip');
        tt.innerHTML = text;
        tt.style.display = 'block';
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        let x = e.touches ? e.touches[0].clientX : e.clientX;

        // Clamp horizontal : évite que le cadre (centré via transform:translateX(-50%))
        // ne dépasse les bords de l'écran. offsetWidth lu après display:block ci-dessus,
        // donc mesure réelle (le contenu vient d'être injecté).
        const margin = 8;
        const halfWidth = tt.offsetWidth / 2;
        const minX = halfWidth + margin;
        const maxX = window.innerWidth - halfWidth - margin;
        x = Math.min(Math.max(x, minX), maxX);

        tt.style.left = x + 'px';
        tt.style.top = y + 'px';
    };
    window.hideBarTooltip = function () {
        const tt = document.getElementById('custom-chart-tooltip');
        if (tt) tt.style.display = 'none';
    };

    // --- CONFIGURATION ---
    const colorMap = {};
    const labelMap = {};
    settings.types.forEach(tp => {
        colorMap[tp.id] = getColorValueForId(tp.id);
        labelMap[tp.id] = tp.label;
    });
    const barGray = getCSSColor('--chart-gray-bar');
    const textGray = getCSSColor('--chart-gray-text');

    // Chantier 1B (suite) : types de la combinaison "repos" pour la moyenne mobile —
    // settings.combinedTypeIds, même source que renderResults() (plus de [1,2] en dur).
    const reposIds = settings.combinedTypeIds;

    // --- FENÊTRAGE (Chantier 1A) ---
    // Fenêtre officielle d'affichage : 14 jours glissants sur resultsEndDate.
    // Plage élargie de ±1 jour pour l'agrégation : la moyenne mobile centrée sur 3 jours
    // a besoin d'un voisin de chaque côté, y compris pour les 2 jours en bord de fenêtre
    // (voir Handoff, section 5 — pièges techniques).
    const ed = window.resultsEndDate;
    const windowStartTs = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() - (RESULTS_WINDOW_DAYS - 1)).getTime();
    const windowEndTs = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() + 1).getTime(); // exclusif
    const aggStartTs = windowStartTs - 86400000;
    const aggEndTs = windowEndTs + 86400000;

    // --- AGRÉGATION (sur la plage élargie) ---
    const daysData = {};
    let allPeriods = [...state.history];
    if (state.activeType) {
        // Découpe à minuit (comme closePeriod()) — voir splitPeriodIntoDayFragments().
        splitPeriodIntoDayFragments(state.startTime, Date.now()).forEach(frag => {
            allPeriods.push({ typeId: state.activeType, start: frag.start, end: frag.end });
        });
    }
    allPeriods = allPeriods.filter(p => p.start >= aggStartTs && p.start < aggEndTs);

    allPeriods.forEach(p => {
        const d = new Date(p.start);
        const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const displayDate = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!daysData[dateKey]) daysData[dateKey] = { displayDate, totals: {}, reposMins: 0, totalMins: 0 };
        const durationMins = (p.end - p.start) / 60000;
        const typeKey = p.typeId !== undefined ? p.typeId : p.type;
        if (!daysData[dateKey].totals[typeKey]) daysData[dateKey].totals[typeKey] = 0;
        daysData[dateKey].totals[typeKey] += durationMins;
        daysData[dateKey].totalMins += durationMins;
        if (reposIds.includes(typeKey)) daysData[dateKey].reposMins += durationMins;
    });

    const sortedDates = Object.keys(daysData).sort((a, b) => b.localeCompare(a));

    // Jours de la fenêtre officielle uniquement — la plage élargie ci-dessus ne sert
    // qu'au calcul de la moyenne mobile en bord de fenêtre, jamais à l'affichage.
    const displayDates = sortedDates.filter(key => {
        const [yy, mm, dd] = key.split('-').map(Number);
        const ts = new Date(yy, mm - 1, dd).getTime();
        return ts >= windowStartTs && ts < windowEndTs;
    });

    if (displayDates.length === 0) {
        container.innerHTML = `<p style='text-align:center; color:#888;'>${t('noDataAvailable')}</p>`;
        return;
    }

    // --- MOYENNE MOBILE CENTRÉE SUR 3 JOURS ---
    // Même règle que renderResults : journée incomplète exclue du triplet.
    // La valeur stockée est le % de position horizontale sur la barre (0-100).
    const chronoDates = [...sortedDates].reverse();

    const isIncomplete = (key) => {
        // Un jour est incomplet dès qu'il a moins de 22h59 enregistrées, 
        // y compris pour "aujourd'hui".
        return daysData[key].totalMins < 23 * 60 - 1;
    };

    const moyMobileChart = {};
    if (reposIds.length === 0) {
        // Combinaison vide : pas de point blanc du tout (un 0% serait trompeur, pas
        // une vraie absence de donnée) — cohérent avec le masquage de la ligne 3 dans
        // renderResults().
        chronoDates.forEach(key => { moyMobileChart[key] = null; });
    } else {
        chronoDates.forEach((key, idx) => {
            if (idx === 0 || idx === chronoDates.length - 1) { moyMobileChart[key] = null; return; }
            const kPrev = chronoDates[idx - 1];
            const kNext = chronoDates[idx + 1];
            if (isIncomplete(kPrev) || isIncomplete(key) || isIncomplete(kNext)) { moyMobileChart[key] = null; return; }
            const avg = (daysData[kPrev].reposMins + daysData[key].reposMins + daysData[kNext].reposMins) / 3;
            moyMobileChart[key] = (avg / 1440) * 100;
        });
    }

    // --- CONSTRUCTION DU HTML ---
    let html = `
                <div style="position: relative; margin-bottom: 20px;">
                    <div style="display: flex; margin-left: 55px; position: relative; color: ${textGray}; font-size: 0.75rem; height: 18px; font-weight: bold;">
                        <span style="position: absolute; left: 0%; transform: translateX(-50%);">0</span>
                        <span style="position: absolute; left: 25%; transform: translateX(-50%);">6</span>
                        <span style="position: absolute; left: 50%; transform: translateX(-50%);">12</span>
                        <span style="position: absolute; left: 75%; transform: translateX(-50%);">18</span>
                        <span style="position: absolute; left: 100%; transform: translateX(-50%);">24</span>
                    </div>
                    <div style="position: relative; padding-top: 8px; padding-bottom: 2px;">
                        <div style="position: absolute; top: 0; bottom: 0; left: 55px; right: 0; pointer-events: none; z-index: 0;">
                            <div style="position: absolute; left: 25%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                            <div style="position: absolute; left: 50%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                            <div style="position: absolute; left: 75%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                        </div>
            `;

    displayDates.forEach(dateKey => {
        const day = daysData[dateKey];
        const avgPc = moyMobileChart[dateKey]; // % ou null

        // Week-end : texte de la date légèrement grisé pour distinguer visuellement les jours
        // de semaine et de week-end. L'opacité s'applique au seul <span> du texte (pas au <div>
        // de la colonne) : les mini-pastilles, frères de ce <span>, n'en héritent donc pas.
        const [dkY, dkM, dkD] = dateKey.split('-').map(Number);
        const isWeekend = [0, 6].includes(new Date(dkY, dkM - 1, dkD).getDay());
        const dateLabelStyle = 'width: 45px; flex-shrink: 0; font-size: 0.9rem; font-weight: bold; color: #e0e0e0; text-align: right; margin-right: 10px;';
        const dateTextStyle = isWeekend ? ' style="opacity: 0.6;"' : '';

        const avgMins = avgPc !== null ? (avgPc / 100) * 1440 : 0;
        const avgLabel = avgPc !== null ? `~ ${t('resMoy3j')} : ${formatMins(avgMins)}` : '';

        // Mini-pastilles d'événements journaliers — même fonction et même forme (barrette,
        // pas un cercle) que dans Historique. Frères du <span> du texte de la date, dans un
        // conteneur .daily-chart-date-wrap à la largeur exacte du texte : positionnées en
        // absolu à 50 % de ce conteneur, elles sont donc centrées sur le texte réel (quelle que
        // soit la police) et n'héritent jamais de l'opacité weekend (portée par le <span>).
        // Elles ne modifient ni la hauteur de ligne ni margin-bottom.
        const eventPillsHTML = getPresentDailyEventTags(dateKey)
            .map(tg => `<span class="timeline-event-marker-pill" style="background:${getEventTagColor(tg.id)};"></span>`)
            .join('');
        const eventMarkersHTML = eventPillsHTML
            ? `<span class="daily-chart-event-markers">${eventPillsHTML}</span>`
            : '';

        const dotDisplay = window.showMoyDots ? 'block' : 'none';

        const avgDot = avgPc !== null ? `
                    <div style="display: ${dotDisplay}; position: absolute; left: 55px; right: 0; top: 0; bottom: 0; pointer-events: none; z-index: 3;">
                        <div style="position: absolute; left: ${avgPc.toFixed(2)}%;
                                    top: 50%; transform: translate(-50%, -50%);
                                    width: 9px; height: 9px; background: white; border-radius: 50%;
                                    box-shadow: 0 0 4px rgba(0,0,0,0.7); pointer-events: auto; cursor: default;"
                             onmousemove="showBarTooltip(event, '<b>${avgLabel}</b>')"
                             ontouchstart="showBarTooltip(event, '<b>${avgLabel}</b>')"
                             onmouseout="hideBarTooltip()" ontouchend="hideBarTooltip()">
                        </div>
                    </div>` : '';

        html += `
                    <div style="display: flex; align-items: center; margin-bottom: 15px; position: relative; z-index: 1;">
                        <div style="${dateLabelStyle}">
                            <span class="daily-chart-date-wrap"><span${dateTextStyle}>${day.displayDate}</span>${eventMarkersHTML}</span>
                        </div>
                        <div style="flex-grow: 1; display: flex; height: 24px; background-color: ${barGray}; border-radius: 4px; overflow: hidden; cursor: pointer; position: relative; border: 0.5px solid rgba(255,255,255,0.1);">
                            <div style="position: absolute; inset: 0; display: flex; z-index: 1;">
                                ${Object.keys(day.totals).sort().map(type => {
            const mins = day.totals[type];
            const perc = (mins / 1440) * 100;
            const typeId = parseInt(type);
            const color = colorMap[typeId] || getColorValueForId(typeId);
            const label = labelMap[typeId] || getLabelForId(typeId) || `Type #${typeId}`;
            const timeStr = formatMins(mins);
            // Texte de l'infobulle dans data-tip (échappé), jamais dans le JS inline : un libellé
            // contenant ' ou " casserait sinon le gestionnaire (infobulle muette). Le libellé est
            // échappé une fois pour le HTML de l'infobulle, puis le tout pour l'attribut.
            const tipHtml = escapeHtml(`${escapeHtml(label)} : <b>${timeStr}</b>`);
            return perc > 0 ? `
                                        <div style="width: ${perc}%; background-color: ${color}; height: 100%;"
                                             data-tip="${tipHtml}"
                                             onmousemove="showBarTooltip(event, this.dataset.tip)"
                                             onmouseout="hideBarTooltip()"
                                             ontouchstart="showBarTooltip(event, this.dataset.tip)"
                                             ontouchend="hideBarTooltip()">
                                        </div>` : '';
        }).join('')}
                            </div>
                            <div style="position: absolute; inset: 0; display: flex; pointer-events: none; z-index: 2;">
                                ${Array.from({ length: 24 }).map(() =>
            `<div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.15);"></div>`
        ).join('')}
                            </div>
                        </div>
                        ${avgDot}
                    </div>
                `;
    });

    html += `</div></div>`;

    // Légende — types ayant des données dans l'historique
    html += `<div style="display: flex; flex-wrap: wrap; justify-content: flex-start; margin-left: 55px; row-gap: 2px; column-gap: 10px; margin-top: 5px; font-size: 0.85rem; color: ${textGray};">`;
    getTypesWithHistoryData().forEach(tp => {
        const label = tp.label || `Type #${tp.id}`;
        html += `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${colorMap[tp.id]};"></div>
                        <span>${label}</span>
                    </div>`;
    });

    // Légende cliquable pour les points de moyenne mobile
    const eyeSlash = window.showMoyDots ? '' : `<span style="position: absolute; top: 50%; left: -2px; right: -2px; height: 2px; background: var(--text-color); transform: rotate(-45deg);"></span>`;
    const opacity = window.showMoyDots ? '1' : '0.5';

    html += `
                <div onclick="toggleMoyDots()" style="display: flex; align-items: center; gap: 6px; cursor: pointer; opacity: ${opacity}; transition: opacity 0.2s;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: white; box-shadow: 0 0 3px rgba(0,0,0,0.5);"></div>
                    <span>~ ${t('resMoy3j')}</span>
                    <span style="position: relative; display: inline-block; margin-left: 4px; font-size: 1.1rem;">
                        👁️
                        ${eyeSlash}
                    </span>
                </div>`;

    container.innerHTML = html;
}

// ============================================================
// 14b. GRAPHIQUE HEBDOMADAIRE
// Affiche une barre par semaine ISO, représentant la moyenne
// des jours complets (>= 23h enregistrées) de cette semaine.
// Pas de moyenne mobile. Label : "S21", "S22", etc.
// ============================================================
function renderWeeklyCharts() {
    console.log("[renderWeeklyCharts] Rendu du graphique hebdomadaire");

    const container = document.getElementById('weekly-charts-container');
    if (!container) return;
    container.innerHTML = '';

    // Point 4 : colorMap et labelMap depuis settings.types (tous les types, actifs et inactifs)
    // La légende n'affichera que les types ayant des données dans la période affichée
    const colorMap = {};
    const labelMap = {};
    settings.types.forEach(tp => {
        colorMap[tp.id] = getColorValueForId(tp.id);
        labelMap[tp.id] = tp.label;
    });
    const barGray = getCSSColor('--chart-gray-bar');
    const textGray = getCSSColor('--chart-gray-text');

    // Types repos (même définition que renderDailyCharts)
    const reposIds = [1, 2];

    // --- HELPER : numéro de semaine ISO et année ISO ---
    // Retourne { week: 21, year: 2026 } pour une date donnée.
    // La semaine ISO commence le lundi. L'année ISO peut différer de l'année civile
    // pour les jours en début/fin d'année.
    function getISOWeek(dateStr) {
        const d = new Date(dateStr);
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = date.getUTCDay() || 7; // lundi = 1, dimanche = 7
        date.setUTCDate(date.getUTCDate() + 4 - day); // jeudi de la semaine
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        return { week, year: date.getUTCFullYear() };
    }

    // --- AGRÉGATION PAR JOUR (identique à renderDailyCharts) ---
    const daysData = {};
    let allPeriods = [...state.history];
    if (state.activeType) {
        // Découpe à minuit (comme closePeriod()) — voir splitPeriodIntoDayFragments().
        splitPeriodIntoDayFragments(state.startTime, Date.now()).forEach(frag => {
            allPeriods.push({ typeId: state.activeType, start: frag.start, end: frag.end });
        });
    }

    allPeriods.forEach(p => {
        const d = new Date(p.start);
        const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const displayDate = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!daysData[dateKey]) daysData[dateKey] = { displayDate, totals: {}, reposMins: 0, totalMins: 0 };
        const durationMins = (p.end - p.start) / 60000;
        const typeKey = p.typeId !== undefined ? p.typeId : p.type;
        if (!daysData[dateKey].totals[typeKey]) daysData[dateKey].totals[typeKey] = 0;
        daysData[dateKey].totals[typeKey] += durationMins;
        daysData[dateKey].totalMins += durationMins;
        if (reposIds.includes(typeKey)) daysData[dateKey].reposMins += durationMins;
    });

    // Critère d'incomplétude — même seuil que renderDailyCharts
    const isIncomplete = (key) => daysData[key].totalMins < 23 * 60 - 1;

    // --- AGRÉGATION PAR SEMAINE ---
    // weeksData : clé = "2026-W21", valeur = { label, completeDays, totals }
    const weeksData = {};

    Object.keys(daysData).forEach(dateKey => {
        if (isIncomplete(dateKey)) return; // On ignore les jours incomplets

        const { week, year } = getISOWeek(dateKey);
        const weekKey = `${year}-W${String(week).padStart(2, '0')}`; // ex: "2026-W21"

        if (!weeksData[weekKey]) {
            weeksData[weekKey] = {
                label: `${settings.lang === 'fr' ? 'S' : 'W'}${week}`,   // S21 (fr) ou W21 (en/nl)
                completeDays: 0,
                totals: {},          // somme des minutes par type
                totalMins: 0
            };
        }

        weeksData[weekKey].completeDays++;
        weeksData[weekKey].totalMins += daysData[dateKey].totalMins;

        Object.keys(daysData[dateKey].totals).forEach(type => {
            if (!weeksData[weekKey].totals[type]) weeksData[weekKey].totals[type] = 0;
            weeksData[weekKey].totals[type] += daysData[dateKey].totals[type];
        });
    });

    // Tri décroissant (semaine la plus récente en haut)
    const sortedWeeks = Object.keys(weeksData).sort((a, b) => b.localeCompare(a));

    if (sortedWeeks.length === 0) {
        container.innerHTML = `<p style='text-align:center; color:#888;'>${t('notEnoughData')}</p>`;
        return;
    }

    // --- CONSTRUCTION DU HTML ---
    // Même structure visuelle que renderDailyCharts : axe 0h-24h + barres
    let html = `
                <div style="position: relative; margin-bottom: 20px;">
                    <div style="display: flex; margin-left: 55px; position: relative; color: ${textGray}; font-size: 0.75rem; height: 18px; font-weight: bold;">
                        <span style="position: absolute; left: 0%; transform: translateX(-50%);">0</span>
                        <span style="position: absolute; left: 25%; transform: translateX(-50%);">6</span>
                        <span style="position: absolute; left: 50%; transform: translateX(-50%);">12</span>
                        <span style="position: absolute; left: 75%; transform: translateX(-50%);">18</span>
                        <span style="position: absolute; left: 100%; transform: translateX(-50%);">24</span>
                    </div>
                    <div style="position: relative; padding-top: 8px; padding-bottom: 2px;">
                        <div style="position: absolute; top: 0; bottom: 0; left: 55px; right: 0; pointer-events: none; z-index: 0;">
                            <div style="position: absolute; left: 25%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                            <div style="position: absolute; left: 50%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                            <div style="position: absolute; left: 75%; top: 0; bottom: 0; border-left: 1px solid var(--grid-line);"></div>
                        </div>
            `;

    sortedWeeks.forEach(weekKey => {
        const week = weeksData[weekKey];
        const n = week.completeDays; // nombre de jours complets dans la semaine

        // Calcul des moyennes : total de la semaine / nombre de jours complets
        html += `
                    <div style="display: flex; align-items: center; margin-bottom: 15px; position: relative; z-index: 1;">
                        <div style="width: 45px; flex-shrink: 0; font-size: 0.9rem; font-weight: bold; color: #e0e0e0; text-align: right; margin-right: 10px;">
                            ${week.label}
                        </div>
                        <div style="flex-grow: 1; display: flex; height: 24px; background-color: ${barGray}; border-radius: 4px; overflow: hidden; cursor: default; position: relative; border: 0.5px solid rgba(255,255,255,0.1);">
                            <div style="position: absolute; inset: 0; display: flex; z-index: 1;">
                                ${Object.keys(week.totals).sort().map(type => {
            const avgMins = week.totals[type] / n;
            const perc = (avgMins / 1440) * 100;
            // Passe C : lookup par typeId
            const typeId = parseInt(type);
            const color = colorMap[typeId] || getColorValueForId(typeId);
            const label = labelMap[typeId] || getLabelForId(typeId) || `Type #${typeId}`;
            const timeStr = formatMins(avgMins);
            // Même principe que le graphe journalier : texte échappé dans data-tip, pas dans le JS inline.
            const tooltipText = escapeHtml(`${escapeHtml(label)} : <b>${timeStr}</b> (moy. ${n}j)`);
            return perc > 0 ? `
                                        <div style="width: ${perc}%; background-color: ${color}; height: 100%;"
                                             data-tip="${tooltipText}"
                                             onmousemove="showBarTooltip(event, this.dataset.tip)"
                                             onmouseout="hideBarTooltip()"
                                             ontouchstart="showBarTooltip(event, this.dataset.tip)"
                                             ontouchend="hideBarTooltip()">
                                        </div>` : '';
        }).join('')}
                            </div>
                            <div style="position: absolute; inset: 0; display: flex; pointer-events: none; z-index: 2;">
                                ${Array.from({ length: 24 }).map(() =>
            `<div style="flex: 1; border-right: 1px solid rgba(0,0,0,0.15);"></div>`
        ).join('')}
                            </div>
                        </div>
                    </div>
                `;
    });

    html += `</div></div>`;

    // Légende — types ayant des données dans l'historique
    html += `<div style="display: flex; flex-wrap: wrap; justify-content: flex-start; margin-left: 55px; row-gap: 2px; column-gap: 10px; margin-top: 5px; font-size: 0.85rem; color: ${textGray};">`;
    getTypesWithHistoryData().forEach(tp => {
        const label = tp.label || `Type #${tp.id}`;
        html += `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${colorMap[tp.id]};"></div>
                        <span>${label}</span>
                    </div>`;
    });
    html += `</div>`;

    container.innerHTML = html;
}