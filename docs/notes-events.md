# Chantier « Notes & événements journaliers » — note de référence

> Source de vérité : le code (`js/daily-data.js`, `js/import-export.js`, `js/results.js`, `index.html`, `style.css`, `js/translations.js`, état beta.28).
> Cette note remplace les 3 synthèses `synthese-transition-notes-events*.md`.
> Chantier **en cours** : les fondations, la saisie, l'export/import, l'affichage dans plusieurs vues, le tableau à défilement continu (beta.24 à 28) et la mesure d'usage GoatCounter sont faits ; il reste un test d'usage réel avec peu de types d'événements, la décision sur la visibilité des événements et des extensions (voir `TODO.md`, section Notes & événements).
> Le volet stockage/performance, issu des mêmes synthèses, est traité à part dans `docs/optimisation-stockage-performance.md`.

## 1. Idée directrice

Une seule fondation de données par **jour civil** couvre à la fois la note journalière et les événements de suivi (MPE/PEM, malade, jour OK, et plus tard médicament, repas…). Un épisode de MPE se représente comme un tag actif sur les jours concernés : pas de structure « événement à durée » séparée.

Trois types de données avaient été identifiés :
1. **Note journalière** (texte libre, une par jour) — fait.
2. **Événement de suivi** (tag + valeur éventuelle) — fait pour le mode `presence`.
3. **Note de période** (texte attaché à une entrée de `state.history[]`) — **conçue mais non implémentée** (voir § 8).

## 2. Modèle de données (vérifié dans le code)

