
// ============================================================
// 0b. CAPTURE PRÉCOCE DE L'ÉVÉNEMENT D'INSTALLATION PWA
// Posé tôt car beforeinstallprompt peut survenir dès le chargement.
// preventDefault() systématique : c'est toujours notre UI (splash / bouton
// Réglages) qui pilote l'installation, jamais le bandeau natif du navigateur.
// La référence n'est utilisable qu'une fois — window.deferredInstallPrompt
// est remis à null après usage (prompt() consommé) ou après installation effective.
// ============================================================
window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    console.log('[Install] beforeinstallprompt capturé');
});
window.addEventListener('appinstalled', () => {
    window.deferredInstallPrompt = null;
    console.log('[Install] App installée (appinstalled)');
    // sendNewUserInstalledOnce définie plus bas (hissée) — callable ici sans problème.
    sendNewUserInstalledOnce();
    // Détection réelle, fiable pour toute la famille Chromium (tier A ou B, peu importe
    // comment l'installation a été déclenchée) — voir showInstallSplashConfirmation().
    showInstallSplashConfirmation('AB');
});

// ============================================================
// 1c. DÉTECTION INSTALLATION PWA — appareil et disponibilité
// isPWAInstalled() et isIOSDevice() sont déjà définies plus bas dans ce fichier
// (section notifications) — les déclarations de fonction sont hissées (hoisting),
// donc utilisables ici sans problème.
// ============================================================

// Vrai pour un smartphone/tablette, faux pour un ordinateur.
// Signal principal : pointeur imprécis (doigt) sans possibilité de survol —
// un laptop tactile a un trackpad (hover:hover) et est donc traité comme "ordinateur".
function isHandheldDevice() {
    if (window.matchMedia('(pointer: coarse)').matches
        && window.matchMedia('(hover: none)').matches) return true;
    if (isIOSDevice()) return true; // couvre l'iPad, qui échappe parfois aux media queries ci-dessus
    return /Mobi|Android/i.test(navigator.userAgent);
}

// Détecte le navigateur intégré réel via inapp-spy (bibliothèque vendorisée, licence MIT
// — voir inapp-spy.js et le <script> qui la charge). Couvre Facebook, Messenger, Instagram,
// Twitter/X, LinkedIn, TikTok, Snapchat, LINE, WeChat, Threads, GSA, WhatsApp, Reddit et
// Telegram (détection par mécanisme séparé, pas une regex), + repli générique pour toute
// webview non nommément identifiée (isInApp:true, appKey:undefined). Retourne toujours un
// objet — {isInApp:false} si la bibliothèque n'a pas pu charger (ne devrait pas arriver).
function detectInAppBrowser() {
    if (typeof window.InAppSpy !== 'function') return { isInApp: false };
    return window.InAppSpy();
}

// Nom d'affichage de l'app détectée, pour les textes génériques ("{appName}" dans les
// traductions) — repli neutre si webview générique non identifiée nommément.
function getInAppBrowserName() {
    const info = detectInAppBrowser();
    return info.appName || t('installWebviewGenericName');
}

// Vrai dans N'IMPORTE QUEL navigateur intégré connu (WebView "in-app browser" d'un réseau
// social) — ni le prompt natif Android ni "Sur l'écran d'accueil" iOS n'y fonctionnent,
// quelle que soit la plateforme sous-jacente ou l'app en cause. Nom conservé tel quel
// (Facebook reste la référence "historique" et la plus immédiatement reconnaissable dans
// le code) même si la détection sous-jacente est désormais généralisée (inapp-spy) — voir
// detectInAppBrowser() ci-dessus. Traité à part de A/B/C/D (voir tier 'F', généralisé lui
// aussi — voir getInstallTier()).
function isFacebookInAppBrowser() {
    return detectInAppBrowser().isInApp;
}

// Détermine le canal navigateur pour les events GoatCounter (NewUser-browser-*/-webview-*,
// DailyUser-browser-*/-webview-*) — appelée uniquement quand on sait déjà que ce n'est pas
// un cas "installed" (voir les appelants). Un tag dédié par app connue d'inapp-spy (liste
// complète, coût quasi nul si jamais déclenché) ; Chrome/Safari détectés par signature UA
// (pas d'API dédiée) ; "browser-Other" regroupe les vrais navigateurs alternatifs (Firefox,
// Edge, Samsung Internet...) — distinct de "webview-*" qui couvre les apps sociales.
const INAPP_GOATCOUNTER_TAGS = {
    facebook: 'Facebook', messenger: 'Messenger', instagram: 'Instagram',
    twitter: 'Twitter', linkedin: 'LinkedIn', tiktok: 'TikTok', snapchat: 'Snapchat',
    line: 'Line', wechat: 'WeChat', threads: 'Threads', gsa: 'GSA',
    whatsapp: 'WhatsApp', reddit: 'Reddit', telegram: 'Telegram'
};

