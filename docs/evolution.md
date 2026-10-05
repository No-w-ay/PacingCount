# Chantier « Graphique Évolution » — note de référence

> Source de vérité : le code (`js/evolution.js`, `style.css`, `js/translations.js`, état beta.23).
> Cette note remplace les 4 synthèses de transition `synthese-transition-evolution*.md`.
> Chantier **terminé** côté fonctionnalités ; il reste du raffinement visuel et quelques idées (voir `TODO.md`, section Évolution).

## 1. Ce que c'est

Un overlay plein écran, **paysage** (rotation CSS de 90°), ouvert depuis la page Résultats (`#results-nav-evolution` → `openEvolutionOverlay()`). Il trace l'évolution, jour après jour, du temps passé dans chaque type de période : points bruts + moyennes mobiles, sur une fenêtre de temps (« palier ») navigable.

- JS : `js/evolution.js` (≈1 770 lignes, chargé avant le script inline).
- HTML : bloc `#evolution-overlay` dans `index.html` (chips, `#evolution-chart-wrap`, légende, message « pas de données », toast, carte de valeurs, `#evolution-xaxis-hitzone`, `#evolution-xaxis-preview`, bouton fermer).
- CSS : section Évolution de `style.css`.
- Seule bibliothèque : Chart.js (vendorisé, `chart.js`).
- Clés de traduction : `evolution*` dans `js/translations.js` (FR/EN/NL).

## 2. Comportement actuel (vérifié dans le code)

### 2.1. Données
- **Jour complet** : un jour compte seulement si `totalMins ≥ 23×60 − 1` (`isComplete()`). Même seuil pour « aujourd'hui » que pour tout autre jour, sans traitement de faveur.
- **Index complet** : `buildEvolutionFullDaysIndex()` agrège **tout** l'historique en un index par jour (`{ daysData, dateKeys }`), mis en cache dans `window.evolutionFullDaysIndex`. Coût proportionnel au nombre de périodes ; calculé **une seule fois par ouverture de l'overlay**. Pas d'invalidation fine : l'overlay est plein écran, aucune édition possible pendant qu'il est ouvert.
- **Période active incluse** : elle est découpée à minuit par `splitPeriodIntoDayFragments()` (même helper que Résultats/graphiques/Historique), jamais exclue. Limite assumée : l'index n'est pas reconstruit en continu, « aujourd'hui » n'avance donc pas tant que l'overlay reste ouvert (fermer/rouvrir).
- **Moyennes mobiles** (`computeMovingAvg(halfWidth)`) : `~3j` = halfWidth 1, `~5j` = 2, `~7j` = 3, centrées, calculées sur l'**index complet** (pas de marge fixe). Un point n'existe que si tous les voisins de sa fenêtre sont des jours complets et calendairement contigus (contiguïté testée par composants de date, jamais en millisecondes — voir DST).
- **Ancrage hors fenêtre** : `reduceToWindowWithAnchors()` garde tous les points de la fenêtre + au plus un point d'ancrage avant et un après (`_anchor: true`), quelle que soit leur distance. Chart.js ne peut tracer (ni rogner) un segment qu'entre deux points présents dans le tableau.
- **Trous** : `spanGaps: true` partout. Si l'écart entre deux points dépasse `EVOLUTION_AVG_GAP_THRESHOLD_MS` (1,5 jour), le segment passe en pointillé `[4,4]` à opacité réduite (`evolutionSegmentDash`, `evolutionSegmentColor`). Un point **isolé** (aucun voisin proche) reçoit un rayon plus grand et reste toujours en pleine opacité : « ceci est une vraie donnée ».

### 2.2. Réglages et défauts
Persistés dans `settings` (défauts appliqués seulement si le champ est absent) :

| Réglage | Défaut |
|---|---|
| `evolutionSelectedSeries` | `[1]` (type 1 seul) |
| `evolutionShowRawPoints` (`1j`) | `true` |
| `evolutionShowMovingAvg` (`~3j`) | `false` |
| `evolutionShowMovingAvg5` (`~5j`) | `true` |
| `evolutionShowMovingAvg7` (`~7j`) | `false` |
| `evolutionShowLegend` (pastille « L ») | `true` (appliqué aussi rétroactivement, choix assumé) |

