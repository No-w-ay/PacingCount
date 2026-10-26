# Optimisation : stockage, CPU, mémoire, batterie — note de référence

> Fusion de l'ancienne note « Optimisation CPU, mémoire, batterie (état au 27 juin 2026) » et de l'ancienne note `stockage-performance.md`.
> Vérifiée contre le code de `dev` (beta.23, 2026-10-05). Les chiffres de taille datent de l'été 2026 (mesure sur un historique réel).
> **Rien n'est tranché** parmi les options d'architecture du § 4 : la décision attend des mesures réelles (GoatCounter `DailyUser-LS-above-*MB`) et la stabilisation du chantier notes/événements.

## 1. Tableau de bord : état des points de l'ancienne note

| Point (note du 27 juin) | État | Détail |
|---|---|---|
| Aucun `try/catch` sur `saveState()` / `saveSettings()` (critique) | **Fait, avec reste** | `safeSave()` (try/catch + `showStorageFullToast()`) est utilisée par `saveState()`, `saveSettings()`, `saveDailyData()` et la plupart des écritures de `pacingSettings` (evolution.js, results.js, index.html). **Reste** : 6 écritures directes `localStorage.setItem('pacingSettings', …)` non protégées dans `saveAlert()`, `deleteAlert()`, `toggleAlert()`, `applyProfile()`, `restoreCustomProfile()`, `changeLang()`, plus les chemins d'import (`js/import-export.js`, écriture directe des clés). Risque faible (settings petits) mais incohérent. |
| Surveillance de la taille du stockage | **Fait** | `getLocalStorageSize()`, `STORAGE_LIMIT_BYTES` (5 Mo), `STORAGE_WARN_RATIO = 0.90`, toast d'avertissement quotidien (`lastStorageWarningSent`), events GoatCounter `DailyUser-LS-above-{1..4}MB` (palier le plus haut, une fois par jour). |
| Fenêtrer les rendus (priorité 2) | **Fait, sauf un** | `renderResults()` (`RESULTS_WINDOW_DAYS = 14`), `renderDailyCharts()` (14 jours glissants), `renderTimelineChart()` (7 jours), `renderHistory()` (fenêtre filtrée). **Non fenêtré** : `renderWeeklyCharts()` — il copie tout `state.history` et agrège toutes les semaines. `buildEvolutionFullDaysIndex()` reste volontairement complet (paliers longs). |
| Debounce de `saveState()` (priorité 3, optionnel) | **Écarté** | Voir § 3. |
| Timer `setInterval` 1 s | **Inchangé, négligeable** | `timerInterval` : un calcul de durée + 2 écritures DOM par seconde, seulement si une période est active. |
| Wake Lock + pseudo-veille | **Fait (conditionné)** | `requestWakeLock()` ne s'active que si une alerte activée existe pour le type actif (`hasActiveAlarms`), sinon il relâche ; l'overlay de pseudo-veille n'est armé que si un Wake Lock est actif. Reprogrammé à chaque `scheduleAlerts()`. |
| GoatCounter : file avec réessais | **Inchangé, borné** | `_processGoatQueue()` : au plus 10 essais à 1 s si `window.goatcounter` n'est pas chargé et que `navigator.onLine`, puis file abandonnée. Aucune boucle infinie. |
| `applySteamroller()` en O(n×m) | **Inchangé** | Boucles imbriquées base × priorités × fragments puis tri. Acceptable : appelée sur la période éditée, non sur tout l'historique. Pas de mesure défavorable à ce jour. |
| `renderHistory()` : `state.history.indexOf(e)` | **Inchangé, acceptable** | Coût O(n) par ligne affichée, mais seule la fenêtre filtrée est parcourue. |
| Agrégation partagée entre `renderDailyCharts()` et `renderResults()` | **Dette technique** | Pas factorisée ; gain surtout de lisibilité. |
| Horizon de saturation « ≈ 11 ans, ≈ 60 o/entrée » | **Faux, corrigé** | Voir § 2. |

## 2. Constat mesuré (stockage)

- Un historique réel de ~6 780 entrées occupe **≈ 0,71 Mo** après 6 mois d'usage, soit **≈ 4 100 octets/jour** : plus de 3 fois l'estimation de l'ancienne note (probablement antérieure aux enrichissements : alertes, `sentAlerts`, champs supplémentaires).
- Horizon de saturation du quota (≈ 5 Mo) au taux réel :

| Scénario | Octets/jour | Horizon |
|---|---|---|
| Périodes seules (mesuré) | ~4 100 | ≈ 3,5 ans |
| + `dailyData` (note 200 car. + 10 events/jour) | ~4 930 | ≈ 2,9 ans |
| + notes de période (5/jour, ~100 car.) | ~5 980 | ≈ 2,4 ans |

L'horizon « 11 ans » était faux d'un facteur ~3. L'usage de la personne qui a fourni la mesure (développement/test) n'est probablement pas représentatif : il faut une vraie distribution.

## 3. Performance ressentie — diagnostic

