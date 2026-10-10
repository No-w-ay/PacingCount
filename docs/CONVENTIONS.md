# Conventions techniques et pièges à ne pas réintroduire

> Leçons cumulées des chantiers passés. Les règles de **méthode de travail** (comment on collabore) sont dans les instructions du projet ; ici, uniquement du **technique**. Les pièges propres à un chantier sont dans sa note (`docs/evolution.md`, `docs/notes-events.md`).

## Dates et temps
- **DST** : le « jour suivant » se calcule avec `new Date(y, m, d + 1)`, jamais `+ 24*3600*1000` / `+ 86400000`. Une nuit de changement d'heure fait 23 h ou 25 h. Un `+ 86400000` reste acceptable pour mesurer une *durée en jours* entre deux dates, pas pour avancer d'un jour calendaire. En cas de doute sur un bug de continuité, grep `86400000`.
- **Jours « agrégés »** (Résultats, graphiques journalier/hebdomadaire, timeline, index Évolution) : la période en cours doit toujours être découpée à minuit par `splitPeriodIntoDayFragments()` avant classement. Les vues « brutes » (compteur Mesure, liste Historique, export CSV) affichent la période en cours en une seule entrée continue, sans découpe.
- `closePeriod()` coupe à `23:59:59.999` / `00:00:00.000` : l'écart de 1 ms (≈ 1 s après un aller-retour CSV) **n'est pas un vrai trou**. Un fragment de durée nulle ne doit jamais être créé (garde de durée strictement positive dans `closePeriod()` et `splitPeriodIntoDayFragments()`).
- `snapAdjacentBorders()` recolle volontairement les petits trous < 60 s (`SNAP_THRESHOLD`) : ne pas la modifier pour traiter le cas de minuit.

## Affichage
- **Durées h/min** : toujours `splitMinutesHM()` / `formatMins()` (un seul `Math.round()` sur le total, puis `floor`/modulo). Jamais `floor` des heures + `round` des minutes séparés (donne « 2h60 »).
- **HTML interpolé** : tout texte utilisateur placé dans un attribut ou un handler inline (`onclick="…'${x}'…"`, `title`) passe par `escapeHtml()`. Rencontré sur les libellés de types (apostrophes) à trois endroits.
- **Champ de saisie** : un rafraîchissement ne réécrit jamais un `<textarea>`/`<input>` en cours de frappe. Séparer le rendu « au changement de contexte » du rendu « à chaque frappe ».
- **Table `border-collapse`** : un contour de ligne se fait avec `box-shadow: inset` par cellule.
- **Éléments de simple référence géométrique** : `pointer-events: none`.
- **Largeur selon le texte et la police** : la mesurer plutôt que la deviner (copies hors écran `visibility: hidden` avec les **vraies classes**, retirées dans un `finally`, repli si la mesure donne 0 car un parent est `display: none`). Remesurer au changement de langue et à l'ouverture.
- **Opacité d'une cellule** (weekend) : l'appliquer à un `<span>` du texte, pas à la cellule, sinon cadres et ombres sont atténués aussi.

## Chart.js
- **Fermetures figées** : un callback défini à la création du chart (`ticks.color`, `ticks.callback`, `afterBuildTicks`, `afterDraw`…) ne voit que le 1er rendu. Lire `this.options…` (callback `function`, pas arrow) ou une variable `window.*` réassignée à chaque rendu.
- **Géométrie** : pour aligner un élément sur un graphe, lire `scale.getPixelForValue()` / `getValueForPixel()` ; ne jamais deviner un offset en pixels.
- **Étiquette d'axe multi-ligne** : seulement avec une hauteur d'axe figée (`afterFit`), pour que la zone de tracé ne varie pas avec le contenu.
- **Sous rotation CSS** (overlay Évolution) : préférer un élément DOM (`onclick`, `getBoundingClientRect()`) à tout calcul sur les coordonnées internes de Chart.js.
- **Tactile** : le sens d'une conversion `clientY` → date/position doit être **validé sur appareil** (trois inversions constatées). Un tap se distingue d'un geste par la **distance** parcourue, jamais par la durée.