function detectNewUserChannel() {
    const inapp = detectInAppBrowser();
    if (inapp.isInApp) {
        return 'webview-' + (INAPP_GOATCOUNTER_TAGS[inapp.appKey] || 'Other');
    }
    const ua = navigator.userAgent;
    // Ordre important : Brave, Samsung Internet et Opera se font tous passer pour Chrome
    // dans leur user-agent (compatibilité web) — doivent être testés avant le test Chrome
    // générique. Brave en particulier ne peut PAS être détecté par user-agent du tout :
    // seule la présence de l'objet navigator.brave le trahit (vérification synchrone
    // suffisante ici, pas besoin d'attendre sa méthode asynchrone isBrave() — recommandation
    // officielle Brave : https://github.com/brave/brave-browser/wiki/Detecting-Brave-(for-Websites)).
    if (typeof navigator.brave !== 'undefined') return 'browser-Brave';
    if (/SamsungBrowser/.test(ua)) return 'browser-Samsung';
    if (/OPR\/|Opera/.test(ua)) return 'browser-Opera';
    if (/Firefox|FxiOS/.test(ua)) return 'browser-Firefox';
    if (/Chrome|CriOS|Chromium/.test(ua) && !/Edg\//.test(ua)) return 'browser-Chrome';
    if (/Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg\//.test(ua)) return 'browser-Safari';
    return 'browser-Other'; // notamment Edge, navigateurs non identifiés
}

// Compteur "NewUser-installed" — capture toute installation du point de vue utilisateur,
// peu importe le mécanisme technique sous-jacent (qui varie par plateforme, pas par choix
// utilisateur) : premier lancement directement en mode installé (iOS, si le stockage
// n'est pas partagé avec Safari) OU confirmation appinstalled (Android/Chromium,
// conversion depuis le navigateur). Flag anti-doublon : un seul envoi, peu importe lequel
// des deux déclencheurs arrive en premier.
function sendNewUserInstalledOnce() {
    if (localStorage.getItem('newUserInstalledSent')) return;
    localStorage.setItem('newUserInstalledSent', '1');
    if (navigator.onLine) sendToGoatCounter('NewUser-installed');
}

// Détermine le "tier" d'installation disponible :
//   'F' — n'importe quel navigateur intégré connu (Facebook, Reddit, WhatsApp, Instagram,
//         etc. — voir detectInAppBrowser()/isFacebookInAppBrowser()) : aucune installation
//         possible depuis ce contexte, quelle que soit la plateforme — priorité sur tout
//         le reste (voir checkFacebookBrowserBlock()). La lettre 'F' reste inchangée par
//         commodité (Facebook = cas le plus reconnaissable/historique dans le code), même
//         si la détection sous-jacente couvre désormais bien plus large.
//   'A' — prompt natif capturé (beforeinstallprompt) → un clic suffit
//   'B' — famille Chromium (Chrome/Edge/Samsung Internet...) mais prompt pas
//         encore capturé → instructions manuelles via le menu du navigateur
//   'C' — iOS Safari → instructions Partager → Sur l'écran d'accueil
//   'D' — aucun chemin identifié (ex. Firefox Android) → pas de bouton one-clic ;
//         le bouton Réglages propose alors d'ouvrir le lien dans Chrome
function getInstallTier() {
    if (isFacebookInAppBrowser()) return 'F';
    if (isIOSDevice()) return 'C';
    const ua = navigator.userAgent;
    const isChromiumFamily = /Chrome|Chromium|Edg\//.test(ua) && !/Firefox/i.test(ua);
    if (isChromiumFamily) {
        return window.deferredInstallPrompt ? 'A' : 'B';
    }
    return 'D';
}

const INSTALL_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours entre deux rappels (tiers A/B)
const INSTALL_INTENSIVE_PERIOD_DAYS = 14; // fin de la période "insistante" (tiers C/D)
const INSTALL_INTENSIVE_INTERVAL_DAYS = 3; // cadence pendant cette période, après J1→J2 quotidien

// Détermine si le splash doit être affiché à ce lancement, selon le tier.
// A/B (Chromium) : cycle premier lancement + rappel 7 jours, inchangé.
// C/D (export+import requis pour changer de voie) : plus insistant en tout début
// d'usage — jour 1 et jour 2 systématiques, puis tous les 3 jours pendant 2 semaines,
// puis rejoint le cycle standard à 7 jours. Jamais deux fois le même jour civil.
function shouldShowSplashForTier(tier) {
    if (tier === 'A' || tier === 'B') {
        if (window.isFirstEverLaunch) return true;
        const lastDismiss = parseInt(localStorage.getItem('installPromptLastDismissAt') || '0', 10);
        if (!lastDismiss) return true;
        return (Date.now() - lastDismiss) >= INSTALL_REMINDER_INTERVAL_MS;
    }

    const todayStr = new Date().toDateString();
    const lastShownStr = localStorage.getItem('installPromptLastShownDay');
    if (lastShownStr === todayStr) return false; // jamais deux fois le même jour civil
    if (!lastShownStr) return true; // jamais montré — couvre le tout premier affichage

    const firstDateStr = localStorage.getItem('installFirstLaunchDate') || todayStr;
    const daysSinceFirst = Math.round((new Date(todayStr) - new Date(firstDateStr)) / 86400000);
    const daysSinceLastShown = Math.round((new Date(todayStr) - new Date(lastShownStr)) / 86400000);

    let requiredInterval;
    if (daysSinceFirst <= 1) requiredInterval = 1; // jour 1 et jour 2 : tous les jours
    else if (daysSinceFirst <= INSTALL_INTENSIVE_PERIOD_DAYS) requiredInterval = INSTALL_INTENSIVE_INTERVAL_DAYS;
    else requiredInterval = 7; // rejoint le cycle standard

    return daysSinceLastShown >= requiredInterval;
}

// Enregistre la fermeture du splash (quel que soit le bouton pressé) — sert de base
// au rappel à 7 jours. Un seul point d'appel pour toutes les issues du splash.
function recordInstallPromptDismiss() {
    localStorage.setItem('installPromptLastDismissAt', Date.now().toString());
}

// ============================================================
// 1d. SPLASH D'INSTALLATION PWA (Bloc 3)
// Construit dynamiquement au moment de l'affichage — jamais présent dans le DOM
// sinon. Pas encore appelé automatiquement au démarrage (voir Bloc 4 — séquencement
// avec checkMessages()) ; testable manuellement via showInstallSplash() en console.
// ============================================================

const INSTALL_SPLASH_SHOW_SLOGAN = true; // passer à false pour retirer le slogan sans autre changement
const INSTALL_EXPORT_MIN_PERIODS = 5;
const INSTALL_EXPORT_MIN_MINUTES = 10;

// Icône générique "Partager" (flèche sortant d'un cadre) — convention d'interface
// universelle, pas un logo propriétaire. currentColor hérite de l'opacité du texte parent.
const INSTALL_SHARE_ICON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-left:2px;"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`;

// Vrai si on doit suggérer un export CSV avant d'installer (tier C / iOS) —
// condition combinée pour éviter de le proposer après quelques clics de test.
// Sert aussi désormais de déclencheur pour le paragraphe de contexte du Splash 1
// (remplace l'ancienne logique basée sur premier lancement/rappel).
function shouldSuggestExportBeforeInstall() {
    const periods = state.history.length;
    if (periods < INSTALL_EXPORT_MIN_PERIODS) return false;
    const totalMs = state.history.reduce((sum, e) => sum + (e.end - e.start), 0);
    return (totalMs / 60000) >= INSTALL_EXPORT_MIN_MINUTES;
}

function showInstallSplash() {
    if (document.getElementById('install-splash')) return; // déjà affiché
    const tier = getInstallTier();
    if (tier === 'F') {
        // Ne devrait jamais arriver ici — tout navigateur intégré est intercepté en amont, dans
        // checkAndShowInstallSplash(), avant même l'appel à cette fonction.
        console.warn('[Install] showInstallSplash() appelé en tier F — voir checkFacebookBrowserBlock()');
        return;
    }

    // Base de la cadence par jour civil (tiers C/D uniquement — voir shouldShowSplashForTier()).
    if (tier === 'C' || tier === 'D') {
        localStorage.setItem('installPromptLastShownDay', new Date().toDateString());
    }

    const overlay = document.createElement('div');
    overlay.id = 'install-splash';
    overlay.innerHTML = `
                <div id="install-splash-inner">
                    <img id="install-splash-logo" src="icon-192.png" alt="">
                    <div id="install-splash-appname">${APP_NAME}</div>
                    ${INSTALL_SPLASH_SHOW_SLOGAN ? `<div id="install-splash-slogan">${t('installSplashSlogan')}</div>` : ''}
                    <div id="install-splash-body"></div>
                </div>
            `;
    document.body.appendChild(overlay);

    // Splash 1 unifié pour A/B/C — même écran partout, seule la cible du clic diffère
    // (voir renderInstallSplashButtonScreen()). Tier D a son propre écran dédié
    // (renderInstallSplashTierD()) : pas de bouton d'installation possible, juste un
    // lien à copier — pas un blocage comme pour un navigateur intégré, Firefox reste un choix légitime.
    if (tier === 'D') {
        renderInstallSplashTierD();
    } else {
        renderInstallSplashButtonScreen();
    }
    console.log(`[Install] Splash affiché — variante:${window.isFirstEverLaunch ? 'premier lancement' : 'rappel'} tier:${tier}`);
}

// Tier D (ex. Firefox) — écran informatif unique, pas de bouton d'installation possible.
// Contrairement à un navigateur intégré : pas un blocage, juste l'absence de voie d'installation —
// "continuer dans ce navigateur" reste donc une sortie pleinement légitime.
function renderInstallSplashTierD() {
    const body = document.getElementById('install-splash-body');
    if (!body) return;

    const sloganEl = document.getElementById('install-splash-slogan');
    if (sloganEl) sloganEl.style.display = INSTALL_SPLASH_SHOW_SLOGAN ? '' : 'none';

    const isReminder = !window.isFirstEverLaunch;
    const showContext = shouldSuggestExportBeforeInstall();
    const blankLine = '<div class="install-splash-context-line">&nbsp;</div>';
    const contextHTML = showContext
        ? `${blankLine}<div id="install-splash-reminder-text">${t('installSplashReminderText')}</div>${blankLine}`
        : blankLine.repeat(6);

    body.innerHTML = `
                <div id="install-splash-context">${contextHTML}</div>
                <div class="install-splash-instructions">
                    <p style="font-weight:bold;">${t('installTierDText')}</p>
                    <p style="font-size:0.85rem; font-weight:normal; font-family:monospace; opacity:0.8; word-break:break-all;">${getCleanInstallUrl()}</p>
                    <button class="export-btn" style="margin-top:8px;" id="install-splash-copy-btn"
                        onclick="copyInstallLinkFromSplash()">${t('installCopyLinkBtn')}</button>
                </div>
                <div id="install-splash-dismiss" onclick="closeInstallSplash()">${isReminder ? t('installSplashDismissReminder') : t('installSplashDismissFirst')}</div>
            `;
}

// Copie dédiée au splash (distincte de copyInstallLink() en Réglages, qui cible un
// autre bouton) — best-effort, échoue silencieusement selon le contexte.
async function copyInstallLinkFromSplash() {
    try {
        await navigator.clipboard.writeText(getCleanInstallUrl());
        const btn = document.getElementById('install-splash-copy-btn');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = t('installLinkCopied');
            setTimeout(() => { btn.textContent = original; }, 2000);
        }
    } catch (e) {
        console.warn('[Install] Copie du lien échouée :', e);
    }
}


// Splash 1 — écran commun A/B/C. Le paragraphe de contexte n'apparaît que si
// shouldSuggestExportBeforeInstall() est vrai (données réelles en jeu), plus lié au
// cycle premier lancement/rappel. Espace réservé (#install-splash-context) même vide,
// pour que la position du logo/nom en haut et du bouton en bas ne bouge pas.
function renderInstallSplashButtonScreen() {
    const body = document.getElementById('install-splash-body');
    if (!body) return;
    const tier = getInstallTier();
    const isReminder = !window.isFirstEverLaunch;
    const showContext = shouldSuggestExportBeforeInstall();
    // Tier C : le clic mène toujours directement aux instructions (jamais de prompt natif
    // possible sur iOS). Tier A/B : décision réelle au clic, voir handleInstallButtonClick().
    const onClick = tier === 'C' ? "renderInstallSplashInstructions('C')" : 'handleInstallButtonClick()';

    // Slogan uniquement sur ce premier écran — masqué sur Splash 2/3 (voir ces fonctions).
    // Restauré ici au cas où on revient via "Retour".
    const sloganEl = document.getElementById('install-splash-slogan');
    if (sloganEl) sloganEl.style.display = INSTALL_SPLASH_SHOW_SLOGAN ? '' : 'none';

    // Espace réservé : 1 ligne vide + texte + 1 ligne vide si affiché,
    // sinon 6 lignes vides équivalentes — même hauteur totale dans les deux cas,
    // pour que le bouton en dessous ne bouge jamais.
    const blankLine = '<div class="install-splash-context-line">&nbsp;</div>';
    const contextHTML = showContext
        ? `${blankLine}<div id="install-splash-reminder-text">${t('installSplashReminderText')}</div>${blankLine}`
        : blankLine.repeat(6);

    body.innerHTML = `
                <div id="install-splash-context">${contextHTML}</div>
                <div id="install-splash-cta-area">
                    <button class="export-btn" onclick="${onClick}">${t('installTierAButton')}</button>
                </div>
                <div id="install-splash-dismiss" onclick="closeInstallSplash()">${isReminder ? t('installSplashDismissReminder') : t('installSplashDismissFirst')}</div>
            `;
}

// Splash 2 — instructions, toujours atteint depuis Splash 1 (bouton). "Retour" y ramène
// (pas de dismiss enregistré, navigation interne). Tier C ajoute un second bouton
// "J'ai pu suivre ces instructions" qui mène au Splash 3 auto-déclaré — aucune détection
// automatique n'existant sur iOS. Plus d'export CSV ici : déplacé au Splash 3 (désencombre).
// Construit le bloc "titre + étapes" — partagé entre le splash plein écran et la carte
// Réglages. Le contenu ne vit qu'ici ; chaque appelant garde sa propre mise en scène
// autour (plein écran vs carte compacte, export en ligne ou non), pour que le contenu
// ne puisse plus diverger entre les deux comme c'est arrivé par le passé.
// Tier F retiré d'ici — géré par buildInstallWebviewPathsHTML() (voir section 1e),
// structure différente (deux chemins bleus + bouton/délai Android), pas réutilisable
// avec le format "un seul cadre" de cette fonction.
function buildInstallStepsHTML(tier) {
    if (tier === 'C') {
        return `
                    <div class="install-splash-steps">
                        <p>${t('installStepsHeading')}</p>
                        <div>- ${t('installTierCStep1')} ${INSTALL_SHARE_ICON_SVG}</div>
                        <div>- ${t('installTierCStep2')}</div>
                        <div>- ${t('installTierCStep3')}</div>
                    </div>`;
    }
    // Tier B (par défaut)
    return `
                <div class="install-splash-steps">
                    <p>${t('installStepsHeading')}</p>
                    <div>- ${t('installTierBStep1')}</div>
                    <div>- ${t('installTierBStep2')}</div>
                </div>`;
}

function renderInstallSplashInstructions(tier) {
    const body = document.getElementById('install-splash-body');
    if (!body) return;

    // Slogan réservé au Splash 1 uniquement.
    const sloganEl = document.getElementById('install-splash-slogan');
    if (sloganEl) sloganEl.style.display = 'none';

    const confirmBtn = tier === 'C'
        ? `<button class="export-btn" style="margin:0 0 10px 0;" onclick="renderInstallSplashConfirmationBody('C')">${t('installConfirmSelfReportBtn')}</button>`
        : '';

    body.innerHTML = `
                <div class="install-splash-instructions">
                    ${buildInstallStepsHTML(tier)}
                </div>
                ${confirmBtn}
                <div id="install-splash-dismiss" onclick="renderInstallSplashButtonScreen()">${t('installSplashBack')}</div>
            `;
}

// Splash 3 — confirmation. variant 'C' = auto-déclaré (iOS, aucune détection possible),
// variant 'AB' = confirmé automatiquement via appinstalled (voir écouteur global).
// showInstallSplashConfirmation() crée l'overlay s'il n'existe pas déjà (cas 'AB' déclenché
// hors de tout flux splash en cours, ex. installation via le menu du navigateur).
function showInstallSplashConfirmation(variant) {
    let overlay = document.getElementById('install-splash');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'install-splash';
        overlay.innerHTML = `
                    <div id="install-splash-inner">
                        <img id="install-splash-logo" src="icon-192.png" alt="">
                        <div id="install-splash-appname">${APP_NAME}</div>
                        <div id="install-splash-body"></div>
                    </div>
                `;
        document.body.appendChild(overlay);
    }
    renderInstallSplashConfirmationBody(variant);
}