- `saveState()` est appelée en double dans plusieurs flux (`reconstructHistory()` + `cancelAlerts()`, 2 appels dans `startPeriod()`, `scheduleAlerts()` + sauvegarde de `visibilitychange`), mais **chaque appel coûte 3 à 20 ms** même à 6 780 entrées (mesure par `performance.now()` dans `saveState()`) : ce n'est **pas** la cause du ralentissement perçu au réveil.
- **Le debounce généralisé est écarté** : certains appels sont des filets de sécurité volontaires (`state.sentAlerts = []` écrit immédiatement dans `cancelAlerts()`), et un debounce réintroduirait un risque de perte à la mort de l'app. Alternative sûre mais au gain négligeable : un paramètre `skipSave` sur `cancelAlerts()` quand elle est appelée depuis `scheduleAlerts()`.
- **Piste restante non testée** : instrumenter `renderWeeklyCharts()` avec `performance.now()` et refaire un test arrière-plan → retour **avec la page Résultats affichée** (le dernier test n'avait aucune page de données ouverte : non concluant).

## 4. Options d'architecture comparées (non tranchées)

**A. IndexedDB « simple »** — `state`/`settings` restent des objets en mémoire ; seuls le chargement initial (asynchrone) et `saveState()`/`saveSettings()` changent de support.
+ lève la limite de taille ; effort localisé ; logique métier inchangée. − ne réduit pas le coût de sérialisation (déjà non problématique) ; première brique IndexedDB du projet (ouverture, transactions, erreurs asynchrones) avec son propre risque de bugs.

**B. IndexedDB « par jour »** — un objet par jour regroupant les périodes closes, période active à part.
+ réécrit seulement les jours touchés. − chantier lourd : le rouleau compresseur (`applySteamroller`, `snapAdjacentBorders`, `mergeAdjacentPeriods`) doit savoir quels jours charger ; couture permanente avec la période active ; `buildEvolutionFullDaysIndex()` en profite peu. Jugé suringénierie au regard du problème confirmé.

**C. Archivage manuel vers un export** (avec résumé agrégé par jour conservé dans une structure séparée, ex. `pacingArchivedDailyTotals`).
+ aucune nouvelle technologie ; réutilise l'export JSON ; borne activement le volume. − perd le détail par période ; demande une action et une décision de l'utilisateur ; complexifie légèrement `buildEvolutionFullDaysIndex()`.

**D. Statu quo** (toast d'alerte + export manuel). + zéro développement. − l'horizon (2,4–3,5 ans) n'est plus négligeable.

**E. Archivage automatique vers IndexedDB** (fenêtre glissante 1–2 ans en localStorage, débordement archivé silencieusement).
+ isole la complexité (le rouleau compresseur reste synchrone sur des données récentes ; IndexedDB ne reçoit que du contenu figé) ; aucune charge pour l'utilisateur ; conserve le détail. − les consommateurs « tout l'historique » (Évolution, export complet) doivent fusionner deux sources (asynchrone + synchrone) ; la mécanique de bascule (« quand exactement ? ») demande de la réflexion ; ce n'est pas un vrai premier pas vers une migration complète.

**Décision de fond actée** : `pacingDailyData` reste en localStorage ; **IndexedDB sera introduit une seule fois, dans un chantier unique et dédié** regroupant tout ce qui en dépend (plutôt qu'un apprentissage en deux temps). Déclencheurs : mesures GoatCounter + stabilisation de `dailyData` par l'usage. La structure de `dailyData` (clé = date ISO) s'y prête sans changement.

Détail d'effort estimé pour introduire IndexedDB (5 blocs testables séparément) : ouverture de la base + `onupgradeneeded` ; wrapper Promise (`get`/`put`/`delete`) ; intégration au bootstrap **sans bloquer** le démarrage de Mesure/Historique (point le plus délicat) ; branchement de l'UI (charger une plage de jours en une transaction, pas jour par jour) ; export JSON qui lit de façon asynchrone.

## 5. Synchronisation multi-appareils (réflexion de long terme)

- Besoins d'une synchro fiable : `id` stable (UUID via `crypto.randomUUID()`), `updatedAt` par enregistrement, tombstones (`deleted: true`).
- **À ajouter au moment du passage à IndexedDB, pas avant.** Un UUID ajoute ≈ 48 octets/entrée, soit ≈ 480 Ko pour 10 000 périodes, pour un bénéfice qui n'existe que si la synchro devient un projet.
- `id` n'est **pas** requis par IndexedDB lui-même (un auto-increment suffit pour un usage local) : ce sont deux décisions indépendantes. À l'import d'un ancien JSON, traiter `id` comme optionnel (`entry.id || crypto.randomUUID()`).
- Séquençage envisagé (carte mentale, rien de planifié) : (5) stockage ; (6) décision d'architecture serveur — compte vs code d'appairage, backend maison vs service existant type CouchDB/PouchDB, et séparer « synchro d'un seul utilisateur » de « partage entre personnes » (droits d'accès, bien plus complexe) ; (7) synchro multi-appareils (dernière écriture gagne, tombstones, file locale) ; (8) partage entre personnes (optionnel).

## 6. Actions peu coûteuses restantes

- **Réévaluer `STORAGE_WARN_RATIO = 0.90`** (toast à 4,5 Mo, marge de réaction courte au rythme mesuré) : abaisser le seuil ou ajouter un palier plus précoce.
- **Instrumenter `renderWeeklyCharts()`** (§ 3), puis fenêtrer si elle est en cause.
- **Passer les 6 écritures directes de `pacingSettings` à `safeSave()`** (§ 1) — petit bloc, à valider avant de coder.
- Recalculer l'horizon avec des données réelles incluant `dailyData`.
- Question générale encore ouverte : quelle partie de l'app consomme le plus de calcul / mémoire / batterie ? (mesurer avant d'optimiser).
