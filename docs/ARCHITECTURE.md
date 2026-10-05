  # PacingCount — architecture

  ## Structure des fichiers
  - `index.html` : HTML + gros script inline (cœur : constantes, migration, état,
    alertes, messages/mises à jour, moteur des périodes, rendu, historique,
    timeline, navigation, init, swipe)
  - `style.css` ; `sw.js`, `manifest.json`, `messages.json`, `chart.js`, `inapp-spy.js`
  - `js/` : `translations.js`, `install.js`, `evolution.js`, `import-export.js`,
    `daily-data.js`, `results.js`
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

        startPeriod() → scheduleAlerts(typeId, startTime) → setTimeout pour chaque vague
        Au déclenchement: guard LATE_ALERT_THRESHOLD = 15000ms — si retard > 15s, abandon(visibilitychange prend le relais)
        Envoi via postMessage DISPLAY_NOW au SW → showNotification()
        Enregistrement dans state.sentAlerts[] + saveState()
        Après dernière vague: autoReleaseWakeLockTimer relâche le Wake Lock 60s plus tard

        Flux visibilitychange(retour au premier plan) :

        Re - acquérir Wake Lock si besoin
        Calculer lastCatchupAt(timestamp du dernier catchup pour ce type)
        Compter vagues manquées: fireAt < now && !alreadySent && fireAt > lastCatchupAt
        Si missed > 0 → UNE notification catchup, enregistrée dans sentAlerts avec source: 'catchup'
        Si plus de vagues futures après catchup → releaseWakeLock()
        scheduleAlerts() reprogramme les futures — sentAlerts sauvegardé / restauré autour de cet appel

        Structure sentAlerts dans pacingState:

        javascript{ waveIndex, typeId, firedAt, mode: 'presence', source: 'timer' | 'catchup' }
        // waveIndex = -1 pour les catchups

        Wake Lock:

        Activé dans requestWakeLock() uniquement si une alerte active existe pour le type en cours
        Relâché: automatiquement après dernière alerte, ou manuellement à stopRecording(), ou si plus de vagues après catchup
        Si système coupe le Wake Lock(batterie) → stopInactivityDetection()

        Pseudo - veille :

        Overlay noir après INACTIVITY_DELAY = 20000ms d'inactivité
        Déverrouillage: swipe vers le haut
        Timer principal synchronisé via MutationObserver

        Mode vagues croissantes: désactivé silencieusement(wave = false hardcodé), logique conservée dans le code


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


        6. Système de messages JSON

        Au démarrage de l'app, l'app fetche le fichier messages.json depuis le serveur
        (cache: no-store — toujours la version fraîche). Le premier message éligible est
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
        update — invitation à mettre à jour, au maximum une fois par semaine par id. Devient bloquant après blockAfter (voir priorité absolue ci-dessus). Nécessite un SW en attente pour s'afficher.

        Filtres d'éligibilité :

        validFrom / validUntil — période de validité (vide = pas de limite)
        maxVersion — s'affiche uniquement si APP_VERSION ≤ maxVersion (vide = toutes versions)
        blockAfter — avant la date : non bloquant avec bouton "Plus tard" ; après : bloquant, pas de dismiss possible

        localStorage

        seenMessages — array d'ids vus définitivement (welcome, info, et update "Plus tard")
        lastShownUpdate — timestamp du dernier affichage d'un update, pour le filtre 7 jours. Ignoré si l'id du message a changé.

        Usage concret

        Modifier messages.json sur GitHub pour pousser un message sans mise à jour de l'app
        Désactiver un message sans l'effacer : mettre validUntil dans le passé
        Kill switch : renseigner maxVersion + blockAfter pour forcer une mise à jour


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
        DailyUser-LS-above-{1|2|3|4}MB  (taille localStorage, un seul palier : le plus haut atteint)


        8. Arbre d'installation : Splashes et cadre dans onglet Réglages
        Descriptif complet : docs/installation.md

        debugInstallState() en console pour un diagnostic complet de l'état actuel
        dans l'arbre à tout moment
