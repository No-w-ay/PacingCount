# Système de messages JSON — note de référence

> Source de vérité : le code (`index.html` sections 8c, 8d et 23 ; `messages.json` ; `sw.js`). Le fonctionnement général (types de messages, filtres, ordre de priorité) est décrit dans `docs/ARCHITECTURE.md`, § 6 ; cette note couvre la **structure de l'interface**, la **règle de réaffichage**, et l'**incident des anciennes copies de `messages.json`** (octobre 2026).

## 1. Structure de l'interface (décidée, à garder simple)

- **Mode automatique** : au démarrage, séquence habituelle (mise à jour bloquante > splash > toasts > message JSON). Le message `update` s'affiche dans la fenêtre `#messageModal`, avec le texte venu de `messages.json`.
- **Mode manuel** : bouton « Vérifier mise à jour » dans les Réglages (`openUpdateModal()`). Il cherche un nouveau SW et affiche seulement les versions, le conseil d'export et les boutons — **jamais le texte du JSON** (le modal n'a donc pas de « partie centrale » : c'est normal). Ce comportement pourrait être revu plus tard (afficher aussi le texte).
- Un message `update` n'est montré **que si un SW est en attente** ; sinon il est sauté sans aucun log. Le rattrapage de la beta.19 relance `checkMessages()` quand le nouveau SW passe en `installed` (jugé efficace à l'usage).
- Le bandeau « Mise à jour disponible — relancez l'app », envisagé un temps, est abandonné.

## 2. Règle de réaffichage d'un message `update` non bloquant (beta.31)

- Un « Plus tard » (`dismissMessage(id, false)`) ajoute l'id à `seenMessages` **et** écrit `lastShownUpdate` (timestamp global, un seul).
- Un message `update` déjà vu reste **masqué 7 jours** après ce « Plus tard », puis **réapparaît** tant que la mise à jour est en attente. Un **nouvel id** n'est pas « vu » : il s'affiche tout de suite. Un « vu » sans date enregistrée réapparaît (et se réinitialise au prochain « Plus tard »).
- Un message **bloquant** n'est pas concerné ; `welcome` et `info` restent affichés une seule fois.
- **Bug corrigé** : avant la beta.31, un deuxième test `seenMessages` (dans `evaluateMessageEligibility()`) s'appliquait aussi aux `update` : le « Plus tard » était définitif et le délai de 7 jours n'était jamais atteint.
- Test sur appareil : régler `lastShownUpdate` à une date de 8 jours en arrière dans le `localStorage` (`localStorage.setItem('lastShownUpdate', Date.now() - 8*86400000)`) puis relancer.

## 3. Incident : anciens messages `update` (parfois bloquants) affichés par erreur

### Observé
- Début octobre 2026, sur un téléphone Android (PWA installée depuis la branche `dev`), deux mises à jour (beta.24 → 25, puis beta.27 → 28) ont affiché un **ancien** message `update` : texte français commençant par « 0.9.27 », texte anglais par « 0.9.26 ». Les deux fenêtres étaient en mode **bloquant** (pas de bouton « Plus tard »), alors que le fichier publié n'avait plus de `blockAfter`. Le numéro de version (en tête) et la proposition d'export (en pied) venaient de l'app, donc corrects.
- Parfois, le bon message s'affichait aussi (comportement normal) : l'incident est **intermittent**.

### Analyse (vérifiée dans l'historique git)
- Les deux textes correspondent exactement à **un même état de `messages.json`** : celui des trois commits de test du blocage, du 16 août (16:52) au 17 août (13:01) 2026 (ids `update-0.9.27-beta.18`, `18b`, `18c`, `blockAfter = 2026-05-13`, donc dans le passé → bloquant). Dans cet état, le texte anglais n'avait pas encore été mis à jour (« 0.9.26 »), le français si. Le fichier a été remis à `blockAfter = ''` à 13:10 le 17 août.
- Le serveur sert bien le fichier actuel (contrôlé le 9 octobre). Le code ne **fabrique** pas ces messages : il a affiché une ancienne copie complète du fichier ; le caractère bloquant vient du `blockAfter` de cette copie.
- Rien dans l'app ne conserve `messages.json` : jamais dans `ASSETS_TO_CACHE` ni mis en cache par `sw.js` (historique de `sw.js` sans mention), seuls `seenMessages` et `lastShownUpdate` sont stockés. Le fetch demande déjà `cache: 'no-store'`.

### Hypothèse (non confirmée)
Une **couche de cache non identifiée, hors du code de l'app**, a gardé une copie du fichier datant de cette fenêtre du 16-17 août et la resservait de temps en temps (copie liée à l'appareil ou au chemin réseau). Piste à vérifier : une couche réseau côté téléphone (icône de clé dans la barre d'état des captures : VPN ou filtre ?). Cette copie est indexée par URL.

### Correctif (beta.30)
- Le fetch ajoute un **paramètre unique à l'URL** : `messages.json?t=<Date.now()>`, en plus de `cache: 'no-store'`. Toute copie indexée par URL est contournée. Le serveur ignore la query string d'un fichier statique ; hors-ligne, le comportement est inchangé (pas de message).
- **Trace de diagnostic** `messagesFetchDiag` (`localStorage`, écrasée à chaque lancement, quelques centaines d'octets, aucune donnée personnelle), lisible après coup : `JSON.parse(localStorage.getItem('messagesFetchDiag'))`. Champs : `at`, `app`, `status`, `firstUpdateId`, `blockAfter`, `olderThanInstalled`, `headers` (`age`, `cf-cache-status`, `etag`, `last-modified`, `date`), ou `error` si le fetch a échoué.
- **Alerte console** (`console.warn`) quand l'id du premier message `update` désigne une version **strictement plus ancienne** que celle installée (`olderThanInstalled`). Un id égal à la version courante est normal.
- Lecture : `olderThanInstalled: true` alors que l'URL est unique → une couche ignore l'URL ; les en-têtes `age` / `cf-cache-status` situent Cloudflare ; `error` → hors-ligne.
- Rappel de convention : à chaque commit, l'`id` du message devient `update-<APP_VERSION>`.

### Pistes écartées (pour ne pas rouvrir le débat)
- **Garde « ne pas afficher un message plus ancien que la version installée »** : une rustine qui masquerait l'erreur ; on préfère la **voir** (la trace et l'alerte suffisent). À reconsidérer seulement si la trace montre une copie périmée malgré l'URL unique.
- **Vérification à la reprise de l'app** (`reg.update()` + `checkMessages()` au retour au premier plan) : aucune preuve que le cas se produise, et le rattrapage de la beta.19 fonctionne. À reconsidérer si des messages « absents » reviennent.
- **Vieux cache de `sw.js`** : écarté (voir Analyse).

## 4. À évaluer plus tard
- Retirer la trace `messagesFetchDiag` et l'alerte après quelques semaines sans anomalie (ne pas garder indéfiniment du code inutile).
- Afficher le texte du JSON dans le mode manuel.
- Extraire `js/messages.js` (voir TODO, « Architecture du code »).
