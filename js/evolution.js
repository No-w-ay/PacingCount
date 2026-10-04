// evolution.js — section 25 (graphique Évolution). Dépend des globals de index.html (settings, state, t, …), appelé uniquement après chargement.

// ============================================================
// 25. GRAPHIQUE ÉVOLUTION (Chantier 2/3 — Passe 1, puis raffinement continuité des trous)
//
// buildEvolutionFullDaysIndex() : agrège TOUT l'historique en un index par jour
// (proportionnel au nombre de PÉRIODES, pas de jours) — coûteux mais rare : calculé une
// seule fois par ouverture de l'overlay (voir openEvolutionOverlay()), mis en cache dans
// window.evolutionFullDaysIndex. Pas de logique d'invalidation fine : l'overlay occupe
// tout l'écran (aucune édition de données possible pendant qu'il est ouvert), donc un
// simple recalcul à chaque (ré)ouverture suffit.
//
// computeEvolutionData() lit ensuite cet index déjà construit — tout le reste (fenêtre
// affichée, moyennes mobiles, recherche d'un point d'ancrage hors fenêtre) devient un
// simple parcours de ce petit tableau (proportionnel au nombre de JOURS, borné même sur
// des années d'usage quotidien), donc bon marché à répéter à chaque frame de geste.
//
// Pourquoi un ancrage hors fenêtre : Chart.js ne peut tracer un segment de courbe
// (même partiellement, même juste la portion visible) qu'entre deux points réellement
// présents dans le tableau de données. Un trou de plusieurs jours à plusieurs mois entre
// deux points de moyenne mobile doit donc pouvoir inclure son point de destination même
// s'il tombe hors de la fenêtre affichée — sans quoi Chart.js n'a rien à quoi relier le
// dernier point visible, et le segment pointillé disparaît entièrement au lieu d'être
// rogné visuellement au bord (ce que scales.x.min/max fait nativement, à condition que
// les deux points existent dans le tableau). D'où : pour chaque courbe, on conserve tous
// les points dans la fenêtre + au plus un point d'ancrage immédiatement avant et un
// immédiatement après, peu importe leur distance réelle. Ces points d'ancrage sont
// marqués _anchor:true pour être exclus du calcul d'échelle Y en mode zoom
// (computeYAxisRange) — sinon un point très éloigné et très différent fausserait
// l'échelle affichée pour la fenêtre réellement visible.
// ============================================================

// Construit l'index par jour sur l'intégralité de l'historique — volontairement sans
// fenêtrage : c'est le seul endroit de l'app qui a besoin de "tout", et seulement une
// fois par ouverture d'overlay (voir commentaire d'en-tête ci-dessus).
// La période active en cours est désormais INCLUSE (avant : exclue en entier — voir
// synthèse précédente), mais découpée à minuit comme partout ailleurs dans l'app (même
// helper splitPeriodIntoDayFragments() que Résultats/graphiques/Historique). Sans cette
// découpe, une période ouverte depuis >24h gonflerait totalMins au-delà de 1440 min pour
// son jour de départ, faussant à la fois la détection "jour complet" et l'échelle Y en
// mode zoom (computeYAxisRange() pouvait dépasser 24h) — c'est pour cette raison qu'elle
// avait été exclue en entier à l'origine. Le seuil "jour complet" (isComplete(), voir
// computeEvolutionData()) reste strictement identique pour "aujourd'hui" que pour tout
// autre jour — aucun traitement de faveur : un jour très rempli peut donc apparaître
// avant même minuit, un jour avec des trous reste invisible jusqu'à ce que le seuil soit
// atteint, exactement comme n'importe quel jour passé.
function buildEvolutionFullDaysIndex() {
    const daysData = {};

    // Agrège une période dans daysData — factorisé pour être appelé à la fois sur
    // l'historique clos (state.history[]) et sur les fragments de la période active
    // (voir plus bas), sans dupliquer la logique de bucket par jour.
    function addPeriod(typeId, start, end) {
        const d = new Date(start);
        const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const mins = (end - start) / 60000;
        if (!daysData[dateKey]) {
            daysData[dateKey] = { timestamp: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), totalMins: 0, typeTotals: {} };
        }
        daysData[dateKey].totalMins += mins;
        if (!daysData[dateKey].typeTotals[typeId]) daysData[dateKey].typeTotals[typeId] = 0;
        daysData[dateKey].typeTotals[typeId] += mins;
    }

    state.history.forEach(e => addPeriod(e.typeId, e.start, e.end));

    if (state.activeType !== null && state.startTime !== null) {
        splitPeriodIntoDayFragments(state.startTime, Date.now()).forEach(frag => {
            addPeriod(state.activeType, frag.start, frag.end);
        });
    }

    return { daysData, dateKeys: Object.keys(daysData).sort() };
}

// computeEvolutionData() : fonction d'agrégation générique — accepte n'importe quelle
// fenêtre (windowDays paramétré) et n'importe quel ensemble de séries (typeId numérique,
// ou 'combined' pour la grandeur blanche définie par settings.combinedTypeIds — même état
// que Chantier 1B, pas de duplication). Un jour est exclu en bloc (toutes séries) s'il
// est incomplet — même seuil que renderResults()/renderDailyCharts() (< 23h-1min).
// Lit window.evolutionFullDaysIndex (voir buildEvolutionFullDaysIndex() ci-dessus) —
// jamais reconstruit ici, seulement à l'ouverture de l'overlay.
function computeEvolutionData(endDate, windowDays, seriesIds) {
    const windowStartTs = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - (windowDays - 1)).getTime();
    const windowEndTs = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).getTime(); // exclusif

    if (!window.evolutionFullDaysIndex) window.evolutionFullDaysIndex = buildEvolutionFullDaysIndex();
    const { daysData, dateKeys } = window.evolutionFullDaysIndex;

    const isComplete = (key) => daysData[key] && daysData[key].totalMins >= 23 * 60 - 1;

    function seriesValue(dateKey, seriesId) {
        const day = daysData[dateKey];
        if (!day) return 0;
        if (seriesId === 'combined') {
            return settings.combinedTypeIds.reduce((sum, tId) => sum + (day.typeTotals[tId] || 0), 0);
        }
        return day.typeTotals[seriesId] || 0;
    }

    // Points bruts — jours complets uniquement, dans la fenêtre officielle. Conversion
    // minutes → heures ici : l'axe Y du graphe est en heures (0-24). Pas de notion
    // d'ancrage hors fenêtre pour les points bruts : ce sont des points isolés (pas de
    // ligne à relier), seules les courbes de moyenne mobile ont besoin de cette logique.
    const points = {};
    seriesIds.forEach(sid => points[sid] = []);
    dateKeys.forEach(key => {
        const ts = daysData[key].timestamp;
        if (ts < windowStartTs || ts >= windowEndTs) return;
        if (!isComplete(key)) return;
        seriesIds.forEach(sid => points[sid].push({ x: ts, y: seriesValue(key, sid) / 60 }));
    });

    // Moyenne mobile centrée générique — halfWidth=1 → fenêtre 3j (J-1..J+1),
    // halfWidth=2 → fenêtre 5j, halfWidth=3 → fenêtre 7j. Calculée sur l'INTÉGRALITÉ de
    // dateKeys (pas seulement la fenêtre affichée) : un jour proche du bord de la fenêtre
    // va chercher ses voisins aussi loin que l'historique réel le permet, sans limite
    // artificielle. Continuité calendaire stricte : tous les jours voisins impliqués
    // doivent être calendairement consécutifs (pas seulement adjacents dans le tableau
    // trié) et complets — un vrai jour sans aucune période enregistrée est courant sur de
    // longues fenêtres ; sans ce contrôle, un jour absent ferait glisser silencieusement
    // le calcul sur un jour non-adjacent. _inWindow marque les points dans la fenêtre
    // officielle, distingués ensuite des candidats d'ancrage hors fenêtre (voir
    // reduceToWindowWithAnchors() plus bas).
    function computeMovingAvg(halfWidth) {
        const result = {};
        seriesIds.forEach(sid => result[sid] = []);
        dateKeys.forEach((key, idx) => {
            if (idx - halfWidth < 0 || idx + halfWidth >= dateKeys.length) return;

            const neighborKeys = [];
            for (let off = -halfWidth; off <= halfWidth; off++) neighborKeys.push(dateKeys[idx + off]);

            for (let i = 1; i < neighborKeys.length; i++) {
                // Comparaison par composants de date (pas par différence brute en ms) —
                // une nuit de changement d'heure ne dure que 23h ou 25h réelles, jamais
                // exactement 86400000ms, alors que le jour reste bien calendairement le
                // suivant. Même convention que le reste du projet (voir navigateHistory(),
                // getPalierStartDate()) : jamais de +24*3600*1000 pour un "jour suivant".
                const prevDate = new Date(daysData[neighborKeys[i - 1]].timestamp);
                const expectedNext = new Date(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate() + 1).getTime();
                if (daysData[neighborKeys[i]].timestamp !== expectedNext) return;
            }
            if (neighborKeys.some(k => !isComplete(k))) return;

            const ts = daysData[key].timestamp;
            const inWindow = ts >= windowStartTs && ts < windowEndTs;
            seriesIds.forEach(sid => {
                const sum = neighborKeys.reduce((s, k) => s + seriesValue(k, sid), 0);
                result[sid].push({ x: ts, y: (sum / neighborKeys.length) / 60, _inWindow: inWindow });
            });
        });
        return result;
    }

    // Réduit une série de moyenne mobile (calculée sur tout l'historique) à : tous ses
    // points dans la fenêtre affichée, + au plus un point d'ancrage immédiatement avant
    // et un immédiatement après — peu importe leur distance réelle (voir commentaire
    // d'en-tête de section). fullSeries est déjà trié par x croissant (dateKeys l'est).
    function reduceToWindowWithAnchors(fullSeries) {
        const result = {};
        seriesIds.forEach(sid => {
            const inWin = [];
            let before = null, after = null;
            fullSeries[sid].forEach(pt => {
                if (pt._inWindow) {
                    inWin.push({ x: pt.x, y: pt.y });
                } else if (pt.x < windowStartTs) {
                    before = pt; // dernier candidat rencontré avant la fenêtre = le plus proche (ordre croissant)
                } else if (after === null) {
                    after = pt; // premier candidat rencontré après la fenêtre = le plus proche (ordre croissant)
                }
            });
            const arr = [];
            if (before) arr.push({ x: before.x, y: before.y, _anchor: true });
            arr.push(...inWin);
            if (after) arr.push({ x: after.x, y: after.y, _anchor: true });
            result[sid] = arr;
        });
        return result;
    }

    return {
        points,
        movingAvg3: reduceToWindowWithAnchors(computeMovingAvg(1)),
        movingAvg5: reduceToWindowWithAnchors(computeMovingAvg(2)),
        movingAvg7: reduceToWindowWithAnchors(computeMovingAvg(3))
    };
}

let evolutionChartInstance = null;

// ============================================================
// 25d. EXPLORATION TACTILE — ligne verticale + points sur les courbes, dessinés en
// CANVAS (pas en DOM). Remplace le tooltip natif de Chart.js (désactivé, voir
// plugins.tooltip.enabled:false dans la config du chart).
//
// Choix canvas plutôt que DOM (contrairement à la bande de prévisualisation du
// pincement, en DOM) : ici la précision doit être pixel-parfaite avec les courbes
// réellement tracées (la marge de l'axe Y à gauche, ~55px, devrait sinon être
// recalculée à la main pour un positionnement en pourcentage — exactement le genre de
// valeur devinée qui a posé problème pour le millésime avant l'adoption du rendu natif
// Chart.js). En canvas, on lit directement scale.getPixelForValue()/getPixelForValue()
// — la géométrie exacte que Chart.js connaît déjà de lui-même, sans rien deviner.
//
// window.evolutionExploreTimestamp (jour, minuit local) : null hors exploration, sinon
// la date actuellement explorée — lu par le plugin ci-dessous à chaque redraw.
//
// Persistance et bascule (voir onEvolutionTouchStart/End) : le CONTACT (touchstart)
// bascule l'affichage — rien de visible → l'affiche à l'endroit touché ; quelque chose
// de visible → le masque. Le déplacement (touchmove) fait suivre le doigt SAUF si ce
// contact vient de fermer l'affichage (isClosing) — dans ce cas, tout déplacement est
// ignoré jusqu'au relâchement, pour qu'un micro-tremblement du doigt ne rouvre jamais
// l'affichage juste après l'avoir fermé (il faut relever puis retoucher pour explorer
// ailleurs). Au relâchement (touchend), rien n'est masqué automatiquement — l'état
// reste tel quel jusqu'au prochain contact ou jusqu'à un vrai changement d'affichage
// (palier, sélection, navigation — voir le masquage en tête de renderEvolutionChart()).
// ============================================================