function renderInstallSplashConfirmationBody(variant) {
    const body = document.getElementById('install-splash-body');
    if (!body) return;

    // Slogan réservé au Splash 1 uniquement (pertinent si on arrive ici depuis le
    // Splash 2 dans le même overlay — le cas variant 'AB' frais n'en crée pas).
    const sloganEl = document.getElementById('install-splash-slogan');
    if (sloganEl) sloganEl.style.display = 'none';

    let exportBox = '';
    if (variant === 'C' && shouldSuggestExportBeforeInstall()) {
        exportBox = `
                    <div class="install-splash-export-box">
                        <p>${t('installTierCExportText', { n: state.history.length })}</p>
                        <button class="export-btn"
                            style="background:rgba(255,180,0,0.1); color:#ffcc55; border:1px solid rgba(255,180,0,0.5);"
                            onclick="exportJSON()">${t('installTierCExportBtn')}</button>
                    </div>`;
    }

    // Tier C : ramène au Splash 1, où se trouve déjà le vrai lien "continuer dans le
    // navigateur" — pas besoin d'un second mécanisme de fermeture distinct.
    // Tier AB : fermeture directe, revenir à un Splash 1 "navigateur" n'aurait pas de sens
    // puisque l'installation vient d'aboutir.
    const closeAction = variant === 'C' ? 'renderInstallSplashButtonScreen()' : 'closeInstallSplashConfirmation()';
    const closeLabel = variant === 'C' ? t('installSplashBack') : t('btnClose');

    body.innerHTML = `
                <div class="install-splash-instructions">
                    <p>${variant === 'C' ? t('installConfirmTextIOS') : t('installConfirmTextAB')}</p>
                    ${exportBox}
                </div>
                <div id="install-splash-dismiss" onclick="${closeAction}">${closeLabel}</div>
            `;
    console.log(`[Install] Splash 3 (confirmation) affiché — variante:${variant}`);
}

