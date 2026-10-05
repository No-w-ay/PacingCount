# Chantier « Notes & événements journaliers » — note de référence

> Source de vérité : le code (`js/daily-data.js`, `js/import-export.js`, `js/results.js`, `index.html`, `style.css`, `js/translations.js`, état beta.23).
> Cette note remplace les 3 synthèses `synthese-transition-notes-events*.md`.
> Chantier **en cours** : les fondations, la saisie, l'export/import et l'affichage dans plusieurs vues sont faits ; il reste de l'ergonomie, des réglages visuels et des extensions (voir `TODO.md`, section Notes & événements).
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

## 3. Interfaces (état actuel)

### 3.1. Tableau de saisie (overlay `#daily-events-overlay`, bouton 📝 sur la page Mesure)
- Overlay **portrait, sans rotation**, `z-index: 480`. Défilement natif ; en-tête et 1ʳᵉ colonne en `position: sticky` (hauteurs figées en CSS, jamais mesurées en JS). **Aucun geste tactile personnalisé.**
- **Fenêtre fixe de 2 mois civils pleins** : le mois ancre (`window.dailyEventsMonth`, le plus récent) + le mois précédent. Plus de barre de navigation en haut ni de lignes-teaser (retirées après la synthèse 2). Titre statique « Saisie journalière ».
- Navigation par 3 flèches dans la case d'en-tête Date : `↓` recule de 2 mois, `↑` avance de 2 mois (désactivé sur le mois courant), `⬆` retour au mois courant (désactivé sur le mois courant). Jamais de jour futur : sur le mois courant, la génération s'arrête au jour présent.
- **Générique par tag actif** : un tag `tristate` occupe 2 colonnes (Oui/Non, en-tête à 2 niveaux), un tag `presence` une seule. Un futur tag apparaît sans code supplémentaire.
- **Colonne Note** en dernière position : texte intégral plafonné à 2 lignes (`-webkit-line-clamp`), « Pas de note » en italique grisé si vide.
- **Panneau de note permanent** en haut (`#daily-events-note-panel`) : date en toutes lettres, `<textarea>` (2 lignes, 80 caractères), compteur `x/80`, indicateur « Enregistré » (réapparaît 600 ms après la dernière frappe). Le jour édité se choisit **par tap sur la colonne Date ou Note** (jamais sur une case d'événement) ; réinitialisé sur aujourd'hui à l'ouverture de l'overlay uniquement.
- Ligne éditée entourée en **beige** (`--beige-light: #e0c896`) par `box-shadow: inset` cellule par cellule (une bordure de `<tr>` est absorbée par `border-collapse`). Weekend atténué via un `<span>` autour du texte de la date (jamais sur la cellule, sinon le cadre est atténué aussi).
- `refreshDailyEventUIs()` : point de rafraîchissement unique après toute saisie (Résultats si actif, tableau si ouvert).

### 3.2. Pastilles et note dans les autres vues
- **Résultats** : sous/à côté de la date de chaque jour, pastilles d'événements (fond = couleur du tag, texte blanc, `border-radius: 10px`) alignées à droite de la date, note dessous (2 lignes max). Chaque ligne est **indépendamment** absente si vide. Non cliquable pour l'instant. Les jours **sans période enregistrée** restent invisibles même avec un event ou une note (option A actée).
- **Historique (graphe timeline)** : mini-**barrettes** (10×4 px, `border-radius: 2px`) sous les dates, positionnées en absolu à la position réelle de la colonne lue dans Chart.js (`scales.x.getPixelForValue(i)`), groupe centré, ordre stable (celui de `settings.eventTags`). Visibilité liée au bouton « L » de la légende.
- **Graphe journalier (Résultats)** : mêmes barrettes (`.daily-chart-event-markers`), mais en HTML/CSS pur (ce graphe n'utilise pas Chart.js), frères du `<div>` de date (pour ne pas hériter de l'opacité du weekend), toujours visibles (pas de bouton « L »).
- Le graphe hebdomadaire n'est volontairement **pas** concerné.
- **Règle de cohérence visuelle** : *cercle = type de période, pastille/barrette = événement journalier*.
- `getPresentDailyEventTags(dateKey)` : source unique de « quels événements sont présents ce jour », dans l'ordre stable de `settings.eventTags`.

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
5. Aucun geste tactile personnalisé dans le tableau (le défilement natif suffit en V1).
6. Une **suggestion visuelle** basée sur la veille (idée explorée) ne doit jamais écrire dans `events[]` : seul un clic explicite écrit, sinon on fabrique des valeurs « confirmées » fantômes.
7. `pem` est passé de `tristate` à `presence` (avec `day_ok` comme déclaration positive explicite), **sans code de migration** : l'app n'était pas diffusée publiquement.
8. `pacingDailyData` reste en **localStorage** ; IndexedDB est reporté à un chantier unique et dédié (voir `docs/optimisation-stockage-performance.md`).
9. Nommage : attribut `polarity` (valeurs `positive`/`negative`) tranché et codé ; `id` de tags en anglais (convention du projet).

## 6. Pistes explorées puis écartées

- Registre de notes de période séparé indexé par timestamp (`periodNotes[start]`) → remplacé par un champ `note` directement sur l'objet période (la règle « la note suit le premier morceau » est alors respectée gratuitement par `applySteamroller` / `mergeAdjacentPeriods`).
- Booléen `exclusiveWithOthers`, puis groupe nommé `exclusionGroup` → insuffisants (deux camps qui s'excluent entre eux sans s'exclure en interne) → `polarity`.
- Un seul CSV multi-types ; colonnes ajoutées au CSV.
- Sélection du jour édité par « snap » au défilement → remplacée par le tap explicite.
- Tooltip au tap sur les pastilles de l'Historique (reporté), caractère coloré dans l'étiquette Chart.js (impossible nativement : `ticks.color` s'applique à toute l'étiquette), couleur de la date elle-même (perd l'information « plusieurs events »), liseré dans la légende (mauvaise nature de donnée).
- Debounce généralisé de `saveState()` (voir stockage).

## 7. Pièges à ne pas réintroduire

- Tout texte interpolé dans un attribut ou un handler inline passe par `escapeHtml()`.
- Un rafraîchissement après saisie ne réécrit **jamais** un champ en cours de frappe : `renderDailyNotePanel()` seulement au changement de jour édité, jamais à chaque frappe (`onDailyNoteInput()` ne touche jamais `ta.value`).
- Toute fonction qui change l'état actif/inactif d'un type appelle ensuite `syncAlertsWithTypes()` (désactiver un type désactive ses alertes ; réactiver le type ne les réactive pas).
- L'exclusion par polarity ne s'applique qu'à l'**activation**.
- Contour de ligne dans une table `border-collapse` → `box-shadow: inset` par cellule.
- **Changement d'id d'un tag builtin** : la resynchronisation du bootstrap ne le gère pas (entrée orpheline dans `settings.eventTags` et `dailyData`) ; tant que l'app n'est pas diffusée, reset manuel `localStorage.removeItem('pacingSettings')` + `('pacingDailyData')`. Après diffusion publique, il faudra une vraie migration.
- Lire la géométrie réelle de Chart.js (`getPixelForValue`) pour aligner un élément sur un graphe.
- Pièges des harnais de test jsdom : voir `docs/CONVENTIONS.md`.

## 8. Ce qui reste à faire ou à décider (détail dans `TODO.md`)

- **Note de période** : non implémentée et **non sécurisée**. Avant toute UI, traiter les quatre points qui perdraient ou dupliqueraient `note` silencieusement : `closePeriod()` (recrée des objets `{typeId,start,end}` nus — le plus critique), `applySteamroller()` (le fragment droit doit perdre la note), `saveManualEdit()` (`newEntry` créé neuf), `mergeAdjacentPeriods()` (la note du second fragment est perdue si les deux en ont une).
- Tap sur les pastilles/note de Résultats → ouvrir l'overlay au bon jour (il faut positionner `dailyEventsMonth` sur la bonne paire de mois et faire défiler jusqu'à la ligne ; question ouverte : l'ancre reste-t-elle décalée après fermeture ?).
- Renommage éventuel du mode `presence` (famille « n-state » : `n−1` valeurs stockées + l'absence) — aucune urgence.
- Glisser-coche horizontal (V2 du tableau), indicateur « jour non rempli » sur le bouton 📝 (pas de clignotement : le langage visuel du projet est couleur/opacité), refonte de la navigation de l'overlay.
- Extension à d'autres tags (`numeric`…), suggestion « héritage de la veille » (uniquement visuelle), modes `scale` / `choice`.
- Petits nettoyages : clé `dailyEventsDateHeader` jamais utilisée, commentaire CSS faux sur le z-index (480 est *au-dessus* d'Évolution à 450), incohérence 80 / 5000 caractères.