**Jamais persistés** (reviennent au défaut à chaque session) : le palier courant (défaut **3 mois**), le mode de l'axe Y (`full`), la position d'exploration.

Règles de cohérence :
- `~5j` et `~7j` sont **mutuellement exclusives**.
- Au moins **une série** doit rester sélectionnée (toast `evolutionMinOneSeries`).
- Au moins **une représentation** : `1j` bloquée si c'est la dernière active (toast `evolutionMinOneRepresentation`) ; si on désactive la dernière moyenne mobile active, `1j` s'active automatiquement (sans toast).
- La pastille `combined` (courbe blanche = somme des types de `settings.combinedTypeIds`) n'existe **que si cette combinaison n'est pas vide**.
- `cleanupCombinedTypeIds()` et le nettoyage de `evolutionSelectedSeries` (à l'ouverture de l'overlay et au rendu de Résultats) retirent les types sans données. Une série redevenue valide plus tard réapparaît **désélectionnée**.

### 2.3. Axe X — paliers
- `buildEvolutionPaliers()` (recalculé à chaque ouverture) : `1m, 2m, 3m, 4m, 6m, 9m, 1a`, puis `1.5a`, `2a` (seulement si l'historique les justifie), puis un palier par année tant qu'il ne couvre pas tout, puis `tout` (`months: null`, début = premier jour réel de l'historique).
- Calendrier réel : `getPalierStartDate()` utilise `new Date(y, m−N, d)`, jamais un nombre de jours fixe.
- **Pincement** (2 doigts) : écarter = palier plus court (zoom avant), rapprocher = palier plus long. Effet « cliquet » (`PINCH_STEP_THRESHOLD = 1.4`, recalculé depuis le dernier pas franchi, donc plusieurs paliers en un geste). **Au moins un des deux doigts doit démarrer dans la zone tactile du bas.**
- **Palette** : toucher le label de durée ouvre `#evolution-palier-picker` (sélection directe d'un palier).
- **Swipe** (1 doigt, mesuré sur `clientY` à cause de la rotation) : déplace la date de fin. Zone = `#evolution-xaxis-hitzone`, **120 px en bas du graphe**, `pointer-events: none` (simple référence géométrique). Seuil de confirmation `EVOLUTION_PAN_CONFIRM_PX = 8` : en dessous, c'est un tap potentiel et rien n'est bloqué. **Désactivé sur le palier `tout`.**
- **Bornes** (`clampEvolutionEndDate()`, `getEvolutionHistoryBounds()`) : borne haute = dernier jour réel de l'historique ; borne basse = `histStart + (windowDays − 1)` (la fenêtre commence au plus tôt au premier jour réel). Appliqué en direct pendant le swipe et centralement dans `renderEvolutionChart()`. Pas de marge de confort.
- Sélectionner `tout` remet la fin à aujourd'hui (`applyEvolutionPalierChange()`), puis le clamp la ramène au dernier jour réel si besoin.
- **Graduations** (`getEvolutionTickDaysInMonth`, `computeEvolutionTicks`, partagées entre le graphe réel et la bande de prévisualisation) : 1 mois → tous les jours ; 2–3 mois → pas de 5 ; 4–6 mois → pas de 10 ; ≥ 9 mois (dont `tout`) → un tick par mois.
- **Millésime** : `ticks.callback` renvoie un tableau `["janv.", "2026"]` pour tout 1er janvier (rendu multi-ligne natif), **à condition de figer la hauteur de l'axe** : `afterFit: scale.height = 44`. Hiérarchie d'opacité principal (0,95) / secondaire (0,55) partagée avec l'axe Y et la bande de prévisualisation (`EVOLUTION_TICK_PRINCIPAL_ALPHA` / `SECONDARY_ALPHA`).
- **Bande de prévisualisation** (`#evolution-xaxis-preview`, DOM indépendant de Chart.js, fond opaque, 33 px) : recouvre les graduations réelles pendant un geste de pincement/swipe et affiche les futures graduations (`renderEvolutionPreviewBand`). Les données réelles ne sont recalculées **qu'au relâchement** (contrainte de légèreté/batterie).

### 2.4. Axe Y
- Deux modes : `full` (0–24 h fixe, défaut) et `zoom` (adapté aux données réellement dessinées). Bascule par `#evolution-yaxis-toggle` (élément DOM, onclick), pas par détection de coordonnées dans le canvas.
- `computeYAxisRange()` : pas choisi selon l'amplitude brute (≤2 h → 10 min, ≤3 h → 15, ≤6 h → 30, ≤12 h → 1 h, sinon 2 h) ; min arrondi par le bas, max par le haut. Les points `_anchor` ne comptent **pas** avec leur valeur brute : on prend la valeur **interpolée** là où le segment croise le bord de la fenêtre.
- `formatEvolutionYTick(value, stepHours)` : si le pas implique des fractions d'heure, **toutes** les graduations s'affichent en `H:MM` ; sinon numéro d'heure seul.

### 2.5. Exploration tactile (tooltip Chart.js désactivé)
- Un toucher hors de la bande du bas affiche une **ligne verticale blanche** + un point par courbe active + la **carte de valeurs** `#evolution-value-card` (date complète en monospace, valeurs triées par ordre décroissant dans la couleur du type, suffixe « moyenne n jours », repli « aucune donnée à cette date »). Dessin dans le canvas via un plugin `afterDraw` (`evolutionExploreLinePlugin`) en lisant `scale.getPixelForValue()` / `getValueForPixel()`.
- Valeurs : exactes pour les points bruts (jamais interpolés), interpolées pour les moyennes mobiles.
- Modèle d'interaction final : le **contact** bascule l'affichage (montre si masqué, masque si visible) ; `touchmove` suit le doigt ; `touchend` ne masque rien. Un contact qui vient de **fermer** l'affichage ignore tout déplacement jusqu'au relâchement (`isClosing`). L'affichage disparaît au prochain changement réel (palier, sélection, navigation), pas pendant un simple geste.
- Conversion doigt → date : `(rect.bottom − touch.clientY) / rect.height` (sens validé sur appareil).

### 2.6. Chips, légende, messages
- Une seule rangée : chips de séries (types + `combined`), pastilles `1j / ~3j / ~5j / ~7j`, pastille `L`, puis à droite le groupe palier (pastille de durée + date de fin `→ DD MMM YYYY`).
- Date de fin en **monospace à largeur fixe** (`formatEvolutionEndDateFixed`, table `evolutionMonthsShort4` : mois sur 4 caractères, jour paddé par un espace) ; `white-space: pre` indispensable sur `#evolution-palier-end`.
- Mise à jour en direct pendant les gestes : pincement → seulement la durée ; swipe → seulement la date de fin.
- **Légende** (`#evolution-legend-panel`, coin haut-droit du graphe, `pointer-events: none`, fond `rgba(40,40,40,.8)`) : une entrée par type nommé (sélectionnés ∪ composants de la combinaison blanche, triés par id), ligne de décomposition `⚪ = 🔵 + 🟢` (disques sans marge propre dans un conteneur `inline-flex; gap:4px`), ligne « tendance interpolée (pas de données) » **uniquement si un vrai trou est visible**. Regroupement glouton par nombre de caractères (`evolutionLegendPackItems`, `maxChars = 45` fixé en dur).
- Message « pas de données dans cette vue » (`#evolution-no-data-msg`) : affiché quand tous les datasets construits sont vides.
- `showEvolutionGuardToast()` : toast local à l'overlay, en haut du graphe, anti-doublon.

## 3. Décisions de conception à retenir

1. **DOM plutôt que coordonnées Chart.js** pour tout ce qui est tactile ou positionnel sous la rotation CSS : les calculs sur `event.x/y` ou `chartArea` ne sont pas fiables sous transform ; un élément DOM avec `onclick` / `getBoundingClientRect()` l'est.
2. **Index complet + ancrage** plutôt qu'une marge fixe autour de la fenêtre : la marge (`MAX_AVG_HALF_WIDTH`) a été définitivement abandonnée car elle ne couvrait pas les trous de plusieurs mois.
3. **Recalcul uniquement au relâchement** d'un geste ; pendant le geste, seule la bande de prévisualisation (DOM, légère) bouge.
4. **Tap vs geste décidé sur la distance, jamais sur la durée.**
5. **Un état mémoire reflète la réalité du moment**, pas une intention passée (nettoyage des sélections fantômes).
6. **Palier et mode Y non persistés** ; légende persistée.
7. **Pas de marge de confort** sur le clamp de navigation (à reconsidérer seulement si la fenêtre paraît abrupte à l'usage).
8. **Période active incluse** dans l'index, avec le même seuil « jour complet » que les autres.

## 4. Pistes écartées ou abandonnées

- Détection du toggle Y par coordonnées dans le canvas Chart.js (peu fiable sous rotation).
- Plugin `afterDraw` dessinant le millésime à la main (offset deviné) → remplacé par le rendu multi-ligne natif + hauteur d'axe figée.
- Garde-fou « pas de pincement si un pan est actif » : il cassait tous les pincements (le 1er doigt démarrait un pan). Remplacé par le seuil de 8 px.
- Cadre « Collectez plus de données » avec seuil de 6 jours complets → remplacé par le simple test « datasets vides ».
- Distinguer tap et drag par une attente temporelle (erreur corrigée).
- Option A de l'exploration (seuil de déplacement sur `touchmove` pour la fermeture) → remplacée par `isClosing` (déterministe, sans valeur à calibrer).
- Zone de swipe sur toute la hauteur du graphe (essayée, abandonnée pour 120 px).
- Exclusion de la période active en entier (contournement d'un bug de fond, remplacé par le découpage à minuit).
- Étiquette Chart.js multi-ligne **sans** hauteur figée (zone de tracé variable).

## 5. Pièges à ne pas réintroduire

- **Fermetures figées après `chart.update()`** : un callback Chart.js (`color`, `callback`, `afterBuildTicks`, `afterDraw`…) défini à la création ne voit que les variables capturées au 1er rendu. Il doit lire `this.options…` (callback `function`, pas arrow) ou une variable `window.*` réassignée à chaque rendu (`window._evolutionCurrentPalier`). Rencontré trois fois.
- **`pointer-events: none`** sur tout élément qui ne sert que de référence géométrique (sinon il avale les taps du canvas).
- **Sens des conversions tactiles** (`clientY` → date/position) : à valider **sur appareil**. Trois inversions de signe constatées (pincement, swipe, exploration) : la dérivation théorique de la rotation n'a jamais suffi.
- **DST** : jour suivant = `new Date(y, m, d + 1)`, jamais `+ 86400000` (la moyenne mobile avait cassé sur la nuit à 23 h de mars). `86400000` subsiste dans `evolution.js` uniquement pour des **durées** (nombre de jours d'une fenêtre), pas pour passer au jour suivant.
- **`_anchor`** : ne jamais compter sa valeur brute dans l'échelle Y.
- **Durées h/min** : toujours `splitMinutesHM()` / `formatMins()` (pas de `floor` + `round` séparés → « 2h60 »).
- **Texte HTML interpolé** (`onclick`, `title`) : toujours `escapeHtml()`.
- **Largeur fixe** de la date de fin : ne pas retirer `white-space: pre`.
- **Aligner un élément sur un graphe Chart.js** : lire la géométrie réelle (`getPixelForValue`), ne jamais deviner un offset en pixels.

## 6. Corrections de bugs notables (mémoire)

Échelle Y faussée par une période > 24 h non découpée ; millésime tronqué ; DST dans `computeMovingAvg` ; sélections et compositions fantômes après import « remplacer » ; palier `tout` tronqué (fin non remise à aujourd'hui) ; trait pointillé disparaissant au bord de fenêtre ; débordement vertical du pointillé rogné ; « Xh60 » (5 endroits corrigés via `splitMinutesHM`).

## 7. Idées non réalisées (voir `TODO.md`)

Pincement « à ancre » pour le palier `tout` ; marqueur de point isolé en pointillé ; marge de confort du clamp ; bande de prévisualisation (33 px) plus basse que l'axe réel (44 px) ; validation de l'usage réel (sensibilité de la zone 120 px, seuil 8 px, paliers annuels > 2a, valeurs par défaut).
