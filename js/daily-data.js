// daily-data.js — événements journaliers (tags) et notes quotidiennes. dailyData/saveDailyData restent dans index.html (section 4).



// ============================================================
// 2a. TAGS D'ÉVÉNEMENTS JOURNALIERS BUILTIN (chantier notes/événements)
// Même principe que PROFILES[...].types[].label : labels multilingues {fr,en,nl}, résolus
// une fois dans la langue courante quand le tag est fusionné dans settings.eventTags[]
// (voir bootstrap section 4, et retraduction dans changeLang()).
// mode : "tristate" (oui / non / non renseigné = absence d'event), extensible.
// ============================================================
// ⚠️ pem est passé de tristate à presence dans cette même session (aucune diffusion
// publique n'a eu lieu — pas de migration de données écrite, voir note de commentaire
// près du bootstrap de dailyData). polarity ('positive'/'negative') implémente la logique
// d'exclusion mutuelle par CAMP (pas par tag isolé, voir stripOppositePolarityEvents()) :
// deux tags de même polarity coexistent librement, deux tags de polarity opposée s'excluent,
// un tag sans polarity (ex. futur "médicament X") reste totalement indépendant, ne modifie
// rien et n'est jamais modifié par ce mécanisme.
const BUILTIN_EVENT_TAGS = [
    {
        id: "pem",
        label: { fr: "MPE", en: "PEM", nl: "PEM" },
        description: {
            fr: "Malaise post-effort : aggravation des symptômes après un effort (apparaît généralement 1 à 3 jours après l'effort)",
            en: "Post-exertional malaise: symptoms worsened after exertion (usually appears 1 to 3 days after the effort)",
            nl: "Post-exertionele malaise: verergering van de klachten na inspanning (verschijnt meestal 1 tot 3 dagen na de inspanning)"
        },
        mode: "presence",
        polarity: "negative",
        timed: false,
        repeatable: false
    },
    {
        id: "sick",
        label: { fr: "Malade", en: "Sick", nl: "Ziek" },
        description: {
            fr: "Malade : infection en cours (virus, bactérie…)",
            en: "Sick: infection ongoing (virus, bacteria…)",
            nl: "Ziek: infectie aan de gang (virus, bacterie…)"
        },
        mode: "presence",
        polarity: "negative",
        timed: false,
        repeatable: false
    },
    {
        id: "day_ok",
        label: { fr: "Jour OK", en: "Day OK", nl: "Dag OK" },
        description: {
            fr: "Jour OK : journée globalement correcte ou bonne",
            en: "Day OK: overall an okay or good day",
            nl: "Dag OK: over het algemeen een redelijke of goede dag"
        },
        mode: "presence",
        polarity: "positive",
        timed: false,
        repeatable: false
    }
];

// Couleurs des événements — définies GLOBALEMENT ici (une seule source, par tagId), pas par
// mode : reconnaissables et volontairement différentes des couleurs de type (TYPE_COLORS,
// palette bleu/vert/jaune/orange/rouge/violet). Tag sans entrée ici (ex. futur tag
// indépendant) → repli neutre (--blue), pour rester utilisable sans configuration préalable.
const EVENT_TAG_COLORS = {
    pem: '#8e2b2b',      // rouge sombre
    sick: '#a45c1f',     // orange sombre
    day_ok: '#2e6b3a'    // vert sombre
};
function getEventTagColor(tagId) {
    return EVENT_TAG_COLORS[tagId] || 'var(--blue)';
}

// Construit l'entrée settings.eventTags[] d'un tag builtin, dans la langue demandée.
function buildEventTagFromBuiltin(def, lang) {
    return {
        id: def.id,
        label: def.label[lang] || def.label['fr'] || '',
        description: def.description?.[lang] || def.description?.['fr'] || '',
        mode: def.mode,
        polarity: def.polarity, // undefined pour un tag sans exclusion (ex. futur tag indépendant)
        active: true,
        timed: def.timed ?? false,
        repeatable: def.repeatable ?? false,
        builtin: true
    };
}


// Valeur d'un événement journalier pour un jour et un tag : 'yes' | 'no' | null
// (null = non renseigné = aucun event stocké — "absence d'info ≠ info d'absence").
function getDailyEventValue(dateKey, tagId) {
    const ev = dailyData[dateKey]?.events?.find(e => e.tagId === tagId);
    return ev ? ev.value : null;
}

// Présence d'un événement 'presence' pour un jour et un tag : true | false — seule la
// présence de l'event dans le tableau fait foi, jamais de value:false stockée (cohérent
// avec le principe déjà en place pour 'tristate' : une absence n'est pas une donnée).
function getDailyEventPresence(dateKey, tagId) {
    return !!dailyData[dateKey]?.events?.some(e => e.tagId === tagId);
}

// Liste des tags actifs présents pour un jour donné, dans l'ordre STABLE de
// settings.eventTags (jamais réordonné selon les données du jour) — partagée entre les
// pastilles de Résultats et les mini-pastilles sous les dates d'Historique, pour garder
// une seule source de vérité sur "quels événements compter comme présents ce jour".
// Générique par mode, mais seul 'presence' est retenu pour l'instant : aucun tag actif
// n'utilise un autre mode aujourd'hui (voir BUILTIN_EVENT_TAGS). À étendre ici le moment
// venu, sans toucher les deux appelants — pistes déjà identifiées : un futur 'tristate'
// compterait comme présent seulement si value==='yes' (un "non" explicite ne justifie pas
// plus qu'un "non renseigné", cohérent avec 'presence' qui n'affiche rien dans les deux
// cas) ; un futur 'numeric' resterait probablement hors de cette liste (pas de pastille
// pertinente sans widget dédié pour afficher sa valeur).
function getPresentDailyEventTags(dateKey) {
    return settings.eventTags.filter(tg => tg.active && tg.mode === 'presence' && getDailyEventPresence(dateKey, tg.id));
}

// ---------- Mesure d'usage GoatCounter (veille) ----------
// Appelée par le ping quotidien (index.html). Regarde UNIQUEMENT la veille (date locale, calendrier :
// jamais jour + 24*3600*1000) :
//  - un event 'Daily-event-<number>' par tag BUILTIN actif de mode 'presence' présent la veille ;
//    nombre d'envois tiré au hasard : 0 (1/4), 1 (1/2), 2 (1/4) → moyenne 1 (comptage non biaisé)
//    mais présence masquée. Jamais d'id de tag non builtin (le nom d'un tag perso pourrait être personnel) ;
//  - 'Daily-note' une seule fois si la note de la veille n'est pas vide (pas de masquage).
// Lecture : total de l'event ÷ DailyUser-TOTAL de la même période (voir docs/notes-events.md).
// rand : injectable pour les tests (défaut Math.random).
const DAILY_GOAT_DRAW = [0, 1, 1, 2];
const DAILY_GOAT_EVENT_NUM = { pem: 1, sick: 2, day_ok: 3 }; // un nouveau tag builtin doit recevoir son numéro ici, sinon il n'est pas envoyé
function drawDailyEventGoatCount(rand) {
    const r = typeof rand === 'function' ? rand() : Math.random();
    return DAILY_GOAT_DRAW[Math.min(DAILY_GOAT_DRAW.length - 1, Math.floor(r * DAILY_GOAT_DRAW.length))];
}