// Cherche la valeur Y d'un tableau de points {x,y} (trié par x croissant) à un x donné :
// correspondance exacte si elle existe, sinon interpolation linéaire entre les deux
// points encadrants SI allowInterpolation (jamais pour les points bruts — voir
// _repType:'raw', qui ne doit jamais laisser croire à une donnée reconstituée pour un
// jour qui n'en a pas). Retourne null si aucune valeur ne peut être déterminée (hors
// plage du tableau, ou correspondance exacte requise mais absente).
function evolutionValueAtX(dataArr, ts, allowInterpolation) {
    if (!dataArr || dataArr.length === 0) return null;
    for (let i = 0; i < dataArr.length; i++) {
        if (dataArr[i].x === ts) return dataArr[i].y;
    }
    if (!allowInterpolation) return null;
    for (let i = 0; i < dataArr.length - 1; i++) {
        const a = dataArr[i], b = dataArr[i + 1];
        if (ts > a.x && ts < b.x) {
            const ratio = (ts - a.x) / (b.x - a.x);
            return a.y + (b.y - a.y) * ratio;
        }
    }
    return null;
}

// Plugin Chart.js — dessine la ligne verticale + un point par série active, à la date
// actuellement explorée (window.evolutionExploreTimestamp). Ne fait rien hors
// exploration (ts null). afterDraw : s'exécute après le rendu normal du graphe, jamais
// pris en compte dans le calcul de mise en page (même famille de technique que le rendu
// du millésime).
const evolutionExploreLinePlugin = {
    id: 'evolutionExploreLine',
    afterDraw(chart) {
        const ts = window.evolutionExploreTimestamp;
        if (ts === null || typeof ts === 'undefined') return;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        if (!xScale || !yScale) return;
        const xPixel = xScale.getPixelForValue(ts);
        if (xPixel < chart.chartArea.left || xPixel > chart.chartArea.right) return;

        const ctx = chart.ctx;
        ctx.save();

        // Ligne verticale — blanche, plus marquée que le quadrillage de fond (0.2) mais
        // pas aussi appuyée qu'un élément d'interface actif.
        ctx.strokeStyle = withAlpha('#ffffff', 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xPixel, chart.chartArea.top);
        ctx.lineTo(xPixel, chart.chartArea.bottom);
        ctx.stroke();

        // Un point par dataset actif ayant une valeur à cette date — correspondance
        // exacte pour les points bruts, interpolée pour les moyennes mobiles (voir
        // evolutionValueAtX()) : cohérent avec ce que la courbe affiche visuellement à
        // cet endroit, pointillé compris.
        chart.data.datasets.forEach(ds => {
            const y = evolutionValueAtX(ds.data, ts, ds._repType !== 'raw');
            if (y === null) return;
            const yPixel = yScale.getPixelForValue(y);
            const radius = ds._repType === 'raw' ? 3.5 : 4;
            ctx.beginPath();
            ctx.fillStyle = ds._color || '#ffffff';
            ctx.arc(xPixel, yPixel, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        });

        ctx.restore();
    }
};


// Seuil au-delà duquel un écart (en ms) entre deux points consécutifs est considéré
// comme un "trou" de données (jour incomplet, période sans mesure) — sert au style
// pointillé des segments, à la couleur des segments (evolutionSegmentColor(), ci-dessus
// près de withAlpha()) et à la détection des points isolés (isEvolutionPointIsolated(),
// dans renderEvolutionChart()). Portée globale : evolutionSegmentColor() est définie hors
// de renderEvolutionChart() et doit pouvoir y accéder. 1,5 jour : plus large qu'un écart
// normal jour-à-jour (24h) pour ne jamais déclencher à tort, assez strict pour réagir dès
// qu'un seul jour manque.
const EVOLUTION_AVG_GAP_THRESHOLD_MS = 1.5 * 86400000;

// Opacités des graduations principales vs secondaires (axe X : mois vs jour ; axe Y :
// heure entière vs fraction) — portée globale : réutilisées à la fois par les ticks
// réels du graphe (renderEvolutionChart()) et par la bande de prévisualisation pendant
// un geste (renderEvolutionPreviewBand()), pour un rendu identique dans les deux cas.
// Principal = repère d'orientation (nom de mois, heure entière, ou janvier en mode
// "graduations mois uniquement"), secondaire = graduation fine intermédiaire.
const EVOLUTION_TICK_PRINCIPAL_ALPHA = 0.95;
const EVOLUTION_TICK_SECONDARY_ALPHA = 0.55;

// Paliers de largeur temporelle (axe X) — sélectionnés par pincement (section 25b).
// "months: null" pour 'tout' signifie borne réelle = premier jour de l'historique
// (_getHistoryStartDate()), pas un nombre de mois fixe.
//
// Construit dynamiquement (pas un tableau fixe) : après 1 an, ajoute 1,5 an, 2 ans, puis
// un palier par année tant que ce palier ne couvre pas encore tout l'historique réel —
// "tout" reste toujours le dernier palier, quelle que soit l'ancienneté des données.
// Appelée à l'ouverture de l'overlay (voir openEvolutionOverlay()), mise en cache dans
// window.evolutionPaliers pour la durée de l'ouverture (pas recalculée à chaque frame
// de geste).
function buildEvolutionPaliers() {
    // Paliers courts — toujours affichés, jamais tronqués (même logique qu'avant pour
    // cette partie de la liste : ce sont des fenêtres courtes, quasi toujours pertinentes).
    const paliers = [
        { id: '1m', months: 1 }, { id: '2m', months: 2 }, { id: '3m', months: 3 },
        { id: '4m', months: 4 }, { id: '6m', months: 6 }, { id: '9m', months: 9 },
        { id: '1a', months: 12 }
    ];
    // Paliers 1.5a/2a — désormais soumis à la même troncature que les paliers annuels
    // dynamiques ci-dessous : si l'historique réel est plus court que ce que couvrirait
    // ce palier, il ferait doublon avec "tout" et n'est pas ajouté (ni les plus longs).
    const longCandidates = [{ id: '1.5a', months: 18 }, { id: '2a', months: 24 }];
    const histStart = _getHistoryStartDate();
    const today = new Date();
    if (histStart) {
        for (const p of longCandidates) {
            const candidateStart = new Date(today.getFullYear(), today.getMonth() - p.months, today.getDate());
            if (candidateStart <= histStart) break; // ce palier (et les plus longs) couvriraient déjà tout
            paliers.push(p);
        }
        let years = 3;
        while (years <= 50) { // garde-fou de sécurité, ne devrait jamais être atteint
            const candidateStart = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
            if (candidateStart <= histStart) break; // ce palier couvrirait déjà tout l'historique
            paliers.push({ id: `${years}a`, months: years * 12 });
            years++;
        }
    } else {
        // Aucun historique du tout (app vide) : on garde 1.5a/2a par cohérence visuelle,
        // rien à tronquer puisqu'il n'y a pas de borne réelle à comparer.
        paliers.push(...longCandidates);
    }
    paliers.push({ id: 'tout', months: null });
    return paliers;
}

// Calcule la date de début (minuit local) pour un palier donné, ancrée sur endDate.
// Arithmétique calendaire (pas un nombre de jours fixe) : "1 mois" recule d'exactement
// un mois calendaire, JS gère nativement le débordement de fin de mois (ex: 31 mars
// -1 mois → 28/29 février). Palier 'tout' : borne réelle = premier jour avec données,
// repli à 1 mois si aucun historique (évite une fenêtre vide/instable).
function getPalierStartDate(endDate, palier) {
    if (palier.months === null) {
        const histStart = _getHistoryStartDate();
        return histStart || new Date(endDate.getFullYear(), endDate.getMonth() - 1, endDate.getDate());
    }
    return new Date(endDate.getFullYear(), endDate.getMonth() - palier.months, endDate.getDate());
}

// Jours de graduation dans un mois pour un palier donné :
//   1 mois → tous les jours ; 2/3 mois → pas de 5 (1,5,10,...,25) ;
//   6 mois → pas de 10 (1,10,20) ; 1 an et au-delà (dont 'tout') → mensuel (jour 1
// uniquement). Raisonne sur palier.months (nombre) plutôt que palier.id (chaîne) pour
// couvrir nativement les paliers annuels dynamiques (1.5a, 2a, 3a, ...) sans les lister
// un par un. Le dernier multiple avant 30 est exclu naturellement par la condition
// d < 30 (trop proche du 1er du mois suivant, déjà affiché séparément).
function getEvolutionTickDaysInMonth(palier, daysInMonth) {
    if (palier.months === 1) {
        return Array.from({ length: daysInMonth }, (_, i) => i + 1);
    }
    if (palier.months === null || palier.months >= 9) {
        return [1]; // 9 mois et au-delà (+ 'tout') → mensuel
    }
    const pas = (palier.months === 4 || palier.months === 6) ? 10 : 5; // 2/3 mois → pas de 5 ; 4/6 mois → pas de 10
    const days = [];
    for (let d = 1; d < 30; d += pas) days.push(d);
    return days;
}

// Construit la liste des graduations (timestamps) pour l'axe X entre rangeMin et
// rangeMax, selon le pas propre au palier — réutilisée par le graphique Chart.js
// (afterBuildTicks) ET par la bande de prévisualisation pendant un geste (section 25b),
// pour que les deux affichent toujours exactement les mêmes jours.
function computeEvolutionTicks(rangeMin, rangeMax, palier) {
    const ticks = [];
    let cursor = new Date(new Date(rangeMin).getFullYear(), new Date(rangeMin).getMonth(), 1);
    const end = new Date(rangeMax);
    while (cursor <= end) {
        const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        getEvolutionTickDaysInMonth(palier, daysInMonth).forEach(day => {
            if (day > daysInMonth) return;
            const d = new Date(cursor.getFullYear(), cursor.getMonth(), day);
            if (d.getTime() >= rangeMin && d.getTime() <= rangeMax) ticks.push(d.getTime());
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return ticks.sort((a, b) => a - b);
}

// ============================================================
// 25c. LABEL DE PALIER CLIQUABLE + PALETTE DE SÉLECTION DIRECTE
// Groupe #evolution-palier-group (injecté en fin de rendu par renderEvolutionChips(),
// même rangée que les chips/pills, poussé à droite) : durée cliquable (ouvre
// #evolution-palier-picker, pills réutilisant .evolution-toggle-pill) + fin de période
// "→ mois année" (non cliquable, mise à jour uniquement par le swipe). Mis à jour en
// direct pendant les gestes (candidat), et à l'état committé après tout rendu réel (voir
// renderEvolutionChart() et onEvolutionTouchEnd()).
// ============================================================

// Formate "1,5" (FR/NL) vs "1.5" (EN) — seul cas décimal possible dans la liste actuelle
// de paliers est 1.5a (18 mois / 12).
function formatEvolutionDecimalYears(years) {
    const str = years.toString();
    return settings.lang === 'en' ? str : str.replace('.', ',');
}

// Texte de la partie durée du label — et des pills de la palette (même fonction,
// même texte partout pour un seul palier donné).
function formatEvolutionPalierDurationText(palier) {
    if (palier.months === null) return t('evolutionFullHistory');
    if (palier.months < 12) {
        return palier.months === 1
            ? t('evolutionMonthSingular')
            : t('evolutionMonthsPlural', { n: palier.months });
    }
    const years = palier.months / 12;
    if (Number.isInteger(years)) {
        return years === 1
            ? t('evolutionYearSingular')
            : t('evolutionYearsPlural', { n: years });
    }
    return t('evolutionYearsDecimal', { n: formatEvolutionDecimalYears(years) });
}

// Formate la date de fin en largeur FIXE (monospace) — abréviation mois à 4 caractères
// (padding déjà inclus dans la chaîne, ex. "mai ", voir evolutionMonthsShort4 dans
// translations{}), jour paddé par un ESPACE (pas un zéro — style "23 oct." plutôt que
// "02 oct.") sur 2 caractères, année sur 4. #evolution-palier-end a white-space:pre
// (voir CSS) pour ne jamais laisser le rendu collapser ces espaces de padding — chaque
// position de caractère reste alignée d'un swipe à l'autre, sans "saut" visuel.
function formatEvolutionEndDateFixed(date) {
    const dict = translations[settings.lang] || translations['fr'];
    const months = dict.evolutionMonthsShort4 || translations['fr'].evolutionMonthsShort4;
    const day = date.getDate().toString().padStart(2, ' ');
    const month = months[date.getMonth()];
    return `${day} ${month} ${date.getFullYear()}`;
}

// Met à jour l'affichage du label — sans argument : état committé actuel
// (window.evolutionPalierIndex / window.evolutionEndDate). Pendant un geste, l'appelant
// passe un palier candidat (pincement) OU une date de fin candidate (swipe), jamais les
// deux à la fois — voir onEvolutionTouchMove().
function updateEvolutionPalierLabel(overridePalier, overrideEndDate) {
    const durationEl = document.getElementById('evolution-palier-duration');
    const endEl = document.getElementById('evolution-palier-end');
    if (!durationEl || !endEl) return;

    const palier = overridePalier || window.evolutionPaliers[window.evolutionPalierIndex];
    durationEl.textContent = formatEvolutionPalierDurationText(palier);

    if (palier.months === null) {
        endEl.textContent = ''; // "Historique complet" — pas de fin fixe à afficher
        return;
    }
    const endDate = overrideEndDate || window.evolutionEndDate;
    endEl.textContent = ` → ${formatEvolutionEndDateFixed(endDate)}`;
}

function hideEvolutionPalierPicker() {
    const picker = document.getElementById('evolution-palier-picker');
    if (picker) picker.style.display = 'none';
}

function toggleEvolutionPalierPicker() {
    const picker = document.getElementById('evolution-palier-picker');
    if (!picker) return;
    if (picker.style.display === 'flex') {
        picker.style.display = 'none';
    } else {
        renderEvolutionPalierPicker();
        picker.style.display = 'flex';
    }
}

function renderEvolutionPalierPicker() {
    const picker = document.getElementById('evolution-palier-picker');
    if (!picker) return;
    picker.innerHTML = window.evolutionPaliers.map((p, idx) => {
        const cls = idx === window.evolutionPalierIndex
            ? 'evolution-toggle-pill evolution-chip-selected'
            : 'evolution-toggle-pill evolution-chip-unselected';
        return `<div class="${cls}" onclick="selectEvolutionPalier(${idx})">${formatEvolutionPalierDurationText(p)}</div>`;
    }).join('');
}

// Applique un changement de palier — factorisé car atteint par deux chemins (pincement,
// sélection dans la palette). Cas particulier "tout" : ce palier signifie "l'historique
// en entier, jusqu'à aujourd'hui" — si evolutionEndDate avait été déplacé dans le passé
// par un swipe précédent (sur un autre palier), on le ramène à aujourd'hui ici, sinon
// "tout" afficherait une fenêtre tronquée (rien après cette ancienne date de fin swipée).
// Les autres paliers n'ont pas cette ambiguïté : ils sont légitimement relatifs à
// n'importe quelle date de fin choisie.
function applyEvolutionPalierChange(newIndex) {
    window.evolutionPalierIndex = newIndex;
    const palier = window.evolutionPaliers[newIndex];
    if (palier.months === null) {
        const n = new Date();
        window.evolutionEndDate = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }
    renderEvolutionChart();
}

// Sélection directe d'un palier depuis la palette — ferme la palette, redessine le
// graphique avec la fenêtre du palier choisi.
function selectEvolutionPalier(index) {
    hideEvolutionPalierPicker();
    if (index === window.evolutionPalierIndex) return;
    applyEvolutionPalierChange(index);
}

// Couleur/label d'une série — 'combined' (grandeur blanche, settings.combinedTypeIds)
// ou un typeId individuel. Réutilisé par les chips et par le graphique.
function getEvolutionSeriesColor(seriesId) {
    return seriesId === 'combined' ? '#ffffff' : getColorValueForId(seriesId);
}
function getEvolutionSeriesLabel(seriesId) {
    return seriesId === 'combined' ? t('resComboTotal') : (getLabelForId(seriesId) || `Type #${seriesId}`);
}

// Applique une opacité à une couleur de série pour les points bruts (distinction
// visuelle avec la courbe de moyenne mobile, tracée pleine opacité par-dessus).
// Couvre les formats réellement utilisés ici : hsl(...) (palette prédéfinie), blanc
// (combinaison), hex (futurs types custom). Repli sans opacité si format inconnu
// (rgb/rgba déjà, etc.) — n'empêche jamais l'affichage, juste moins de contraste.
function withAlpha(colorStr, alpha) {
    if (colorStr === '#ffffff' || colorStr === 'white') return `rgba(255,255,255,${alpha})`;
    if (colorStr.startsWith('hsl(')) return colorStr.replace('hsl(', 'hsla(').replace(/\)$/, `, ${alpha})`);
    if (colorStr.startsWith('#')) {
        const hex = colorStr.replace('#', '');
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        const bigint = parseInt(full, 16);
        return `rgba(${(bigint >> 16) & 255},${(bigint >> 8) & 255},${bigint & 255},${alpha})`;
    }
    return colorStr;
}

// Couleur d'un segment de courbe selon qu'il traverse un trou de données ou non — mêmes
// seuils que evolutionSegmentDash() (voir EVOLUTION_AVG_GAP_THRESHOLD_MS, section 25),
// mais appliqués à la couleur plutôt qu'au style du trait. normalAlpha = opacité du
// segment plein (donnée réelle des deux côtés) ; gapAlpha = opacité du segment pointillé
// (reconstitué à travers un trou) — toujours plus faible, pour bien marquer la différence.
function evolutionSegmentColor(baseColor, normalAlpha, gapAlpha) {
    return (ctx) => {
        const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
        return withAlpha(baseColor, gap > EVOLUTION_AVG_GAP_THRESHOLD_MS ? gapAlpha : normalAlpha);
    };
}

// Vrai si au moins un segment consécutif d'un tableau de points de courbe dépasse le
// seuil de trou (EVOLUTION_AVG_GAP_THRESHOLD_MS) — même test que evolutionSegmentDash()/
// evolutionSegmentColor(), mais utilisable en JS pur avant tout rendu Chart.js. Sert à
// savoir si la ligne d'explication du pointillé doit apparaître dans le panneau de
// légende (voir renderEvolutionLegendPanel()) — uniquement si un pointillé est
// effectivement visible dans la fenêtre actuellement affichée, pas juste "une courbe de
// moyenne mobile est active".
function evolutionSeriesHasGap(dataArr) {
    for (let i = 1; i < dataArr.length; i++) {
        if (dataArr[i].x - dataArr[i - 1].x > EVOLUTION_AVG_GAP_THRESHOLD_MS) return true;
    }
    return false;
}

// ============================================================
// 25c. PANNEAU DE LÉGENDE — superposé au coin haut-droit du graphe (voir CSS), bascule
// via la pastille "L" (voir renderEvolutionChips()). État persisté dans
// settings.evolutionShowLegend (contrairement à evolutionYAxisMode/evolutionPalierIndex,
// qui restent volontairement en session — voir garde de section 4).
// ============================================================

// Petit disque coloré inline — utilisé pour chaque ligne du panneau (types individuels).
// margin-right:5px fixe l'écart dot→label, toujours du même côté (usage : dot suivi
// directement de son propre texte, jamais d'un autre élément à espacer symétriquement).
function evolutionLegendDot(color) {
    return `<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${color}; margin-right:5px; vertical-align:middle;"></span>`;
}

// Variante SANS marge — utilisée uniquement dans la ligne de décomposition
// (dot = dot + dot), où l'espacement entre TOUS les éléments (dots et symboles) doit
// être uniforme des deux côtés. Un margin-right fixe sur le dot créerait une asymétrie
// (plus d'espace avant un symbole qu'après, le symbole suivant n'ayant pas de marge
// symétrique côté gauche) — voir renderEvolutionLegendPanel() pour l'usage avec un
// conteneur flex à `gap` uniforme, qui règle ce problème proprement.
function evolutionLegendBareDot(color) {
    return `<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${color};"></span>`;
}

// Regroupe une liste d'éléments de légende sur des lignes, en approximant la largeur par
// un nombre de caractères plutôt qu'une mesure DOM réelle (dépendrait de la police,
// complexe pour un gain marginal) : glouton, ajoute un élément à la ligne courante tant
// que sa longueur cumulée (+ séparateur) ne dépasse pas maxChars, sinon démarre une
// nouvelle ligne. Générique — chaque élément fournit sa propre longueur approximative
// (item.len) et son propre HTML (item.html), utilisé aussi bien pour les types nommés que
// pour la ligne de décomposition blanche (courte, désormais éligible au regroupement
// comme n'importe quelle autre entrée — seule la ligne "tendance" reste toujours à part).
function evolutionLegendPackItems(items, maxChars) {
    const SEP_CHARS = 2; // équivalent de l'espacement visuel entre deux entrées d'une même ligne
    const lines = [];
    let current = [];
    let currentLen = 0;
    items.forEach(item => {
        const sep = current.length > 0 ? SEP_CHARS : 0;
        if (current.length > 0 && currentLen + sep + item.len > maxChars) {
            lines.push(current);
            current = [item];
            currentLen = item.len;
        } else {
            current.push(item);
            currentLen += sep + item.len;
        }
    });
    if (current.length) lines.push(current);
    return lines;
}

// Reconstruit le contenu du panneau à partir de l'état courant (séries sélectionnées,
// composition de la combinaison blanche) — hasVisibleGap calculé par l'appelant
// (renderEvolutionChart(), qui a déjà les tableaux de points sous la main).
function renderEvolutionLegendPanel(hasVisibleGap) {
    window._evolutionLastHasGap = hasVisibleGap; // mémorisé pour toggleEvolutionLegend()
    const panel = document.getElementById('evolution-legend-panel');
    if (!panel) return;
    if (!settings.evolutionShowLegend) { panel.style.display = 'none'; return; }

    const selected = settings.evolutionSelectedSeries;
    const hasCombined = selected.includes('combined');

    // Types à nommer : sélectionnés individuellement + composant la combinaison blanche
    // si elle est active (même si un type composant n'est pas individuellement
    // sélectionné dans le graphe) — dédupliqués, triés par id croissant.
    const namedTypeIds = new Set();
    selected.forEach(sid => { if (sid !== 'combined') namedTypeIds.add(sid); });
    if (hasCombined) settings.combinedTypeIds.forEach(id => namedTypeIds.add(id));
    const sortedIds = [...namedTypeIds].sort((a, b) => a - b);

    // TEST : budget fixe à 45 caractères (au lieu du calcul dynamique basé sur la ligne
    // la plus longue) — algorithme de regroupement inchangé (evolutionLegendPackItems()),
    // seuil simplement plus élevé pour évaluer le rendu avec des lignes plus denses.
    const maxChars = 45;
    const DOT_CHARS = 2;

    // Construit la liste des éléments "regroupables" — types nommés + ligne de
    // décomposition (si active) + ligne "tendance" (si un trou est visible, ajoutée en
    // dernier ci-dessous) : tous traités comme des entrées ordinaires du regroupement,
    // plus d'exception forcée à être seule sur sa ligne.
    const legendItems = sortedIds.map(id => {
        const label = getLabelForId(id) || `Type #${id}`;
        return {
            len: label.length + DOT_CHARS,
            html: `<span style="white-space:nowrap;">${evolutionLegendDot(getColorValueForId(id))}${label}</span>`
        };
    });
    if (hasCombined) {
        // Conteneur flex à `gap` uniforme : espacement identique des deux côtés de CHAQUE
        // élément (dot, "=", dot, "+", dot...) — corrige l'asymétrie d'un espacement basé
        // sur la marge propre du dot (toujours du même côté) combinée à un espace texte.
        // inline-flex (pas flex) : cet élément est désormais un item parmi d'autres dans
        // la ligne qui l'accueille, pas un bloc autonome.
        const n = settings.combinedTypeIds.length;
        const decompLen = DOT_CHARS + 3 /* " = " */ + n * DOT_CHARS + Math.max(0, n - 1) * 3 /* " + " */;
        const parts = [evolutionLegendBareDot('#ffffff'), '='];
        settings.combinedTypeIds.forEach((id, idx) => {
            if (idx > 0) parts.push('+');
            parts.push(evolutionLegendBareDot(getColorValueForId(id)));
        });
        legendItems.push({
            len: decompLen,
            html: `<span style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px;">${parts.join('')}</span>`
        });
    }
    if (hasVisibleGap) {
        const gapLabel = `⋯ ${t('evolutionGapLegend')}`;
        legendItems.push({
            len: gapLabel.length,
            html: `<span style="white-space:nowrap;">${gapLabel}</span>`
        });
    }

    let html = '';
    if (legendItems.length > 0) {
        const lines = evolutionLegendPackItems(legendItems, maxChars);
        lines.forEach(line => {
            const itemsHtml = line.map(item => item.html).join('');
            html += `<div style="display:flex; align-items:center; gap:10px;">${itemsHtml}</div>`;
        });
    }

    panel.innerHTML = html;
    panel.style.display = html ? 'block' : 'none';
}

// Bascule la visibilité — pas de recalcul de données nécessaire (le contenu dépend de
// l'état déjà connu au dernier rendu du graphe, voir window._evolutionLastHasGap).
function toggleEvolutionLegend() {
    settings.evolutionShowLegend = !settings.evolutionShowLegend;
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips(); // met à jour la classe visuelle de la pastille "L"
    renderEvolutionLegendPanel(window._evolutionLastHasGap || false);
}

// Chips de sélection — un cercle par type ayant des données (getTypesWithHistoryData(),
// cohérent avec les légendes existantes) + un cercle blanc pour la combinaison, + les
// pastilles "1j" (points bruts), "~3j" et "~5j" (moyennes mobiles). Pas de limite de
// sélection simultanée des séries.
function renderEvolutionChips() {
    const container = document.getElementById('evolution-chips-container');
    if (!container) return;

    let html = '';
    getTypesWithHistoryData().forEach(tp => {
        const selected = settings.evolutionSelectedSeries.includes(tp.id);
        const cls = selected ? 'evolution-chip-selected' : 'evolution-chip-unselected';
        html += `<div class="evolution-chip ${cls}" style="background:${getColorValueForId(tp.id)};"
                              onclick="toggleEvolutionSeries(${tp.id})" title="${escapeHtml(tp.label || `Type #${tp.id}`)}"></div>`;
    });
    // La pastille blanche n'existe que si la combinaison a au moins un type composant —
    // cohérent avec le nettoyage déjà fait côté données (cleanupCombinedTypeIds() /
    // openEvolutionOverlay()) : pas de pastille pour une combinaison vide, désélectionnée
    // ou non, il n'y a simplement rien à représenter.
    if (settings.combinedTypeIds.length > 0) {
        const combinedSelected = settings.evolutionSelectedSeries.includes('combined');
        const combinedCls = combinedSelected ? 'evolution-chip-selected' : 'evolution-chip-unselected';
        html += `<div class="evolution-chip ${combinedCls}" style="background:#ffffff;"
                              onclick="toggleEvolutionSeries('combined')" title="${t('resComboTotal')}"></div>`;
    }

    const rawCls = settings.evolutionShowRawPoints ? 'evolution-chip-selected' : 'evolution-chip-unselected';
    html += `<div class="evolution-toggle-pill ${rawCls}" onclick="toggleEvolutionRawPoints()">${t('evolutionPillRaw')}</div>`;

    const avg3Cls = settings.evolutionShowMovingAvg ? 'evolution-chip-selected' : 'evolution-chip-unselected';
    html += `<div class="evolution-toggle-pill ${avg3Cls}" onclick="toggleEvolutionMovingAvg()">${t('evolutionPill3d')}</div>`;

    const avg5Cls = settings.evolutionShowMovingAvg5 ? 'evolution-chip-selected' : 'evolution-chip-unselected';
    html += `<div class="evolution-toggle-pill ${avg5Cls}" onclick="toggleEvolutionMovingAvg5()">${t('evolutionPill5d')}</div>`;

    const avg7Cls = settings.evolutionShowMovingAvg7 ? 'evolution-chip-selected' : 'evolution-chip-unselected';
    html += `<div class="evolution-toggle-pill ${avg7Cls}" onclick="toggleEvolutionMovingAvg7()">${t('evolutionPill7d')}</div>`;

    // Pastille "L" — bascule le panneau de légende superposé (voir section 25c).
    // Lettre seule, pas de mot : convention déjà utilisée ailleurs dans l'app (ex. bouton
    // "L" de la légende Historique), ne nécessite aucune traduction.
    const legendCls = settings.evolutionShowLegend ? 'evolution-chip-selected' : 'evolution-chip-unselected';
    html += `<div class="evolution-toggle-pill ${legendCls}" onclick="toggleEvolutionLegend()">L</div>`;

    // Groupe durée + fin de période — dans la même rangée que les chips/pills ci-dessus
    // (poussé à droite via margin-left:auto, voir CSS). Textes remplis juste après par
    // updateEvolutionPalierLabel() : évite de dupliquer ici la logique de formatage.
    html += `<div id="evolution-palier-group">
                <div id="evolution-palier-duration" class="evolution-toggle-pill evolution-chip-selected"
                     onclick="toggleEvolutionPalierPicker()"></div><span id="evolution-palier-end"></span>
                <div id="evolution-palier-picker"></div>
            </div>`;

    container.innerHTML = html;
    updateEvolutionPalierLabel();
}

// Affiche un message temporaire de garde-fou (sélection minimale non respectée), avec
// auto-masquage après 3s — même esprit visuel que les toasts globaux de l'app (voir
// showStorageWarningToast() etc.), mais local à l'overlay Évolution : élément DOM dédié
// dans #evolution-chart-wrap plutôt qu'un pacing-toast plein écran, pour rester bien
// positionné même sous la rotation CSS de l'overlay. Anti-doublon : un seul timer
// partagé — si le message est déjà affiché, on relance simplement son décompte plutôt
// que d'empiler les appels si l'utilisateur martèle le bouton.
let evolutionGuardToastTimer = null;
function showEvolutionGuardToast(message) {
    const el = document.getElementById('evolution-guard-toast');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(evolutionGuardToastTimer);
    evolutionGuardToastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// Nombre de représentations temporelles actuellement actives (points bruts 1j + les 3
// moyennes mobiles) — sert de garde-fou dans les toggle*() ci-dessous : jamais zéro
// simultanément, pour ne jamais afficher le message "pas de données" simplement parce
// que rien n'a été coché (confusant, notamment pour un public en brouillard cognitif).
function countActiveEvolutionRepresentations() {
    return [settings.evolutionShowRawPoints, settings.evolutionShowMovingAvg,
    settings.evolutionShowMovingAvg5, settings.evolutionShowMovingAvg7]
        .filter(Boolean).length;
}

// Bascule une série dans/hors settings.evolutionSelectedSeries — persisté, pas de
// limite de nombre de séries simultanées (à tester en usage réel avant d'en ajouter une).
// Garde-fou : le dernier élément sélectionné ne peut pas être retiré (toast).
function toggleEvolutionSeries(seriesId) {
    const idx = settings.evolutionSelectedSeries.indexOf(seriesId);
    if (idx !== -1 && settings.evolutionSelectedSeries.length === 1) {
        showEvolutionGuardToast(t('evolutionMinOneSeries'));
        return;
    }
    if (idx === -1) settings.evolutionSelectedSeries.push(seriesId);
    else settings.evolutionSelectedSeries.splice(idx, 1);
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips();
    renderEvolutionChart();
}

// Points bruts (1j) — sert de filet de sécurité pour les 3 autres représentations (voir
// toggleEvolutionMovingAvg*() ci-dessous, qui reportent automatiquement dessus). N'ayant
// lui-même aucun repli possible, sa désactivation est bloquée (toast) s'il est la
// dernière représentation active.
function toggleEvolutionRawPoints() {
    if (settings.evolutionShowRawPoints && countActiveEvolutionRepresentations() === 1) {
        showEvolutionGuardToast(t('evolutionMinOneRepresentation'));
        return;
    }
    settings.evolutionShowRawPoints = !settings.evolutionShowRawPoints;
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips();
    renderEvolutionChart();
}

// Désactiver ~3j alors que c'est la dernière représentation active : jamais bloqué —
// report automatique sur les points bruts (1j), qui s'active à sa place. Le changement
// reste visible (pastille 1j qui s'allume), donc pas de toast nécessaire ici.
function toggleEvolutionMovingAvg() {
    const turningOn = !settings.evolutionShowMovingAvg;
    settings.evolutionShowMovingAvg = turningOn;
    if (!turningOn && countActiveEvolutionRepresentations() === 0) {
        settings.evolutionShowRawPoints = true;
    }
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips();
    renderEvolutionChart();
}

// ~5j et ~7j sont mutuellement exclusives — les activer ensemble surchargerait le
// graphe pour un gain de lecture limité (deux moyennes larges très proches visuellement).
// Même repli automatique sur 1j que ~3j si c'est la dernière représentation active.
function toggleEvolutionMovingAvg5() {
    const turningOn = !settings.evolutionShowMovingAvg5;
    settings.evolutionShowMovingAvg5 = turningOn;
    if (turningOn) {
        settings.evolutionShowMovingAvg7 = false;
    } else if (countActiveEvolutionRepresentations() === 0) {
        settings.evolutionShowRawPoints = true;
    }
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips();
    renderEvolutionChart();
}

function toggleEvolutionMovingAvg7() {
    const turningOn = !settings.evolutionShowMovingAvg7;
    settings.evolutionShowMovingAvg7 = turningOn;
    if (turningOn) {
        settings.evolutionShowMovingAvg5 = false;
    } else if (countActiveEvolutionRepresentations() === 0) {
        settings.evolutionShowRawPoints = true;
    }
    safeSave('pacingSettings', JSON.stringify(settings));
    renderEvolutionChips();
    renderEvolutionChart();
}

// Calcule les bornes de l'axe Y en mode zoom, à partir des datasets réellement dessinés
// (points bruts + courbes de moyenne mobile actuellement visibles — pas les séries
// masquées par les toggles 1j/~3j/~5j/~7j). Travaille en minutes en interne pour éviter les
// imprécisions flottantes (10 min = 1/6 h), reconverti en heures pour Chart.js à la fin.
// rangeMin/rangeMax : bornes de la fenêtre affichée (mêmes valeurs que scales.x.min/max),
// nécessaires pour interpoler la valeur Y au bord (voir ci-dessous).
// Retourne {min, max, stepSize}, ou null si aucune donnée (aucune série sélectionnée, ou
// fenêtre vide) — l'appelant retombe alors sur l'affichage 0-24h par défaut.
function computeYAxisRange(datasets, rangeMin, rangeMax) {
    let dataMinH = Infinity, dataMaxH = -Infinity;
    const addY = (y) => {
        if (y < dataMinH) dataMinH = y;
        if (y > dataMaxH) dataMaxH = y;
    };
    datasets.forEach(ds => {
        const data = ds.data || [];
        data.forEach((pt, i) => {
            if (!pt._anchor) { addY(pt.y); return; }
            // Point d'ancrage hors fenêtre (voir reduceToWindowWithAnchors(), section 25)
            // — sa valeur brute ne doit jamais influencer l'échelle (potentiellement très
            // éloignée/différente). On inclut à la place la valeur interpolée là où le
            // segment qui le relie à son voisin croise le bord de la fenêtre visible :
            // c'est exactement la hauteur à laquelle le pointillé rogné sera affiché à ce
            // bord — sans quoi ce bout de pointillé visible pourrait déborder au-delà de
            // l'échelle Y calculée, verticalement rogné avant même d'atteindre le bord
            // latéral du graphe.
            const neighbor = pt.x < rangeMin ? data[i + 1] : data[i - 1];
            if (!neighbor) return; // pas de voisin (série réduite à ce seul point) — rien à interpoler
            const boundary = pt.x < rangeMin ? rangeMin : rangeMax;
            const span = neighbor.x - pt.x;
            addY(span === 0 ? pt.y : pt.y + (neighbor.y - pt.y) * ((boundary - pt.x) / span));
        });
    });
    if (dataMinH === Infinity) return null;

    const dataMinM = dataMinH * 60;
    const dataMaxM = dataMaxH * 60;
    const rawRangeH = dataMaxH - dataMinH;

    // Pas de graduation selon l'amplitude brute (avant arrondi) — jusqu'à ~12 graduations
    // reste lisible (référence : 12 graduations pour 24h avec un pas de 2h).
    let stepM;
    if (rawRangeH <= 2) stepM = 10;
    else if (rawRangeH <= 3) stepM = 15;
    else if (rawRangeH <= 6) stepM = 30;
    else if (rawRangeH <= 12) stepM = 60;
    else stepM = 120;

    let minM = Math.floor(dataMinM / stepM) * stepM;
    let maxM = Math.ceil(dataMaxM / stepM) * stepM;
    // Garde-fou : évite un axe de largeur nulle si toutes les valeurs sont identiques.
    if (maxM === minM) maxM = minM + stepM;

    return { min: minM / 60, max: maxM / 60, stepSize: stepM / 60 };
}

// Formatte une graduation de l'axe Y évolution — décision prise sur le PAS de l'axe
// (stepHours), pas sur la valeur individuelle : si le pas implique des fractions d'heure
// (10/15/30 min), TOUTES les graduations de cet axe s'affichent en "H:MM" (ex. "3:00",
// "3:30"), y compris celles qui tombent pile sur une heure entière — pour une échelle
// visuellement homogène. Si le pas est un multiple d'heure entière (mode "tout" 0-24h à
// pas 2h, ou tout pas ≥60 min), aucune fraction n'est jamais possible : on garde le
// format numéro seul ("10", "11", "12").
function formatEvolutionYTick(hourValue, stepHours) {
    const totalMin = Math.round(hourValue * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const isFractionalStep = stepHours && Math.round(stepHours * 60) % 60 !== 0;
    if (!isFractionalStep) return `${h}`;
    return `${h}:${m.toString().padStart(2, '0')}`;
}

// Bascule mode "tout" (0-24h fixe) / "zoom" (adapté aux données affichées) — en mémoire
// pour la session uniquement (pas de localStorage), donc retour à "tout" à chaque
// redémarrage de l'app. Redessine immédiatement le graphe avec la nouvelle échelle.
function toggleEvolutionYAxisMode() {
    window.evolutionYAxisMode = (window.evolutionYAxisMode === 'zoom') ? 'full' : 'zoom';
    console.log(`[Evolution] Mode axe Y → ${window.evolutionYAxisMode}`);
    renderEvolutionChart();
}

// Rendu du graphique — une paire de datasets (points bruts + moyenne mobile optionnelle)
// par série sélectionnée dans settings.evolutionSelectedSeries.
function renderEvolutionChart() {
    console.log("[renderEvolutionChart] Rendu du graphique évolution");
    const canvas = document.getElementById('evolutionChart');
    if (!canvas) return;

    // Masque l'exploration en cours (ligne + carte de valeurs) dès qu'un vrai changement
    // d'affichage se produit — palier, sélection de série, navigation temporelle, etc.
    // Appelé uniquement au COMMIT d'un changement (jamais pendant un simple geste de
    // pincement/swipe en cours, qui ne passe que par renderEvolutionPreviewBand()) :
    // l'affichage doit refléter la situation actuelle, pas une exploration qui pointait
    // sur un contexte devenu obsolète (même principe que ailleurs dans ce projet).
    window.evolutionExploreTimestamp = null;
    const exploreCard = document.getElementById('evolution-value-card');
    if (exploreCard) exploreCard.style.display = 'none';

    // Palier courant (largeur de fenêtre) — en mémoire pour la session uniquement,
    // pas de localStorage (même convention que evolutionYAxisMode). window.evolutionPaliers
    // est construit dynamiquement à l'ouverture de l'overlay (voir openEvolutionOverlay()
    // et buildEvolutionPaliers()) ; repli défensif ici si jamais appelé avant (ne devrait
    // pas arriver). Modifié par pincement (section 25b). window._evolutionCurrentPalier
    // est relu en direct par afterBuildTicks() plus bas — nécessaire car ce callback est
    // capturé une seule fois à la création du chart (closure), et doit rester correct
    // aux mises à jour suivantes sans recréer le chart.
    if (!window.evolutionPaliers) window.evolutionPaliers = buildEvolutionPaliers();
    if (typeof window.evolutionPalierIndex === 'undefined') {
        window.evolutionPalierIndex = window.evolutionPaliers.findIndex(p => p.id === '3m');
    }
    const palier = window.evolutionPaliers[window.evolutionPalierIndex];
    window._evolutionCurrentPalier = palier;
    let startDate = getPalierStartDate(window.evolutionEndDate, palier);
    let windowDays = Math.round((window.evolutionEndDate.getTime() - startDate.getTime()) / 86400000) + 1;

    // Recale evolutionEndDate si nécessaire (voir clampEvolutionEndDate()) — couvre tous
    // les chemins d'appel de renderEvolutionChart(), pas seulement le swipe (déjà clampé
    // en direct pendant le geste) : sélection d'un nouveau palier plus large que la
    // position actuelle via la palette, ou via pincement. Un seul point de correction
    // plutôt que de dupliquer la logique à chaque appelant.
    const clampedEnd = clampEvolutionEndDate(window.evolutionEndDate, windowDays);
    if (clampedEnd.getTime() !== window.evolutionEndDate.getTime()) {
        window.evolutionEndDate = clampedEnd;
        startDate = getPalierStartDate(window.evolutionEndDate, palier);
        windowDays = Math.round((window.evolutionEndDate.getTime() - startDate.getTime()) / 86400000) + 1;
    }

    // Label palier — état committé (pas d'override) : couvre tous les cas d'appel de
    // renderEvolutionChart() (ouverture, sélection via palette, fin de geste confirmé).
    updateEvolutionPalierLabel();

    const seriesIds = settings.evolutionSelectedSeries;
    const { points, movingAvg3, movingAvg5, movingAvg7 } = computeEvolutionData(window.evolutionEndDate, windowDays, seriesIds);

    const textGray = getCSSColor('--chart-gray-text');
    const gridColor = getCSSColor('--border') || '#333';
    // Graduations principales vs secondaires (axe X : mois vs jour ; axe Y : heure entière
    // vs fraction) — opacités partagées entre les deux axes (constantes globales, voir
    // EVOLUTION_TICK_PRINCIPAL_ALPHA/SECONDARY_ALPHA en tête de section) pour une
    // hiérarchie visuelle cohérente. Principal = repère d'orientation (nom de mois, heure
    // entière), secondaire = graduation fine intermédiaire (numéro de jour, minutes).
    const rangeMin = startDate.getTime();
    const rangeMax = window.evolutionEndDate.getTime();

    const AVG3_BORDER_WIDTH = 2;
    const AVG5_BORDER_WIDTH = AVG3_BORDER_WIDTH * 1.5; // trait 1.5x plus large que ~3j
    // ~7j : même largeur, opacité et fonctionnement pointillé que ~5j "à ce stade" —
    // choix explicite (voir échange), à affiner plus tard si une distinction visuelle
    // supplémentaire s'avère utile.
    const AVG7_BORDER_WIDTH = AVG5_BORDER_WIDTH;
    // Rayon des points isolés (voir isEvolutionPointIsolated() plus bas) — même ratio
    // 1.5x que les traits, pour rester cohérent avec la convention visuelle déjà en
    // place (3j = fin, 5j = épais) plutôt que d'introduire un nouveau langage visuel.
    const AVG3_ISOLATED_RADIUS = 3;
    const AVG5_ISOLATED_RADIUS = AVG3_ISOLATED_RADIUS * 1.5;
    const AVG7_ISOLATED_RADIUS = AVG5_ISOLATED_RADIUS;

    // Style de segment dynamique (option "segment" de Chart.js, stylage par tronçon de
    // ligne) : pointillé pour le tronçon qui traverse un trou de données, plein sinon.
    // Combiné à spanGaps:true (voir datasets plus bas) — le trait relie toujours tous
    // les points, jamais de coupure invisible ; c'est ce pointillé qui indique
    // visuellement l'absence de donnée réelle entre deux points, tout en suggérant la
    // tendance générale entre les deux, plutôt qu'une continuité pleine et trompeuse.
    function evolutionSegmentDash(ctx) {
        const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
        return gap > EVOLUTION_AVG_GAP_THRESHOLD_MS ? [4, 4] : undefined;
    }

    // Un point de moyenne mobile "isolé" (aucun voisin assez proche des deux côtés)
    // resterait peu visible avec pointRadius:0 si les points bruts (1j) sont masqués —
    // même relié par un trait pointillé de part et d'autre, on veut distinguer d'un
    // coup d'œil "ceci est une vraie donnée" de "ceci n'est qu'un raccord visuel". On
    // lui donne donc un petit marqueur plein dans ce cas précis uniquement.
    function isEvolutionPointIsolated(data, index) {
        const cur = data[index];
        if (!cur) return false;
        const prev = data[index - 1];
        const next = data[index + 1];
        const prevGap = !prev || (cur.x - prev.x) > EVOLUTION_AVG_GAP_THRESHOLD_MS;
        const nextGap = !next || (next.x - cur.x) > EVOLUTION_AVG_GAP_THRESHOLD_MS;
        return prevGap && nextGap;
    }

    const datasets = [];
    // Vrai si au moins une courbe de moyenne mobile ACTUELLEMENT AFFICHÉE contient un
    // segment pointillé dans la fenêtre visible — sert à la ligne d'explication du
    // pointillé dans le panneau de légende (voir renderEvolutionLegendPanel()), affichée
    // seulement si pertinent pour ce qui est réellement à l'écran.
    let hasVisibleGap = false;
    seriesIds.forEach(sid => {
        const color = getEvolutionSeriesColor(sid);
        const label = getEvolutionSeriesLabel(sid);
        if (settings.evolutionShowRawPoints) {
            datasets.push({
                label,
                data: points[sid] || [],
                showLine: false,
                pointRadius: 3,
                // Opacité réduite (0.45, au lieu de 0.7) : les points bruts restent
                // repérables mais laissent ressortir les courbes de moyenne mobile
                // par-dessus, surtout là où plusieurs séries se superposent.
                pointBackgroundColor: withAlpha(color, 0.45),
                pointBorderColor: 'rgba(0,0,0,0.3)',
                order: 3, // dessiné en dessous des courbes (order plus élevé = dessous)
                // Métadonnées pour l'exploration tactile (evolutionExploreLinePlugin,
                // renderEvolutionValueCard) — _repType:'raw' signale une lecture par
                // correspondance exacte du jour uniquement, jamais interpolée.
                _seriesId: sid, _repType: 'raw', _color: color
            });
        }
        if (settings.evolutionShowMovingAvg) {
            const avg3Data = movingAvg3[sid] || [];
            if (evolutionSeriesHasGap(avg3Data)) hasVisibleGap = true;
            datasets.push({
                label: `${label} ${t('evolutionPill3d')}`,
                data: avg3Data,
                showLine: true,
                // Points isolés toujours à pleine opacité — ils signalent une vraie
                // donnée (par opposition au pointillé, qui indique une reconstitution),
                // ce contraste ne doit jamais être dilué.
                pointRadius: (ctx) => isEvolutionPointIsolated(avg3Data, ctx.dataIndex) ? AVG3_ISOLATED_RADIUS : 0,
                pointBackgroundColor: color,
                pointBorderWidth: 0,
                spanGaps: true, // toujours relier — segment.borderDash indique les trous, pas une coupure
                // Trait à 0.65 sur donnée réelle, 0.45 sur segment pointillé (trou) —
                // moins prioritaire visuellement que ~5j/~7j (voir plus bas), qui restent pleins.
                segment: { borderDash: evolutionSegmentDash, borderColor: evolutionSegmentColor(color, 0.65, 0.45) },
                borderColor: withAlpha(color, 0.65),
                borderWidth: AVG3_BORDER_WIDTH,
                order: 2, // dessiné par-dessus les points
                _seriesId: sid, _repType: 'avg3', _avgDays: 3, _color: color
            });
        }
        if (settings.evolutionShowMovingAvg5) {
            const avg5Data = movingAvg5[sid] || [];
            if (evolutionSeriesHasGap(avg5Data)) hasVisibleGap = true;
            datasets.push({
                label: `${label} ${t('evolutionPill5d')}`,
                data: avg5Data,
                showLine: true,
                pointRadius: (ctx) => isEvolutionPointIsolated(avg5Data, ctx.dataIndex) ? AVG5_ISOLATED_RADIUS : 0,
                pointBackgroundColor: color,
                pointBorderWidth: 0,
                spanGaps: true, // toujours relier — segment.borderDash indique les trous, pas une coupure
                // Trait plein à pleine opacité sur donnée réelle (courbe la plus
                // prioritaire visuellement avec ~7j), 0.45 sur segment pointillé (trou) —
                // cohérent avec ~3j pour la partie pointillée.
                segment: { borderDash: evolutionSegmentDash, borderColor: evolutionSegmentColor(color, 1, 0.45) },
                borderColor: color,
                borderWidth: AVG5_BORDER_WIDTH,
                order: 1, // dessiné par-dessus les points et ~3j
                _seriesId: sid, _repType: 'avg5', _avgDays: 5, _color: color
            });
        }
        if (settings.evolutionShowMovingAvg7) {
            const avg7Data = movingAvg7[sid] || [];
            if (evolutionSeriesHasGap(avg7Data)) hasVisibleGap = true;
            datasets.push({
                label: `${label} ${t('evolutionPill7d')}`,
                data: avg7Data,
                showLine: true,
                pointRadius: (ctx) => isEvolutionPointIsolated(avg7Data, ctx.dataIndex) ? AVG7_ISOLATED_RADIUS : 0,
                pointBackgroundColor: color,
                pointBorderWidth: 0,
                spanGaps: true, // toujours relier — segment.borderDash indique les trous, pas une coupure
                // Même largeur/opacité/fonctionnement pointillé que ~5j "à ce stade" (voir
                // constantes AVG7_* ci-dessus).
                segment: { borderDash: evolutionSegmentDash, borderColor: evolutionSegmentColor(color, 1, 0.45) },
                borderColor: color,
                borderWidth: AVG7_BORDER_WIDTH,
                order: 0, // dessiné par-dessus tout le reste (points, ~3j, ~5j)
                _seriesId: sid, _repType: 'avg7', _avgDays: 7, _color: color
            });
        }
    });

    // Mode axe Y — "full" (0-24h fixe) par défaut, "zoom" (adapté aux données affichées)
    // sur bascule utilisateur (clic sur les valeurs d'axe, voir onClick plus bas). En
    // mémoire pour la session uniquement, pas de persistance localStorage.
    if (typeof window.evolutionYAxisMode === 'undefined') window.evolutionYAxisMode = 'full';
    // Cas 0 série sélectionnée en mode zoom : computeYAxisRange() retourne null, on
    // retombe visuellement sur 0-24h sans changer le mode logique — dès qu'une série
    // est recochée, le zoom reprend directement (voir toggleEvolutionYAxisMode()).
    const zoomRange = window.evolutionYAxisMode === 'zoom' ? computeYAxisRange(datasets, rangeMin, rangeMax) : null;
    const yRange = zoomRange || { min: 0, max: 24, stepSize: 2 };

    // Message "pas de données" — visible si tous les datasets réellement construits
    // ci-dessus sont vides. Un seul test couvre à la fois "aucune série sélectionnée" et
    // "séries sélectionnées mais rien dans la fenêtre affichée" (aucune distinction
    // nécessaire, le message générique convient aux deux cas).
    const evolutionHasAnyData = datasets.some(ds => (ds.data || []).length > 0);
    const noDataEl = document.getElementById('evolution-no-data-msg');
    if (noDataEl) {
        noDataEl.style.display = evolutionHasAnyData ? 'none' : 'block';
        if (!evolutionHasAnyData) noDataEl.textContent = t('evolutionNoDataInView');
    }

    renderEvolutionLegendPanel(hasVisibleGap);

    if (evolutionChartInstance) {
        evolutionChartInstance.data.datasets = datasets;
        evolutionChartInstance.options.scales.x.min = rangeMin;
        evolutionChartInstance.options.scales.x.max = rangeMax;
        evolutionChartInstance.options.scales.y.min = yRange.min;
        evolutionChartInstance.options.scales.y.max = yRange.max;
        evolutionChartInstance.options.scales.y.ticks.stepSize = yRange.stepSize;
        evolutionChartInstance.update();
        return;
    }

    evolutionChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false, // {x,y} déjà fournis
            scales: {
                x: {
                    type: 'linear',
                    min: rangeMin,
                    max: rangeMax,
                    // Graduations calées selon le pas propre au palier courant (voir
                    // computeEvolutionTicks()) — un axe linéaire ne les positionne pas
                    // automatiquement. Relit axis.min/max et window._evolutionCurrentPalier
                    // en direct (pas rangeMin/rangeMax/palier capturés par closure) : ce
                    // callback n'est défini qu'une fois à la création du chart, mais doit
                    // rester juste aux mises à jour suivantes (chart.update()) sans recréer
                    // l'instance — axis.min/max sont eux déjà correctement remis à jour à
                    // chaque appel (voir la branche evolutionChartInstance existante ci-dessus).
                    afterBuildTicks: (axis) => {
                        axis.ticks = computeEvolutionTicks(axis.min, axis.max, window._evolutionCurrentPalier)
                            .map(v => ({ value: v }));
                    },
                    // Hauteur d'axe FIXE, quel que soit le contenu affiché (étiquette à 1 ou
                    // 2 lignes) — afterFit s'exécute après le calcul naturel de Chart.js et
                    // l'écrase. Remplace l'ancien plugin afterDraw à offset pixel deviné :
                    // ici Chart.js rend lui-même le texte multi-ligne (callback ci-dessous),
                    // avec ses propres métriques de police, tout en gardant la zone de tracé
                    // strictement stable (contrainte produit clé — jamais de recalcul de
                    // hauteur d'axe selon que janvier est visible ou non).
                    afterFit: (scale) => { scale.height = 44; },
                    ticks: {
                        // Couleur scriptable : opacité différente selon qu'il s'agit d'une
                        // graduation principale ou secondaire — voir constantes ci-dessus. En
                        // mode "graduations mois uniquement" (palier ≥9m, voir
                        // getEvolutionTickDaysInMonth()), TOUTES les graduations tombent sur
                        // le 1er du mois — dans ce cas précis, seul janvier reste principal,
                        // les autres mois redescendent en secondaire. En dehors de ce mode,
                        // comportement inchangé (mois = principal, numéro de jour = secondaire).
                        // Lit window._evolutionCurrentPalier (réassigné à chaque appel de
                        // renderEvolutionChart()) plutôt que la variable locale `palier`,
                        // capturée par fermeture une seule fois à la création du chart —
                        // corrige le bug de fermeture figée (Handoff §13.1).
                        color: (ctx) => {
                            const d = new Date(ctx.tick.value);
                            const isDayOne = d.getDate() === 1;
                            const curPalier = window._evolutionCurrentPalier;
                            const isMonthOnlyMode = curPalier && (curPalier.months === null || curPalier.months >= 9);
                            const isPrincipal = isDayOne && (!isMonthOnlyMode || d.getMonth() === 0);
                            return withAlpha(textGray, isPrincipal ? EVOLUTION_TICK_PRINCIPAL_ALPHA : EVOLUTION_TICK_SECONDARY_ALPHA);
                        },
                        // Étiquette à 2 lignes (mois abrégé + millésime) uniquement pour le
                        // 1er janvier — quel que soit le palier courant, paliers courts
                        // inclus (plus de garde isMonthOnlyMode ici : le seul repère est "ce
                        // tick tombe un 1er janvier"). Chart.js gère nativement le rendu
                        // multi-ligne (centrage, métriques de police) — remplace l'ancien
                        // dessin manuel à offset deviné.
                        callback: (value) => {
                            const d = new Date(value);
                            if (d.getDate() !== 1) return d.getDate().toString();
                            const monthLabel = d.toLocaleDateString(getLocale(), { month: 'short' });
                            return d.getMonth() === 0 ? [monthLabel, d.getFullYear().toString()] : monthLabel;
                        }
                    },
                    grid: { color: gridColor }
                },
                y: {
                    min: yRange.min,
                    max: yRange.max,
                    ticks: {
                        // Couleur scriptable : opacité forte pour les heures entières
                        // (principales), réduite pour les fractions d'heure (secondaires) —
                        // mêmes constantes que l'axe X, voir plus haut.
                        color: (ctx) => {
                            const isWholeHour = Math.round(ctx.tick.value * 60) % 60 === 0;
                            return withAlpha(textGray, isWholeHour ? EVOLUTION_TICK_PRINCIPAL_ALPHA : EVOLUTION_TICK_SECONDARY_ALPHA);
                        },
                        stepSize: yRange.stepSize,
                        // function (pas arrow) : Chart.js lie `this` à l'instance de
                        // l'axe — lecture dynamique de stepSize à chaque appel, correcte
                        // aussi bien à la création qu'après un chart.update() ultérieur
                        // (où stepSize est réassigné sur options.scales.y.ticks, voir
                        // plus haut, mais une fermeture aurait gardé l'ancienne valeur).
                        callback: function (value) { return formatEvolutionYTick(value, this.options.ticks.stepSize); }
                    },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                // Légende native masquée — les chips de sélection en tiennent déjà lieu.
                legend: { display: false },
                // Tooltip natif désactivé — entièrement remplacé par le mécanisme
                // d'exploration tactile (ligne verticale + carte de valeurs, voir
                // evolutionExploreLinePlugin ci-dessous et renderEvolutionValueCard()).
                tooltip: { enabled: false }
            }
        },
        plugins: [evolutionExploreLinePlugin]
    });
}

// Construit et positionne la carte de valeurs — appelée à chaque frame de l'exploration
// (voir updateEvolutionExplore()). Position gauche/droite adaptative : toujours du côté
// OPPOSÉ à la date explorée par rapport au milieu de la zone de tracé réelle
// (chart.chartArea, pas le canvas entier qui inclut la colonne des labels Y) — pour
// qu'elle ne se retrouve jamais cachée sous le doigt qui explore.
function renderEvolutionValueCard(dayTs) {
    const card = document.getElementById('evolution-value-card');
    if (!card || !evolutionChartInstance) return;

    const chart = evolutionChartInstance;
    const xPixel = chart.scales.x.getPixelForValue(dayTs);
    const mid = (chart.chartArea.left + chart.chartArea.right) / 2;
    const onLeftHalf = xPixel < mid;
    card.style.left = onLeftHalf ? '' : '40px'; //modifN
    card.style.right = onLeftHalf ? '0px' : ''; //modifN

    // Une ligne par valeur active à cette date, correspondance exacte pour les points
    // bruts / interpolée pour les moyennes (même règle que le plugin de dessin) —
    // triées de la plus haute à la plus basse, sans distinction de type par groupe.
    const lines = [];
    chart.data.datasets.forEach(ds => {
        const value = evolutionValueAtX(ds.data, dayTs, ds._repType !== 'raw');
        if (value === null) return;
        lines.push({ value, color: ds._color, repType: ds._repType, avgDays: ds._avgDays });
    });
    lines.sort((a, b) => b.value - a.value);

    let html = `<div style="color:#fff;">${formatEvolutionEndDateFixed(new Date(dayTs))}</div>`;
    if (lines.length === 0) {
        html += `<div style="opacity:0.75;">${t('evolutionNoDataAtDate')}</div>`;
    } else {
        lines.forEach(line => {
            const mins = line.value * 60;
            const { h, m } = splitMinutesHM(mins);
            // Padding par "0" transparent (même convention que renderResults()) : garantit
            // une largeur identique aux vrais chiffres sous la police monospace.
            const hStr = h < 10 ? `<span style="color:transparent;">0</span>${h}` : `${h}`;
            const suffix = line.repType !== 'raw' ? ` ${t('evolutionAvgSuffix', { n: line.avgDays })}` : '';
            html += `<div style="color:${line.color};">${hStr}h${m.toString().padStart(2, '0')}${suffix}</div>`;
        });
    }

    card.innerHTML = html;
    card.style.display = 'block';
}

// ============================================================
// 25b. GESTES TACTILES — pincement (palier axe X) et swipe (navigation temporelle)
//
// Zones de reconnaissance : le pincement (2 doigts) et le swipe (1 doigt) partagent la
// même zone (#evolution-xaxis-hitzone), ramenée à 120px en bas du graphe — pas toute la
// hauteur (essayé un temps, puis réduit) : habitue l'utilisateur à faire les gestes
// d'échelle dans le bas, en prévision d'un futur usage du swipe ailleurs sur le graphe
// qui ne devra pas entrer en conflit. Le pincement exige qu'au moins un des deux doigts
// démarre dans cette zone (voir isTouchInEvolutionHitzone()) ; le swipe l'exige aussi
// pour son unique doigt. Le seuil de confirmation à 8px (EVOLUTION_PAN_CONFIRM_PX, voir
// plus bas) reste la protection contre l'interférence avec un tap dans cette même zone
// (ex. tooltip sur un point proche du bas) : tant qu'il n'est pas franchi, rien n'est
// bloqué et le tap suit son cours normal vers Chart.js.
//
// Rotation CSS de l'overlay (90°) : un mouvement "horizontal" tel que perçu par
// l'utilisateur (une fois le téléphone physiquement tourné pour voir l'overlay en
// paysage) correspond à un déplacement VERTICAL en coordonnées brutes (clientY), pas
// horizontal — cohérent avec le repère de conception déjà documenté pour cet overlay
// (voir CSS de #evolution-overlay-inner). C'est pourquoi le swipe est mesuré sur
// clientY, et la largeur de référence (px → jours) sur la hauteur du rect DOM de la
// zone tactile (déjà exprimée en coordonnées écran post-rotation par
// getBoundingClientRect()). Le sens exact (+ ou -) reste à valider au premier test réel
// sur appareil — un simple flip de signe suffira si besoin.
//
// Pendant le geste, seule une bande de prévisualisation séparée (DOM, indépendante de
// Chart.js) est mise à jour — aucun recalcul de données ni redessin du graphique tant
// que le doigt n'est pas relâché, pour rester léger sur un appareil qui doit tourner
// plusieurs jours d'affilée.
// ============================================================

let evolutionGestureState = null; // null | { type:'pinch', ... } | { type:'pan', ... }

function initEvolutionGestures() {
    const wrap = document.getElementById('evolution-chart-wrap');
    if (!wrap) return;
    wrap.addEventListener('touchstart', onEvolutionTouchStart, { passive: false });
    wrap.addEventListener('touchmove', onEvolutionTouchMove, { passive: false });
    wrap.addEventListener('touchend', onEvolutionTouchEnd, { passive: true });
    wrap.addEventListener('touchcancel', onEvolutionTouchEnd, { passive: true });
}

function evolutionTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// Distance de mouvement (en px, coordonnées brutes) au-delà de laquelle un contact dans
// la bande des dates est considéré comme un vrai geste de pan plutôt qu'un tap. En
// dessous, on ne touche à rien (pas de preventDefault, pas d'aperçu) : le tap suit son
// cours normal vers Chart.js et son tooltip. Évite qu'un tremblement de doigt minime
// (jamais 0px pile) sur un grand palier (où peu de px = plusieurs jours) ne décale
// silencieusement la date à chaque tap.
const EVOLUTION_PAN_CONFIRM_PX = 8;

// Vrai si un point de contact (touch) tombe dans la zone de reconnaissance des gestes
// d'échelle (#evolution-xaxis-hitzone, 120px en bas du graphe — voir CSS). Partagée par
// le pincement (au moins un des deux doigts) et le swipe (le seul doigt), pour une seule
// définition de la zone à tenir à jour.
function isTouchInEvolutionHitzone(touch) {
    const hitzone = document.getElementById('evolution-xaxis-hitzone');
    if (!hitzone) return false;
    const rect = hitzone.getBoundingClientRect();
    return touch.clientX >= rect.left && touch.clientX <= rect.right
        && touch.clientY >= rect.top && touch.clientY <= rect.bottom;
}

function onEvolutionTouchStart(e) {
    // Referme la palette de sélection si elle était ouverte — évite qu'elle reste
    // affichée par-dessus un geste en cours (pincement ou swipe).
    hideEvolutionPalierPicker();

    // Un pincement (2 doigts) prend toujours le dessus, même s'il remplace un pan en
    // cours (confirmé ou non) — c'est le comportement naturel attendu quand le 2e doigt
    // d'un vrai pincement arrive juste après le 1er.
    if (e.touches.length === 2) {
        // Au moins un des deux doigts doit démarrer dans la zone des gestes d'échelle
        // (120px en bas, voir CSS) — plus tolérant qu'exiger les deux (un pincement
        // légitime peut démarrer avec le premier doigt posé hors zone).
        if (!isTouchInEvolutionHitzone(e.touches[0]) && !isTouchInEvolutionHitzone(e.touches[1])) return;
        e.preventDefault();
        evolutionGestureState = {
            type: 'pinch',
            lastStepDist: evolutionTouchDistance(e.touches),
            candidateIndex: window.evolutionPalierIndex
        };
        return;
    }
    if (e.touches.length === 1 && !evolutionGestureState) {
        const touch = e.touches[0];

        if (isTouchInEvolutionHitzone(touch)) {
            // Le palier "tout" n'a pas de largeur à faire glisser (le début est toujours
            // le premier jour réel de l'historique, quelle que soit la fin) — un swipe
            // dessus n'aurait pas de sens cohérent (voir discussion). On n'entame même
            // pas de geste candidat : les taps dans cette zone restent utilisables
            // normalement (mais l'exploration, elle, ne démarre jamais dans cette bande
            // — réservée aux gestes d'échelle, voir plus bas).
            const currentPalier = window.evolutionPaliers[window.evolutionPalierIndex];
            if (currentPalier.id === 'tout') return;

            const hitzone = document.getElementById('evolution-xaxis-hitzone');
            const rect = hitzone.getBoundingClientRect();
            // rect.height sert de référence pour convertir le déplacement en jours (voir
            // daysPerPx plus bas) : avec une zone réduite à 120px, le swipe devient plus
            // sensible au pixel qu'avec l'ancienne pleine hauteur — effet mécanique
            // attendu, à valider au test réel sur appareil.
            // Pas de preventDefault ici : tant que le geste n'est pas confirmé (voir
            // onEvolutionTouchMove), on ne bloque rien — un simple tap dans cette bande
            // doit pouvoir atteindre normalement le canvas.
            const startDate = getPalierStartDate(window.evolutionEndDate, currentPalier);
            const windowDays = Math.round((window.evolutionEndDate.getTime() - startDate.getTime()) / 86400000) + 1;
            evolutionGestureState = {
                type: 'pan',
                confirmed: false,
                startY: touch.clientY,
                pxRange: rect.height,
                windowDays,
                candidateEndDate: new Date(window.evolutionEndDate)
            };
            return;
        }

        // Zone du bouton de bascule axe Y (#evolution-yaxis-toggle) — élément DOM avec
        // son propre onclick, pointer-events actif (contrairement à la hitzone) : on
        // laisse le tap lui parvenir normalement via e.target, sans démarrer
        // d'exploration par-dessus. Détection par hit-testing DOM natif (fiable sous la
        // rotation CSS), pas par calcul de coordonnées.
        if (e.target.closest && e.target.closest('#evolution-yaxis-toggle')) return;

        // Sinon : exploration du graphe (ligne verticale + carte de valeurs, section
        // 25d). Le CONTACT lui-même bascule l'affichage : rien n'était visible → ce
        // contact l'affiche à l'endroit touché ; quelque chose était déjà visible
        // (persistant d'un geste précédent, voir touchend plus bas) → ce contact le
        // masque. Dans ce second cas (fermeture), tout déplacement du doigt PENDANT ce
        // même contact est ensuite ignoré (voir isClosing / onEvolutionTouchMove) — un
        // tap pour fermer ne doit jamais rouvrir l'affichage à cause d'un micro-tremblement
        // du doigt avant relâchement. Un contact qui affiche, lui, reste suivi normalement
        // par le déplacement (touchmove), sans condition.
        if (!evolutionChartInstance) return;
        e.preventDefault();
        const wasShowing = window.evolutionExploreTimestamp !== null && typeof window.evolutionExploreTimestamp !== 'undefined';
        evolutionGestureState = { type: 'explore', isClosing: wasShowing };
        if (wasShowing) {
            clearEvolutionExplore();
        } else {
            updateEvolutionExplore(touch);
        }
    }
}

function onEvolutionTouchMove(e) {
    if (!evolutionGestureState) return;

    if (evolutionGestureState.type === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const dist = evolutionTouchDistance(e.touches);
        const ratio = dist / evolutionGestureState.lastStepDist;
        const PINCH_STEP_THRESHOLD = 1.4; // effet magnétique : un pas franchi = un palier
        // Écarter les doigts (ratio > seuil) = zoomer "dedans" (comme une photo) = fenêtre
        // plus étroite → palier plus petit. Rapprocher les doigts = zoomer "dehors" =
        // fenêtre plus large → palier plus grand.
        if (ratio > PINCH_STEP_THRESHOLD && evolutionGestureState.candidateIndex > 0) {
            evolutionGestureState.candidateIndex--;
            evolutionGestureState.lastStepDist = dist;
        } else if (ratio < 1 / PINCH_STEP_THRESHOLD && evolutionGestureState.candidateIndex < window.evolutionPaliers.length - 1) {
            evolutionGestureState.candidateIndex++;
            evolutionGestureState.lastStepDist = dist;
        }
        const candidatePalier = window.evolutionPaliers[evolutionGestureState.candidateIndex];
        const start = getPalierStartDate(window.evolutionEndDate, candidatePalier);
        renderEvolutionPreviewBand(start.getTime(), window.evolutionEndDate.getTime(), candidatePalier);
        // Pincement → met à jour uniquement la partie durée du label (la fin de période
        // reste celle actuellement committée, inchangée par ce geste).
        updateEvolutionPalierLabel(candidatePalier, null);
    } else if (evolutionGestureState.type === 'pan' && e.touches.length === 1) {
        // Voir note de rotation en en-tête de section : mouvement local "horizontal" = clientY brut.
        const dyRaw = e.touches[0].clientY - evolutionGestureState.startY;

        if (!evolutionGestureState.confirmed) {
            if (Math.abs(dyRaw) < EVOLUTION_PAN_CONFIRM_PX) return; // encore un tap potentiel, on ne touche à rien
            evolutionGestureState.confirmed = true; // seuil franchi — c'est un vrai drag
        }
        e.preventDefault();

        const daysPerPx = evolutionGestureState.windowDays / evolutionGestureState.pxRange;
        const dayDelta = -Math.round(dyRaw * daysPerPx);
        const ed = window.evolutionEndDate;
        const candidate = clampEvolutionEndDate(new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() + dayDelta), evolutionGestureState.windowDays);
        evolutionGestureState.candidateEndDate = candidate;

        const palier = window.evolutionPaliers[window.evolutionPalierIndex];
        const start = getPalierStartDate(candidate, palier);
        renderEvolutionPreviewBand(start.getTime(), candidate.getTime(), palier);
        // Swipe → met à jour uniquement la partie "→ mois année" du label (la durée
        // reste celle actuellement committée, inchangée par ce geste).
        updateEvolutionPalierLabel(null, candidate);
    } else if (evolutionGestureState.type === 'explore' && e.touches.length === 1) {
        // Un contact qui vient de FERMER l'affichage (isClosing) ignore tout déplacement
        // pour le reste de ce même contact — évite qu'un micro-tremblement du doigt
        // avant relâchement ne rouvre l'affichage juste après l'avoir fermé (voir
        // onEvolutionTouchStart). Il faut relever puis retoucher pour explorer ailleurs.
        if (evolutionGestureState.isClosing) return;
        e.preventDefault();
        updateEvolutionExplore(e.touches[0]);
    }
}

function onEvolutionTouchEnd(e) {
    if (!evolutionGestureState) return;
    // Le geste se termine dès qu'il ne reste plus aucun doigt — pas de transition vers
    // un autre type de geste avec les doigts restants (évite les glissades accidentelles
    // d'un pincement mal terminé vers un pan, ou l'inverse).
    if (e.touches.length > 0) return;

    if (evolutionGestureState.type === 'pinch') {
        hideEvolutionPreviewBand();
        if (evolutionGestureState.candidateIndex !== window.evolutionPalierIndex) {
            applyEvolutionPalierChange(evolutionGestureState.candidateIndex); // met aussi à jour le label (état committé)
        } else {
            updateEvolutionPalierLabel(); // aucun changement — revient à l'état committé
        }
    } else if (evolutionGestureState.type === 'pan' && evolutionGestureState.confirmed) {
        // Pan jamais confirmé (resté sous le seuil) : rien n'a été touché ni prévisualisé,
        // rien à défaire — le tap a déjà suivi son cours normal de son côté.
        hideEvolutionPreviewBand();
        if (evolutionGestureState.candidateEndDate.getTime() !== window.evolutionEndDate.getTime()) {
            window.evolutionEndDate = evolutionGestureState.candidateEndDate;
            renderEvolutionChart(); // met aussi à jour le label (état committé)
        } else {
            updateEvolutionPalierLabel(); // aucun changement — revient à l'état committé
        }
    }
    // type === 'explore' : rien à faire ici — l'affichage (ligne + carte) reste tel
    // quel au relâchement, décidé uniquement au contact (voir touchstart) et suivi en
    // continu pendant un drag (voir touchmove). Masqué uniquement par un nouveau
    // contact (bascule) ou par un vrai changement d'affichage (voir renderEvolutionChart()).
    evolutionGestureState = null;
}

// Convertit la position tactile en date visée, puis met à jour la ligne verticale
// (canvas, via evolutionExploreLinePlugin) et la carte de valeurs (DOM). Appelée au
// toucher initial et à chaque déplacement pendant l'exploration — geste léger : aucun
// recalcul de données, uniquement un redraw canvas (chart.draw()) et une lecture directe
// dans les tableaux déjà construits.
function updateEvolutionExplore(touch) {
    if (!evolutionChartInstance) return;
    const canvas = evolutionChartInstance.canvas;
    const rect = canvas.getBoundingClientRect();
    let fraction = (rect.bottom - touch.clientY) / rect.height; // correctif car inversion
    fraction = Math.min(Math.max(fraction, 0), 1);
    // Repère de conception (voir swipe, section 25b) : mouvement local "horizontal" =
    // clientY brut. Sens déduit de celui déjà confirmé par test réel pour le swipe (où
    // un déplacement du doigt vers le bas fait reculer la fenêtre affichée vers des
    // dates plus anciennes, donc vers une position plus à gauche de l'axe local) —
    // ⚠️ à reconfirmer concrètement, comme les deux gestes précédents : un flip de
    // signe simple suffira si le sens perçu est inversé au premier test.
    const localPixelX = evolutionChartInstance.width * (1 - fraction);
    const rawValue = evolutionChartInstance.scales.x.getValueForPixel(localPixelX);
    if (rawValue === undefined || rawValue === null || isNaN(rawValue)) return;
    const raw = new Date(rawValue);
    // Arrondi au jour civil (composants de date, jamais d'arithmétique en ms — cohérent
    // avec la règle DST déjà actée pour ce fichier) — les points de données sont tous à
    // la granularité du jour (minuit local).
    const dayTs = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()).getTime();

    window.evolutionExploreTimestamp = dayTs;
    evolutionChartInstance.draw();
    renderEvolutionValueCard(dayTs);
}

// Fin de l'exploration (relâchement du doigt) — efface la ligne/les points (redraw
// canvas) et masque la carte de valeurs.
function clearEvolutionExplore() {
    window.evolutionExploreTimestamp = null;
    if (evolutionChartInstance) evolutionChartInstance.draw();
    const card = document.getElementById('evolution-value-card');
    if (card) card.style.display = 'none';
}

// Bornes réelles de l'historique (premier/dernier jour avec données) — lues depuis
// l'index déjà construit à l'ouverture de l'overlay (voir buildEvolutionFullDaysIndex(),
// section 25). Reconstruit défensivement si absent (ne devrait pas arriver en usage
// normal, l'overlay doit toujours être ouvert avant tout appel ici).
function getEvolutionHistoryBounds() {
    if (!window.evolutionFullDaysIndex) window.evolutionFullDaysIndex = buildEvolutionFullDaysIndex();
    const idx = window.evolutionFullDaysIndex;
    if (!idx || idx.dateKeys.length === 0) return null;
    const firstKey = idx.dateKeys[0];
    const lastKey = idx.dateKeys[idx.dateKeys.length - 1];
    return {
        start: new Date(idx.daysData[firstKey].timestamp),
        end: new Date(idx.daysData[lastKey].timestamp)
    };
}

// Borne evolutionEndDate — règle symétrique sur les DONNÉES RÉELLES, pas sur "aujourd'hui" :
//   - Borne haute : le dernier jour réel de l'historique (pas "aujourd'hui" — évite de
//     pouvoir swiper vers une fenêtre vide si rien n'a été enregistré récemment).
//   - Borne basse : la position la plus reculée où le DÉBUT de la fenêtre affichée
//     coïncide exactement avec le premier jour réel de l'historique — jamais plus loin.
//     windowDays sert à convertir cette contrainte (qui porte sur le début de fenêtre,
//     une valeur dérivée) en une contrainte sur evolutionEndDate (la seule valeur qu'on
//     fait varier directement) : minEndDate = histStart + (windowDays - 1). Si
//     l'historique réel est plus court que le palier courant, cette borne basse
//     dépasserait la borne haute (position impossible, dans le "futur" des données) —
//     plafonnée dans ce cas à la borne haute : le recul est alors simplement désactivé,
//     aucun cas particulier à gérer séparément (voir échange).
// windowDays optionnel — absent, le clamp ne s'applique qu'à la borne haute (repli sûr).
function clampEvolutionEndDate(candidate, windowDays) {
    const todayMidnight = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    const bounds = getEvolutionHistoryBounds();
    const maxEndDate = bounds ? bounds.end : todayMidnight;
    if (candidate > maxEndDate) return maxEndDate;

    if (bounds && windowDays) {
        let minEndDate = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), bounds.start.getDate() + windowDays - 1);
        if (minEndDate > maxEndDate) minEndDate = maxEndDate; // historique plus court que le palier — recul désactivé
        if (candidate < minEndDate) return minEndDate;
    } else if (bounds && candidate < bounds.start) {
        return bounds.start; // repli si windowDays indisponible
    }
    return candidate;
}