### 2.1. `pacingDailyData` (localStorage)
Objet indexé par date ISO `AAAA-MM-JJ` :
```js
{ "2026-07-15": { "text": "…", "events": [ { "tagId": "pem" } ] } }
```
- `text` et `events` sont des **champs frères**, chacun facultatif (un jour sans rien n'a pas de clé). Ne jamais les imbriquer.
- Chargement défensif (`try/catch`, repli `{}`), sauvegarde par `saveDailyData()` → `safeSave()`. `let dailyData` et `saveDailyData()` restent dans `index.html` (section 4).
- **Note** : limite de **80 caractères** dans l'UI (`maxlength` + `setDailyNote()`), alors que l'import JSON accepte jusqu'à `IMPORT_MAX_DAY_TEXT = 5000` caractères (incohérence connue, voir `TODO.md`).

### 2.2. `settings.eventTags[]`
Même principe que `settings.types[]` : id stable, label, actif/inactif.
```js
{ id, label, description, active, mode, polarity?, timed, repeatable, builtin }
```
- Les tags `builtin` viennent de `BUILTIN_EVENT_TAGS` (définis dans `js/daily-data.js`, labels `{fr,en,nl}`) et sont **fusionnés dans `settings.eventTags` au bootstrap** (section 4 d'`index.html`). Les tags manquants sont ajoutés ; pour un tag déjà présent, le bootstrap **réécrit** `mode`, `polarity`, `timed`, `repeatable` depuis la définition builtin, mais **jamais** `active` (réglage utilisateur) ni `label`/`description` (gérés par `changeLang()`).
- ⚠️ Un **changement d'`id`** n'est pas couvert par cette resynchronisation : l'ancienne entrée reste orpheline (voir § 7).
- **`active` = visibilité** : un tag inactif disparaît du tableau, des pastilles et des mesures. Aucune interface de réglage pour l'instant (jugée « trop spéculative ») ; les trois tags builtin sont actifs par défaut (`buildEventTagFromBuiltin()` pose `active: true`). Si tous les tags sont masqués, le tableau reste utilisable pour les notes. Idée abandonnée pour l'instant : un champ `defaultActive: false` pour démarrer « Malade » masqué (décision du 2026-10-07 : on ne le désactive pas encore).
- `timed` (capturer une heure) et `repeatable` (plusieurs occurrences par jour) existent dans la structure mais sont `false` pour les trois tags actuels. Le combo `timed:false, repeatable:true` n'a pas de sens (occurrences indiscernables).

### 2.3. Tags builtin actuels
| id | FR / EN / NL | mode | polarity | couleur |
|---|---|---|---|---|
| `pem` | MPE / PEM / PEM | `presence` | `negative` | `#8e2b2b` (rouge sombre) |
| `sick` | Malade / Sick / Ziek | `presence` | `negative` | `#a45c1f` (orange sombre) |
| `day_ok` | Jour OK / Day OK / Dag OK | `presence` | `positive` | `#2e6b3a` (vert sombre) |

Les couleurs sont dans `EVENT_TAG_COLORS` (`js/daily-data.js`), une source unique par `tagId` ; `getEventTagColor()` retombe sur `var(--blue)` pour un tag inconnu. Description de `sick` : « Malade (agent infectieux) » (distinction volontaire avec une simple sensation de malaise). Les textes EN/NL de `day_ok` ont été traduits par Claude et pas relus mot à mot.

### 2.4. Modes d'événement
- **`presence`** : un event existe ou n'existe pas (`{ tagId }`, pas de `value`).
- **`tristate`** : `{ tagId, value: "yes" | "no" }`, l'absence = « non renseigné » (distinction jugée non négociable pour un tag type MPE si on veut un « je confirme qu'il n'y en a pas eu »). **Aucun tag tristate actif aujourd'hui**, mais tout le code (tableau, exclusion, import) le gère de façon générique.
- **`numeric`** : `{ tagId, value: number, time? }` — prévu dans `IMPORT_TAG_MODES`, pas d'UI.
- Une seule forme d'event pour tous les modes : `{ tagId, time?, value? }`, interprétée selon le `mode` du tag.
- `scale` (0-10), `choice` (liste courte), texte libre par event : **non retenus** pour l'instant (à n'ajouter que sur besoin confirmé).

### 2.5. Exclusion par `polarity`
Attribut optionnel `polarity: 'positive' | 'negative'`. Règle unique (`getTagPolarity()` + `stripOppositePolarityEvents()`) : **à l'activation uniquement** d'un tag, on retire du jour tous les events de polarity **opposée**. Même polarity → coexistence libre ; pas de polarity → tag indépendant.
- Exemple : cocher « Jour OK » efface MPE et Malade du jour ; cocher MPE efface « Jour OK » ; MPE et Malade coexistent.
- Jamais appliquée à la désactivation ni à un changement de valeur interne (Oui↔Non).
- Implémentée à l'identique dans `toggleEventPresence()` et `toggleEventTristate()`.
- La règle **ignore `active`** (elle filtre via `getTagPolarity()` sans regarder la visibilité). Piste retenue pour plus tard, quand une interface de masquage existera : ne l'appliquer qu'entre tags visibles ; la coexistence d'événements opposés après réactivation d'un tag masqué est acceptable et visible.

## 3. Interfaces (état actuel)

### 3.1. Tableau de saisie (overlay `#daily-events-overlay`, bouton 📝 sur la page Mesure) — état beta.28
Refonte en beta.24 à 28 : l'ancien tableau `<table>` (fenêtre de 2 mois, flèches ↓ ↑ ⬆, séparateur de mois, cadre beige par ligne) a été **remplacé** ; dernière version avec : commit `f99733a` (tableau à mois) et `d305079` (beta.24, cadre beige `.de-row-editing`).

**Structure et défilement**
- Overlay **portrait, sans rotation**, `z-index: 480`. Un seul conteneur défilable (`#daily-events-scroll`) : défilement **continu vers le passé**, jamais de jour futur. Le rang 0 = aujourd'hui, figé à l'ouverture ; l'overlay s'ouvre toujours sur aujourd'hui.
- **Fenêtre virtuelle** : 60 lignes dessinées dans le DOM (`DAILY_EVENTS_WINDOW_ROWS`), lignes de **44 px exactement** posées en absolu (`top = rang × 44`). Zone défilable initiale de 150 lignes, prolongée de 90 à l'approche de la fin. Redessin par hystérésis (`MARGIN_LOW` 10 / `MARGIN_HIGH` 30, recentrage 20). Aucune mesure de géométrie en JS : tout vient de constantes (sauf la largeur de la colonne Date, voir plus bas).
- En-tête et 1ʳᵉ colonne en `position: sticky`, hauteurs figées en CSS (`--de-row-h`, `--de-head-h` : 44 px sans tag tristate, 60 px avec ; `--de-head-rows`).
- Écouteur de défilement limité à une exécution par image (`requestAnimationFrame`).

**Jour édité = ligne du haut**
- Un **cadre fixe** (`#daily-events-frame`, sticky sous l'en-tête, `pointer-events: none`) remplace le cadre par ligne. Un seul indicateur de jour (variante A retenue).
- Pendant le défilement, le panneau suit en direct la ligne du haut (date en direct, panneau grisé et en lecture seule), puis se **recale** après 140 ms de silence sur la ligne du haut et charge sa note. Pas de recalage tant que le doigt ou la souris est posé (`touchstart/mousedown`, relâché par `touchend/touchcancel/mouseup`).
- Tap sur la date ou la note d'une ligne : amène ce jour en haut (glissement doux si ≤ 14 lignes, sinon saut instantané avec validation immédiate de la ligne). Un tap ne touche jamais aux cases d'événement.
- Bouton du coin « Ajd ⬆ » / « Today ⬆ » / « Vandaag ⬆ » : retour à aujourd'hui (grisé quand on y est).

**Colonnes**
- Date | un tag par colonne (deux pour un `tristate`) | Note **élastique** : `minmax(170px, 1fr)`, grille bornée entre colonnes fixes + 170 px et colonnes fixes + 320 px (80 caractères tiennent sur 2 lignes sans troncature au plafond).
- **Colonne Date** : jour de la semaine sur 2 lettres + `jj/mm` **sans année** (l'année est dans la pastille de date du panneau) ; la ligne d'aujourd'hui est sur 2 lignes (« Aujourd'hui » en bleu, pas en gras, puis la date). Largeur **mesurée** à chaque rendu complet (`measureDailyEventsDateColW()` : copies hors écran avec les vraies classes, dates sur 14 jours, libellé du jour et bouton du coin, + 2 px) ; repli `DAILY_EVENTS_COL_DATE_W = 92` seulement si la mesure donne 0 (overlay masqué).
- Notes vides : tiret « – » pâle (opacité 0,3). Libellé « Note » aligné à gauche, en-têtes « Date » et « Note » en gris un peu plus clair que les en-têtes d'événement.
- **Info-bulle** sur un en-tête d'événement : tap (ou survol sur ordinateur, attribut `title`) ; une seule à la fois ; se ferme au retap, au tap ailleurs, au défilement ou après 5 s. Texte pris à la source (`BUILTIN_EVENT_TAGS`, langue courante) via `getDailyEventTagTip()` ; affiché en `textContent`.
- Titre de l'overlay en 1,1 rem (comme « Totaux par jour » et « Historique »).

**Panneau de note permanent** (`#daily-events-note-panel`)
- `<textarea>` de 2 lignes avec texte d'indication « Note facultative » / « Optional note » / « Optionele notitie ». Dessous, une ligne en grille `1fr auto 1fr` : compteur `x/80` | **pastille de date** (monospace, jour de semaine sur 2 lettres, avec une `<input type=date>` transparente par-dessus, `max` = aujourd'hui, pour sauter à une date) | indicateur « Enregistré » (réapparaît 600 ms après la dernière frappe).
- **Limite de 80 caractères** : `maxlength` seul bloque en silence sur ordinateur et ne couvre pas tous les claviers mobiles ; `onDailyNoteInput()` tronque aussi à 80 (curseur conservé, paires de substitution/emoji intactes) et un écouteur `beforeinput` détecte la tentative de dépassement. Retour visuel : le compteur passe en **ambre** (`#e3a53a`, gras) 600 ms, sans changer la couleur du cadre ni afficher de message.

- `refreshDailyEventUIs()` : point de rafraîchissement unique après toute saisie (Résultats si actif, ligne du tableau si ouvert via `refreshDailyEventsRow()`).

### 3.2. Pastilles et note dans les autres vues
- **Résultats** : sous/à côté de la date de chaque jour, pastilles d'événements (fond = couleur du tag, texte blanc, `border-radius: 10px`) alignées à droite de la date, note dessous (2 lignes max). Chaque ligne est **indépendamment** absente si vide. Non cliquable pour l'instant. Les jours **sans période enregistrée** restent invisibles même avec un event ou une note (option A actée).
- **Historique (graphe timeline)** : mini-**barrettes** (10×4 px, `border-radius: 2px`) sous les dates, positionnées en absolu à la position réelle de la colonne lue dans Chart.js (`scales.x.getPixelForValue(i)`), groupe centré, ordre stable (celui de `settings.eventTags`). Visibilité liée au bouton « L » de la légende.
- **Graphe journalier (Résultats)** : mêmes barrettes (`.daily-chart-event-markers`), mais en HTML/CSS pur (ce graphe n'utilise pas Chart.js), frères du `<div>` de date (pour ne pas hériter de l'opacité du weekend), toujours visibles (pas de bouton « L »).
- Le graphe hebdomadaire n'est volontairement **pas** concerné.
- **Règle de cohérence visuelle** : *cercle = type de période, pastille/barrette = événement journalier*.
- `getPresentDailyEventTags(dateKey)` : source unique de « quels événements sont présents ce jour », dans l'ordre stable de `settings.eventTags`.

### 3.3. Mesure d'usage GoatCounter (beta.28)
Événements envoyés dans le **ping quotidien existant** (une fois par jour, en ligne, pas le jour du tout premier lancement), en **fin de file**, après les `DailyUser-*`. Fonction `getDailyGoatCounterPaths()` dans `js/daily-data.js`, appel dans `index.html` (bloc 4 du ping, protégé par `try/catch`).
- **Quand** : on ne regarde que **la veille** (date locale du calendrier : `new Date(y, m, d - 1)`).
- **Événements** `Daily-event-1`, `Daily-event-2`, `Daily-event-3` = MPE (`pem`), Malade (`sick`), Jour OK (`day_ok`) — **numéros, pas de noms explicites** (table `DAILY_GOAT_EVENT_NUM` ; un nouveau tag builtin doit y recevoir un numéro, sinon il n'est pas envoyé). Conditions : tag builtin, actif, de mode `presence`, présent la veille. Jamais d'identifiant de tag non builtin (un tag personnel pourrait avoir un nom personnel).
- **Masquage par tirage** pour chaque tag concerné : 0 envoi (1/4), 1 envoi (1/2), 2 envois (1/4) → moyenne 1 (comptage non biaisé), mais la présence individuelle n'est plus déductible. Variance 0,5 (choisie plutôt que 0/1/2 équiprobable, variance 0,67, pour réduire le bruit).
- **`Daily-note`** : un seul envoi si le texte de la veille n'est pas vide (espaces seuls ignorés), **sans masquage**.
- Un log console `[GoatCounter] Veille AAAA-MM-JJ : <event> → n envoi(s)` indique chaque tirage (y compris 0). Pour retester : supprimer `lastDailyPingSent` du localStorage et recharger (il faut un événement ou une note posés la veille ; le tirage est aléatoire).
- **Lecture** : le total d'un événement ne compte pas des jours d'événement ; il compte « jours d'ouverture × part de jours avec l'événement la veille ». Lire le **rapport** `événement ÷ DailyUser-TOTAL` de la même période, agrégé sur **au moins 4 semaines**, en regardant le total des hits (pas les visiteurs uniques : comportement de GoatCounter face à deux hits identiques d'un même visiteur non vérifié). Les utilisateurs fréquents y pèsent davantage ; adoption et intensité ne se séparent pas (GoatCounter n'a pas d'identité d'utilisateur).
- **Ordres de grandeur (simulation et calcul à la main, hypothèses : 30 utilisateurs dont un tiers ouvre l'app tous les jours, un tiers 4 jours par semaine, un tiers 2 jours par semaine)** : avec 15 utilisateurs de la fonction ≈ 72 événements sur 4 semaines, bruit du tirage ≈ 9 % (≈ 13 % avec « hier »), variation due à la composition du groupe ≈ 27 % ; avec 5 utilisateurs de la fonction ≈ 26 événements, tirage ≈ 17 % (≈ 24 %), composition ≈ 46 %. La composition d'un petit groupe domine donc le bruit du tirage ; une semaine seule est trop bruitée (±30 % à ±60 %). Biais selon le rythme d'ouverture : envois par jour d'événement réel ≈ 1,00 (ouverture quotidienne), ≈ 0,57 (4 j/sem.), ≈ 0,29 (2 j/sem.).
- **Limites** : si l'app est fermée avant la fin de la file (au pire ≈ 3 s pour 7 hits ajoutés : 3 types × 2 + la note), les derniers événements sont perdus, `lastDailyPingSent` étant déjà posé (même limite que les `DailyUser-*`, un peu plus marquée ici car ces événements sont en fin de file). La file reste à **400 ms** : GoatCounter limite `/count` à 4 hits par seconde (commentaire du code source), 300 ms laisserait trop peu de marge pour un gain inférieur à 1 s.

## 4. Export / Import

### 4.1. Choix du format
- **CSV inchangé** (périodes uniquement) : le parseur est un `split(',')` naïf sans échappement, qui casserait sur du texte libre ; on ne l'a pas touché. Un ancien CSV reste donc importable tel quel.
- **JSON nouveau** pour tout le reste, miroir direct des structures internes (pas de conversion aller/retour). Structure (`buildJSONExport()`, `JSON_EXPORT_FORMAT_VERSION = 1`) :
```json
{ "format": "pacingcount-export", "formatVersion": 1, "exportedAt": "…", "appVersion": "…",
  "periodData": [ { "typeId": 1, "start": 0, "end": 0 } ],
  "dailyData": { "AAAA-MM-JJ": { "text": "…", "events": [ { "tagId": "pem" } ] } },
  "eventTags": [ ],
  "typesConfig": { "activeProfile": "…", "types": [ ] } }
```
- `periodData` = `state.history` + la période active convertie en entrée close. Alertes et préférences d'affichage **jamais exportées** (propres à l'appareil).
- Un futur XLSX serait écrit directement depuis les structures internes, pas depuis un export : choisir JSON plutôt que CSV n'a donc coûté aucun travail futur.
- Pas de zip : un second fichier téléchargé suffit pour l'instant.

### 4.2. Import (`importFile()` → `importJSON()` / `importCSV()`)
- **Détection par le contenu** (`{` en tête → JSON, sinon CSV), pas par l'extension (certains navigateurs Android renvoient `text/plain`).
- **Principe** : un import ne remplace que ce que son format contient ; une clé absente du fichier ne touche à rien.
- **Validation en mémoire avant toute écriture** (`validateJSONImport()`) : refuse un fichier non PacingCount ou de version plus récente ; filtre les périodes invalides ; assainit les libellés (30 caractères, caractères dangereux retirés) ; valide les clés de date ; n'accepte que les events cohérents avec le mode du tag (`tristate` → `value` obligatoire, `presence` → pas de `value`) ; propage `polarity` (valeurs strictes `positive`/`negative`).
- Reconnaissance de profil multilingue (`matchProfileAnyLang()`), différences de types pertinentes seulement (`computeImportTypeDiffs()`), **confirmation obligatoire** avant d'écraser `typesConfig`.
- Fusion des events (`mergeDailyDataInto()`) par jour **et** par tag : une absence dans le fichier n'efface jamais rien, le fichier gagne sur un désaccord.
- **Retour arrière** (`rollbackJsonImport()`) : copie de sécurité avant écriture, restauration en deux passes si un quota est dépassé.
- Modal dédié `#importJsonModal`. Tous les boutons d'export (footer Historique, toasts de stockage, splash iOS, mise à jour) pointent vers `exportJSON()`. **Seuls restent en CSV** les deux écrans de navigateur intégré (Facebook & co.) ; pas d'export JSON en webview.

## 5. Décisions de conception à retenir

1. Granularité **jour civil** (ni par période, ni horodatée librement).
2. `text` et `events` sont frères, pas parent/enfant.
3. Les tags builtin sont fusionnés dans `settings.eventTags` (pas de liste séparée à concaténer partout).
4. Un format JSON « mature » dès la première version pour ne plus retoucher sa *forme* (seul son contenu s'enrichit).
5. Aucun geste tactile personnalisé dans le tableau (défilement natif ; le recalage sur la ligne du haut est un script, pas un geste).
6. Une **suggestion visuelle** basée sur la veille (idée explorée) ne doit jamais écrire dans `events[]` : seul un clic explicite écrit, sinon on fabrique des valeurs « confirmées » fantômes.
7. `pem` est passé de `tristate` à `presence` (avec `day_ok` comme déclaration positive explicite), **sans code de migration** : l'app n'était pas diffusée publiquement.
8. `pacingDailyData` reste en **localStorage** ; IndexedDB est reporté à un chantier unique et dédié (voir `docs/optimisation-stockage-performance.md`).
9. Tableau à **défilement continu** (fenêtre virtuelle) et **jour édité = ligne du haut** (cadre fixe, panneau qui suit puis se recale) plutôt qu'une fenêtre de mois, qu'un tap explicite seul ou qu'un défilement avec accroche CSS.
10. **Un seul indicateur de jour** (cadre fixe) ; pas de second indicateur concurrent.
11. Largeur de la colonne Date **mesurée** (plus de risque de troncature selon la police/langue), les autres largeurs restent des constantes.
12. Visibilité des événements = champ `active` existant, **sans interface de réglage** pour l'instant ; test d'usage d'abord avec peu de types d'événements.
13. Mesure d'usage : un événement GoatCounter **par type d'événement** (non agrégés), la veille seulement, tirage 0/1/2 (1/4, 1/2, 1/4), `Daily-note` sans masquage ; noms numériques.
14. Nommage : attribut `polarity` (valeurs `positive`/`negative`) tranché et codé ; `id` de tags en anglais (convention du projet).

## 6. Pistes explorées puis écartées

- Registre de notes de période séparé indexé par timestamp (`periodNotes[start]`) → remplacé par un champ `note` directement sur l'objet période (la règle « la note suit le premier morceau » est alors respectée gratuitement par `applySteamroller` / `mergeAdjacentPeriods`).
- Booléen `exclusiveWithOthers`, puis groupe nommé `exclusionGroup` → insuffisants (deux camps qui s'excluent entre eux sans s'exclure en interne) → `polarity`.
- Un seul CSV multi-types ; colonnes ajoutées au CSV.
- Sélection du jour édité par « snap » au défilement → remplacée par le tap explicite.
- Tooltip au tap sur les pastilles de l'Historique (reporté), caractère coloré dans l'étiquette Chart.js (impossible nativement : `ticks.color` s'applique à toute l'étiquette), couleur de la date elle-même (perd l'information « plusieurs events »), liseré dans la légende (mauvaise nature de donnée).
- Debounce généralisé de `saveState()` (voir stockage).
- **Tableau (beta.24 à 28)** : `scroll-snap` CSS avec une fenêtre virtuelle (incompatible : le navigateur recale sur des lignes qui changent) ; chargement par blocs avec rognage du haut ; variante B (second indicateur de jour concurrent du cadre fixe) ; message texte à 80/80 (remplacé par le compteur ambre) ; changement de couleur du cadre de note à 80 ; année dans la colonne Date ; libellé « Pas de note » (remplacé par un tiret pâle) ; réduction du padding latéral autour du bouton « Ajd ⬆ » ; bloc de réglage de visibilité dans les Réglages (trop spéculatif).
- **GoatCounter** : paliers (« buckets ») d'intensité par événement (trop de choses à lire) ; événement « découverte » (non nécessaire, rester simple) ; événement à chaque clic ; fenêtre glissante de 10 jours avec envoi à la probabilité T/10 (précision un peu meilleure, code plus long, nombre de jours à justifier : remplacée par « hier » pour la simplicité, la différence totale étant de l'ordre de 2 points face à la variation de composition) ; événements nommés par tag (`Daily-event-pem`…) au profit de numéros ; file à 300 ms (limite de 4 hits/s).

## 7. Pièges à ne pas réintroduire

- Tout texte interpolé dans un attribut ou un handler inline passe par `escapeHtml()`.
- Un rafraîchissement après saisie ne réécrit **jamais** un champ en cours de frappe : `renderDailyNotePanel()` seulement au changement de jour édité, jamais à chaque frappe (`onDailyNoteInput()` ne touche à `ta.value` que pour **tronquer** au-delà de 80 caractères, curseur conservé).
- Toute fonction qui change l'état actif/inactif d'un type appelle ensuite `syncAlertsWithTypes()` (désactiver un type désactive ses alertes ; réactiver le type ne les réactive pas).
- L'exclusion par polarity ne s'applique qu'à l'**activation**.
- (Ancien tableau `<table>`) Contour de ligne dans une table `border-collapse` → `box-shadow: inset` par cellule. Le tableau actuel est une grille de `div` : le cadre est un élément sticky dédié.
- **Hauteur exacte des lignes** : 44 px posées en CSS (`--de-row-h`) **et** en JS (`DAILY_EVENTS_ROW_H`) ; tout contenu qui ferait grandir une ligne fausserait `top = rang × 44` et le recalage. Ne rien ajouter qui dépende du contenu dans une ligne.
- **`maxlength` ne suffit pas** pour la limite de 80 : sur ordinateur il bloque en silence (donc `beforeinput` pour allumer le compteur), et certains claviers mobiles (Samsung) contournent la limite (donc troncature dans `onDailyNoteInput()`).
- **`touchcancel`** : le navigateur reprend le geste (fin du contrôle JS, l'élan continue) ; traité comme un relâchement qui réarme le recalage.
- **Sonde de mesure** : toujours retirée dans un `finally` ; hors écran (`visibility: hidden`), jamais dans un conteneur `display: none` (largeur 0 → repli à 92 px).
- **Ajouter un tag builtin** : lui donner une couleur (`EVENT_TAG_COLORS`), des descriptions FR/EN/NL (`BUILTIN_EVENT_TAGS`, source des info-bulles) **et un numéro GoatCounter** (`DAILY_GOAT_EVENT_NUM`).
- **Changement d'id d'un tag builtin** : la resynchronisation du bootstrap ne le gère pas (entrée orpheline dans `settings.eventTags` et `dailyData`) ; tant que l'app n'est pas diffusée, reset manuel `localStorage.removeItem('pacingSettings')` + `('pacingDailyData')`. Après diffusion publique, il faudra une vraie migration.
- Lire la géométrie réelle de Chart.js (`getPixelForValue`) pour aligner un élément sur un graphe.
- Pièges des harnais de test jsdom : voir `docs/CONVENTIONS.md`.

## 8. Ce qui reste à faire ou à décider (détail dans `TODO.md`)

- **À confirmer avant la publication** : actifs par défaut pour MPE et Jour OK ; Malade reste actif pour l'instant. Test d'usage réel avec 2 types d'événements, puis décision sur une interface de visibilité (et sur la règle de polarité entre tags visibles seulement).
- **Lire les premières mesures** `Daily-event-1/2/3` et `Daily-note` (événement ÷ `DailyUser-TOTAL`, ≥ 4 semaines) ; vérifier le comptage de deux hits identiques dans le tableau de bord.
- **Note de période** : non implémentée et **non sécurisée**. Avant toute UI, traiter les quatre points qui perdraient ou dupliqueraient `note` silencieusement : `closePeriod()` (recrée des objets `{typeId,start,end}` nus — le plus critique), `applySteamroller()` (le fragment droit doit perdre la note), `saveManualEdit()` (`newEntry` créé neuf), `mergeAdjacentPeriods()` (la note du second fragment est perdue si les deux en ont une).
- **Tap sur les pastilles/note de Résultats → ouvrir l'overlay au bon jour** : plus simple qu'avant (défilement continu, rang 0 = aujourd'hui : il suffit de calculer le rang et d'appeler le tap sur date) ; à valider avec le report de `renderResults()` pendant que l'overlay est ouvert.
- Leviers pour gagner de la largeur si besoin : police du libellé « Aujourd'hui » (0,74 rem ≈ 6 px), colonnes de tag (44 px ≈ 6 px).
- Renommage éventuel du mode `presence` (famille « n-state ») — aucune urgence.
- Glisser-coche horizontal (V2 du tableau), indicateur « jour non rempli » sur le bouton 📝 (pas de clignotement : le langage visuel du projet est couleur/opacité).
- Extension à d'autres tags (`numeric`…), suggestion « héritage de la veille » (uniquement visuelle), modes `scale` / `choice`.
- Relire les textes EN/NL de `day_ok` et des descriptions d'info-bulle (traduits par Claude).
- Petits nettoyages : clé `dailyEventsDateHeader` jamais utilisée (3 occurrences dans `js/translations.js`), commentaire CSS faux sur le z-index (480 est *au-dessus* d'Évolution à 450), incohérence 80 / 5000 caractères.
