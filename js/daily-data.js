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
            fr: "Malaise post-effort en cours",
            en: "Post-exertional malaise ongoing",
            nl: "Post-exertionele malaise aan de gang"
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
            fr: "Malade (agent infectieux)",
            en: "Sick (infectious agent)",
            nl: "Ziek (infectieus agens)"
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
            fr: "Jour globalement correct ou bon",
            en: "Overall a fine or good day",
            nl: "Over het algemeen een goede of prima dag"
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
    refreshDailyEventUIs();
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
    refreshDailyEventUIs();
}


// ============================================================
// 20c. TABLEAU ÉVÉNEMENTS JOURNALIERS (chantier notes/événements, Passe 2)
// Overlay portrait plein écran, ouvert depuis la page Mesure (#btn-daily-events).
// Générique par tag actif (tous modes confondus) : 'tristate' occupe 2 colonnes (Oui/Non),
// tout autre mode (ex. 'presence') en occupe 1 seule — un futur tag apparaît ici sans code
// supplémentaire. Le mode 'tristate' reste géré ici pour un usage futur éventuel, mais
// aucun tag actif ne l'utilise actuellement (les 3 tags builtin sont tous en 'presence').
// Défilement natif (CSS position:sticky, voir <style>) — pas de geste personnalisé en V1.
// Fenêtre affichée : toujours 2 mois civils pleins (mois ANCRE + le mois qui le précède),
// jamais plus. Plus de barre de navigation en haut de l'overlay (retirée) : la seule
// navigation temporelle passe par les 3 flèches de la case d'en-tête Date du tableau, qui
// déplacent la fenêtre par pas de 2 mois. Titre statique "Saisie journalière" à la place.
// ============================================================

window.dailyEventsMonth = null; // Mois ANCRE (1er du mois, le plus récent des 2 mois affichés) — initialisé à l'ouverture

function openDailyEventsOverlay() {
    const overlay = document.getElementById('daily-events-overlay');
    if (!overlay) return;
    if (!window.dailyEventsMonth) {
        const n = new Date();
        window.dailyEventsMonth = new Date(n.getFullYear(), n.getMonth(), 1);
    }
    // Panneau de note : toujours réinitialisé sur aujourd'hui à l'OUVERTURE de l'overlay —
    // persiste ensuite tant qu'il reste ouvert (y compris à travers la navigation de mois),
    // jusqu'à un nouveau tap explicite sur la colonne Date ou Note du tableau.
    const n2 = new Date();
    window.dailyEventsNoteDate = `${n2.getFullYear()}-${(n2.getMonth() + 1).toString().padStart(2, '0')}-${n2.getDate().toString().padStart(2, '0')}`;
    overlay.style.display = 'flex';
    renderDailyNotePanel();
    renderDailyEventsTable();
}