// Pas de checkMessages() ici, volontairement — cohérent avec l'idée que l'utilisateur
// passera par l'app installée à partir de maintenant, quel que soit le chemin emprunté.
function closeInstallSplashConfirmation() {
    const overlay = document.getElementById('install-splash');
    if (overlay) overlay.remove();
}

// skipMessages : true si l'installation vient d'être acceptée — dans ce cas, on ne
// montre plus rien dans cet onglet navigateur, l'utilisateur est censé basculer vers
// l'app installée à partir de maintenant. Sinon, showStartupToasts() prend le relais :
// toasts puis message JSON, dans cet ordre — le splash reste toujours prioritaire.
function closeInstallSplash(skipMessages) {
    recordInstallPromptDismiss();
    const overlay = document.getElementById('install-splash');
    if (overlay) overlay.remove();
    if (!skipMessages) showStartupToasts();
}

// Clic sur le bouton "Installer" (tier A ou B uniquement — tier C ne passe jamais ici,
// voir renderInstallSplashButtonScreen()). La décision se prend ici, au tout dernier
// moment, pas au rendu du splash.
async function handleInstallButtonClick() {
    if (window.deferredInstallPrompt) {
        await triggerNativeInstallPrompt(); // gère aussi la fermeture du splash
        return;
    }
    // Toujours pas de prompt natif disponible au moment du clic → écran instructions,
    // "Retour" pour revenir à l'écran bouton (pas de dismiss enregistré ici).
    renderInstallSplashInstructions('B');
    console.log('[Install] Clic sans prompt natif disponible — repli instructions manuelles');
}

