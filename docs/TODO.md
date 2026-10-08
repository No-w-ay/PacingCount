# TODO — PacingCount

> Liste unique et à jour. Mise à jour : 2026-10-08 (après beta.28). Les détails d'un chantier sont dans sa note (`docs/evolution.md`, `docs/notes-events.md`, `docs/installation.md`, `docs/optimisation-stockage-performance.md`). Les conventions techniques sont dans `docs/CONVENTIONS.md`.
> Le dépôt est public : n'y écrire rien de personnel.

## En investigation

- **Notifications Chrome non voulues dans la PWA installée** — 2 tests :
  1. Désactiver temporairement l'enregistrement du SW (commenter `navigator.serviceWorker.register('./sw.js')` dans `index.html`), utiliser l'app normalement pendant une journée. Si la notification disparaît, le SW est en cause.
  2. Si le SW est en cause, le réactiver mais commenter `self.skipWaiting()` et `self.clients.claim()` dans `sw.js` (activation immédiate et prise de contrôle de tous les clients : suspects). *Note : `skipWaiting()` est déjà désactivé dans `install` ; `clients.claim()` reste actif dans `activate`.*
- **`messages.json` : anciennes infos affichées dans le message de mise à jour** — vérifier d'abord quelle URL/branche sert le fichier (`main` et `dev` n'ont pas le même `messages.json`), puis l'`id` du message (`seenMessages`), puis le timing de détection du SW. Le cache n'est probablement pas en cause (fetch `no-store`, fichier hors `ASSETS_TO_CACHE`).
- **Confirmer le correctif de la course SW / `messages.json`** (beta.19 : second appel de `checkMessages()` quand le nouveau SW passe en `installed`) lors d'une vraie mise à jour déployée.

## Court terme

- **Publier** : valider beta.28 sur appareils (Windows, Android ; iOS si possible), puis PR `dev` → `main`. Avant : relire `messages.json` de `dev` (l'`id` du message update sera `update-0.9.29-beta.28`, il sera montré aux utilisateurs de `main`) ; **confirmer MPE et Jour OK actifs par défaut** (Malade reste actif pour l'instant).
- Couleur du bouton Exporter incohérente : bleu dans Historique, jaune ailleurs (modals). Pas encore de décision.
- Nettoyages cosmétiques sans risque : commentaire CSS faux sur le `z-index` de l'overlay du tableau (480 est *au-dessus* d'Évolution à 450) ; clé de traduction `dailyEventsDateHeader` jamais utilisée ; indentation et ancien `addAll` commenté dans `sw.js`.
- Incohérence de limite de la note journalière : 80 caractères dans l'UI, 5 000 (`IMPORT_MAX_DAY_TEXT`) à l'import JSON.
- **Réévaluer `STORAGE_WARN_RATIO = 0.90`** (toast à 4,5 Mo : marge de réaction courte). Voir `docs/optimisation-stockage-performance.md`.

## Moyen terme