## Données et état
- **L'état persisté reflète la réalité du moment**, pas une intention passée : une sélection ou une composition qui référence un type sans données doit être nettoyée au bon point d'entrée (pas seulement filtrée à l'affichage), puis ne pas être recochée automatiquement.
- **Types actifs/inactifs** : toute fonction qui change l'état d'un type appelle ensuite `syncAlertsWithTypes()`.
- **Détection d'état dérivé** (ex. `detectProfile()`) : ignorer les champs sans pertinence pour un slot **inactif** (un renommage silencieux d'un type inactif ne doit pas faire sortir d'un profil de base).
- **Tags builtin** : un changement d'`id` n'est pas géré par la resynchronisation du bootstrap (voir `docs/notes-events.md`).
- Une règle d'exclusion entre données s'applique à l'**activation**, jamais à la désactivation ni à un changement de valeur interne.
- Pas de migration de données pour une structure non encore diffusée publiquement ; dès la diffusion, toute modification de structure persistée exige une migration (voir `migrateLocalStorage()`).

## Fichiers et déploiement
- Scripts classiques (pas de modules), chargés dans le `<head>` avant le script inline ; l'ordre entre fichiers est libre sauf `js/daily-data.js` (utilisé dès la section 4).
- Tout nouveau fichier : `<script src>` dans `index.html` **et** `ASSETS_TO_CACHE` dans `sw.js`, puis `APP_VERSION` et `CACHE_NAME` incrémentés ensemble. Écrire les chemins de la même façon des deux côtés, pas de query string dans les `<script src>`.
- `sw.js` : installation tout-ou-rien avec `fetch(new Request(url, { cache: 'reload' }))` + contrôle `response.ok` ; mise à jour activée manuellement (`SKIP_WAITING` depuis `applyUpdate()`), pas de `skipWaiting()` automatique.
- `index.html`, `sw.js`, `manifest.json`, `messages.json` et `icon-192.png` / `icon-512.png` restent à la racine (portée du SW, `start_url`, fetch relatif, chemins du manifest). Les autres icônes et le générateur sont des sources dans `icons/` ; les anciennes versions sont dans `archive/` (servies aussi par Cloudflare, mais jamais mises en cache ni chargées par l'app).
- Un `messages.json` modifié sur `dev` n'est lu que par l'app servie depuis `dev` ; `main` a le sien. Le fetch utilise `cache: 'no-store'` **et** un paramètre unique `?t=<Date.now()>` (beta.30 : contourne toute copie du fichier indexée par URL, voir `docs/messages-json.md`) ; le fichier n'est pas dans `ASSETS_TO_CACHE`.
- Course SW / `messages.json` : si le message `update` n'apparaît pas, vérifier d'abord le timing de détection du nouveau SW (logs `[Update] …`) avant de soupçonner `maxVersion` / `validFrom`. Un message `update` n'est montré que si un SW est en attente, sinon il est sauté **sans log**.
- **Message `update` anormal** (ancien, ou bloquant à tort) : lire la trace `JSON.parse(localStorage.getItem('messagesFetchDiag'))` (id reçu, `olderThanInstalled`, en-têtes). L'`id` du message doit valoir `update-<APP_VERSION>` à chaque commit.
- **Commits depuis VS Code connecté à GitHub (sans copie locale)** : il n'y a pas de zone *Stage*, tous les changements en attente partent dans le même commit. Beaucoup de **déplacements/renommages** d'un coup (seuil indicatif, non mesuré : au-delà d'une dizaine) font échouer le commit avec `No working content for created or changed commit operation` : l'extension relit le contenu de chaque fichier déplacé et lance le commit avant la fin des lectures (échec en ≈ 30 ms). Procéder par lots d'une dizaine de fichiers, un commit par lot. Une suppression ne demande aucune relecture : plus légère qu'un déplacement. Pour lire l'erreur : palette de commandes → `Developer: Show Logs…` → canal GitHub / Remote Repositories.
- **Fins de ligne** : le dépôt mélange LF et CRLF selon les fichiers (constat au 2026-10-05 : CRLF pour `style.css`, `js/*.js` et `docs/ARCHITECTURE.md` ; LF pour `index.html`, `sw.js`, `manifest.json`, `messages.json` et les autres notes). Sans conséquence pour l'app, mais un fichier remplacé par une copie aux fins de ligne différentes apparaît entièrement modifié dans le diff. Règle : **conserver les fins de ligne existantes du fichier** quand on en remplace un (Claude les préserve) ; les nouveaux fichiers sont en LF. Vérification : `grep -c $'\r$' fichier` (nombre de lignes CRLF).
- Bug de continuité entre un état attendu et un fichier réel : repartir du fichier réel (dépôt, branche `dev`), jamais d'un document collé plus haut dans une conversation.

## Saisie et défilement
- **Limite de longueur d'un champ** : `maxlength` seul ne suffit pas (blocage silencieux sur ordinateur, contourné par certains claviers mobiles) → troncature dans le gestionnaire `input` (curseur conservé, paires de substitution/emoji intactes) + `beforeinput` pour le retour visuel.
- **Liste longue** : fenêtre virtuelle à lignes de hauteur exacte (CSS **et** JS), `overflow-anchor: none`, écouteur de défilement limité à une exécution par image ; pas de `scroll-snap` avec une fenêtre qui change.
- **Gestes** : `touchcancel` = le navigateur reprend le geste (l'élan continue) ; ne jamais recaler pendant que le doigt ou la souris est posé.

## Analytics (GoatCounter)
- Ping quotidien : `DailyUser-installed` seulement si `isPWAInstalled()` ; canaux détaillés `DailyUser-browser-X` / `-webview-X` / `-*-TOTAL` ; `DailyUser-alertON` si au moins une alerte active ; `DailyUser-LS-above-{1..4}MB` (taille localStorage). `period-started-sample10p` est échantillonné à 10 % (×10 pour estimer le volume). Interrupteur `SEND_DAILY_CUSTOM_PROFILE_EVENT = false`. `DailyUser-custom-{N}-types` (profil personnalisé : nombre de types actifs, sans libellé ; beta.31 ; le détail `DailyUser-Custom-…` reste désactivé). `Daily-event-1/2/3` (MPE, Malade, Jour OK : veille, tirage 0/1/2 avec probabilités 1/4, 1/2, 1/4) et `Daily-note` (veille, sans masquage) : voir `docs/notes-events.md`, § 3.3. Ne jamais envoyer d'identifiant ou de libellé de tag personnel.
- **Limite GoatCounter** : `/count` est limité à 4 hits par seconde (code source, `handlers/backend.go`) ; la file d'envoi reste espacée de 400 ms (`GOATCOUNTER_QUEUE_DELAY_MS`). Ne pas la raccourcir : un 429 perd des événements sans avertissement.
- **Lecture** : toujours rapporter un événement à `DailyUser-TOTAL` de la même période (rythmes d'ouverture très différents), agrégé sur ≥ 4 semaines ; avec peu d'utilisateurs, la composition du groupe domine le bruit.

## Tests automatisés (jsdom / Node)
Méthode utilisée pendant les chantiers événements : extraire le `<script>` par regex, `node --check`, compter les balises `<script>`/`</script>`, et lancer des harnais Node/jsdom qui extraient les **vraies fonctions** du fichier (jamais une copie) avec des globals factices. Les harnais précédents sont relancés à chaque passe. Limites : ni rendu visuel, ni confort tactile, ni moteur de rendu mobile → le test sur appareil reste indispensable.
- Les `let`/`const` de premier niveau (`settings`, `state`, `dailyData`) ne sont **pas** des propriétés de `window` ; y accéder via `window.eval("…")`.
- `refreshDailyEventUIs()` teste `overlay.style.display !== 'none'` : avant tout `openDailyEventsOverlay()`, le style inline est `''` → faux positif ; ouvrir l'overlay d'abord dans le test.
- jsdom normalise `style.background` en `rgb(…)` : comparer après conversion.
- Charger `js/daily-data.js` seul dans un contexte `vm` (globals factices `window`, `document`, `settings`, `dailyData`) permet de tester ses fonctions pures sans jsdom (ex. `getDailyGoatCounterPaths()` avec un `rand` injecté, `TZ=Europe/Brussels` pour les changements d'heure).
- `assert.deepStrictEqual` entre objets de deux contextes (jsdom / `vm`) échoue à cause des prototypes de **realms** différents : comparer via `JSON.stringify`.
- jsdom n'a pas `scrollTo` : le code garde un repli.
- **Chromium headless** pour le rendu et le tactile : `@sparticuz/chromium` + `puppeteer-core` (scripts `.mjs`, `npm` autorisé), vrais gestes via CDP `Input.dispatchTouchEvent` (un `scrollTop` programmatique ne reproduit pas l'élan). Masquer le splash d'installation (`[id*="splash" i]`), qui recouvre l'overlay. Pour tester le ping GoatCounter : stubber `window.goatcounter` et `Math.random` avec `evaluateOnNewDocument`, supprimer `lastDailyPingSent`, recharger. Les largeurs mesurées en headless diffèrent de celles d'un appareil (polices) : confirmer sur Android.
- jsdom ne charge pas les `<script src>` externes ni `matchMedia` : stubber `window.Chart` (au moins `.scales.x.getPixelForValue`) ou encadrer par `try/catch`.