// Bande de prévisualisation des graduations pendant un geste (pincement ou swipe) — DOM
// indépendant de Chart.js, jamais lié au rendu réel du graphique pendant le geste (voir
// en-tête de section). Réutilise computeEvolutionTicks() pour afficher exactement les
// mêmes jours que le graphique une fois le geste terminé, et applique désormais la même
// logique visuelle que les ticks réels (renderEvolutionChart()) : hiérarchie d'opacité
// principal/secondaire (constantes globales EVOLUTION_TICK_PRINCIPAL_ALPHA/SECONDARY_ALPHA)
// et millésime sur 2 lignes pour tout tick du 1er janvier. Hauteur de la bande (26px,
// voir CSS) pas encore ajustée pour ces 2 lignes — à faire dans un prochain passage.
function renderEvolutionPreviewBand(rangeStart, rangeEnd, palier) {
    const band = document.getElementById('evolution-xaxis-preview');
    if (!band) return;
    const span = rangeEnd - rangeStart;
    if (span <= 0) { band.innerHTML = ''; band.style.display = 'block'; return; }
    const textGray = getCSSColor('--chart-gray-text');
    const isMonthOnlyMode = palier.months === null || palier.months >= 9;
    const ticks = computeEvolutionTicks(rangeStart, rangeEnd, palier);
    band.innerHTML = ticks.map(ts => {
        const pct = ((ts - rangeStart) / span) * 100;
        const d = new Date(ts);
        const isDayOne = d.getDate() === 1;
        const isPrincipal = isDayOne && (!isMonthOnlyMode || d.getMonth() === 0);
        const color = withAlpha(textGray, isPrincipal ? EVOLUTION_TICK_PRINCIPAL_ALPHA : EVOLUTION_TICK_SECONDARY_ALPHA);
        let label;
        if (!isDayOne) {
            label = d.getDate().toString();
        } else if (d.getMonth() === 0) {
            label = `${d.toLocaleDateString(getLocale(), { month: 'short' })}<br>${d.getFullYear()}`;
        } else {
            label = d.toLocaleDateString(getLocale(), { month: 'short' });
        }
        return `<span class="evolution-preview-tick" style="left:${pct.toFixed(2)}%; color:${color};">${label}</span>`;
    }).join('');
    band.style.display = 'block';
}