function getDailyGoatCounterPaths(now, rand) {
    const n = now || new Date();
    const yDate = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    const dateKey = dailyEventsDateKey(yDate);
    const items = []; // { path, count } — count peut être 0 (tirage), gardé pour le log
    settings.eventTags.forEach(tg => {
        if (!tg.active || tg.mode !== 'presence') return;
        if (!DAILY_GOAT_EVENT_NUM[tg.id] || !BUILTIN_EVENT_TAGS.some(d => d.id === tg.id)) return;
        if (!getDailyEventPresence(dateKey, tg.id)) return;
        items.push({ path: 'Daily-event-' + DAILY_GOAT_EVENT_NUM[tg.id], count: drawDailyEventGoatCount(rand) });
    });
    const note = dailyData[dateKey]?.text;
    if (typeof note === 'string' && note.trim()) items.push({ path: 'Daily-note', count: 1 });
    return { dateKey, items };
}

// Pastilles d'événements journaliers pour un jour donné (Résultats) — un tag présent =
// une pastille (label court, texte blanc, fond = couleur du tag via getEventTagColor()).
function buildDailyEventPillsHTML(dateKey) {
    return getPresentDailyEventTags(dateKey)
        .map(tg => `<span class="results-event-pill" style="background:${getEventTagColor(tg.id)};">${escapeHtml(tg.label)}</span>`)
        .join('');
}

// polarity d'un tag ('positive' | 'negative' | undefined si le tag n'a pas ce champ, ou
// n'existe plus) — undefined = tag indépendant, jamais concerné par l'exclusion.
function getTagPolarity(tagId) {
    const tg = settings.eventTags.find(t => t.id === tagId);
    return tg ? tg.polarity : undefined;
}

// Retire d'un tableau d'events ceux dont le tag a une polarity DIFFÉRENTE de celle du tag
// qu'on est en train d'activer — jamais ceux de la même polarity (ils coexistent librement),
// jamais ceux d'un tag sans polarity (indépendants, ex. futur "médicament X"). N'est appelée
// qu'au moment d'ACTIVER un tag (jamais à la désactivation) : activer 'pem' (negative) efface
// 'day_ok' (positive) s'il était coché, mais laisse 'sick' (negative, même camp) et tout
// tag indépendant intacts. Si le tag qu'on active n'a lui-même pas de polarity, ne retire rien.
function stripOppositePolarityEvents(events, activatingTagId) {
    const pol = getTagPolarity(activatingTagId);
    if (!pol) return events;
    return events.filter(ev => {
        const evPol = getTagPolarity(ev.tagId);
        return !(evPol && evPol !== pol);
    });
}

// Tap sur une case 'presence' : ajoute l'event (présent, en appliquant l'exclusion par
// polarity — voir stripOppositePolarityEvents()) ou le retire (absent, simple suppression,
// aucune règle d'exclusion à la désactivation). Jamais de value stockée. Même nettoyage
// qu'ailleurs : clé du jour supprimée si elle devient vide (events ET note absents).
function toggleEventPresence(dateKey, tagId) {
    const day = dailyData[dateKey] || (dailyData[dateKey] = {});
    let events = Array.isArray(day.events) ? day.events : [];
    const already = events.some(ev => ev.tagId === tagId);
    if (already) {
        events = events.filter(ev => ev.tagId !== tagId);
    } else {
        events = stripOppositePolarityEvents(events, tagId);
        events.push({ tagId });
    }
    day.events = events;
    if (day.events.length === 0) delete day.events;
    if (Object.keys(day).length === 0) delete dailyData[dateKey];
    saveDailyData();
    refreshDailyEventUIs(dateKey);
}

// Tap sur Oui / Non : sélectionne la valeur ; un second tap sur la valeur déjà active
// revient à "non renseigné" (l'event est retiré, jamais stocké comme valeur vide).
// La clé du jour est supprimée dès qu'elle ne contient plus rien (pas de jour "fantôme").
function toggleEventTristate(dateKey, tagId, value) {
    const day = dailyData[dateKey] || (dailyData[dateKey] = {});
    let events = Array.isArray(day.events) ? day.events : [];
    const existing = events.find(ev => ev.tagId === tagId);
    if (existing && existing.value === value) {
        // 2e tap sur la même valeur : désactivation, pas d'exclusion à appliquer.
        events = events.filter(ev => ev.tagId !== tagId);
    } else if (existing) {
        // Le tag était déjà actif (Oui→Non ou inverse) : sa polarity n'a pas changé, les
        // events déjà exclus au moment de sa 1ère activation le restent — rien à refaire.
        existing.value = value;
    } else {
        // Le tag n'était pas actif : c'est une activation, on applique l'exclusion par
        // polarity avant d'ajouter (voir stripOppositePolarityEvents()).
        events = stripOppositePolarityEvents(events, tagId);
        events.push({ tagId, value });
    }
    day.events = events;
    if (day.events.length === 0) delete day.events;
    if (Object.keys(day).length === 0) delete dailyData[dateKey];
    saveDailyData();
    refreshDailyEventUIs(dateKey);
}


