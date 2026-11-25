  # PacingCount — architecture

  ## Structure des fichiers
  - `index.html` : HTML + gros script inline (cœur : constantes, migration, état,
    alertes, messages/mises à jour, moteur des périodes, rendu, historique,
    timeline, navigation, init, swipe)
  - `style.css` ; `sw.js`, `manifest.json`, `messages.json`, `chart.js`, `inapp-spy.js`
  - `js/` : `translations.js`, `install.js`, `evolution.js`, `import-export.js`,
    `daily-data.js`, `results.js`, et les quatre fichiers des alertes :
    `alerts-shared-sw.js` (**code partagé entre la page et le service worker** : stockage IndexedDB, registre
    « déjà jouée » partagé, règle commune `alertsSelectDue` / `alertsBuildCatchup`, constantes de tolérance ;
    aucune référence à `window`, `document`, `settings`, `state`, `t()` : chargé par `<script src>` dans index.html
    et, à partir de la beta.10, par `importScripts()` dans `sw.js`),
    `alerts.js` (partie commune de la page : réglages `settings.alerts[]`, interface, état des notifications,
    plan d'alertes : `getRunStart()` et `computeAlertPlan()`, fonction pure partagée par les canaux ;
    `buildServerPlan()` / `refreshAlertPlanStore()` : plan avec textes pré-traduits, enregistré dans IndexedDB
    à chaque `scheduleAlerts()` / `cancelAlerts()`, au passage en arrière-plan, au changement de langue et à
    l'enregistrement des réglages ; copie du registre « déjà jouée » dans IndexedDB : `mirrorPlayed*`,
    `mergePlayedFromStore()`),
    `alerts-local.js` (mode local : minuteries, Wake Lock, pseudo-veille, `playDueWaves()` (règle unique
    d'affichage, appelée par les minuteries et au retour visible), `catchUpAlertsOnVisible()` appelée par
    l'écouteur `visibilitychange` d'index.html) et
    `alerts-server.js` (modes serveur et mixte : abonnement Web Push, synchronisation des horaires avec le
    Worker `syncServerPlan()` et état `pushSyncStatus` ; voir `docs/alertes-serveur.md`).
    Le choix du mode (`getAlertMode()`, `onAlertModeChange()`, `renderAlertModeUI()`) est dans `alerts.js` ;
    `scheduleAlerts`, `cancelAlerts` et `releaseWakeLock` restent dans `alerts-local.js` et tiennent compte du mode.
    (`import-export.js` : exports CSV/JSON ; import CSV ; import JSON en deux écrans
    Remplacer / Fusionner ; **helpers de correspondance des types partagés** CSV et JSON :
    `normalizeTypeLabel`, `resolveTypeTarget`, `buildTypeMappingTableHTML`,
    `analyzeTypeMapping`. Règles : `docs/notes-events.md` § 4.2)
  - `cf-worker/` : serveur d'alertes (Cloudflare Worker + Durable Object), déployé à part
    avec `wrangler` (voir `docs/alertes-serveur.md`). Publié par Pages comme fichiers
    statiques, jamais mis en cache par le SW ; aucun secret dedans.
  - Autres dossiers : `docs/` (cette note, `TODO.md`, `CONVENTIONS.md`, notes de chantier),
    `icons/` (sources des icônes + générateur ; `icon-192.png` et `icon-512.png`
    restent à la racine car référencés par le manifest et `sw.js`),
    `archive/` (anciennes versions, hors app : jamais chargées ni mises en cache).
  - Scripts classiques (pas de modules), chargés dans le `<head>` avant le gros script.
    L'ordre entre eux est libre, sauf que `daily-data.js` doit être chargé avant
    le script inline (`BUILTIN_EVENT_TAGS` est utilisé dès la section 4).
  - Tout nouveau fichier : l'ajouter dans `<script src>` ET dans `ASSETS_TO_CACHE`
    (sw.js), puis incrémenter `APP_VERSION` / `CACHE_NAME`.

  ## Logique générale


        0. Types de périodes et profils — structure et logique

        Chaque type de période est un objet persisté dans `settings.types[]` 
        (localStorage, clé `pacingSettings`) :
        
        { id: 1, label: "Couché sans stimulation", active: true, color: "blue" }
        
        `id` est immuable et sert de clé dans tout l'historique. `label` est cosmétique 
        et renommable librement. `active` détermine si le type est visible dans l'interface. 
        `color` est le format de couleur brut — nom de variable CSS (`"blue"`), hex (`"#e74c3c"`), 
        ou fonction CSS (`"hsl(...)"`) — géré de façon uniforme par `getColorForId()`.

        L'app supporte 6 slots prédéfinis (ids 1 à 6, couleurs bleu/vert/jaune/orange/rouge/violet). 
        Des slots supplémentaires (ids 7+) sont architecturalement possibles avec une couleur hex 
        ou hsl dans `color`. Au minimum 1 type doit rester actif.

        Gestion des couleurs — deux fonctions :

        `getColorForId(typeId)` — retourne une valeur CSS inline (`var(--blue)`, `#e74c3c`, `hsl(...)`). 
        Utilisée partout sauf Chart.js.

        `getColorValueForId(typeId)` — retourne une valeur calculée (hex ou hsl direct). 
        Réservée à Chart.js qui n'accepte pas `var(--)`.

        Profils — structure et comportement :

        Un profil est un preset qui écrit dans `settings.types[]`. Il ne vit pas en permanence : 
        c'est une fonction de pré-remplissage, pas une entité active.

        Deux profils prédéfinis hardcodés dans la constante `PROFILES{}` : `pacingcount_standard` 
        (3 types actifs) et `uz_leuven_2018` (5 types actifs). Ils définissent uniquement `label` 
        et `active` par slot — pas les couleurs, qui sont fixes par `id`.

        `settings.activeProfile` vaut l'id du profil courant (`"pacingcount_standard"`, `"uz_leuven_2018"`) 
        ou `"custom"`. Il est mis à jour automatiquement par `detectProfile()` à chaque `saveSettings()`, 
        par comparaison label + active de chaque slot contre les profils connus.

        Un seul profil personnalisé est supporté, stocké dans `settings.customProfiles[0]`. Il est créé 
        automatiquement (snapshot de `settings.types[]`) au premier écart d'un profil prédéfini, 
        et mis à jour silencieusement à chaque modification manuelle suivante. Il reste accessible 
        via son bouton dans les Réglages même après avoir appliqué un profil prédéfini, et peut 
        être restauré en un clic.

        Labels — contraintes :

        30 caractères maximum (enforced via `maxlength` sur les inputs). Persistés dans `settings.types[].label`. 
        `settings.labels[]` est un tableau dérivé des labels actifs, maintenu pour compatibilité avec les fonctions de graphes.

        
        1. Logique des périodes — Moteur central :

        applySteamroller(base, priority) — gère les chevauchements, fragment gauche reçoit isLive: false
        snapAdjacentBorders(periods, entries) — raccorde les bornes à moins de SNAP_THRESHOLD(60s)
        mergeAdjacentPeriods(periods) — fusionne les adjacents de même type, propage isLive
        Chaîne: steamroller → snap → merge
        reconstructHistory — isLive est la seule source de vérité, ne pas vérifier p.end

        Contraintes critiques:

        typeId entier 1-6 (extensible), immuable, couleur fixe par typeId stockée dans settings.types[].color
        Coupure à minuit toujours faite par closePeriod() — jamais de période chevauchant minuit
        Périodes de durée nulle: filtrées à l'import et à la création
        DST: utiliser new Date(jour + 1), jamais dayS + 24 * 3600 * 1000
        SNAP_THRESHOLD = 60000 — mettre à 0 désactive le snap(debug)


        2. Logique des alertes, Wake Lock, pseudo - veille

        Flux d'une alerte normale :

        startPeriod() → scheduleAlerts(typeId, startTime) → pour CHAQUE alerte active dont l'ensemble de types contient le type en cours : getRunStart() (début de la séquence continue dans l'ensemble) puis computeAlertPlan() → un setTimeout par vague future
        Chaque minuterie appelle playDueWaves() : RÈGLE UNIQUE, aussi appelée au retour visible (catchUpAlertsOnVisible). Elle prend toutes les vagues dues et non jouées de toutes les alertes ; une alerte avec UNE seule vague due, en retard d'au plus ALERT_LATE_TOLERANCE_MS (60 s) → rappel normal (tag pacing-<alertId>-w<n>) ; tous les autres cas → UN SEUL rattrapage (tag pacing-catchup) : une alerte = « Rattrapage : nom », plusieurs = « Rattrapage : N alertes » + une ligne par alerte (durée décroissante), rang = dernière vague due
        Les vagues sont marquées dans state.sentAlerts[] (+ saveState()) AVANT l'attente du SW (pas de doublon ni de désordre si plusieurs minuteries se réveillent ensemble) ; si le SW est introuvable, le marquage est annulé (unmarkWavePlayed)
        Envoi via postMessage DISPLAY_NOW au SW → showNotification()
        Le registre survit aux changements de type dans l'ensemble, purgé à la fin de la séquence
        Après dernière vague: autoReleaseWakeLockTimer relâche le Wake Lock 60s plus tard

        Flux visibilitychange(retour au premier plan) → catchUpAlertsOnVisible() :

        playDueWaves() (rattrapage éventuel, voir ci-dessus), puis scheduleAlerts() reprogramme les vagues futures ; si plus rien à attendre → releaseWakeLock()
        Pas de rattrapage au démarrage de l'app (seulement au retour visible et par les minuteries)

        Modèle d'une alerte (settings.alerts[]) : { id, typeIds: [..], enabled, threshold, interval, maxCount } ; nom calculé (libellés des types joints par « + »). Migration automatique depuis l'ancien format (typeId unique) dans normalizeAlerts().

        Structure sentAlerts dans pacingState:

        javascript{ alertId, runStart, waveIndex, firedAt, source: 'timer' | 'catchup' }
        // clé d'une vague = (alertId, runStart, waveIndex) ; les anciennes entrées (format ≤ beta.4) sont inertes

        Wake Lock:

        Activé dans requestWakeLock() uniquement si une alerte active existe pour le type en cours
        Relâché: automatiquement après dernière alerte, ou manuellement à stopRecording(), ou si plus de vagues après catchup
        Si système coupe le Wake Lock(batterie) → stopInactivityDetection()

        Pseudo - veille :

        Overlay noir après INACTIVITY_DELAY = 20000ms d'inactivité
        Déverrouillage: swipe vers le haut
        Timer principal synchronisé via MutationObserver

        Mode vagues croissantes: supprimé (beta.5)

        Trois modes des alertes (beta.10), réglage settings.alertMode ('local' par défaut | 'server' | 'mixed'), choisi dans Réglages > Alertes de périodes :
        local : le flux ci-dessus, aucun contact avec le serveur.
        mixed : le flux ci-dessus + syncServerPlan() envoie au Worker Cloudflare les horaires des vagues futures non jouées ; le Wake Lock n'est tenu que tant que le serveur n'a pas confirmé (pushSyncStatus !== 'ok', scheduleAlerts() rappelée à chaque changement d'état).
        server : scheduleAlerts() ne programme rien (ni minuterie ni Wake Lock), catchUpAlertsOnVisible() ne joue rien ; seul le serveur réveille l'appareil.
        Flux serveur : refreshAlertPlanStore() écrit le plan (avec plan.mode) dans IndexedDB puis appelle syncServerPlan() (aussi au démarrage, au retour visible, à 'online', toutes les 2 min si en attente) → /schedule ou /cancel. Push VIDE reçu par sw.js → handlePush() : lit plan + registre dans IndexedDB, alertsSelectDue() (même règle que la page), marque les vagues (source 'sw') puis affiche les textes pré-traduits ; rien de dû → notification silencieuse fermée aussitôt (ou rien si une fenêtre est visible) ; échec → notification de repli fixe. Écouteur notificationclick commun aux notifications locales et serveur.
        Protocole, décisions, limites et à-faire : `docs/alertes-serveur.md`.


        3. Mode développeur

        Activé par 7 taps sur le titre ou le copyright dans la section À propos. Persisté en localStorage (devMode = '1'). Désactivé via un toggle visible uniquement quand le mode est actif. Les éléments dev portent la classe CSS dev-only — cachés par défaut, visibles quand body a la classe dev-mode.

        Éléments contrôlés par le mode dev :

        Bouton "Test Notif Immédiate"
        Bouton "Mode Plein Écran"
        Le toggle lui-même avec l'indicateur 🛠️ Mode développeur

        Eruda est chargé dynamiquement au premier passage en mode dev (pas au démarrage) — économise les ressources en production.


        4. Système de console

        Trois niveaux :

        _nativeLog — référence au console.log natif du navigateur, capturée avant toute surcharge. Jamais modifiée. Toujours disponible pour la console PC DevTools.
        
        Surcharge initiale (active dès le démarrage) — remplace console.log par une fonction qui :

        Horodate chaque message ([HH:MM:SS])
        Stocke dans _logBuffer[] (max 100 entrées, buffer tournant)
        Envoie vers _nativeLog → visible sur PC DevTools

        Surcharge post-Eruda (active après chargement d'Eruda) — remplace console.log à nouveau :

        Horodate chaque message
        Envoie vers _erudaLog (référence Eruda capturée juste avant neutralisation)
        Eruda redirige vers PC en interne — un seul horodatage sur PC ✅

        Séquence au chargement d'Eruda :

        Capturer _erudaLog = console.log.bind(console) → pointe vers Eruda
        Neutraliser la surcharge initiale : console.log = _nativeLog — pour qu'Eruda capture le natif pur
        eruda.init() — Eruda prend le natif comme base, pas la surcharge
        Replay du buffer via erudaConsole.log() — injecte directement dans Eruda sans doublon PC
        Réappliquer l'horodatage via la surcharge post-Eruda
        Message "Replay terminé — console en direct"

        Résultat :

        PC DevTools : logs depuis le démarrage, un seul horodatage, en continu ✅
        Eruda : replay complet depuis le démarrage, puis direct, horodaté ✅
        Buffer conservé en mémoire après replay — base pour futur rapport d'erreur ✅


        5. Infrastructure de déploiement

        Liaison GitHub → Cloudflare Pages. Deux branches :

        main → pacingcount.pages.dev — version stable
        dev → dev.pacingcount.pages.dev — version de développement

        Workflow : coder sur dev, tester, merger dans main quand stable.

        Détection auto branche dev/prod via const IS_DEV = location.hostname.includes('dev.')
        (détecte automatiquement dev.pacingcount.pages.dev vs pacingcount.pages.dev)
        Pas de modification d'apparence à gérer au merge.
    
        En dev branch :
        - Fond barre de navigation en gris vert sombre
        - Titre page mesure — indique dev branch en petit gris italique

        Le Worker Cloudflare (cf-worker/) n'est pas déployé par la liaison GitHub → Pages : il se déploie
        à la main (`npx wrangler deploy` depuis cf-worker/). Un seul Worker sert dev, main (Cloudflare)
        et main (GitHub Pages) ; origines autorisées dans cf-worker/wrangler.toml.


        6. Système de messages JSON

        Au démarrage de l'app, l'app fetche le fichier messages.json depuis le serveur
        (cache: no-store + paramètre unique ?t=<timestamp> dans l'URL — toujours la version fraîche ; voir docs/messages-json.md). Le premier message éligible est
        affiché dans un modal. Un seul message par lancement.

        Priorité absolue : une mise à jour bloquante (isBlocking, voir blockAfter ci-dessous)
        est vérifiée en tout premier, sans délai (checkBlockingUpdate(), section 23) — avant
        même le splash d'installation. Si trouvée, elle est affichée immédiatement et le reste
        de la séquence de démarrage (splash, toasts, message JSON normal) est sauté pour ce
        lancement. Sinon, séquence habituelle après 2,5 secondes : splash > toasts > message JSON
        (checkMessages()) — voir section 8d / checkAndShowInstallSplash().

        Le fichier messages.json est hébergé sur GitHub, modifiable sans toucher au code de l'app. 
        L'ordre des messages dans le fichier défini leur ordre de priorité.

        3 types de messages :

        welcome — affiché une seule fois au premier lancement (id jamais vu dans seenMessages)
        info — astuce ou information, affiché une seule fois (id mis en seenMessages au dismiss)
        update — invitation à mettre à jour. Après un « Plus tard » (non bloquant) : masqué 7 jours, puis ré-affiché tant que la mise à jour est en attente (beta.31). Devient bloquant après blockAfter (voir priorité absolue ci-dessus). Nécessite un SW en attente pour s'afficher.

        Filtres d'éligibilité :

        validFrom / validUntil — période de validité (vide = pas de limite)
        maxVersion — s'affiche uniquement si APP_VERSION ≤ maxVersion (vide = toutes versions)
        blockAfter — avant la date : non bloquant avec bouton "Plus tard" ; après : bloquant, pas de dismiss possible

        localStorage

        seenMessages — array d'ids vus (welcome, info : définitivement ; update "Plus tard" : voir la règle des 7 jours ci-dessous)
        lastShownUpdate — timestamp du dernier "Plus tard" sur un update (un seul, global) ; sert à la règle des 7 jours. Sans effet sur un nouvel id (pas encore dans seenMessages : affiché aussitôt).
        messagesFetchDiag — trace du dernier fetch de messages.json (beta.30), écrasée à chaque lancement ; voir docs/messages-json.md

        Usage concret

        Modifier messages.json sur GitHub pour pousser un message sans mise à jour de l'app
        Désactiver un message sans l'effacer : mettre validUntil dans le passé
        Kill switch : renseigner maxVersion + blockAfter pour forcer une mise à jour

        Détails (structure de l'interface auto/manuel, règle des 7 jours, incident des anciennes copies du fichier et diagnostic) : docs/messages-json.md


        7. Liste finale complète des events GoatCounter liés à l'installation/navigateur
        
        (NewUser est relatif au suffixe, pas absolu)

        NewUser-installed (= TOTAL) NOTE : pas de comptage séparé des installations qui conservent le LocalStorage sour chrome)
        NewUser-webview-{Facebook, Messenger, Instagram, Twitter, LinkedIn, TikTok,
                    Snapchat, Line, WeChat, Threads, GSA, WhatsApp, Reddit, Telegram, Other}
        NewUser-webview-TOTAL
        NewUser-browser-{Chrome, Safari, Samsung, Firefox, Brave, Opera, Other}
        NewUser-browser-TOTAL

        DailyUser-TOTAL
        DailyUser-{version}
        DailyUser-{installed|browser}
        DailyUser-webview-{...même liste...}
        DailyUser-webview-TOTAL
        DailyUser-browser-{Chrome, Safari, Samsung, Firefox, Brave, Opera}  (Other exclu du détail)
        DailyUser-browser-TOTAL
        DailyUser-alertON
        DailyUser-{PacingCountStandard|UZLeuven2018}  (profil prédéfini actif ; un seul des deux)
        DailyUser-custom-{N}-types  (beta.31 : profil personnalisé ; N = nombre de types actifs, 1 à 6 ; aucun libellé envoyé.
                                      Le détail DailyUser-Custom-{ids+libellés} reste désactivé : SEND_DAILY_CUSTOM_PROFILE_EVENT = false)
        DailyUser-LS-above-{1|2|3|4}MB  (taille localStorage, un seul palier : le plus haut atteint)

        Daily-event-{1|2|3}  (beta.28 : MPE / Malade / Jour OK ; la VEILLE seulement ; 0, 1 ou 2 envois tirés
                              au hasard, probabilités 1/4, 1/2, 1/4 ; tags builtin actifs ; voir docs/notes-events.md, § 3.3)
        Daily-note           (beta.28 : note de la veille non vide ; un seul envoi)

        export-json | export-csv | import-json-replace | import-json-merge | import-csv-replace | import-csv-merge
                             (beta.41 : après une exportation / importation réussie, en ligne seulement)


        8. Arbre d'installation : Splashes et cadre dans onglet Réglages
        Descriptif complet : docs/installation.md

        debugInstallState() en console pour un diagnostic complet de l'état actuel
        dans l'arbre à tout moment