function closeDailyEventsOverlay() {
    const overlay = document.getElementById('daily-events-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Déplace le mois ancre — appelée avec delta=±2 (voir les 3 flèches de la case Date,
// renderDailyEventsTable()) : la fenêtre affichée avance/recule toujours par paire de mois.
function navigateDailyEventsMonth(delta) {
    const m = window.dailyEventsMonth;
    window.dailyEventsMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
    renderDailyEventsTable();
    const scroll = document.getElementById('daily-events-scroll');
    if (scroll) scroll.scrollTop = 0;
}

// Retour à la fenêtre par défaut : mois courant (ancre) + mois précédent.
function goToDailyEventsToday() {
    const n = new Date();
    window.dailyEventsMonth = new Date(n.getFullYear(), n.getMonth(), 1);
    renderDailyEventsTable();
    const scroll = document.getElementById('daily-events-scroll');
    if (scroll) scroll.scrollTop = 0;
}

// Rafraîchit toute vue actuellement affichée qui dépend des événements journaliers —
// Résultats (si l'onglet est actif) et/ou ce tableau (s'il est ouvert). Point d'appel
// unique partagé par toggleEventTristate()/toggleEventPresence(), pour ne jamais dupliquer
// cette logique à chaque nouveau point de saisie (page Mesure, tableau, futurs écrans...).
function refreshDailyEventUIs() {
    if (document.getElementById('page-results').classList.contains('active')) renderResults();
    const overlay = document.getElementById('daily-events-overlay');
    if (overlay && overlay.style.display !== 'none') renderDailyEventsTable();
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
    const clean = text.slice(0, 80);
    const day = dailyData[dateKey] || (dailyData[dateKey] = {});
    if (clean) day.text = clean; else delete day.text;
    if ((!day.events || day.events.length === 0) && !day.text) delete dailyData[dateKey];
    saveDailyData();
}

// Change le jour actuellement chargé dans le panneau de note — appelée par un tap sur la
// colonne Date ou la colonne Note du tableau (jamais sur une case d'événement, qui sert déjà
// à activer/désactiver — voir renderDailyEventsTable()).
function editDailyNoteFor(dateKey) {
    window.dailyEventsNoteDate = dateKey;
    renderDailyNotePanel();
    renderDailyEventsTable();
}

// Reconstruit tout le panneau (date + contenu du textarea) — appelée uniquement au
// changement de jour édité (ouverture de l'overlay, editDailyNoteFor()), JAMAIS à chaque
// frappe : réécrire ta.value pendant la saisie ferait sauter la position du curseur.
function renderDailyNotePanel() {
    const dateKey = window.dailyEventsNoteDate;
    if (!dateKey) return;
    const [y, mo, da] = dateKey.split('-').map(Number);
    const d = new Date(y, mo - 1, da);
    const rawDateLabel = d.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('daily-events-note-date').textContent =
        rawDateLabel.charAt(0).toUpperCase() + rawDateLabel.slice(1);
    const ta = document.getElementById('daily-events-note-textarea');
    ta.value = getDailyNote(dateKey);
    updateDailyNoteCounter(ta.value.length);
    clearTimeout(window._dailyNoteSaveTimer);
    const ind = document.getElementById('daily-events-note-saved');
    // Contenu déjà celui enregistré (on vient de le recharger depuis dailyData) — indicateur
    // affiché immédiatement, pas de délai nécessaire dans ce cas précis (pas une frappe en cours).
    if (ind) { ind.textContent = t('dailyEventsNoteSaved'); ind.style.visibility = 'visible'; }
}

function updateDailyNoteCounter(len) {
    const el = document.getElementById('daily-events-note-counter');
    if (el) el.textContent = `${len}/80`;
}

// À chaque frappe : sauvegarde immédiate en mémoire/localStorage (comme partout ailleurs
// dans l'app — aucune notion de "brouillon non enregistré"), mise à jour du compteur, et
// l'indicateur "Enregistré" n'apparaît qu'après un court silence de frappe (jamais à chaque
// caractère, pour ne pas clignoter) — voir scheduleDailyNoteSavedIndicator(). Le tableau est
// rafraîchi pour que l'aperçu de la case Note reste à jour, mais PAS le panneau lui-même
// (renderDailyNotePanel() réécrirait ta.value et ferait sauter le curseur pendant la saisie).
function onDailyNoteInput(el) {
    setDailyNote(window.dailyEventsNoteDate, el.value);
    updateDailyNoteCounter(el.value.length);
    scheduleDailyNoteSavedIndicator();
    renderDailyEventsTable();
}

function scheduleDailyNoteSavedIndicator() {
    const ind = document.getElementById('daily-events-note-saved');
    if (!ind) return;
    ind.style.visibility = 'hidden'; // masqué pendant la frappe — jamais de clignotement par caractère
    clearTimeout(window._dailyNoteSaveTimer);
    window._dailyNoteSaveTimer = setTimeout(() => {
        ind.textContent = t('dailyEventsNoteSaved');
        ind.style.visibility = 'visible';
    }, 600);
}

function renderDailyEventsTable() {
    const table = document.getElementById('daily-events-table');
    if (!table) return;

    const titleEl = document.getElementById('daily-events-title');
    if (titleEl) titleEl.textContent = t('dailyEventsTitle');

    const anchor = window.dailyEventsMonth; // mois le plus récent des 2 affichés
    const prevAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1); // mois qui le précède, toujours affiché avec lui
    const tags = settings.eventTags.filter(tg => tg.active);
    const locale = getLocale();
    const editDate = window.dailyEventsNoteDate; // jour actuellement chargé dans le panneau de note

    // Navigation bornée au mois courant côté futur (on ne journalise pas l'avenir) — aucune
    // borne côté passé, contrairement à Historique/Résultats : cet outil n'est pas lié aux
    // périodes enregistrées, un jour sans période reste journalisable.
    const todayMidnight = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    const isAnchorCurrentMonth = (anchor.getFullYear() === todayMidnight.getFullYear() && anchor.getMonth() === todayMidnight.getMonth());

    // --- En-tête à 2 niveaux ---
    // Case Date : 3 flèches compactes plutôt que le mot "Date" — SEULE navigation temporelle
    // du tableau (voir commentaire de section) : ↓ recule la fenêtre de 2 mois (toujours
    // actif), ↑ avance de 2 mois (masqué si la fenêtre affiche déjà le mois courant, rien à
    // avancer), ⬆ retour direct à la fenêtre par défaut (masqué dans le même cas).
    let thead = '<thead><tr>';
    thead += `<th class="de-col-date" rowspan="2"><div class="de-col-date-buttons">
                <button class="de-nav-mini-btn" onclick="navigateDailyEventsMonth(-2)" title="${t('dailyEventsPrevMonth')}">↓</button>
                <button class="de-nav-mini-btn" onclick="navigateDailyEventsMonth(2)" ${isAnchorCurrentMonth ? 'disabled' : ''} title="${t('dailyEventsNextMonth')}">↑</button>
                <button class="de-nav-mini-btn" onclick="goToDailyEventsToday()" ${isAnchorCurrentMonth ? 'disabled' : ''} title="${t('dailyEventsBackToToday')}">⬆</button>
            </div></th>`;
    let totalDataCols = 0;
    tags.forEach(tg => {
        if (tg.mode === 'tristate') { thead += `<th colspan="2">${escapeHtml(tg.label)}</th>`; totalDataCols += 2; }
        else { thead += `<th rowspan="2">${escapeHtml(tg.label)}</th>`; totalDataCols += 1; }
    });
    // Colonne Note — toujours en dernier, hors boucle des tags (ce n'est pas un event).
    thead += `<th rowspan="2">${t('dailyEventsNoteHeader')}</th>`;
    const totalCols = 1 /* date */ + totalDataCols /* tags */ + 1 /* note */;
    thead += '</tr><tr>';
    tags.forEach(tg => {
        if (tg.mode === 'tristate') thead += `<th>${t('eventStateYes')}</th><th>${t('eventStateNo')}</th>`;
    });
    thead += '</tr></thead>';

    // --- Corps : un bloc par mois affiché (toujours 2 : ancre + précédent), chacun précédé
    // d'une ligne séparatrice purement informative (nom du mois des jours qui suivent,
    // jamais cliquable — voir CSS .de-month-separator). Jours du plus récent au plus ancien
    // à l'intérieur d'un même mois, plafonné à aujourd'hui uniquement pour le mois qui EST
    // le mois civil courant (jamais de jour futur, même principe que pour les périodes).
    function buildMonthBlock(monthDate) {
        const isThisCalendarMonth = (monthDate.getFullYear() === todayMidnight.getFullYear() && monthDate.getMonth() === todayMidnight.getMonth());
        const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
        const lastDay = isThisCalendarMonth ? todayMidnight.getDate() : daysInMonth;

        const rawLabel = monthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        const monthLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        let html = `<tr class="de-month-separator"><td colspan="${totalCols}">${escapeHtml(monthLabel)}</td></tr>`;

        for (let day = lastDay; day >= 1; day--) {
            const d = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
            const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            const isWeekend = [0, 6].includes(d.getDay());
            const isToday = d.getTime() === todayMidnight.getTime();
            const isEditing = dateKey === editDate;
            const rowClass = (isToday ? ' de-today' : '') + (isEditing ? ' de-row-editing' : '');
            const dateClass = 'de-col-date' + rowClass;
            const formattedDateRaw = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
            // Opacité réduite du weekend — restreinte au texte de la date lui-même (span
            // dédié), jamais à toute la cellule : sinon elle assombrirait aussi le cadre de
            // sélection (tr.de-row-editing) quand les deux se superposent un jour de weekend.
            const formattedDate = isWeekend ? `<span class="de-weekend-text">${formattedDateRaw}</span>` : formattedDateRaw;
            // Cellule "Aujourd'hui" sur 2 lignes (mot-clé + date complète), pour repérer le
            // jour courant d'un coup d'œil sans avoir à lire/comparer la date affichée.
            const dateContent = isToday
                ? `<div class="de-today-label">${t('dailyEventsToday')}</div><div>${formattedDate}</div>`
                : formattedDate;
            html += `<tr class="${isEditing ? 'de-row-editing' : ''}">`;
            // Date : tapable pour ouvrir/charger la note de ce jour dans le panneau (jamais les
            // cases d'événement, qui servent déjà à activer/désactiver — voir décision projet).
            html += `<td class="${dateClass}" onclick="editDailyNoteFor('${dateKey}')">${dateContent}</td>`;
            tags.forEach(tg => {
                if (tg.mode === 'tristate') {
                    const val = getDailyEventValue(dateKey, tg.id);
                    html += `<td class="de-cell${rowClass}" onclick="toggleEventTristate('${dateKey}','${tg.id}','yes')"><div class="de-cell-inner"><div class="de-dot${val === 'yes' ? ' de-active-yes' : ''}"></div></div></td>`;
                    html += `<td class="de-cell${rowClass}" onclick="toggleEventTristate('${dateKey}','${tg.id}','no')"><div class="de-cell-inner"><div class="de-dot${val === 'no' ? ' de-active-no' : ''}"></div></div></td>`;
                } else {
                    // Couleur GLOBALE par tag (EVENT_TAG_COLORS), pas par mode — reconnaissable et
                    // différente des couleurs de type. Appliquée en style inline (pas de classe CSS
                    // par tagId à maintenir), seulement quand la case est active.
                    const on = getDailyEventPresence(dateKey, tg.id);
                    const color = getEventTagColor(tg.id);
                    const dotStyle = on ? ` style="background:${color};border-color:${color};"` : '';
                    html += `<td class="de-cell${rowClass}" onclick="toggleEventPresence('${dateKey}','${tg.id}')"><div class="de-cell-inner"><div class="de-dot"${dotStyle}></div></div></td>`;
                }
            });
            // Case Note — texte tel quel si présent (jamais tronqué, plafonné à 2 lignes visuelles
            // par CSS -webkit-line-clamp), "Pas de note" en gris sinon. Tap = ouvre/charge la note
            // de ce jour dans le panneau (même action que le tap sur la date).
            const noteText = getDailyNote(dateKey);
            const notePreview = noteText
                ? escapeHtml(noteText)
                : `<span class="de-note-empty">${t('dailyEventsNoteEmpty')}</span>`;
            html += `<td class="de-cell de-note-cell${rowClass}" onclick="editDailyNoteFor('${dateKey}')"><div class="de-note-preview">${notePreview}</div></td>`;
            html += `</tr>`;
        }
        return html;
    }

    let tbody = '<tbody>';
    tbody += buildMonthBlock(anchor);
    tbody += buildMonthBlock(prevAnchor);
    tbody += '</tbody>';

    table.innerHTML = thead + tbody;
}