// ============================================================
// 20c. TABLEAU ÉVÉNEMENTS JOURNALIERS (chantier notes/événements)
// Overlay portrait plein écran, ouvert depuis la page Mesure (#btn-daily-events).
// Générique par tag actif (tous modes confondus) : 'tristate' occupe 2 colonnes (Oui/Non),
// tout autre mode (ex. 'presence') en occupe 1 seule — un futur tag apparaît ici sans code
// supplémentaire. Le mode 'tristate' reste géré ici pour un usage futur éventuel, mais
// aucun tag actif ne l'utilise actuellement (les 3 tags builtin sont tous en 'presence').
//
// Défilement continu du jour le plus récent (rang 0 = aujourd'hui) vers le passé, sans borne,
// en FENÊTRE VIRTUELLE : la ligne de rang i est la date « aujourd'hui − i jours » (calculée à la
// demande, jamais stockée), toutes les lignes ont une hauteur EXACTE (DAILY_EVENTS_ROW_H) et
// seules ~60 lignes proches de l'écran existent dans le DOM. Le conteneur #daily-events-body
// reçoit la hauteur totale (rangs × hauteur) : le défilement garde sa longueur réelle, et elle
// ne fait que GRANDIR (par paquets, quand on approche de la fin). Les lignes sont positionnées
// en absolu (top = rang × hauteur) ; en-tête et 1ère colonne restent fixes par CSS sticky.
// Défilement natif uniquement — pas de geste tactile personnalisé.
// Une saisie (toggle, frappe dans la note) ne remplace QUE la ligne concernée
// (refreshDailyEventsRow), jamais tout le tableau.
//
// JOUR ÉDITÉ = LIGNE DU HAUT (un seul indicateur de jour) : la ligne juste sous l'en-tête, entourée
// d'un cadre FIXE (#daily-events-frame, sticky), est celle dont la note est dans le panneau.
// - Pendant le défilement : la date du panneau suit en direct la ligne du haut ; tant qu'elle
//   diffère du jour chargé, le champ de note est grisé et en lecture seule (aucune frappe possible
//   sur le mauvais jour) et le clavier est fermé.
// - À l'arrêt (DAILY_EVENTS_SETTLE_MS sans événement de défilement ET doigt/souris relâché) : la
//   ligne la plus proche est recalée pile sous l'en-tête par JS (pas de CSS scroll-snap : incompatible
//   avec la fenêtre virtuelle), puis sa note est chargée.
// - Tap sur une date ou une note, bouton « Aujourd'hui », sélecteur de date du panneau : amènent le
//   jour en haut (selectDailyEventsDate) ; sa note est chargée tout de suite (saut), ou à l'arrivée
//   du glissement doux quand le jour est proche (≤ DAILY_EVENTS_GLIDE_ROWS lignes).
// Colonnes : Date | un tag par colonne | Note ÉLASTIQUE (min DAILY_EVENTS_COL_NOTE_MIN_W, max
// DAILY_EVENTS_COL_NOTE_MAX_W : 80 caractères tiennent sur 2 lignes sans troncature au maximum).
// La navigation par paires de mois (flèches ↓ ↑ ⬆, ligne séparatrice de mois) a été retirée
// avec ce rendu : dernière version du tableau <table> = commit f99733a (branche dev).
// Le cadre beige par ligne (classe .de-row-editing, jour édité quelconque) a été remplacé en
// beta.25 par le cadre fixe ci-dessus : dernière version avec = commit d305079 (beta.24).
// ============================================================

const DAILY_EVENTS_ROW_H = 44;          // px — hauteur EXACTE d'une ligne (aussi posée en CSS : --de-row-h)
const DAILY_EVENTS_COL_DATE_W = 92;     // px — REPLI seulement : la largeur de la colonne Date est MESURÉE (measureDailyEventsDateColW) ; ceci ne sert que si la mesure donne 0 (overlay masqué)
const DAILY_EVENTS_COL_DATE_RESERVE = 2; // px — réserve ajoutée à la largeur mesurée (arrondis de sous-pixel)
const DAILY_EVENTS_COL_TAG_W = 46;      // px — une colonne par tag 'presence', deux par tag 'tristate'
const DAILY_EVENTS_COL_NOTE_MIN_W = 170; // px — colonne Note : largeur minimale (= ancienne largeur fixe)
const DAILY_EVENTS_COL_NOTE_MAX_W = 320; // px — plafond : 80 caractères sur 2 lignes sans troncature
const DAILY_EVENTS_HEAD_H = 44;         // px — en-tête sur 1 niveau (aucun tag tristate actif) = hauteur d'une ligne
const DAILY_EVENTS_HEAD_H_TRISTATE = 60; // px — en-tête sur 2 niveaux (32 + 28) quand un tag tristate est actif
const DAILY_EVENTS_GLIDE_ROWS = 14;     // glissement doux du tap si le jour visé est à ≤ 14 lignes du haut
const DAILY_NOTE_MAX = 80;              // caractères max d'une note (aussi maxlength du <textarea>)
const DAILY_NOTE_INDICATOR_MS = 600;    // silence de frappe avant « Enregistré » ; durée du compteur ambre à 80/80
const DAILY_EVENTS_TIP_MS = 5000;       // durée d'affichage de l'info-bulle d'un en-tête d'événement
const DAILY_EVENTS_INITIAL_ROWS = 150;  // longueur initiale de la zone défilable (en lignes)
const DAILY_EVENTS_EXTEND_ROWS = 90;    // prolongement de la zone défilable quand on approche de la fin
const DAILY_EVENTS_EXTEND_MARGIN = 40;  // lignes d'avance minimum au-delà de la fenêtre dessinée
const DAILY_EVENTS_WINDOW_ROWS = 60;    // lignes dessinées dans le DOM
const DAILY_EVENTS_MARGIN_LOW = 10;     // redessiner si la 1ère ligne visible passe sous (début de fenêtre + 10)
const DAILY_EVENTS_MARGIN_HIGH = 30;    // redessiner si elle dépasse (début de fenêtre + 30)
const DAILY_EVENTS_RECENTER = 20;       // après un redessin : 1ère ligne visible = début de fenêtre + 20
const DAILY_EVENTS_SETTLE_MS = 140;     // silence de défilement avant le recalage sur la ligne du haut

window.dailyEventsToday = null;         // Date (minuit) figée à l'ouverture : rang 0 (null = overlay jamais ouvert)
window.dailyEventsTotalRows = 0;        // longueur courante de la zone défilable, en lignes
window.dailyEventsWinFrom = 0;          // fenêtre dessinée : rangs [from, to[
window.dailyEventsWinTo = 0;
window.dailyEventsLiveDate = null;      // date affichée dans le panneau (suit la ligne du haut en direct)
window.dailyEventsFingerDown = false;   // doigt / souris posé sur la zone : pas de recalage tant que vrai
window.dailyEventsMoving = false;       // panneau grisé : la ligne du haut n'est pas encore le jour chargé

function dailyEventsDateKey(d) {
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// Date du jour de rang i (0 = aujourd'hui). Arithmétique calendaire : jamais + 24*3600*1000 (DST).
function dailyEventsDateForRow(i) {
    const t0 = window.dailyEventsToday;
    return new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - i);
}

