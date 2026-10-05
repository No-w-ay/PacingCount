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
- Un `messages.json` modifié sur `dev` n'est lu que par l'app servie depuis `dev` ; `main` a le sien. Le fetch utilise `cache: 'no-store'` et le fichier n'est pas dans `ASSETS_TO_CACHE`.
- Course SW / `messages.json` : si le message `update` n'apparaît pas, vérifier d'abord le timing de détection du nouveau SW (logs `[Update] …`) avant de soupçonner `maxVersion` / `validFrom`.
- Bug de continuité entre un état attendu et un fichier réel : repartir du fichier réel (dépôt, branche `dev`), jamais d'un document collé plus haut dans une conversation.

## Analytics (GoatCounter)
- Ping quotidien : `DailyUser-installed` seulement si `isPWAInstalled()` ; canaux détaillés `DailyUser-browser-X` / `-webview-X` / `-*-TOTAL` ; `DailyUser-alertON` si au moins une alerte active ; `DailyUser-LS-above-{1..4}MB` (taille localStorage). `period-started-sample10p` est échantillonné à 10 % (×10 pour estimer le volume). Interrupteur `SEND_DAILY_CUSTOM_PROFILE_EVENT = false`.

## Tests automatisés (jsdom / Node)
Méthode utilisée pendant les chantiers événements : extraire le `<script>` par regex, `node --check`, compter les balises `<script>`/`</script>`, et lancer des harnais Node/jsdom qui extraient les **vraies fonctions** du fichier (jamais une copie) avec des globals factices. Les harnais précédents sont relancés à chaque passe. Limites : ni rendu visuel, ni confort tactile, ni moteur de rendu mobile → le test sur appareil reste indispensable.
- Les `let`/`const` de premier niveau (`settings`, `state`, `dailyData`) ne sont **pas** des propriétés de `window` ; y accéder via `window.eval("…")`.
- `refreshDailyEventUIs()` teste `overlay.style.display !== 'none'` : avant tout `openDailyEventsOverlay()`, le style inline est `''` → faux positif ; ouvrir l'overlay d'abord dans le test.
- jsdom normalise `style.background` en `rgb(…)` : comparer après conversion.
- jsdom ne charge pas les `<script src>` externes ni `matchMedia` : stubber `window.Chart` (au moins `.scales.x.getPixelForValue`) ou encadrer par `try/catch`.