// Déclenche le prompt natif — appelée uniquement quand window.deferredInstallPrompt
// existe déjà (voir handleInstallButtonClick()). La référence n'est utilisable qu'une
// fois, elle est remise à null juste après quel que soit le choix de l'utilisateur.
async function triggerNativeInstallPrompt() {
    if (!window.deferredInstallPrompt) {
        console.warn('[Install] Aucune référence beforeinstallprompt disponible');
        closeInstallSplash();
        return;
    }
    window.deferredInstallPrompt.prompt();
    let accepted = false;
    try {
        const choice = await window.deferredInstallPrompt.userChoice;
        console.log(`[Install] Choix utilisateur : ${choice.outcome}`);
        accepted = choice.outcome === 'accepted';
    } catch (e) {
        console.warn('[Install] Erreur lors du prompt natif :', e);
    }
    window.deferredInstallPrompt = null;
    closeInstallSplash(accepted);
}

// ============================================================
// 1e. NAVIGATEUR INTÉGRÉ FACEBOOK (tier F)
// Flux entièrement séparé du splash A/B/C/D — pas de cycle premier lancement/rappel,
// pas de bouton "Retour". Deux cas selon la présence de données réelles (même seuil
// que shouldSuggestExportBeforeInstall(), même question au fond) :
//   - pas de données significatives → blocage total, systématique, aucune fermeture
//   - données réelles → avertissement + tentative export, une fois par jour calendaire,
//     fermeture via "Continuer quand même" (choix légitime, pas un pis-aller)
// Appelé tout en haut de la séquence de démarrage, avant checkMessages() — voir section 23.
// ============================================================

// Construit le bloc "deux chemins de sortie" (Chemin A : menu navigateur, Chemin B :
// copier/coller le lien) — partagé entre le blocage plein écran, l'avertissement
// (Cas 2) et la carte Réglages.
// withFallbackDelay : true → sur Android, affiche d'abord le bouton d'ouverture
//   automatique seul, et ne révèle les deux chemins qu'après échec (voir
//   handleAndroidAutoEscapeClick()). false → chemins affichés directement, sans
//   bouton (carte Réglages, plus simple par choix — voir Handoff).
// Sur iOS, jamais de bouton ni de délai : les chemins sont toujours affichés
// directement (aucune tentative d'ouverture automatique possible sur iOS).
function buildInstallWebviewPathsHTML(withFallbackDelay) {
    const step2 = isIOSDevice() ? t('installFBPathAStep2IOS') : t('installFBPathAStep2Android');
    const pasteStep = isIOSDevice() ? t('installFBPathBStep2IOS') : t('installFBPathBStep2Android');

    const pathsHTML = `
                <div class="install-splash-steps">
                    <div>- ${t('installFBPathAStep1')}</div>
                    <div>- ${step2}</div>
                </div>
                <div style="text-align:center; opacity:0.6; margin:6px 0;">${t('installFBOr')}</div>
                <div class="install-splash-steps">
                    <div>- <span class="install-link-word" onclick="copyWebviewLink(this)">${t('installFBCopyLinkWord')}</span> ${t('installFBPathBIntro')}</div>
                    <div style="font-size:0.85rem; font-weight:normal; font-family:monospace; opacity:0.8; word-break:break-all; margin-top:4px;">${getCleanInstallUrl()}</div>
                    <div style="margin-top:6px;">- ${pasteStep}</div>
                </div>`;

    if (!withFallbackDelay || isIOSDevice()) return pathsHTML;

    return `
                <button class="export-btn" style="margin-bottom:10px;" onclick="handleAndroidAutoEscapeClick()">${t('installWebviewAutoEscapeBtn')}</button>
                <div id="install-fb-fallback" style="display:none;">
                    <p style="font-weight:bold; margin-bottom:8px;">${t('installFBFallbackLabel')}</p>
                    ${pathsHTML}
                </div>`;
}

// Clic sur le bouton d'ouverture automatique (Android) — lance la tentative intent://,
// puis révèle les chemins manuels seulement si la page est toujours visible après un
// court délai (si l'ouverture a réussi, la page passe normalement en arrière-plan
// avant ce délai, et visibilitychange annule le fallback).
function handleAndroidAutoEscapeClick() {
    attemptAndroidAutoEscape();

    const fallbackTimer = setTimeout(() => {
        document.removeEventListener('visibilitychange', onHiddenAfterEscape);
        const fallback = document.getElementById('install-fb-fallback');
        if (fallback) fallback.style.display = 'block';
    }, 3000);

    function onHiddenAfterEscape() {
        if (document.visibilityState === 'hidden') {
            clearTimeout(fallbackTimer);
            document.removeEventListener('visibilitychange', onHiddenAfterEscape);
        }
    }
    document.addEventListener('visibilitychange', onHiddenAfterEscape);
}