- **Revoir la section « détails chiffrés »** (`js/results.js`) pour une meilleure présentation : vue Résultats (couleurs pour les totaux…), durée moyenne et durée max d'une période active, petit graphe empilé du temps passé dans les périodes selon leur durée (0-20 % ; 20-40 % ; … > 100 %, 5 zones, Tmax à définir).
- **Alertes de périodes** :
  - passer à des alertes gérées par serveur ?
  - mode présence : alerte depuis le début de la période en cours (à réactiver proprement) ;
  - mode absence : alerte depuis la fin de la dernière période d'un type donné ; `sentAlerts` → ajouter `mode:'absence'` quand implémenté ;
  - `lastSentWaveIndex` persisté dans `sentAlerts` — à consolider si des faux positifs de rattrapage persistent ;
  - accompagnement pas-à-pas pour configurer les notifications (détection auto OS / version iOS, guide d'installation, test guidé) en remplacement du message d'avertissement actuel à la création d'une alerte.
  - *Bon moment pour extraire `js/alerts.js`* (voir « Architecture du code »).
- **Questions d'export** : export XLSX (écrit directement depuis les structures internes) ; `removeAccents()` dans `exportCSV()`.
- **Système de messages JSON** — extensions futures : sondages (poll), déclencheurs événementiels (event/moment) ; bandeau « Mise à jour disponible — relancez l'app » (remplace le `skipWaiting` agressif, après beta). *Bon moment pour extraire `js/messages.js`.*

## Chantier Évolution (terminé, raffinements possibles)

- Bande de prévisualisation du swipe (`#evolution-xaxis-preview`, 33 px) plus basse que l'axe réel (`scale.height` 44 px) : un fragment de texte gelé (millésime) peut dépasser en haut pendant un geste ; ajuster si gênant.
- Retours d'usage à recueillir : sensibilité de la zone tactile de 120 px et du seuil de confirmation de 8 px ; valeurs par défaut (légende activée, `~5j` par défaut) ; test systématique des paliers annuels au-delà de 2 ans.
- Idées en réserve : pincement « à ancre » (un doigt fixe un bord) pour le palier `tout` ; marqueur de point isolé lui-même en pointillé ; marge de confort sur le clamp de navigation (calée sur le pas de graduation) si la fenêtre paraît abrupte.
- Non-régression à confirmer si pas déjà fait : renommer un type **actif** d'un profil de base doit toujours déclencher le `confirm()` (correctif `detectProfile()`).

## Chantier Notes & événements journaliers (en cours)

Voir `docs/notes-events.md`, § 3 et § 8. Tableau à défilement continu, panneau de note et mesures GoatCounter faits (beta.24 à 28).
- **Test d'usage réel** avec 2 types d'événements (couleurs, exclusion par polarity, notes, défilement) ; ensuite décider d'une **interface de visibilité** des événements (champ `active` existant, rien à coder côté données) et d'appliquer l'exclusion par polarity **aux tags visibles seulement**.
- **Lire les mesures GoatCounter** `Daily-event-1` (MPE), `-2` (Malade), `-3` (Jour OK) et `Daily-note` : événement ÷ `DailyUser-TOTAL`, sur ≥ 4 semaines (une semaine seule est trop bruitée). Vérifier le comptage de 2 hits identiques (total des hits, pas les visiteurs uniques).
- Tap sur les pastilles/note de Résultats → ouvrir l'overlay au bon jour (calculer le rang depuis aujourd'hui) ; reporter `renderResults()` tant que l'overlay est ouvert.
- Jours sans période mais avec event/note : invisibles dans Résultats (option A) — à reconsidérer si besoin.
- **Note de période** (`note` sur `state.history[]`) : traiter d'abord les 4 points qui la perdraient (`closePeriod`, `applySteamroller`, `saveManualEdit`, `mergeAdjacentPeriods`), puis seulement l'UI. Besoin non confirmé (priorité basse).
- Extension à d'autres tags (`numeric`…) ; suggestion « héritage de la veille » (visuelle uniquement, jamais écrite) ; modes `scale` / `choice` sur besoin confirmé ; glisser-coche horizontal (V2 du tableau) ; indicateur « jour non rempli » sur le bouton 📝 (pas de clignotement) ; renommage éventuel du mode `presence` (aucune urgence).
- Gagner de la largeur si besoin : libellé « Aujourd'hui » (0,74 rem ≈ 6 px), colonnes de tag 44 px (≈ 6 px).
- Textes EN/NL du tag `day_ok` et des info-bulles à relire.
- Journal d'événements avec temporalité (début/fin d'état, ex. une MPE du 23 au 26 mars) : voir « Long terme ».

## Installation PWA et navigateurs intégrés (terminé, à confirmer par l'usage)

Voir `docs/installation.md`, § 12.
- Confirmer sur appareils réels : cadence par jour civil (tiers C/D) sur plusieurs jours, `intent://` depuis Facebook sur Android, détection depuis un autre réseau social, affichage EN/NL, Splash 3 après installation par le menu du navigateur.
- Nettoyage cosmétique de commentaires dans `js/install.js` : en-tête de la section 1d obsolète (« pas encore appelé… Bloc 4 »), bloc « Splash 2 » placé au-dessus de `buildInstallStepsHTML()`.
- Idée : paramètres UTM sur les liens postés sur Facebook, pour mesurer l'impact indépendamment du navigateur.

## Stockage & performance

