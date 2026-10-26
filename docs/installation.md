# Installation PWA, splashes et navigateurs intégrés (Facebook & co) — note de référence

> Remplace trois anciennes notes du projet : « Handoff stratégie d'installation », « Résumé des changements appliqués suite au Handoff » et « PWA ouverte depuis Facebook ».
> **Source de vérité : le code de `dev`** (beta.23, vérifié le 2026-10-05). Chantier **largement terminé** ; ce qui reste est surtout de l'observation d'usage (§ 12).
> Les points marqués *(notes d'origine)* viennent des anciennes notes (constats sur des plateformes que le code ne permet pas de re-vérifier) ; tout le reste a été relu dans le code.

## 1. Objectif et enjeu

Faire passer les nouveaux utilisateurs de « page web dans un navigateur » à « application installée », sans perdre de données en route. L'enjeu le plus lourd est le **navigateur intégré d'un réseau social** (Facebook en tête) sur lequel arrivent naturellement beaucoup de nouveaux utilisateurs : on n'y peut ni installer la PWA, ni exporter facilement, et le stockage y est isolé.

Principe constant : tous les messages passent par une UI à nous (jamais le bandeau natif du navigateur : `preventDefault()` sur `beforeinstallprompt`), bienveillante, sans surcharge.

## 2. Où est le code

| Quoi | Où |
|---|---|
| Toute la logique d'installation (détection de tier, splashes, webview, carte Réglages, diagnostic) | `js/install.js` (≈ 940 lignes) |
| Détection des navigateurs intégrés | `inapp-spy.js` (bibliothèque vendorisée, MIT, v5.0.10, expose `window.InAppSpy()`, dans `ASSETS_TO_CACHE`) |
| `isIOSDevice()`, `isPWAInstalled()`, `getCleanInstallUrl()`, `showStartupToasts()`, séquence de démarrage (section 23), `isFirstEverLaunch` / `installFirstLaunchDate` | `index.html` |
| Export CSV/JSON et repli manuel (`exportCSV()`, `exportJSON()`, `showManualExportModal()`) | `js/import-export.js` ; le modal `#manualExportModal` est dans `index.html` |
| Styles `#install-splash*`, `.install-link-word` | `style.css` |
| Textes | `js/translations.js` : **43 clés** `install*` / `manualExport*`, complètes en FR/EN/NL, aucune clé orpheline (vérifié) |

Convention de nommage : les fonctions « Facebook » (`isFacebookInAppBrowser`, `showFacebookBrowserBlock`…) et le tier `'F'` ont gardé leur nom d'origine par lisibilité, mais couvrent désormais **tous** les navigateurs intégrés connus (voir § 8).

## 3. Arbre de décision au démarrage

Point d'entrée unique : `checkAndShowInstallSplash()`, appelé 2,5 s après le démarrage (section 23), après `checkBlockingUpdate()`.

1. **App déjà installée** (`isPWAInstalled()`) → rien.
2. **Ordinateur** (`!isHandheldDevice()`) → rien (ni splash, ni blocage webview, même si un user-agent webview est simulé ; la carte Réglages est masquée aussi). Testé *avant* le webview exprès.
3. **Navigateur intégré connu** → branche dédiée (§ 6), cadence propre.
4. **Sinon** : tier A/B/C/D selon la plateforme, puis cadence du tier (§ 5).

Si un splash prend la main, la suite (toasts puis message JSON) est enchaînée **à sa fermeture** (`closeInstallSplash()` → `showStartupToasts()`), jamais en parallèle. Exception : après une installation **acceptée**, plus rien n'est montré dans l'onglet navigateur (`skipMessages`).

Ordre d'affichage global (un seul élément à la fois) : mise à jour bloquante → webview (blocage/avertissement) → splash standard → toasts (mise à jour installée, stockage) → message JSON.

## 4. Les tiers (`getInstallTier()`)

| Tier | Cas | Comportement |
|---|---|---|
| **F** | Navigateur intégré connu (prioritaire sur tout) | Aucune installation possible ici → sortir vers Chrome/Safari (§ 6) |
| **C** | iOS | Instructions Partager → « Sur l'écran d'accueil » ; aucune détection de succès possible |
| **A** | Chromium avec `beforeinstallprompt` capturé | Un clic = prompt natif |
| **B** | Chromium, prompt pas (encore) capturé | Instructions via le menu du navigateur |
| **D** | Autre (ex. Firefox Android) | Écran actif : lien à copier pour l'ouvrir dans Chrome ; « Continuer dans ce navigateur » est une sortie légitime (ce n'est pas un blocage) |