// Rang d'une date 'AAAA-MM-JJ' (0 = aujourd'hui) ; null si format invalide ou jour futur.
// Date.UTC des deux côtés : écart en jours exact, sans effet de changement d'heure.
function dailyEventsRowForDateKey(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
    const t0 = window.dailyEventsToday;
    if (!m || !t0) return null;
    const diff = Math.round((Date.UTC(t0.getFullYear(), t0.getMonth(), t0.getDate()) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
    return diff >= 0 ? diff : null;
}

// Jour de semaine sur 2 lettres, quelle que soit la langue (« lun. » → « lu », « Mon » → « Mo »,
// « ma » → « ma ») : largeur identique partout.
function dailyEventsWeekday2(date, fmt) {
    return fmt.format(date).replace(/[.\s]/g, '').slice(0, 2);
}

// Largeur de la colonne Date, MESURÉE dans la police réelle : on pose hors écran (visibility:hidden,
// jamais visible) des copies des vraies cellules (mêmes classes, donc mêmes marges, bordures, taille
// de police) avec les textes les plus larges — dates sur deux plages de 7 jours (tous les jours de
// semaine, chiffres variés), libellé « Aujourd'hui » de la langue courante, bouton du coin — et on
// retient le plus large. Renvoie 0 si rien n'est mesurable (overlay masqué) : l'appelant utilise alors
// DAILY_EVENTS_COL_DATE_W. Appelée à chaque rendu complet (ouverture, changement de langue).
function measureDailyEventsDateColW(overlay, ctx) {
    if (!overlay) return 0;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;';
    try {
        const texts = [t('dailyEventsToday')];
        for (let k = 0; k < 7; k++) {
            [new Date(2026, 7, 23 + k), new Date(2026, 11, 20 + k)].forEach(d => {
                texts.push(`${dailyEventsWeekday2(d, ctx.weekdayFmt)} ${ctx.dateFmt.format(d)}`);
            });
        }
        let html = texts.map(s => `<div class="de-c de-col-date" style="position:absolute;left:0;top:0;width:max-content;">${escapeHtml(s)}</div>`).join('');
        // Coin : cellule d'en-tête + bouton à largeur naturelle (en vrai, le bouton remplit la cellule).
        html += `<div class="de-h de-h-corner" style="position:absolute;left:0;top:0;width:max-content;"><button class="de-today-btn" style="width:auto;">${escapeHtml(t('dailyEventsTodayBtn'))}</button></div>`;
        probe.innerHTML = html;
        overlay.appendChild(probe);
        let w = 0;
        probe.childNodes.forEach(el => { w = Math.max(w, el.getBoundingClientRect().width); });
        return w > 0 ? Math.ceil(w) + DAILY_EVENTS_COL_DATE_RESERVE : 0;
    } catch (e) {
        console.warn('[DailyEvents] mesure de la colonne Date impossible — repli', e);
        return 0;
    } finally {
        probe.remove();
    }
}

// Contexte commun à toutes les lignes d'un même dessin (évite de le recalculer ligne par ligne).
function getDailyEventsRenderContext() {
    return {
        tags: settings.eventTags.filter(tg => tg.active),
        // Colonne Date : « ma 06/10 » — jour de semaine sur 2 lettres + jour/mois, SANS année (l'année est
        // dans la date du panneau). Le format jour/mois suit la locale.
        dateFmt: new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: '2-digit' }),
        weekdayFmt: new Intl.DateTimeFormat(getLocale(), { weekday: 'short' })
    };
}

// HTML d'UNE ligne (rang i) : date tapable (amène le jour en haut et charge sa note dans le panneau
// — jamais les cases d'événement, qui servent déjà à activer/désactiver), une case par colonne de
// tag, aperçu de la note (tapable aussi). Le jour édité n'est plus marqué par ligne : c'est le cadre
// fixe #daily-events-frame, posé sur la ligne du haut.
function buildDailyEventsRowHTML(i, ctx) {
    const d = dailyEventsDateForRow(i);
    const dateKey = dailyEventsDateKey(d);
    const isWeekend = [0, 6].includes(d.getDay());
    const isToday = i === 0;
    const formattedDateRaw = `${dailyEventsWeekday2(d, ctx.weekdayFmt)} ${ctx.dateFmt.format(d)}`;
    // Opacité réduite du weekend — restreinte au texte de la date lui-même (span dédié), jamais à
    // toute la cellule (qui porte aussi le fond de la colonne épinglée).
    const formattedDate = isWeekend ? `<span class="de-weekend-text">${formattedDateRaw}</span>` : formattedDateRaw;
    // Cellule "Aujourd'hui" sur 2 lignes (mot-clé + date), pour repérer le jour courant
    // d'un coup d'œil sans avoir à lire/comparer la date affichée.
    const dateContent = isToday
        ? `<div class="de-today-label">${t('dailyEventsToday')}</div><div>${formattedDate}</div>`
        : formattedDate;

    let html = `<div class="de-row${isToday ? ' de-today' : ''}" data-date="${dateKey}" style="top:${i * DAILY_EVENTS_ROW_H}px">`;
    html += `<div class="de-c de-col-date" onclick="selectDailyEventsDate('${dateKey}')">${dateContent}</div>`;
    ctx.tags.forEach(tg => {
        if (tg.mode === 'tristate') {
            const val = getDailyEventValue(dateKey, tg.id);
            html += `<div class="de-c de-cell" onclick="toggleEventTristate('${dateKey}','${tg.id}','yes')"><div class="de-cell-inner"><div class="de-dot${val === 'yes' ? ' de-active-yes' : ''}"></div></div></div>`;
            html += `<div class="de-c de-cell" onclick="toggleEventTristate('${dateKey}','${tg.id}','no')"><div class="de-cell-inner"><div class="de-dot${val === 'no' ? ' de-active-no' : ''}"></div></div></div>`;
        } else {
            // Couleur GLOBALE par tag (EVENT_TAG_COLORS), pas par mode — reconnaissable et
            // différente des couleurs de type. Appliquée en style inline (pas de classe CSS par
            // tagId à maintenir), seulement quand la case est active.
            const on = getDailyEventPresence(dateKey, tg.id);
            const color = getEventTagColor(tg.id);
            const dotStyle = on ? ` style="background:${color};border-color:${color};"` : '';
            html += `<div class="de-c de-cell" onclick="toggleEventPresence('${dateKey}','${tg.id}')"><div class="de-cell-inner"><div class="de-dot"${dotStyle}></div></div></div>`;
        }
    });
    // Case Note — texte tel quel si présent (jamais tronqué, plafonné à 2 lignes visuelles par
    // CSS -webkit-line-clamp), un tiret très pâle sinon (aucun texte : pas de pression à remplir).
    const noteText = getDailyNote(dateKey);
    const notePreview = noteText
        ? escapeHtml(noteText)
        : '<span class="de-note-empty">–</span>';
    html += `<div class="de-c de-cell de-note-cell" onclick="selectDailyEventsDate('${dateKey}')"><div class="de-note-preview">${notePreview}</div></div>`;
    html += `</div>`;
    return html;
}

// En-tête à 2 niveaux, sur la même grille de colonnes que les lignes. Un tag 'tristate' couvre
// 2 colonnes au niveau 1 et porte Oui / Non au niveau 2 ; tout autre mode couvre les 2 niveaux.
// Case Date : un SEUL bouton de navigation (retour à aujourd'hui) — le reste se fait en faisant
// défiler. Grisé quand on est déjà tout en haut.
// Texte de l'info-bulle d'un tag (tap sur son en-tête) : pris à la SOURCE (BUILTIN_EVENT_TAGS, dans la
// langue courante) pour un tag builtin ; repli sur le texte stocké pour un tag qui n'y figure pas.
function getDailyEventTagTip(tg) {
    const def = BUILTIN_EVENT_TAGS.find(d => d.id === tg.id);
    const src = def && def.description;
    return (src && (src[settings.lang] || src.fr)) || tg.description || '';
}