function hideEvolutionPreviewBand() {
    const band = document.getElementById('evolution-xaxis-preview');
    if (band) band.style.display = 'none';
}

// Ouverture / fermeture de l'overlay — pas de recalcul au resize/orientationchange :
// l'orientation physique reste verrouillée portrait (manifest.json), les dimensions du
// viewport ne changent donc jamais pendant que l'overlay est ouvert.
function openEvolutionOverlay() {
    const overlay = document.getElementById('evolution-overlay');
    if (!overlay) return;
    overlay.style.display = 'block';

    cleanupCombinedTypeIds(); // avant tout, pour que le nettoyage ci-dessous se base sur l'état à jour

    // Reconstruit l'index par jour sur tout l'historique à chaque ouverture — coûteux
    // (proportionnel au nombre de périodes) mais rare, voir buildEvolutionFullDaysIndex()
    // (section 25) ; le reste du calcul (fenêtre, moyennes mobiles) lit ensuite ce cache
    // sans jamais re-scanner state.history tant que l'overlay reste ouvert.
    window.evolutionFullDaysIndex = buildEvolutionFullDaysIndex();

    // Désélectionne automatiquement toute série qui n'existe plus réellement — pour un
    // type, absence de données ; pour 'combined', combinaison vide (aucun type composant,
    // déjà nettoyé juste au-dessus). État mémoire qui reflète la réalité du moment, pas
    // une intention passée : une série qui redevient valide plus tard réapparaît comme
    // pastille DÉSÉLECTIONNÉE (jamais recochée automatiquement) — l'utilisateur la
    // re-choisit explicitement, comme un premier affichage. Persisté (vrai nettoyage).
    {
        const existingTypeIds = new Set(getTypesWithHistoryData().map(tp => tp.id));
        const cleanedSeries = settings.evolutionSelectedSeries.filter(sid => {
            if (sid === 'combined') return settings.combinedTypeIds.length > 0;
            return existingTypeIds.has(sid);
        });
        if (cleanedSeries.length !== settings.evolutionSelectedSeries.length) {
            settings.evolutionSelectedSeries = cleanedSeries;
            safeSave('pacingSettings', JSON.stringify(settings));
            console.log('[Evolution] Séries fantômes nettoyées de evolutionSelectedSeries');
        }
    }

    // Reconstruit la liste des paliers à chaque ouverture (pas chère à recalculer, voir
    // buildEvolutionPaliers()) — reflète toujours l'ancienneté actuelle de l'historique.
    // Si un palier était déjà sélectionné (ouverture précédente dans la même session),
    // on borne simplement l'index à la nouvelle longueur plutôt que de le réinitialiser.
    window.evolutionPaliers = buildEvolutionPaliers();
    if (typeof window.evolutionPalierIndex === 'undefined') {
        window.evolutionPalierIndex = window.evolutionPaliers.findIndex(p => p.id === '3m');
    } else {
        window.evolutionPalierIndex = Math.min(window.evolutionPalierIndex, window.evolutionPaliers.length - 1);
    }

    renderEvolutionChips();
    renderEvolutionChart();
    // Init des gestes une seule fois (comme initFooterDrawer()) — l'overlay est recréé
    // dans le DOM dès le premier appel (voir HTML), donc les listeners restent valides
    // aux ouvertures suivantes.
    if (!window._evolutionGesturesInited) {
        initEvolutionGestures();
        window._evolutionGesturesInited = true;
    }
    console.log('[Evolution] Overlay ouvert');
}

function closeEvolutionOverlay() {
    const overlay = document.getElementById('evolution-overlay');
    if (overlay) overlay.style.display = 'none';
    // Hygiène : évite qu'une ligne/carte d'exploration résiduelle apparaisse à la
    // prochaine ouverture avant tout nouveau toucher (état de session, pas de geste en
    // cours à ce stade puisque le bouton fermer n'est atteignable qu'au repos).
    window.evolutionExploreTimestamp = null;
}