Le tier d'un splash standard est **recalculé au moment utile**, jamais figé.

## 5. Cadences d'affichage

| Cas | Règle | Clé localStorage |
|---|---|---|
| A / B | Premier lancement, puis rappel tous les **7 jours** après la dernière fermeture | `installPromptLastDismissAt` |
| C / D | Jours 1 et 2 : chaque jour ; puis **tous les 3 jours** jusqu'à 14 jours ; puis cycle standard 7 jours ; jamais deux fois le même jour civil | `installPromptLastShownDay` (écrit à l'**affichage**), `installFirstLaunchDate` |
| F, Cas 1 (pas de données) | **À chaque lancement**, sans exception | — |
| F, Cas 2 (données) | Une fois par jour civil | `installFBWarningLastShownDay` |

Constantes : `INSTALL_REMINDER_INTERVAL_MS`, `INSTALL_INTENSIVE_PERIOD_DAYS` (14), `INSTALL_INTENSIVE_INTERVAL_DAYS` (3). Pourquoi C/D plus insistants : changer de voie plus tard impose un export + import, donc mieux vaut convaincre tôt.

**Seuil de « données significatives »** (`shouldSuggestExportBeforeInstall()`) : ≥ 5 périodes **et** ≥ 10 minutes cumulées (`INSTALL_EXPORT_MIN_PERIODS`, `INSTALL_EXPORT_MIN_MINUTES`). Il sert à : suggérer l'export (tier C), distinguer Cas 1 / Cas 2 en webview, afficher le paragraphe de contexte sur le Splash 1 et le Tier D.

## 6. Les écrans

**Splash 1 (A/B/C)** : logo, nom, slogan (`INSTALL_SPLASH_SHOW_SLOGAN`), éventuel paragraphe de contexte, bouton « Installer », lien de sortie. Espace réservé constant pour que le bouton ne bouge pas. **Tier A/B : le bouton est toujours affiché de façon optimiste ; la décision réelle (prompt natif ou repli instructions) se prend au clic**, car `beforeinstallprompt` est asynchrone. Tier C : le clic mène toujours aux instructions.

**Splash 2 (instructions)** : `buildInstallStepsHTML(tier)` (tiers B et C). Tier C ajoute « J'ai pu suivre ces instructions » → Splash 3. « Retour » ramène au Splash 1 sans enregistrer de dismiss. Le slogan n'apparaît que sur le Splash 1.

**Splash 3 (confirmation)** : variante `'AB'` déclenchée automatiquement par l'écouteur global `appinstalled` (détection réelle, y compris si l'installation vient du menu du navigateur) ; variante `'C'` auto-déclarée (aucune détection sur iOS), avec, si des données existent, un encart d'export.

**Tier D** : écran unique avec lien à copier (`copyInstallLinkFromSplash()`).

**Navigateur intégré, deux cas** (`checkFacebookBrowserBlock()`) :
- **Cas 1, pas de données** : blocage plein écran (`showFacebookBrowserBlock()`), à chaque lancement. Pas de lien de fermeture.
- **Cas 2, données existantes** : avertissement (`renderFacebookWarningScreen()`) + écran « Transférer mes données déjà enregistrées » (`renderFacebookExportScreen()`) + lien « Continuer quand même » (retour temporaire).
- Dans les deux cas, texte d'intro commun (`installFBIntro`, avec `{appName}` et `{browserName}`) puis **deux chemins** (`buildInstallWebviewPathsHTML()`) : **A** menu du navigateur → « Ouvrir dans le navigateur » ; **B** mot cliquable « Copier » (`copyWebviewLink()`) puis coller dans Chrome/Safari.
- **Android uniquement** : un bouton d'ouverture automatique (`attemptAndroidAutoEscape()`, schéma `intent://`) ; les deux chemins ne sont révélés qu'après 3 s si la page est toujours visible (`visibilitychange` annule le repli en cas de succès). **iOS** : les chemins sont affichés directement, sans bouton ni délai (Apple n'offre aucun moyen de forcer l'ouverture).
- Le lien affiché/copié est `getCleanInstallUrl()` = origine + chemin, **sans** `?fbclid=` ni fragment (n'affecte pas l'installation : `start_url` du manifest est `./`).
- **Bypass de dépannage conservé volontairement** : 7 taps sur le logo du blocage (Cas 1) ferment l'écran. C'est la seule sortie de secours, utile pour tester l'export manuel ; ne pas le retirer sans décision explicite.