Voir `docs/optimisation-stockage-performance.md`.
- Surveiller les mesures GoatCounter `DailyUser-LS-above-*MB` avant de trancher entre les options A/B/C/D/E. (Les `Daily-event-*` / `Daily-note` ajoutent jusqu'à 7 hits par ping ; limite GoatCounter de 4 hits/s, file à 400 ms.)
- Passer les 6 écritures directes de `pacingSettings` à `safeSave()` (voir note). Instrumenter `renderWeeklyCharts()` (seule fonction de rendu non fenêtrée) et refaire un test arrière-plan → retour avec la page Résultats affichée, pour localiser le ralentissement perçu au réveil.
- Optimisation générale : quelle partie de l'app demande le plus de calcul / mémoire / batterie ?
- Chantier IndexedDB unique et dédié (plus tard, selon mesures) ; `id` / `updatedAt` / tombstones seulement à ce moment-là.
- Résolution des bugs éventuels.

## Architecture du code et dépôt

- **Extractions possibles, uniquement quand on travaille dessus** (état actuel : `index.html` ≈ 5 070 lignes, script inline ≈ 4 400) :
  - `js/alerts.js` (sections 7, 7b, 8b + planification, wake lock) — préalable : des écouteurs lisent le DOM au chargement (`getElementById('test-notif')`), donc charger le fichier en fin de `<body>` ou laisser ces écouteurs dans l'init ;
  - `js/messages.js` (8c mises à jour + 8d messages JSON, ≈ 700 lignes) — préalable : ranger le code d'alertes mélangé dans la zone « 8d » et l'enregistrement du SW exécuté au chargement ;
  - `js/history.js` (15, 16, 21, 21b, 21c, ≈ 900 lignes) — préalable : déplacer dans la section 4 les `if (typeof settings.xxx === 'undefined')` exécutés au chargement.
  - Le cœur (constantes, migration, état, moteur des périodes, `updateUI`, init, swipe) reste dans `index.html`.
- Script `check.js` (Node) ou GitHub Action exécutée à chaque push sur `dev` : syntaxe, doublons de noms globaux, cohérence `<script src>` / `ASSETS_TO_CACHE`, fichiers existants. *À proposer et valider avant de coder.*
- `version.js` partagé via `importScripts` dans `sw.js` pour synchroniser `APP_VERSION` / `CACHE_NAME`. *Optionnel.*
- Mettre à jour `docs/ARCHITECTURE.md` au fil de l'eau (le texte « Logique générale » mentionne des sections qui ont bougé).
- Commentaire de fin de `index.html` (≈ l. 5071) : remplacer « voir ARCHITECTURE.md (racine du dépôt) » par « voir docs/ARCHITECTURE.md » (commentaire seul ; à grouper avec la prochaine passe).
- `README.md` ne contient que le titre : décider s'il faut une courte présentation publique (le dépôt est public). Sans urgence.
- Prochaine ancienne version à la racine (`index_v0.928-b54.html`, gardée visible volontairement) : la ranger dans `archive/` quand une version plus récente la remplace.
- Nettoyer le projet Claude : retirer `index(71).html`, `sw(11).js`, `manifest(1).json`, `messages(1).json`, les anciennes synthèses (remplacées par `docs/`) ; retirer aussi `Handoff stratégie d'installation`, `Résumé des changements appliqués suite au Handoff` et `PWA ouverte depuis Facebook` (fusionnées dans `docs/installation.md`) ainsi que `Optimisation CPU, mémoire, batterie` (fusionnée dans `docs/optimisation-stockage-performance.md`).

## Long terme (prospectif, non confirmé)

- Journal d'événements (MPE / crash) avec temporalité — à articuler avec les événements journaliers existants plutôt qu'une structure séparée.
- Rapport PDF exportable pour partage médical.
- Statistiques avancées (heure du premier lever, % temps couché, tendances).
- FCM (Firebase Cloud Messaging) pour des alertes fiables sur Android en veille totale.
- Synchronisation de stockage externe (Google Drive / File System Access API) ; synchro multi-appareils (voir `docs/optimisation-stockage-performance.md`, § 5).
- Rapport d'erreur : `_logBuffer[]` existe déjà ; ajouter `window.onerror` + point d'envoi (attention aux données personnelles).
- Dons ? 50 % pour des associations ? Implications fiscales ?
- Mode d'emploi (le moins possible).

## Ergonomie / look

- Couleurs des boutons export / import / ajout (thème ; éviter la couleur des types de périodes) ; couleurs des boutons d'import dans les modals.
- Icône de l'app.
- Empêcher la rotation automatique (`display: standalone` : actif aussi dans un onglet ?).
- Résultats : symbole somme + couleurs des types ; symbole somme rond bleu et vert ; turquoise pour le nombre.
- Unification simple des polices (titres, autres éléments).
- Secondes en gris plus foncé dans Historique.
- Widget (raccourcis chrono) ?
- Mettre à jour la couleur `--beige-light: #e0c896` si besoin (valeur de départ, jamais affinée).

## Fait récemment (mémoire courte)

Rangement du dépôt (2026-10-05) : anciennes versions dans `archive/`, sources d'icônes dans `icons/`, documentation dans `docs/` (`ARCHITECTURE.md` déplacé de la racine). `icon-192.png` / `icon-512.png` restent à la racine (manifest, sw.js).

Tableau journalier refait (beta.24 à 28, 2026-10) : défilement continu avec fenêtre virtuelle de 60 lignes, cadre fixe sur la ligne du haut, panneau de note qui suit puis se recale, bouton « Ajd ⬆ », pastille de date avec sélecteur, limite de 80 caractères fiable (ordinateur et claviers mobiles) avec compteur ambre, colonne Note élastique, info-bulles sur les en-têtes d'événement, colonne Date à largeur mesurée, descriptions des événements revues. Mesure d'usage GoatCounter (beta.28) : `Daily-event-1/2/3` (veille, tirage 0/1/2) et `Daily-note`.

Refactoring en fichiers : `style.css`, `js/translations.js` (beta.20), `js/install.js` + `js/evolution.js` (beta.21), `js/import-export.js` + `js/daily-data.js` (beta.22), `js/results.js` + `ARCHITECTURE.md` (beta.23) ; `sw.js` : installation tout-ou-rien avec `cache: 'reload'`. Note journalière implémentée (80 caractères), événements MPE / Malade / Jour OK, export/import JSON, pastilles dans Résultats / Historique / graphe journalier.