// Copie l'URL de la page depuis le mot cliquable inline du Chemin B — best-effort,
// feedback affiché directement sur l'élément cliqué. Variante générique de
// copyInstallLinkFromSplash()/copyInstallLink(), réutilisable à chaque endroit où
// ce chemin apparaît (blocage, avertissement, carte Réglages).
async function copyWebviewLink(el) {
    try {
        await navigator.clipboard.writeText(getCleanInstallUrl());
        const original = el.textContent;
        el.textContent = t('installLinkCopied');
        setTimeout(() => { el.textContent = original; }, 2000);
    } catch (e) {
        console.warn('[Install] Copie du lien échouée :', e);
    }
}

function showFacebookBrowserBlock() {
    if (document.getElementById('install-splash')) return;
    const appName = getInAppBrowserName();
    const browserName = isIOSDevice() ? 'Safari' : 'Chrome';
    const overlay = document.createElement('div');
    overlay.id = 'install-splash';
    overlay.innerHTML = `
                <div id="install-splash-inner">
                    <img id="install-splash-logo" src="icon-192.png" alt="">
                    <div id="install-splash-appname">${APP_NAME}</div>
                    <div id="install-splash-body">
                        <div class="install-splash-instructions">
                            <p>${t('installFBIntro', { appName, browserName })}</p>
                            ${buildInstallWebviewPathsHTML(true)}
                        </div>
                    </div>
                </div>
            `;
    // Pas de lien de fermeture ici — blocage volontairement sans issue de contournement.
    document.body.appendChild(overlay);
    console.log(`[Install] Blocage navigateur intégré affiché (${appName}, pas de données significatives)`);

    // DÉPANNAGE VOLONTAIREMENT CONSERVÉ : 7 taps sur l'icône pour contourner le blocage
    // (ce blocage étant volontairement sans issue, c'est la seule sortie de secours, utile
    // notamment pour tester l'export manuel). À documenter comme tel — ne pas retirer
    // sans décision explicite.
    attachFacebookBlockDebugBypass();
}

function attachFacebookBlockDebugBypass() {
    const logo = document.getElementById('install-splash-logo');
    if (!logo) return;
    let tapCount = 0;
    let tapTimer = null;
    logo.addEventListener('click', () => {
        tapCount++;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
        if (tapCount >= 7) {
            tapCount = 0;
            console.warn('[DEBUG TEST] 7 taps — fermeture forcée du blocage navigateur intégré (bypass temporaire de test)');
            const overlay = document.getElementById('install-splash');
            if (overlay) overlay.remove();
        }
    });
}

// Cas 2 (données existantes) — deux écrans, comme les autres tiers : avertissement
// (renderFacebookWarningScreen) puis export dédié (renderFacebookExportScreen),
// accessible via "Transférer mes données déjà enregistrées". showFacebookBrowserWarning()
// crée l'overlay une seule fois, les deux fonctions de rendu se relaient dans le même corps.
function showFacebookBrowserWarning() {
    if (document.getElementById('install-splash')) return;
    const overlay = document.createElement('div');
    overlay.id = 'install-splash';
    overlay.innerHTML = `
                <div id="install-splash-inner">
                    <img id="install-splash-logo" src="icon-192.png" alt="">
                    <div id="install-splash-appname">${APP_NAME}</div>
                    <div id="install-splash-body"></div>
                </div>
            `;
    document.body.appendChild(overlay);
    renderFacebookWarningScreen();
}

function renderFacebookWarningScreen() {
    const body = document.getElementById('install-splash-body');
    if (!body) return;
    const appName = getInAppBrowserName();
    const browserName = isIOSDevice() ? 'Safari' : 'Chrome';
    body.innerHTML = `
                <div class="install-splash-instructions">
                    <p>${t('installFBIntro', { appName, browserName })}</p>
                    ${buildInstallWebviewPathsHTML(true)}
                </div>
                <div class="install-splash-link" onclick="renderFacebookExportScreen()">${t('installFBTransferData')}</div>
                <div class="install-splash-link" onclick="closeFacebookBrowserWarning()">${t('installFBTempReturn', { appName })}</div>
            `;
    console.log(`[Install] Avertissement navigateur intégré affiché (${appName}, données existantes)`);
}

function renderFacebookExportScreen() {
    const body = document.getElementById('install-splash-body');
    if (!body) return;
    const appName = getInAppBrowserName();
    body.innerHTML = `
                <div class="install-splash-instructions">
                    <div class="install-splash-export-box" style="margin-top:0; padding-top:0; border-top:none;">
                        <p>${t('installFBExportText', { n: state.history.length, appName })}</p>
                        <button class="export-btn"
                            style="background:rgba(255,180,0,0.1); color:#ffcc55; border:1px solid rgba(255,180,0,0.5);"
                            onclick="exportCSV()">${t('installFBExportBtn')}</button>
                    </div>
                </div>
                <div class="install-splash-link" onclick="renderFacebookWarningScreen()">${t('installSplashBack')}</div>
            `;
    console.log(`[Install] Écran export navigateur intégré affiché (${appName})`);
}

// Fermeture dédiée — volontairement séparée de closeInstallSplash() : ce flux n'a
// aucun lien avec le cycle de rappel du splash d'installation standard.
function closeFacebookBrowserWarning() {
    const overlay = document.getElementById('install-splash');
    if (overlay) overlay.remove();
}

// Fonction pure (aucun effet de bord) — permet à checkFacebookBrowserBlock() et au
// diagnostic (debugInstallState()) de partager exactement la même règle de cadence,
// sans dupliquer la logique ni risquer une divergence entre les deux.
function shouldShowFacebookWarningToday() {
    return localStorage.getItem('installFBWarningLastShownDay') !== new Date().toDateString();
}