// Case-libellé d'un tag : fond = couleur GLOBALE du tag (getEventTagColor, la même que la pastille
// active des lignes), texte blanc. Un futur tag sans couleur propre retombe sur la couleur par défaut.
function buildDailyEventsHeaderHTML(tags, isAtTop) {
    // Sans tag 'tristate' actif, l'en-tête n'a qu'UN niveau (pas de ligne Oui / Non à prévoir).
    const rows = tags.some(tg => tg.mode === 'tristate') ? '1 / span 2' : '1';
    let col = 2; // numéro de colonne CSS (1 = Date)
    let html = `<div class="de-h de-h-corner" style="grid-row:${rows};grid-column:1"><button class="de-today-btn" onclick="goToDailyEventsToday()" title="${t('dailyEventsBackToToday')}"${isAtTop ? ' disabled' : ''}>${t('dailyEventsTodayBtn')}</button></div>`;
    tags.forEach(tg => {
        const bg = `background:${getEventTagColor(tg.id)}`;
        // Info-bulle : tap (mobile, voir showDailyEventsTip) + attribut title (survol sur ordinateur).
        const tip = getDailyEventTagTip(tg);
        const tipAttrs = tip ? ` data-tag-id="${escapeHtml(tg.id)}" title="${escapeHtml(tip)}"` : '';
        const tipCls = tip ? ' de-h-tip' : '';
        if (tg.mode === 'tristate') {
            html += `<div class="de-h de-h-tag${tipCls}"${tipAttrs} style="grid-row:1;grid-column:${col} / span 2;${bg}">${escapeHtml(tg.label)}</div>`;
            html += `<div class="de-h" style="grid-row:2;grid-column:${col}">${t('eventStateYes')}</div>`;
            html += `<div class="de-h" style="grid-row:2;grid-column:${col + 1}">${t('eventStateNo')}</div>`;
            col += 2;
        } else {
            html += `<div class="de-h de-h-tag${tipCls}"${tipAttrs} style="grid-row:${rows};grid-column:${col};${bg}">${escapeHtml(tg.label)}</div>`;
            col += 1;
        }
    });
    // Colonne Note — toujours en dernier, hors boucle des tags (ce n'est pas un event).
    html += `<div class="de-h de-h-note" style="grid-row:${rows};grid-column:${col}">${t('dailyEventsNoteHeader')}</div>`;
    return html;
}

// Info-bulle d'un en-tête d'événement : une seule à la fois, sous la case tapée. Se ferme au tap
// ailleurs, en retapant la même case, au défilement ou après DAILY_EVENTS_TIP_MS.
function hideDailyEventsTip() {
    clearTimeout(window._dailyEventsTipTimer);
    window.dailyEventsTipTagId = null;
    const tip = document.getElementById('daily-events-tip');
    if (tip) tip.style.display = 'none';
}

function showDailyEventsTip(cell) {
    const overlay = document.getElementById('daily-events-overlay');
    const tg = settings.eventTags.find(x => x.id === cell.dataset.tagId);
    const text = tg ? getDailyEventTagTip(tg) : '';
    if (!overlay || !text) return;
    let tip = document.getElementById('daily-events-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'daily-events-tip';
        overlay.appendChild(tip);
    }
    tip.textContent = text; // texte brut : jamais interprété comme HTML
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    const o = overlay.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const left = Math.max(8, Math.min(c.left + c.width / 2 - tip.offsetWidth / 2 - o.left, o.width - tip.offsetWidth - 8));
    tip.style.left = left + 'px';
    tip.style.top = (c.bottom - o.top + 6) + 'px';
    tip.style.visibility = 'visible';
    window.dailyEventsTipTagId = cell.dataset.tagId;
    clearTimeout(window._dailyEventsTipTimer);
    window._dailyEventsTipTimer = setTimeout(hideDailyEventsTip, DAILY_EVENTS_TIP_MS);
}

// Rendu COMPLET : en-tête, largeur et modèle de colonnes, puis fenêtre de lignes. À utiliser à
// l'ouverture et quand les libellés changent (langue) ; pas pour une saisie. Ne touche pas à la
// position de défilement. Sans effet tant que l'overlay n'a jamais été ouvert.
function renderDailyEventsTable() {
    if (!window.dailyEventsToday) return;
    const grid = document.getElementById('daily-events-grid');
    const head = document.getElementById('daily-events-head');
    const scroller = document.getElementById('daily-events-scroll');
    if (!grid || !head || !scroller) return;

    const titleEl = document.getElementById('daily-events-title');
    if (titleEl) titleEl.textContent = t('dailyEventsTitle');
    const noteField = document.getElementById('daily-events-note-textarea');
    if (noteField) noteField.placeholder = t('dailyEventsNotePlaceholder');
    hideDailyEventsTip();

    // Largeurs posées d'après les tags actifs : un tag 'tristate' occupe 2 colonnes, tout autre mode 1
    // seule. Seule la colonne Date est MESURÉE (une fois par rendu complet, voir
    // measureDailyEventsDateColW ; repli DAILY_EVENTS_COL_DATE_W si 0) — les autres sont des constantes.
    // Seule la colonne Note est élastique (1fr entre son min et son max) ; la grille remplit l'écran
    // dans les bornes [colonnes fixes + min, colonnes fixes + max] et ne déborde (défilement
    // horizontal) que si l'écran est plus étroit que le minimum.
    const tags = settings.eventTags.filter(tg => tg.active);
    const hasTristate = tags.some(tg => tg.mode === 'tristate');
    const dateW = measureDailyEventsDateColW(document.getElementById('daily-events-overlay'), getDailyEventsRenderContext()) || DAILY_EVENTS_COL_DATE_W;
    let template = `${dateW}px`;
    let dataCols = 0;
    tags.forEach(tg => {
        const n = tg.mode === 'tristate' ? 2 : 1;
        dataCols += n;
        template += ` repeat(${n}, ${DAILY_EVENTS_COL_TAG_W}px)`;
    });
    template += ` minmax(${DAILY_EVENTS_COL_NOTE_MIN_W}px, 1fr)`;
    const fixedW = dateW + dataCols * DAILY_EVENTS_COL_TAG_W;
    grid.style.minWidth = (fixedW + DAILY_EVENTS_COL_NOTE_MIN_W) + 'px';
    grid.style.maxWidth = (fixedW + DAILY_EVENTS_COL_NOTE_MAX_W) + 'px';
    grid.style.setProperty('--de-cols', template);
    grid.style.setProperty('--de-row-h', DAILY_EVENTS_ROW_H + 'px');
    // En-tête : 1 niveau (44 px) sans tristate, 2 niveaux (32 + 28 = 60 px) sinon. Hauteurs figées.
    grid.style.setProperty('--de-head-h', (hasTristate ? DAILY_EVENTS_HEAD_H_TRISTATE : DAILY_EVENTS_HEAD_H) + 'px');
    grid.style.setProperty('--de-head-rows', hasTristate ? '32px 28px' : DAILY_EVENTS_HEAD_H + 'px');

    head.innerHTML = buildDailyEventsHeaderHTML(tags, scroller.scrollTop <= 1);
    renderDailyEventsWindow(true);
}

