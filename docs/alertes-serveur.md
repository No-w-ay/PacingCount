# Alertes serveur (Web Push) — note de chantier

> État au 2026-11-22 (beta.2) : **POC validée sur Android** (push programmé, reçu app fermée, annulation, ouverture de l'app au toucher). Tests longs (30 min, 1 h), iOS et intégration réelle **pas encore faits**.
> Le dépôt est public : ne jamais y mettre de secret (clé privée VAPID, `.dev.vars`).

## 1. Pourquoi un serveur

Les alertes locales (`setTimeout` dans la page + Wake Lock + pseudo-veille + rattrapage au `visibilitychange`) ne fonctionnent plus si l'app est fermée. Un service worker ne peut pas garder de minuterie. Pistes écartées :
- **Notification Triggers API** : abandonnée par Chrome.
- **Periodic Background Sync** : trop grossier (intervalle imposé par le navigateur, pas d'heure précise).
- **Firebase / FCM comme produit** : inutile. Le Web Push standard (VAPID) suffit et évite un compte et un SDK supplémentaires. Les services push des navigateurs (Google, Mozilla, Apple, Microsoft) sont les mêmes qu'avec FCM.

## 2. Architecture retenue

Cloudflare Workers + Durable Objects (stockage SQLite, offre gratuite), dossier `cf-worker/` du dépôt.

- **Worker** (`cf-worker/src/index.js`) : réceptionniste public et sans état. Routes `GET /health`, `POST /schedule`, `POST /cancel`. Valide tout (origine, taille, types, limites) puis transmet au Durable Object de l'appareil.
- **Durable Object `DeviceAlarm`** : un par appareil (clé = identifiant aléatoire). Garde les horaires et l'abonnement push, programme **une seule alarme** (la suivante). À l'alarme : envoie le push, programme l'horaire suivant, efface tout après le dernier.
- **Push vide** : aucune donnée n'est envoyée au navigateur. Le texte de la notification est **fixe, dans `sw.js`** (`PUSH_TEXTS`). Ni le serveur ni un tiers ne peut faire afficher un message arbitraire.
- **Le téléphone calcule des horaires absolus** (ms depuis 1970) ; le serveur est « bête ». Il corrige le décalage d'horloge avec `clientNow`.
- **Sécurité VAPID** : clé publique dans `js/alerts-server.js` (publique par nature) ; clé privée uniquement dans les secrets Cloudflare (`VAPID_PRIVATE_KEY`, avec `VAPID_PUBLIC_KEY` et `VAPID_SUBJECT`). Les secrets ne se relisent pas : **garder une copie de la clé privée dans un gestionnaire de mots de passe**. En cas de perte : nouvelle paire, 3 secrets à refaire, clé publique à changer dans l'app, et tous les appareils doivent se réabonner.

### Protocole

| Appel | Corps JSON | Effet |
|---|---|---|
| `POST /schedule` | `{ deviceId, subscription: { endpoint, keys? }, clientNow, fireAt: [ms…] }` | remplace tous les horaires de l'appareil |
| `POST /cancel` | `{ deviceId }` | efface horaires et alarme |
| `GET /health` | — | contrôle de vie |

Limites actuelles : corps ≤ 4 Ko, ≤ 50 horaires, horaire ≤ 24 h dans le futur, ≤ 60 s dans le passé (envoi immédiat), `deviceId` = 22 à 64 caractères `[A-Za-z0-9_-]`, `endpoint` limité aux services push connus (Google, Mozilla, `*.push.apple.com`, `*.notify.windows.com`), TTL du push 300 s, 3 réessais espacés de 15 s.

### Robustesse du Durable Object
- Une alarme à la fois (`setAlarm` remplace la précédente). Une alarme est garantie **au moins une fois** : le code gère le doublon (garde de version, progression enregistrée **avant** l'envoi).
- Abonnement expiré (HTTP 404/410) : l'appareil est effacé. Échec passager : réessai. Rejet définitif : pas de réessai.
- Aucun identifiant dans les journaux ; erreurs génériques côté client.

## 3. Origines autorisées (CORS)

`ALLOWED_ORIGINS` dans `cf-worker/wrangler.toml` : `https://dev.pacingcount.pages.dev`, `https://pacingcount.pages.dev`, `https://no-w-ay.github.io` (main sur GitHub Pages). Une origine = schéma + domaine, sans chemin. Chaque origine est une app distincte pour le navigateur : un appareil a un abonnement push **par origine**, tous servis par le même Worker. Cette liste bloque les appels d'autres sites web ; ce n'est **pas** une authentification (un outil hors navigateur peut falsifier `Origin`). La vraie protection : identifiant d'appareil aléatoire, validation stricte, push vide.

## 4. Côté app (beta.1 à beta.3)

- `js/alerts-server.js` (ex `push-client.js`, renommé en beta.3) : abonnement (`pushManager.subscribe`, `userVisibleOnly`), envoi des horaires, annulation, boutons de test (**mode développeur uniquement** pour l'instant). `deviceId` dans la clé locale `pushDeviceId`, **hors export**.
- `sw.js` : écouteur `push` (affiche toujours une notification, langue du navigateur), écouteur `notificationclick` (met l'app au premier plan, ou l'ouvre). Le clic agit aussi sur les notifications locales (amélioration constatée : avant, elles n'ouvraient pas l'app).
- Test : bouton « Test Push Serveur » + liste de délais (30 s, 5 min, 30 min, 1 h) + « Annuler le test push ».
- `requestPermission` est appelé **en premier, de façon synchrone dans le clic** (obligatoire sur iOS).

## 5. Déploiement du Worker

Indépendant de Git : depuis `cf-worker/`, `npx wrangler deploy` (connexion `npx wrangler login`). `git push` ne met pas le Worker à jour. Secrets : `npx wrangler secret put <NOM>` ; liste : `npx wrangler secret list`. Test local : `npx wrangler dev` avec un fichier `.dev.vars` (ignoré par Git ; `ALLOW_NO_ORIGIN=true` pour tester avec curl). Syntaxe `[exports.DeviceAlarm] type = "durable-object" storage = "sqlite"` validée avec wrangler 4.x ; l'ancienne syntaxe `[[migrations]]` est gardée en commentaire dans `wrangler.toml` au cas où.
Le dossier `cf-worker/` est aussi publié par Pages comme fichiers statiques (aucun secret dedans ; absent de `ASSETS_TO_CACHE`).

## 6. Offre gratuite Cloudflare (vérifiée en novembre 2026 ; à revérifier avant la mise en production)

Workers : 100 000 requêtes/jour. Durable Objects (SQLite) : 100 000 requêtes/jour (alarmes comprises), 5 Go de stockage, 100 000 écritures/jour. Largement suffisant pour un usage personnel ou un petit groupe ; **pas de limitation par IP** à ce jour : un abus pourrait épuiser le quota (voir « À faire »).

## 7. Décisions d'architecture (pas encore codées)

- **Deux modes exclusifs** par appareil : *local* (défaut) ou *serveur* (choix volontaire). Partie commune = définition des alertes et interface. Wake Lock, pseudo-veille et message d'avertissement n'ont de sens qu'en mode local.
- **Trois fichiers** (fait en beta.3, simple déplacement sans changement de comportement) : `js/alerts.js` (commun), `js/alerts-local.js` (mode local), `js/alerts-server.js` (mode serveur, ex `push-client.js`). Choisi plutôt qu'un fichier unique : le mode local (Wake Lock, pseudo-veille, minuteries) est isolé et pourra être retiré ; le calcul des horaires (présence / absence, appelé à évoluer) restera dans le fichier commun, partagé par les deux modes. Le choix local / serveur se fera dans les points d'entrée communs (`scheduleAlerts`, `cancelAlerts`, `releaseWakeLock`), encore dans `alerts-local.js` pour l'instant.
- Question ouverte : période démarrée hors ligne en mode serveur (horaires à envoyer dès le retour de la connexion ?).
- Texte des vraies alertes : langue et contenu. Options : charge utile chiffrée, ou table de textes dans `sw.js` choisie d'après un réglage transmis. À trancher avant l'intégration.

## 8. Observations sur appareil

- **Android (Chrome), beta.1 / beta.2** : push programmé reçu app fermée, annulation prise en compte, toucher de la notification ouvre l'app (y compris pour les notifications locales, ce qui n'était pas le cas avant `notificationclick`). **Test de 30 min, app fermée et téléphone en veille : reçu.** Test de 1 h pas encore fait.
- **Windows (Chrome), observé 2026-11-22** : alerte de 30 s reçue **si Chrome est ouvert**. **Chrome fermé : pas de notification** ; elle **arrive à la réouverture de Chrome** (le service push l'avait gardée en attente ; avec un TTL de 300 s, on s'attend à ce qu'une réouverture plus tardive la perde, non vérifié). Le PC n'est pas un enjeu prioritaire ; comportement noté à titre d'information. Testé dans un **onglet** de navigateur. **Veille du PC de 30 s : même comportement** (alerte reçue). PWA installée non testée ; veille plus longue non testée.

## 9. À faire

1. Test long Android de 1 h ; test iOS (app installée sur l'écran d'accueil, iOS 16.4+).
2. Bilan, décision d'intégrer, puis extraction de `alerts*.js`, réglage de mode, intégration.
3. Durcissement avant de vrais utilisateurs : limitation des abus, renouvellement d'un abonnement expiré (`pushsubscriptionchange`), revue de sécurité, mention de confidentialité (le serveur ne conserve que des horaires et l'adresse d'abonnement, effacés après le dernier horaire).
4. Confirmer dans la documentation officielle les noms d'hôtes Apple et Microsoft des services push (liste actuelle dans `PUSH_HOSTS` / `PUSH_HOST_SUFFIXES`).
5. Vérifier sur appareil que le `fetch` du service worker laisse bien passer les appels `POST` vers le Worker (observé OK en test Android ; à confirmer iOS).