// Tentative de sortie automatique du navigateur intégré — Android uniquement (le schéma
// intent:// n'a pas d'équivalent iOS ; Apple ne permet à aucune page de forcer l'ouverture
// d'une autre app). Technique standard, repérée dans InAppBrowser-Escaper (licence MIT) —
// réimplémentée ici en une seule stratégie simple, cohérent avec notre philosophie "reste
// simple" plutôt que leur cascade de plusieurs tentatives. Certaines apps bloquent
// volontairement cette navigation pour garder l'utilisateur dans leur webview — dans ce
// cas, rien ne se passe et nos instructions manuelles (toujours affichées à côté) restent
// le repli garanti. Copie aussi le lien en filet de sécurité silencieux (même idée reprise
// d'Escaper) : même si la redirection échoue, le lien est déjà prêt à coller manuellement.
// Doit toujours être déclenchée par un vrai clic (jamais au chargement de page) — certaines
// apps (Instagram iOS notamment, documenté dans Escaper) bloquent les tentatives non liées
// à un geste utilisateur réel ; notre architecture ne l'appelle de toute façon que depuis
// des boutons, jamais automatiquement.
async function attemptAndroidAutoEscape() {
    const url = getCleanInstallUrl();
    try {
        await navigator.clipboard.writeText(url);
    } catch (e) {
        // Best-effort, silencieux — cf. limites déjà connues du presse-papier dans
        // certaines webviews (voir showManualExportModal()).
    }
    const intentUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
    window.location.href = intentUrl;
}

// Appelée par checkAndShowInstallSplash() en tout premier — ne plus appeler directement
// depuis la séquence de démarrage (voir plus bas). Retourne true si le navigateur
// Facebook a été détecté (et donc pris la main sur cet affichage).
function checkFacebookBrowserBlock() {
    if (!isFacebookInAppBrowser()) return false;

    if (shouldSuggestExportBeforeInstall()) {
        if (!shouldShowFacebookWarningToday()) return false;
        localStorage.setItem('installFBWarningLastShownDay', new Date().toDateString());
        showFacebookBrowserWarning();
    } else {
        showFacebookBrowserBlock();
    }
    return true;
}

// ============================================================
// POINT D'ENTRÉE UNIQUE — regroupe tout l'arbre de décision du splash d'installation
// (Facebook, desktop, tiers A/B/C/D, cadences respectives) en un seul endroit, plutôt
// que deux systèmes parallèles à synchroniser par convention. Seule fonction à appeler
// depuis la séquence de démarrage (section 23) — retourne true si un splash a pris la
// main sur cet affichage (l'appelant doit alors sauter le reste de la séquence, la suite
// étant enchaînée depuis la fermeture du splash lui-même).
//
// Arbre :
//   1. Déjà installée ? → rien
//   2. Desktop ? → rien (carte Réglages seule, jamais de splash ni de blocage webview —
//      testé avant le webview pour qu'un navigateur intégré détecté sur desktop ne
//      déclenche jamais rien non plus)
//   3. Navigateur intégré connu (Facebook, Reddit, WhatsApp...) ? → branche dédiée, sa propre cadence (voir checkFacebookBrowserBlock())
//   4. Cadence du tier détecté (A/B : 7 jours ; C/D : jour civil, voir shouldShowSplashForTier())
// ============================================================
function checkAndShowInstallSplash() {
    if (isPWAInstalled()) return false;

    if (!isHandheldDevice()) return false;

    if (checkFacebookBrowserBlock()) return true;

    const tier = getInstallTier();
    if (!shouldShowSplashForTier(tier)) return false;

    showInstallSplash();
    return true;
}

// ============================================================
// OUTIL DE DIAGNOSTIC (console) — debugInstallState()
// Lecture seule, aucun effet de bord : n'appelle jamais checkFacebookBrowserBlock() ni
// checkAndShowInstallSplash() directement (elles écrivent en localStorage et déclenchent
// l'affichage réel) — reconstruit le même résultat à partir des fonctions pures
// partagées (isPWAInstalled, shouldShowSplashForTier, shouldShowFacebookWarningToday...),
// donc sans risque de divergence avec la vraie logique.
// ============================================================
function debugInstallState() {
    const g = (label, value) => console.log(`%c${label} :`, 'font-weight:bold', value);

    console.log('%c=== ÉTAT DE L\'ARBRE D\'INSTALLATION ===', 'font-size:14px; font-weight:bold; color:#4da3ff;');

    console.group('🌍 Environnement détecté');
    g('isPWAInstalled()', isPWAInstalled());
    g('isHandheldDevice()', isHandheldDevice());
    g('isIOSDevice()', isIOSDevice());
    g('isFacebookInAppBrowser()', isFacebookInAppBrowser());
    g('detectInAppBrowser()', detectInAppBrowser());
    g('getInstallTier()', getInstallTier());
    g('window.deferredInstallPrompt', window.deferredInstallPrompt ? 'présent' : 'absent');
    console.groupEnd();

    console.group('📊 Données utilisateur');
    const totalMin = Math.round(state.history.reduce((s, e) => s + (e.end - e.start), 0) / 60000);
    g('Périodes enregistrées', state.history.length);
    g('Minutes cumulées', totalMin);
    g('shouldSuggestExportBeforeInstall()', shouldSuggestExportBeforeInstall());
    console.groupEnd();

    console.group('🕒 Cadence — valeurs brutes (localStorage)');
    g('window.isFirstEverLaunch', window.isFirstEverLaunch);
    g('installFirstLaunchDate', localStorage.getItem('installFirstLaunchDate'));
    const lastDismiss = localStorage.getItem('installPromptLastDismissAt');
    g('installPromptLastDismissAt (tiers A/B)', lastDismiss ? new Date(parseInt(lastDismiss)).toLocaleString() : null);
    g('installPromptLastShownDay (tiers C/D)', localStorage.getItem('installPromptLastShownDay'));
    g('installFBWarningLastShownDay (tier F, Cas 2)', localStorage.getItem('installFBWarningLastShownDay'));
    console.groupEnd();

    console.group('🌳 Résultat de l\'arbre — recalculé à la volée, sans effet de bord');
    let branch, wouldShow;
    if (isPWAInstalled()) {
        branch = 'Déjà installée';
        wouldShow = false;
    } else if (!isHandheldDevice()) {
        branch = 'Desktop';
        wouldShow = false;
    } else if (isFacebookInAppBrowser()) {
        const hasData = shouldSuggestExportBeforeInstall();
        const appName = getInAppBrowserName();
        branch = hasData ? `${appName} — Cas 2 (avertissement, données)` : `${appName} — Cas 1 (blocage, pas de données)`;
        wouldShow = hasData ? shouldShowFacebookWarningToday() : true;
    } else {
        const tier = getInstallTier();
        branch = `Tier ${tier}`;
        wouldShow = shouldShowSplashForTier(tier);
    }
    g('Branche empruntée', branch);
    g('Le splash serait affiché maintenant ?', wouldShow);
    console.groupEnd();

    console.group('🖥️ Affichage actuel dans la page');
    const overlay = document.getElementById('install-splash');
    g('#install-splash présent dans le DOM', !!overlay);
    if (overlay) {
        const bodyText = document.getElementById('install-splash-body')?.innerText.trim() || '';
        g('Contenu actuel (aperçu texte)', bodyText.slice(0, 250) + (bodyText.length > 250 ? '…' : ''));
    }
    console.groupEnd();
}