// Dessine la fenêtre de lignes autour de la 1ère ligne visible (scrollTop ÷ hauteur de ligne : le
// corps commence juste sous l'en-tête sticky, qui reste épinglé en haut du conteneur). N'y touche
// pas tant que cette ligne reste dans la zone de confort de la fenêtre déjà dessinée (hystérésis
// MARGIN_LOW / MARGIN_HIGH), sauf si force. Prolonge la zone défilable au besoin, jamais l'inverse.
// Aucune mesure de géométrie : tout vient de constantes.
function renderDailyEventsWindow(force) {
    const scroller = document.getElementById('daily-events-scroll');
    const body = document.getElementById('daily-events-body');
    if (!scroller || !body || !window.dailyEventsToday) return;

    const first = Math.floor(Math.max(0, scroller.scrollTop) / DAILY_EVENTS_ROW_H);
    const from0 = window.dailyEventsWinFrom;
    const outOfZone = window.dailyEventsWinTo <= from0
        || (from0 > 0 && first < from0 + DAILY_EVENTS_MARGIN_LOW)
        || first > from0 + DAILY_EVENTS_MARGIN_HIGH;
    if (!force && !outOfZone) return;

    const from = Math.max(0, first - DAILY_EVENTS_RECENTER);
    const to = from + DAILY_EVENTS_WINDOW_ROWS;
    while (to + DAILY_EVENTS_EXTEND_MARGIN > window.dailyEventsTotalRows) {
        window.dailyEventsTotalRows += DAILY_EVENTS_EXTEND_ROWS;
    }
    body.style.height = (window.dailyEventsTotalRows * DAILY_EVENTS_ROW_H) + 'px';

    const ctx = getDailyEventsRenderContext();
    let html = '';
    for (let i = from; i < to; i++) html += buildDailyEventsRowHTML(i, ctx);
    body.innerHTML = html;
    window.dailyEventsWinFrom = from;
    window.dailyEventsWinTo = to;
}

// Remplace UNE seule ligne (celle de ce jour) — point de rafraîchissement local après une saisie.
// Sans effet si la ligne n'est pas dans la fenêtre dessinée : elle sera correcte à son prochain dessin.
function refreshDailyEventsRow(dateKey) {
    const row = dailyEventsRowForDateKey(dateKey); // valide aussi le format de dateKey (sélecteur sûr)
    const body = document.getElementById('daily-events-body');
    if (row === null || !body) return;
    const el = body.querySelector(`[data-date="${dateKey}"]`);
    if (!el) return;
    el.outerHTML = buildDailyEventsRowHTML(row, getDailyEventsRenderContext());
}

// Bouton « Aujourd'hui » : grisé quand on est déjà tout en haut.
function updateDailyEventsTodayButton() {
    const scroller = document.getElementById('daily-events-scroll');
    const btn = document.querySelector('#daily-events-head .de-today-btn');
    if (scroller && btn) btn.disabled = scroller.scrollTop <= 1;
}

// Rang de la ligne la plus proche du haut (celle qui sera recalée sous l'en-tête).
function dailyEventsTopRow() {
    const scroller = document.getElementById('daily-events-scroll');
    return scroller ? Math.max(0, Math.round(scroller.scrollTop / DAILY_EVENTS_ROW_H)) : 0;
}

// Écouteur de défilement : au plus un traitement par image (requestAnimationFrame). Le redessin de
// la fenêtre n'a lieu que lorsqu'on sort de la zone de confort ; le reste est léger (un texte).
function onDailyEventsScroll() {
    if (window._dailyEventsRaf) return;
    window._dailyEventsRaf = requestAnimationFrame(() => {
        window._dailyEventsRaf = 0;
        renderDailyEventsWindow(false);
        updateDailyEventsTodayButton();
        updateDailyEventsLiveDay();
        scheduleDailyEventsSettle();
        if (window.dailyEventsTipTagId) hideDailyEventsTip();
    });
}

// Date du panneau en direct. Seul le texte de la date change ; la note (champ) reste celle du jour
// chargé, grisée et verrouillée tant que la ligne du haut est un autre jour.
function updateDailyEventsLiveDay() {
    const key = dailyEventsDateKey(dailyEventsDateForRow(dailyEventsTopRow()));
    if (key !== window.dailyEventsLiveDate) setDailyNotePanelDate(key);
    setDailyNotePanelMoving(key !== window.dailyEventsNoteDate);
}

// Recalage : armé à chaque événement de défilement (le délai repart de zéro) et au relâchement du
// doigt. Ne fait rien tant que le doigt / la souris est posé (il sera réarmé au relâchement).
function scheduleDailyEventsSettle() {
    clearTimeout(window._dailyEventsSettleTimer);
    window._dailyEventsSettleTimer = setTimeout(settleDailyEvents, DAILY_EVENTS_SETTLE_MS);
}

function dailyEventsReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function settleDailyEvents() {
    window._dailyEventsSettleTimer = 0;
    const scroller = document.getElementById('daily-events-scroll');
    const overlay = document.getElementById('daily-events-overlay');
    if (!scroller || !overlay || overlay.style.display === 'none' || !window.dailyEventsToday) return;
    if (window.dailyEventsFingerDown) return;
    const row = dailyEventsTopRow();
    const target = row * DAILY_EVENTS_ROW_H;
    // Tolérance 0,5 px : sur écran à densité fractionnaire, scrollTop ne peut pas toujours valoir
    // exactement rang × 44 ; sans elle le recalage bouclerait.
    if (Math.abs(scroller.scrollTop - target) > 0.5) {
        if (scroller.scrollTo) scroller.scrollTo({ top: target, behavior: dailyEventsReducedMotion() ? 'auto' : 'smooth' });
        else scroller.scrollTop = target;
        return; // les événements de défilement suivants réarment le recalage ; la note sera chargée à l'arrivée
    }
    commitDailyEventsRow(row);
}

// Charge dans le panneau la note du jour de rang `row` (devenu ligne du haut). Si c'est déjà le
// jour chargé, seule la date affichée est resynchronisée : le champ n'est PAS réécrit (curseur).
function commitDailyEventsRow(row) {
    const key = dailyEventsDateKey(dailyEventsDateForRow(row));
    if (key === window.dailyEventsNoteDate) {
        setDailyNotePanelDate(key);
        setDailyNotePanelMoving(false);
        return;
    }
    window.dailyEventsNoteDate = key;
    renderDailyNotePanel();
    setDailyNotePanelMoving(false);
}

// Amène un jour en haut ET charge sa note tout de suite (tap sur date/note, « Aujourd'hui »,
// sélecteur de date). Sans effet pour une date invalide ou future.
function selectDailyEventsDate(dateKey) {
    const row = dailyEventsRowForDateKey(dateKey);
    if (row === null) return;
    const scroller = document.getElementById('daily-events-scroll');
    const cur = dailyEventsTopRow();
    // Jour proche : glissement doux (sauf « réduire les animations »). Il passe par le suivi en direct
    // et le recalage ordinaires : la note est chargée à l'arrivée, rien de spécial à gérer ici.
    if (row !== cur && Math.abs(row - cur) <= DAILY_EVENTS_GLIDE_ROWS && scroller && scroller.scrollTo && !dailyEventsReducedMotion()) {
        scroller.scrollTo({ top: row * DAILY_EVENTS_ROW_H, behavior: 'smooth' });
        return;
    }
    scrollDailyEventsToDate(dateKey);
    commitDailyEventsRow(row);
}