**Carte Réglages** (`#settings-install-card`) : visible sur mobile/tablette non installé, **jamais sur ordinateur**, jamais silencieuse (D et F ont leur contenu). Même contenu que le splash via `buildInstallStepsHTML()` / `buildInstallWebviewPathsHTML(false)`, mais volontairement plus simple : pas de multi-écran ni de « Retour », encart d'export affiché directement, chemins webview directs (sans bouton ni délai). Décision au clic, comme le splash.

## 7. Données et export selon la plateforme

| Situation | Stockage | Ce que fait l'app |
|---|---|---|
| Android, installation depuis Chrome | Partagé avec l'onglet navigateur *(notes d'origine)* | Aucun export suggéré (A/B) |
| iOS, « Sur l'écran d'accueil » | Partage avec Safari **non confirmé de façon fiable** *(notes d'origine)* | Tier C : export **JSON** suggéré au Splash 3 si données (`exportJSON()`), à réimporter dans l'app installée |
| Navigateur intégré | **Isolé** de Chrome/Safari, et volatile *(notes d'origine)* | Cas 2 : export **CSV** (`exportCSV()`) |

**Export en navigateur intégré** : le téléchargement par URL `blob:` y échoue (« impossible de charger la page ») et le presse-papier y est parfois bloqué aussi. `exportCSV()` détecte donc le contexte **en amont** (`isFacebookInAppBrowser()`) et ouvre directement `showManualExportModal()` : le contenu s'affiche en clair, pré-sélectionné, avec un bouton « Copier » best-effort. Le texte affiché est la seule garantie qui ne dépend d'aucune API. L'événement GoatCounter `export-csv-manual-fallback` mesure l'usage de ce repli.

## 8. Détection des navigateurs intégrés

`detectInAppBrowser()` s'appuie sur `inapp-spy` : Facebook, Messenger, Instagram, Twitter/X, LinkedIn, TikTok, Snapchat, LINE, WeChat, Threads, GSA, WhatsApp, Reddit, Telegram, plus un repli générique pour toute webview non nommée (`isInApp: true`, pas d'`appKey`). `getInAppBrowserName()` donne le nom d'affichage, avec le repli « cette application » (`installWebviewGenericName`). Les textes utilisent `{appName}` partout.

Limites connues : **SFSafariViewController** (certains navigateurs intégrés iOS) a exactement l'user-agent de Safari : indétectable, angle mort assumé. **Brave** imite Chrome dans l'user-agent : seule la présence de `navigator.brave` est fiable (test synchrone).

## 9. Analytics (GoatCounter)

Facebook n'apparaît pas comme « navigateur » dans GoatCounter : il classe selon le moteur sous-jacent (Safari/WebKit sur iOS, Chrome/WebView sur Android). La source de trafic se lit dans les **Referrers** (facebook.com, l.facebook.com…), souvent masquée (politique de referrer, iOS, bloqueurs). D'où nos propres événements :
- `NewUser-{browser-X | webview-X | installed}` + `-browser-TOTAL` / `-webview-TOTAL` à la toute première utilisation (`detectNewUserChannel()`, `sendNewUserInstalledOnce()` avec drapeau anti-doublon, déclenché soit par `appinstalled`, soit par un premier lancement déjà en mode installé, cas iOS).
- Pas de total global « tous canaux » : un même utilisateur peut avoir plusieurs premiers lancements (stockages séparés).
- Côté quotidien : `DailyUser-{installed|browser}`, `DailyUser-webview-X`, etc. (liste complète dans `docs/ARCHITECTURE.md`, section 7).
- Idée non mise en œuvre : paramètres UTM sur les liens postés sur Facebook pour mesurer l'impact des publications indépendamment du navigateur.

## 10. Z-index (ne pas casser)

`#install-splash` **500** < toasts **550** < `.modal` de base **560** < `#manualExportModal` **600**. Ce dernier doit pouvoir s'ouvrir *depuis* le flux webview (le bouton d'export est dans le splash). Piège passé : avec `.modal` à 100, un modal pouvait être « ouvert » mais invisible derrière le splash.