// ============================================================
// 1f. CARTE PERMANENTE D'INSTALLATION — ONGLET RÉGLAGES (Bloc 5)
// Visible sur mobile/tablette uniquement — jamais sur desktop, où l'installation
// d'une PWA autonome via cette carte n'a pas de sens. Sur mobile, jamais silencieuse
// (tier D et F ont chacun leur contenu ici, pas d'exclusion). Appelée à chaque
// affichage de la page Réglages (voir showPage()).
// ============================================================

function renderSettingsInstallCard() {
    const card = document.getElementById('settings-install-card');
    if (!card) return;
    if (isPWAInstalled() || !isHandheldDevice()) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    const body = document.getElementById('settings-install-body');
    body.innerHTML = `
                <p style="margin:0 0 12px 0; font-size:0.93rem;">${t('installSettingsBannerText')}</p>
                <button class="export-btn" style="margin:0;" onclick="handleSettingsInstallClick()">${t('installSettingsBannerBtn')}</button>
            `;
}

// Clic sur le bouton — décision tier prise ici, au clic, jamais au rendu (même principe
// qu'au Bloc 3). Tier F (navigateur intégré, ex Facebook) prioritaire dans getInstallTier(), donc géré ici sans
// logique séparée à dupliquer.
async function handleSettingsInstallClick() {
    const tier = getInstallTier();
    if (tier === 'A' && window.deferredInstallPrompt) {
        await triggerNativeInstallPromptFromSettings();
        return;
    }
    renderSettingsInstallInstructions(tier);
}

// Variante dédiée à ce contexte — volontairement séparée de triggerNativeInstallPrompt()
// (Bloc 3) : ne doit pas fermer de splash ni enregistrer un dismiss du cycle de rappel,
// ce sont deux flux indépendants.
async function triggerNativeInstallPromptFromSettings() {
    if (!window.deferredInstallPrompt) return;
    window.deferredInstallPrompt.prompt();
    try {
        const choice = await window.deferredInstallPrompt.userChoice;
        console.log(`[Install] (Réglages) Choix utilisateur : ${choice.outcome}`);
    } catch (e) {
        console.warn('[Install] (Réglages) Erreur lors du prompt natif :', e);
    }
    window.deferredInstallPrompt = null;
    renderSettingsInstallCard(); // revient à l'état bouton par défaut
}

function renderSettingsInstallInstructions(tier) {
    const body = document.getElementById('settings-install-body');
    if (!body) return;

    let content = '';
    if (tier === 'F') {
        const appName = getInAppBrowserName();
        const browserName = isIOSDevice() ? 'Safari' : 'Chrome';
        const hasData = shouldSuggestExportBeforeInstall();
        const exportBox = hasData ? `
                    <div class="install-splash-export-box">
                        <p>${t('installFBExportText', { n: state.history.length, appName })}</p>
                        <button class="export-btn"
                            style="background:rgba(255,180,0,0.1); color:#ffcc55; border:1px solid rgba(255,180,0,0.5);"
                            onclick="exportCSV()">${t('installFBExportBtn')}</button>
                    </div>` : '';
        content = `
                    <div class="install-splash-instructions">
                        <p>${t('installFBIntro', { appName, browserName })}</p>
                        ${buildInstallWebviewPathsHTML(false)}
                        ${exportBox}
                    </div>`;
    } else if (tier === 'C') {
        const exportBox = shouldSuggestExportBeforeInstall() ? `
                    <div class="install-splash-export-box">
                        <p>${t('installTierCExportText', { n: state.history.length })}</p>
                        <button class="export-btn"
                            style="background:rgba(255,180,0,0.1); color:#ffcc55; border:1px solid rgba(255,180,0,0.5);"
                            onclick="exportJSON()">${t('installTierCExportBtn')}</button>
                    </div>` : '';
        content = `
                    <div class="install-splash-instructions">
                        ${buildInstallStepsHTML('C')}
                        ${exportBox}
                    </div>`;
    } else if (tier === 'D') {
        content = `
                    <p style="margin:0 0 8px 0; font-size:0.93rem; font-weight:bold;">${t('installTierDText')}</p>
                    <p style="margin:0 0 12px 0; font-size:0.85rem; font-weight:normal; font-family:monospace; opacity:0.8; word-break:break-all;">${getCleanInstallUrl()}</p>
                    <button class="export-btn" style="margin:0;" id="settings-install-copy-btn"
                        onclick="copyInstallLink()">${t('installCopyLinkBtn')}</button>`;
    } else {
        // Tier B (prompt pas encore disponible au moment du clic)
        content = `<div class="install-splash-instructions">${buildInstallStepsHTML('B')}</div>`;
    }

    body.innerHTML = content;
}

// Copie le lien de l'app dans le presse-papier (tier D) — best-effort, échoue
// silencieusement si l'API n'est pas disponible ou refusée par le navigateur.
async function copyInstallLink() {
    try {
        await navigator.clipboard.writeText(getCleanInstallUrl());
        const btn = document.getElementById('settings-install-copy-btn');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = t('installLinkCopied');
            setTimeout(() => { btn.textContent = original; }, 2000);
        }
    } catch (e) {
        console.warn('[Install] Copie du lien échouée :', e);
    }
}