// Sélecteur de date natif du panneau (input type=date transparent posé sur la date affichée).
function onDailyEventsDatePicked(input) {
    if (input.value && dailyEventsRowForDateKey(input.value) !== null) selectDailyEventsDate(input.value);
    else setDailyNotePanelDate(window.dailyEventsNoteDate); // vide ou futur : on garde le jour chargé
}

// Certains navigateurs de bureau n'ouvrent le calendrier qu'au clic sur l'icône du champ.
function openDailyEventsDatePicker(input) {
    try { if (input.showPicker) input.showPicker(); } catch (e) { /* ouverture native seule */ }
}

// Amène la ligne de cette date en 1ère position sous l'en-tête (scrollTop = rang × hauteur).
// La zone défilable est d'abord prolongée pour couvrir la cible, sinon le navigateur bornerait
// scrollTop.
function scrollDailyEventsToDate(dateKey) {
    const scroller = document.getElementById('daily-events-scroll');
    const body = document.getElementById('daily-events-body');
    const row = dailyEventsRowForDateKey(dateKey);
    if (!scroller || !body || row === null) return;
    window.dailyEventsTotalRows = Math.max(window.dailyEventsTotalRows, row + DAILY_EVENTS_EXTEND_ROWS);
    body.style.height = (window.dailyEventsTotalRows * DAILY_EVENTS_ROW_H) + 'px';
    scroller.scrollTop = row * DAILY_EVENTS_ROW_H;
    renderDailyEventsWindow(true);
    updateDailyEventsTodayButton();
}

// Bouton « Aujourd'hui » : retour tout en haut ; aujourd'hui devient le jour édité.
function goToDailyEventsToday() {
    if (!window.dailyEventsToday) return;
    selectDailyEventsDate(dailyEventsDateKey(window.dailyEventsToday));
}

function openDailyEventsOverlay() {
    const overlay = document.getElementById('daily-events-overlay');
    if (!overlay) return;
    // Rang 0 = aujourd'hui, figé à l'ouverture (un tableau laissé ouvert au-delà de minuit garde
    // l'ancien « aujourd'hui » jusqu'à la réouverture). L'overlay s'ouvre toujours sur aujourd'hui.
    const n = new Date();
    window.dailyEventsToday = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    window.dailyEventsTotalRows = DAILY_EVENTS_INITIAL_ROWS;
    window.dailyEventsWinFrom = 0;
    window.dailyEventsWinTo = 0;
    // Panneau de note : réinitialisé sur aujourd'hui (= ligne du haut, scrollTop 0) à l'OUVERTURE.
    // Ensuite le jour chargé est toujours la ligne du haut, voir settleDailyEvents().
    window.dailyEventsNoteDate = dailyEventsDateKey(window.dailyEventsToday);
    window.dailyEventsLiveDate = null;
    window.dailyEventsFingerDown = false;
    clearTimeout(window._dailyEventsSettleTimer);
    overlay.style.display = 'flex';
    const scroller = document.getElementById('daily-events-scroll');
    if (scroller) {
        if (!window._dailyEventsScrollBound) {
            scroller.addEventListener('scroll', onDailyEventsScroll, { passive: true });
            // Doigt / souris posé : pas de recalage sous le doigt. touchcancel : le navigateur
            // reprend le geste (fin du contrôle JS, l'élan continue et réarme le recalage).
            const down = () => { window.dailyEventsFingerDown = true; };
            const up = () => { window.dailyEventsFingerDown = false; scheduleDailyEventsSettle(); };
            scroller.addEventListener('touchstart', down, { passive: true });
            scroller.addEventListener('mousedown', down, { passive: true });
            scroller.addEventListener('touchend', up, { passive: true });
            scroller.addEventListener('touchcancel', up, { passive: true });
            window.addEventListener('mouseup', () => { if (window.dailyEventsFingerDown) up(); }, { passive: true });
            // Info-bulle des en-têtes d'événement : tap sur la case (même case = fermer), tap ailleurs = fermer.
            const head = document.getElementById('daily-events-head');
            if (head) head.addEventListener('click', ev => {
                const cell = ev.target.closest('[data-tag-id]');
                if (!cell) { hideDailyEventsTip(); return; }
                if (window.dailyEventsTipTagId === cell.dataset.tagId) hideDailyEventsTip(); else showDailyEventsTip(cell);
            });
            overlay.addEventListener('pointerdown', ev => {
                if (window.dailyEventsTipTagId && !ev.target.closest('[data-tag-id]')) hideDailyEventsTip();
            }, true);
            // Tentative de dépasser 80 : l'événement précède l'insertion (que maxlength bloque en silence
            // sur ordinateur) — sert seulement à allumer le compteur, jamais à bloquer la frappe.
            const noteTa = document.getElementById('daily-events-note-textarea');
            if (noteTa) noteTa.addEventListener('beforeinput', ev => {
                if (ev.inputType && ev.inputType.indexOf('insert') === 0
                    && noteTa.value.length - (noteTa.selectionEnd - noteTa.selectionStart) >= DAILY_NOTE_MAX) flashDailyNoteLimit();
            });
            window._dailyEventsScrollBound = true;
        }
        scroller.scrollTop = 0;
    }
    const pick = document.getElementById('daily-events-date-input');
    if (pick) pick.max = window.dailyEventsNoteDate; // pas de jour futur
    renderDailyNotePanel();
    renderDailyEventsTable();
}

function closeDailyEventsOverlay() {
    const overlay = document.getElementById('daily-events-overlay');
    if (overlay) overlay.style.display = 'none';
    clearTimeout(window._dailyEventsSettleTimer);
    window.dailyEventsFingerDown = false;
    hideDailyEventsTip();
}

// Rafraîchit toute vue actuellement affichée qui dépend des événements journaliers —
// Résultats (si l'onglet est actif) et/ou ce tableau (s'il est ouvert). Point d'appel
// unique partagé par toggleEventTristate()/toggleEventPresence(), pour ne jamais dupliquer
// cette logique à chaque nouveau point de saisie (page Mesure, tableau, futurs écrans...).
// dateKey : jour modifié → seule sa ligne du tableau est remplacée ; sans dateKey → rendu complet.
function refreshDailyEventUIs(dateKey) {
    if (document.getElementById('page-results').classList.contains('active')) renderResults();
    const overlay = document.getElementById('daily-events-overlay');
    if (overlay && overlay.style.display !== 'none') {
        if (dateKey) refreshDailyEventsRow(dateKey); else renderDailyEventsTable();
    }
}

// Note libre du jour — champ frère de 'events' (pas un event), même convention que
// conçue dès le chantier : deux champs indépendants, ni l'un ni l'autre obligatoire.
function getDailyNote(dateKey) {
    return dailyData[dateKey]?.text || '';
}