## 11. Décisions et pièges à ne pas réintroduire

- **Décision au clic, pas au rendu** (A/B et carte Réglages).
- **`intent://` : une seule tentative simple**, jamais de cascade ; toujours couplée à une copie silencieuse du lien ; toujours déclenchée par un vrai clic (certaines apps bloquent les tentatives sans geste).
- **Pas de blocage pour Firefox/tier D** : l'absence de voie d'installation n'est pas une interdiction.
- **Priorité splash > messages JSON**, y compris au tout premier lancement (une version initiale les avait inversés).
- **Libellés de menu des navigateurs** non garantis entre versions et langues : formulations volontairement larges (« …ou équivalent »). Sur iOS, « Sur l'écran d'accueil » n'est **pas visible au premier écran** du menu Partager (il faut faire défiler) : le dire ainsi, sans parler de « sous-menu ».
- **Registre « vous »** pour tous les textes d'installation/avertissement (distinct du « tu » du message de bienvenue JSON : non réconcilié, assumé).
- **Faux signal UE/iOS** : un blocage des PWA sur iOS dans l'UE avait été évoqué ; vérifié auprès de plusieurs sources, annulé par Apple dès le 1er mars 2024, aucun problème actuel *(notes d'origine)*.
- **Forcer Chrome depuis Facebook est impossible** : Android ouvre le navigateur par défaut de l'appareil (Firefox si c'est lui). On ne peut donc qu'inciter, d'où les deux chemins.
- **WhatsApp** se comporte de façon variable (navigateur système ou vue intégrée) : aucun cas particulier, la détection par signature gère les deux.
- **Pas de lien partagé avec paramètres** : le cache hors ligne du service worker fait une correspondance exacte (query string incluse), donc on copie toujours l'URL nue.

## 12. État et suite

**Terminé et dans le code** : tout ce qui précède (arbre unique, tiers A–D et F, cadences, Splash 1/2/3, webview en deux cas avec export dédié, `intent://`, repli d'export manuel, carte Réglages, désactivation sur ordinateur, traductions FR/EN/NL complètes, `debugInstallState()`).

**À confirmer par l'usage** *(les anciennes notes demandaient ces tests ; leur résultat n'est pas consigné)* :
- cadence par jour civil sur plusieurs jours réels (C/D) ;
- `intent://` sur un vrai Android depuis Facebook ;
- détection généralisée depuis un vrai réseau social (autre que Facebook) ;
- affichage EN/NL de tous les écrans ;
- test Android réel du Splash 3 `'AB'` après installation par le menu du navigateur.

**Diagnostic** : `debugInstallState()` en console donne l'état complet (environnement, données, valeurs brutes de cadence, branche empruntée, « le splash serait-il affiché maintenant ? », DOM actuel), en lecture seule, sans effet de bord. Pour re-tester un flux, effacer les clés de cadence du § 5.

**Idées non réalisées** : UTM sur les liens Facebook (§ 9) ; accompagnement pas-à-pas des notifications (voir `TODO.md`, chantier alertes) ; réconcilier « tu / vous ».

**Nettoyages cosmétiques sans risque** (commentaires obsolètes dans `js/install.js`) :
- l'en-tête de la section 1d dit « Pas encore appelé automatiquement au démarrage (Bloc 4) » alors que `checkAndShowInstallSplash()` l'appelle ;
- le bloc de commentaire « Splash 2 — instructions… » est placé au-dessus de `buildInstallStepsHTML()` au lieu de `renderInstallSplashInstructions()`.

## 13. Pour modifier ce chantier

- Tout nouveau texte : FR, EN **et** NL, avec `{appName}` si l'app détectée peut être nommée.
- Tout contenu « titre + étapes » passe par `buildInstallStepsHTML()` (tiers B/C) ou `buildInstallWebviewPathsHTML()` (webview) : ne pas dupliquer entre splash et Réglages.
- Une nouvelle app intégrée détectée : l'ajouter dans `INAPP_GOATCOUNTER_TAGS` (sinon `webview-Other`).
- Tester sur appareil (Android Chrome au minimum) ; iOS quand c'est possible.
- Toute règle de cadence se modifie dans `shouldShowSplashForTier()` / `shouldShowFacebookWarningToday()` (fonctions pures partagées avec `debugInstallState()` : pas de divergence possible).