// Écrit la note (limite 80 — déjà imposée par maxlength du <textarea>, garde-fou ici en
// plus) ; retire la clé 'text' si le texte est vide, retire toute la clé du jour si elle
// ne contient plus ni note ni events (même nettoyage que toggleEventPresence()).
function setDailyNote(dateKey, text) {
    const clean = text.slice(0, DAILY_NOTE_MAX);
    const day = dailyData[dateKey] || (dailyData[dateKey] = {});
    if (clean) day.text = clean; else delete day.text;
    if ((!day.events || day.events.length === 0) && !day.text) delete dailyData[dateKey];
    saveDailyData();
}

// Affiche une date dans le panneau (texte, valeur du sélecteur, libellé accessible) SANS toucher au
// champ de note : sert au suivi en direct pendant le défilement. Texte visible en LARGEUR FIXE
// (monospace) : « ma  6 oct. 2026 » = jour de semaine sur 2 lettres + le même format que la date de
// fin d'Évolution (formatEvolutionEndDateFixed : jour sur 2, mois sur 4, année sur 4) — rien ne
// « saute » pendant le défilement. Le libellé accessible garde la date complète en toutes lettres.
function setDailyNotePanelDate(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
    const label = document.getElementById('daily-events-note-date');
    if (!m || !label) return;
    const loc = getLocale();
    if (!window._dailyPanelFmt || window._dailyPanelFmtLocale !== loc) {
        window._dailyPanelFmt = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        window._dailyPanelWeekdayFmt = new Intl.DateTimeFormat(loc, { weekday: 'short' });
        window._dailyPanelFmtLocale = loc;
    }
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const longText = window._dailyPanelFmt.format(d);
    label.textContent = `${dailyEventsWeekday2(d, window._dailyPanelWeekdayFmt)} ${formatEvolutionEndDateFixed(d)}`;
    window.dailyEventsLiveDate = dateKey;
    const pick = document.getElementById('daily-events-date-input');
    if (pick) { pick.value = dateKey; pick.setAttribute('aria-label', longText.charAt(0).toUpperCase() + longText.slice(1)); }
}

// Panneau « en mouvement » : la ligne du haut n'est pas (encore) le jour dont la note est chargée.
// Champ grisé et en lecture seule (aucune frappe sur le mauvais jour), clavier fermé.
function setDailyNotePanelMoving(on) {
    if (window.dailyEventsMoving === on) return;
    window.dailyEventsMoving = on;
    const panel = document.getElementById('daily-events-note-panel');
    const ta = document.getElementById('daily-events-note-textarea');
    if (panel) panel.classList.toggle('de-moving', on);
    if (ta) {
        ta.readOnly = on;
        if (on && document.activeElement === ta) ta.blur();
    }
}

// Reconstruit tout le panneau (date + contenu du textarea) — appelée uniquement au
// changement de jour édité (ouverture de l'overlay, commitDailyEventsRow()), JAMAIS à chaque
// frappe : réécrire ta.value pendant la saisie ferait sauter la position du curseur.
function renderDailyNotePanel() {
    const dateKey = window.dailyEventsNoteDate;
    if (!dateKey) return;
    setDailyNotePanelDate(dateKey);
    const ta = document.getElementById('daily-events-note-textarea');
    ta.value = getDailyNote(dateKey);
    updateDailyNoteCounter(ta.value.length);
    // Chargement d'un jour (pas une frappe) : compteur toujours gris.
    clearTimeout(window._dailyNoteLimitTimer);
    const cnt = document.getElementById('daily-events-note-counter');
    if (cnt) cnt.classList.remove('de-limit-hit');
    clearTimeout(window._dailyNoteSaveTimer);
    const ind = document.getElementById('daily-events-note-saved');
    // Contenu déjà celui enregistré (on vient de le recharger depuis dailyData) — indicateur
    // affiché immédiatement, pas de délai nécessaire dans ce cas précis (pas une frappe en cours).
    if (ind) { ind.textContent = t('dailyEventsNoteSaved'); ind.style.visibility = 'visible'; }
}

// Compteur « n/80 ». Il ne change de couleur que pendant la saisie à la limite (flashDailyNoteLimit).
function updateDailyNoteCounter(len) {
    const el = document.getElementById('daily-events-note-counter');
    if (el) el.textContent = `${len}/${DAILY_NOTE_MAX}`;
}

// Compteur en ambre (compatible avec le beige) tant qu'on tape ou tente de taper à la limite, puis retour
// au gris après DAILY_NOTE_INDICATOR_MS (même délai que « Enregistré »). Aucun message, aucun cadre.
function flashDailyNoteLimit() {
    const el = document.getElementById('daily-events-note-counter');
    if (!el) return;
    el.classList.add('de-limit-hit');
    clearTimeout(window._dailyNoteLimitTimer);
    window._dailyNoteLimitTimer = setTimeout(() => el.classList.remove('de-limit-hit'), DAILY_NOTE_INDICATOR_MS);
}

// À chaque frappe : sauvegarde immédiate en mémoire/localStorage (comme partout ailleurs
// dans l'app — aucune notion de "brouillon non enregistré"), mise à jour du compteur, et
// l'indicateur "Enregistré" n'apparaît qu'après un court silence de frappe (jamais à chaque
// caractère, pour ne pas clignoter) — voir scheduleDailyNoteSavedIndicator(). Seule la ligne du
// jour édité est rafraîchie, pour que l'aperçu de la case Note reste à jour, mais PAS le panneau
// lui-même (renderDailyNotePanel() réécrirait ta.value et ferait sauter le curseur pendant la saisie).
function onDailyNoteInput(el) {
    // Filet UNIVERSEL, quel que soit le clavier : maxlength seul laisse les claviers à suggestions
    // (composition d'un mot, ex. Samsung) dépasser 80 jusqu'à la validation du mot. On coupe donc
    // ici, tout de suite, en gardant le curseur — sans jamais couper une paire de substitution
    // (emoji). Le champ n'est réécrit QUE s'il dépasse (jamais en frappe normale : le curseur ne saute pas).
    if (el.value.length > DAILY_NOTE_MAX) {
        let end = DAILY_NOTE_MAX;
        const c = el.value.charCodeAt(end - 1);
        if (c >= 0xD800 && c <= 0xDBFF) end--;
        const caret = Math.min(el.selectionStart, end);
        el.value = el.value.slice(0, end);
        el.setSelectionRange(caret, caret);
    }
    if (el.value.length >= DAILY_NOTE_MAX) flashDailyNoteLimit();
    setDailyNote(window.dailyEventsNoteDate, el.value);
    updateDailyNoteCounter(el.value.length);
    scheduleDailyNoteSavedIndicator();
    refreshDailyEventsRow(window.dailyEventsNoteDate);
}

function scheduleDailyNoteSavedIndicator() {
    const ind = document.getElementById('daily-events-note-saved');
    if (!ind) return;
    ind.style.visibility = 'hidden'; // masqué pendant la frappe — jamais de clignotement par caractère
    clearTimeout(window._dailyNoteSaveTimer);
    window._dailyNoteSaveTimer = setTimeout(() => {
        ind.textContent = t('dailyEventsNoteSaved');
        ind.style.visibility = 'visible';
    }, DAILY_NOTE_INDICATOR_MS);
}