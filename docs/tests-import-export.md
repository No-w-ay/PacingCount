# Tests systématiques — export / import (JSON et CSV)

> Note de chantier. Source de vérité : le code (`js/import-export.js`, moteur des périodes dans `index.html`, `js/daily-data.js`), branche `dev`, **version `0.9.29-beta.42`**. Mise à jour le 2026-10-25 (remplace les versions beta.27 et beta.31/32 de cette note). Dépôt public : aucun contenu personnel, les fichiers de test sont fictifs.
> Statut : logique d'import **refondue en beta.32 à 37**, modal peaufiné en beta.38 à 42 (voir `docs/notes-events.md` § 4.2). **Parcours manuel sur appareil passé le 2026-10-25 (beta.41) sans anomalie** (§ 4) ; il reste la relecture EN/NL des textes.

## 1. En bref

- **70 scénarios** joués par un harnais Node/jsdom sur les **vraies fonctions** du dépôt (logique des périodes, fusion, validation, profils, CSV, retour arrière), plus 25 vérifications spécifiques à la dernière passe (période future, modal 2 écrans, correspondance de types) : **55 conformes à l'attendu, 15 comportements « à juger » (👁), 0 écart (⚠)**. Résultats en annexe.
- Ce que le harnais **ne peut pas voir** reste à faire à la main : sélecteur de fichiers, vrai téléchargement, **lisibilité des deux écrans du modal** (surtout sur téléphone), rendu des écrans après import.
- Parcours manuel : **7 étapes (S1 à S7)** et 6 compléments optionnels ; les fichiers sont fusionnés pour qu'un seul import vérifie plusieurs choses (version courte depuis beta.41).
- Jeu de fichiers manuel : 5 essentiels + 6 optionnels (`1_A…` à `5_H…`, `opt_…`).

## 2. Les règles à vérifier (rappel)

| | Remplacer | Fusionner |
|---|---|---|
| Principe | l'app **devient** le fichier | le **fichier gagne** sur les désaccords |
| Section absente du fichier | périodes / jours → vidés ; tags / types → inchangés | rien n'est touché |
| Types et profil | repris du fichier ; langue des tags/profils prédéfinis de l'app conservée | **jamais modifiés** ; tableau de correspondance si un type du fichier n'est pas une correspondance exacte |
| Période en cours | arrêtée (non annoncée à l'écran 2 depuis beta.40) | traitée comme les autres périodes |
| Périodes futures du fichier | ignorées (> 5 min) / ramenées à maintenant (≤ 5 min) | idem |
| Événements | ceux d'un tag inconnu sont supprimés | par jour et par tag ; polarité opposée : le camp du fichier retire les événements opposés de l'app ce jour-là |
| Avertissement (écran 2) | « N période(s), X note(s) et Y événement(s) actuels… seront effacés » + tableau Maintenant → Après | « … seront écrasés par des données du fichier qui diffèrent dans la même plage temporelle » |
| CSV | périodes uniquement ; événements, notes, tags et types intouchés (les deux modes) | |

## 3. Ce qui est critique, et pourquoi

Une étape est jugée **🔴 critique** si elle peut **faire perdre ou altérer des données** (Remplacer, restauration), si elle passe par un chemin que **seul un appareil réel** valide (sélecteur de fichiers Android, téléchargement), ou si c'est un **usage courant** (sauvegarde, restauration, fusion de deux appareils). **🟠 important** : lisibilité d'un modal qui demande une décision. **⚪ optionnel** : cas rares ou bien couverts par le harnais.

| Étape | Priorité | Ce qu'on contrôle à la main |
|---|---|---|
| **S1** App neuve, puis A en Remplacer | 🔴 | Premier contact : sélecteur de fichiers, les 2 écrans du modal, « Malade » masqué sur app neuve |
| **S2** Exports JSON et CSV | 🔴 | Vrai téléchargement sur Windows **et** Android |
| **S3** BD en Fusionner | 🔴 | Le cœur : fusion, polarité, notes, profil différent ([+]), correspondance de types, textes des 2 écrans |
| **S4** Réimport de l'export | 🔴 | Restauration : retour exact à l'état de S1 |
| **S5** CSV avec correspondance | 🟠 | Modal de correspondance sur téléphone |
| **S6** Une période tourne, puis K en Remplacer | 🔴 | Période en cours arrêtée, alerte annulée |
| **S7** Langues EN/NL, fichier refusé | 🟠 | Textes complets en EN/NL, message d'erreur, données intactes |

> **Si le temps manque** : S1 → S2 → S3 → S4 → S6 (les cinq 🔴).

## 4. Parcours manuel (version courte, beta.41)

Parcours **raccourci en beta.41** : 7 étapes, 5 imports appliqués, 2 exports, 1 fichier refusé, 2 ouvertures de modal sans appliquer (au lieu de 11 étapes et 9-10 imports). Regroupements : le fichier `2_BD_fusion_profil_UZ.json` = contenu de B (3 éléments invalides, événements, notes) + profil UZ Leuven de D (fusion identique à B seul, vérifiée au harnais) ; les étapes s'enchaînent sans réinitialisation ; le réimport de l'export sert de restauration. Retirés car couverts par le harnais : deuxième fusion de B (idempotence), CSV en Remplacer sur appareil, import séparé de D. Jeu de fichiers : `1_A…`, `2_BD…`, `3_K…`, `4_CSV…`, `5_H…`, `opt_…` (générés par `gen-fixtures.js`, sauf `2_BD…` : B avec le profil de D, assemblé à la main).

**Préparation.**
- **Exporter d'abord** (Historique → Exporter .json) si l'appareil contient de vraies données, ou utiliser un autre profil Chrome. Partir d'une **app vide** (effacer les données du site).
- Console ouverte si possible (Windows : F12 ; Android : `chrome://inspect`) : chaque envoi GoatCounter écrit `[GoatCounter] ✅ Envoyé : <nom>`. La version dev envoie au même GoatCounter que la version publiée : ces tests ajoutent quelques hits `import-*`.
- Boutons : **Exporter (.json)** et **Importer** en bas de l'Historique ; **Export partiel (.csv)** et second **Importer** dans les Réglages.
- **À chaque modal** : libellés blancs, nom de fichier monospace beige, plages « a → b » grisées, messages orange **clairs**, ⚠️ seulement sur les boutons d'action, « irréversible » et « Plusieurs types… fusionnés » ; pas de défilement horizontal, boutons distincts.

### S1 🔴 — App neuve, puis A en Remplacer
**a) App neuve** (avant tout import)
- [ ] Mesure → 📝 : seuls **MPE** et **Jour OK** sont proposés (pas « Malade »). Le message de bienvenue s'affiche.

**b) Fichier** `1_A_etat_de_depart.json` → Importer → **écran 1** : `14/09/2026 → 18/09/2026`, « 9 période(s) · 3 note(s) · 6 événement(s) » face à l'application « — » / « 0 période(s) · 0 note(s) · 0 événement(s) » ; « Les profils sont identiques : PacingCount standard ».
- [ ] **Coup d'œil sans appliquer** : « Continuer vers Fusionner » → écran 2 quasi vide (rien à écraser, pas de tableau) → « ‹ Retour ».
- [ ] « Continuer vers Remplacer » → écran 2 : tableau Maintenant → Après (périodes 0 → 9, notes 0 → 3, événements 0 → 6), ligne **Profil** « PacingCount standard → PacingCount standard », aucun message orange (app vide), bouton rouge « ⚠️ Tout remplacer », « ⚠️ Cette action est irréversible… », bouton orange d'export, « ‹ Retour », « Annuler ». Tester « Retour » puis « Annuler » une fois (rien ne change), puis recommencer et confirmer.
- [ ] Android : le sélecteur permet de choisir le `.json`. Console : `import-json-replace`.
- Message : « Import terminé : 9 période(s), 3 note(s) et 6 événement(s) importé(s). » (beta.42 ; mêmes comptes que l'écran 1)

| Jour | Périodes (type #) | Note et événements |
|---|---|---|
| 14/09 | 08:00–09:00 #1 · 09:00–10:30 #2 · 10:30–12:00 #4 · 14:00–15:00 #1 | note « Note A 14/09 », MPE, Céphalée (oui) |
| 15/09 | 08:00–10:00 #4 · 10:00–11:00 #1 · 13:00–13:30 #2 | Jour OK |
| 16/09 | 09:00–12:00 #1 · 16:00–17:00 #2 | note « Note A 16/09 », Malade, Céphalée (non) |
| 18/09 | aucune | note « Seulement dans l'app », MPE |

- [ ] **Malade** est maintenant visible : le fichier A contient la liste de tags avec Malade actif, et Remplacer applique le fichier. Ce n'est pas un bug (une app neuve le masque, étape a).

### S2 🔴 — Exports réels
- [ ] Windows **et** Android : Historique → Exporter .json, puis Réglages → Export partiel .csv ; les deux fichiers sont téléchargés et retrouvables. Console : `export-json`, `export-csv`.
- [ ] **Conserver le `.json`** (restauration S4) et le `.csv` (option ⚪ en fin de note).

### S3 🔴 — BD en Fusionner (fusion + profil différent, en un seul import)
**Fichier** `2_BD_fusion_profil_UZ.json` : le contenu de « B » (événements, notes, périodes, 3 éléments invalides) avec le profil UZ Leuven. **Lire l'écran 1 sans cliquer.**
- Écran 1 : fichier `14/09/2026 → 19/09/2026`, « 8 période(s) · 2 note(s) · 6 événement(s) » avec, **juste dessous en orange clair, « 3 élément(s) ignoré(s) car invalide(s) »** (sans point) ; application « 9 période(s) · 3 note(s) · 6 événement(s) » ; phrase « Le profil du fichier (**UZ Leuven 2018**) diffère de celui de l'application (**PacingCount standard**) **[+]** », noms en gras.
- [ ] **[+] au doigt** : le tableau s'ouvre ([-]), colonne « Dans le fichier » **avant** « Dans l'application » : #1 Couché sans stimulation (identique) ; #2 Détente / Couché actif ; #3 Repas et hygiène / (inactif) ; #4 Activité physique / Non couché ; #5 Activité mentale / (inactif). [-] le referme.
- « Continuer vers Fusionner » → écran 2 : « Le profil de l'application (**PacingCount standard**) sera conservé : les périodes du fichier doivent être réparties sur ce profil. », puis « Correspondances… ✅ = … 🔍 = vérifier avant importation. » ; tableau : ✅ Couché sans stimulation #1 → #1, 🔍 Détente #2 → Couché actif #2, 🔍 Activité physique #4 → Non couché #4 ; **vrai espace sous le tableau** ; message « 4 période(s), 1 note(s) et 2 événement(s) actuels… seront écrasés par des données du fichier qui diffèrent dans la même plage temporelle » ; « ⚠️ Fusionner ».
- [ ] Listes déroulantes utilisables au doigt (changer une cible puis remettre la valeur d'origine). Console : `import-json-merge`.
- Après : **profil et types inchangés (standard)** ; message « Import terminé : 8 période(s), 2 note(s) et 6 événement(s) importé(s). » (beta.42).

| Jour | Périodes (type #) | Note et événements |
|---|---|---|
| 14/09 | 08:00–09:00 #1 · 09:00–09:30 #2 · 09:30–10:00 #1 · 10:00–10:30 #2 · 10:30–12:00 #4 · 14:00–15:00 #2 | note « Note B 14/09 », MPE, Céphalée (**non**) |
| 15/09 | 07:30–10:30 #2 · 10:30–11:00 #1 · 13:00–14:00 #2 | **MPE seul** (« Jour OK » retiré) |
| 16/09 | 09:00–12:00:30 #1 · 12:00:30–13:00 #4 · 16:00–17:00 #2 · 17:02–18:00 #4 | note « Note A 16/09 », Malade, Céphalée (non) |
| 17/09 | 22:00–24:00 #1 | note « Note B 17/09 (seulement dans le fichier) », Jour OK, Céphalée (oui) |
| 18/09 | 00:00–06:00 #1 | note « Seulement dans l'app », MPE |
| 19/09 | aucune | Migraine |

- [ ] Nouveau tag « Migraine » ; les tags prédéfinis gardent leur libellé français. 14/09 : l'ancienne période #2 coupée en trois ; 16/09 : recollement à 12:00:30 mais trou 17:00–17:02 conservé ; 17→18/09 coupé à minuit ; notes des 16 et 18/09 intactes.

### S4 🔴 — Restauration : réimporter l'export de S2
**Fichier** : le `.json` téléchargé en S2 → Continuer vers Remplacer → Tout remplacer.
- Écran 1 : fichier « 9 période(s) · 3 note(s) · 6 événement(s) » face à l'application « 15 période(s) · 4 note(s) · 9 événement(s) ».
- [ ] **L'app est exactement revenue à l'état de S1** (tag « Migraine » et jours 17 et 19/09 disparus, périodes de BD parties). Console : `import-json-replace`.

### S5 🟠 — CSV avec correspondance de types (Fusionner)
**Fichier** `4_CSV_types_a_mapper.csv` → Importer (Réglages ou Historique).
- Deux paragraphes au-dessus du tableau (profil conservé, puis correspondances) ; lignes : ✅ #1, ✅ #2, 🔍 Non couché #3 → #4, ✅ #4, 🔍 Détente #5 → (sans nom) (inactif) #5, 🔍 Autre #7 → Ignorer ; **avertissement orange clair** « ⚠️ Plusieurs types du fichier seront fusionnés… » ; boutons « ⚠️ Remplacer l'historique » et « ⚠️ Fusionner » bien lisibles.
- [ ] Listes déroulantes au doigt ; couleurs de bordure et de flèche cohérentes ; l'avertissement suit les changements de sélection.
- Cliquer **Fusionner** : « 5 période(s) importée(s) avec succès » ; 15 périodes au total (nouveautés : 14/09 09:30–10:00 #1, 16:00–17:00 #2, 19:00–20:00 #4 ; 15/09 11:00–12:00 #4 et 18:00–19:00 **#5**). Console : `import-csv-merge`.
- [ ] Les 4 lignes invalides du fichier sont ignorées sans message.
- [ ] La période en **#5** (type inactif, sans nom) : comment s'affiche-t-elle dans Historique et Résultats ? (à juger)

### S6 🔴 — Une période tourne, puis K en Remplacer
**Préparation** : dans Mesure, démarrer une période (idéalement avec alerte) et la laisser tourner.
**Fichier** `3_K_remplacement_partiel.json` → Importer. Écran 1 : `22/09/2026 → 26/09/2026`, « 2 période(s) · — note(s) · — événement(s) » (« — » = section absente), pas de ligne de profil.
- [ ] **Coup d'œil** : Fusionner → écran 2 quasi vide (pas de tableau) → « ‹ Retour ».
- Remplacer → écran 2 : tableau Maintenant → Après ; « …actuels de l'application seront effacés et remplacés par les données du fichier. » (pas de phrase sur le profil ni sur la période en cours). Console : `import-json-replace`.
- Après : historique = 22/09 09:00–10:00 **#5** et 26/09 09:00–10:00 #1 ; **plus aucune période en cours** ; **plus aucun jour d'événements** ; tag « Céphalée » supprimé ; types et profil inchangés.
- [ ] Chrono de Mesure arrêté, alerte annulée (Android : plus de notification de cette période).
- [ ] La période du 22/09 en type #5 : même jugement qu'en S5.

### S7 🟠 — Langues EN / NL et fichier refusé (sans rien appliquer)
Réglages → **English**, puis ouvrir `2_BD_fusion_profil_UZ.json` : lire l'écran 1 ([+] et tableau), écran 2 Remplacer (ligne « Profile », « The file's profile will be applied. ») et écran 2 Fusionner (« The app's profile (…) will be kept… »), puis **Annuler**. Même chose en **Nederlands** (« Profiel… », « Het profiel van het bestand wordt toegepast. », « Het profiel van de app (…) blijft behouden… »).
- [ ] Textes complets, jamais coupés, aucun mot français résiduel ; plages et compteurs corrects.
- [ ] **Toujours en NL**, importer `5_H_pas_une_sauvegarde.json` : alerte « fichier pas une sauvegarde PacingCount » en néerlandais, **aucun modal**, données inchangées, **aucun** `import-*` dans la console.
- Remettre la langue en français.

### Résultats sur appareil (2026-10-25, beta.41)
Parcours S1 à S7 passé **sans anomalie**. Points « à juger » tranchés : une **période sur un type inactif et sans nom** (#5, S5 et S6) est visible comme attendu dans Historique **et** Résultats ; la taille du **[+]** (tableau des types, écran 1) est correcte au doigt. Corrections demandées à l'issue : texte de `messages.json` (noms d'onglets), note du CSV (Réglages) et message de confirmation JSON → **beta.42**.

## 5. Compléments optionnels ⚪

Depuis un état connu (réimporter `1_A…` en Remplacer avant). Fichiers du jeu court : `opt_…`.

| Option | Fichier | À contrôler |
|---|---|---|
| **Opt 1** CSV exporté réimporté | le `.csv` de S2 (Fusionner) | 3 lignes ✅, message vert « tous les types reconnus » ; aucune période ne change ; console `import-csv-merge` |
| **Opt 2** Profil personnalisé | `opt_E_profil_perso.json` (Fusionner) | Phrase « Le profil du fichier (✏️ Personnalisé)… » ; types de l'app inchangés ; ajoutés : 20/09 #1 et #2, 21/09 #3 |
| **Opt 3** Ancien CSV | `opt_CSV_ancien_format.csv` (Fusionner) | Lignes 🔍 « COUCHE SANS STIMULATION » → #1, « non couche » → #4, « Marche » → Ignorer ; « 2 période(s) » |
| **Opt 4** Fichier vide ⚠️ destructif | `opt_V_vide_mais_valide.json` (Remplacer) | **Après avoir exporté.** Écran 2 : « 9 période(s), 3 note(s) et 6 événement(s)… effacés » ; tout est vide |
| **Opt 5** Changement d'heure | `opt_G_changement_heure.json` (Fusionner) | Résultats au 26/10/2025 (25 h) et 29/03/2026 (23 h) : la période 00:00–04:00 vaut **5 h** puis **3 h** |
| **Opt 6** B seul, même profil | `opt_B_a_fusionner.json` (Fusionner) | Écran 1 « profils identiques », écran 2 sans tableau ; même résultat que S3 |

## 6. Rejouer le harnais

Dossier `harness/` (hors dépôt) : `lib.js` (chargeur), `gen-fixtures.js` (génère `fixtures/` et `manuel/`), `run-scenarios.js` (70 scénarios → `table.md`, `results.json`), `run-parcours.js` (enchaîne l'ancien parcours M1 à M8 et Opt 1 à 5 → `parcours.json`, 27 états ; le parcours court S1 à S7 en est un sous-ensemble, plus le fichier BD), `run-passe6.js` (25 vérifications : périodes futures, écrans, correspondance), `show-modal3.js` (texte des deux écrans en FR/EN/NL).

```
npm i jsdom
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node gen-fixtures.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-scenarios.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-parcours.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-passe6.js
```

Mesuré sur beta.42 : scénarios ✔ 55 · 👁 15 · ⚠ 0 ; parcours : 27 états, 0 incohérence ; passes 6, 8 et 9 : 25, 17 et 18 vérifications, 0 écart. Chaîne du parcours court (A → BD → restauration → CSV → K) rejouée à part (`t3.js`/`t5.js`) : restauration = état A exact, fusion de BD = fusion de B seul. À relancer après toute modification de `js/import-export.js` ou du moteur des périodes. **Limites** : pas de rendu visuel (modals, pastilles, types sans nom) ; pas de vrai sélecteur de fichiers ni de téléchargement (le harnais appelle `buildJSONExport()` et `buildCSVString()`, pas `exportJSON()` / `exportCSV()`) ; alertes, notifications et rendus sont des stubs.

## 7. Observations de la première série (beta.27) et état (beta.37 ; inchangé depuis)

| N° | Observation d'origine | État beta.37 |
|---|---|---|
| O1 | Fichier vide en Remplacer : périodes effacées sans être chiffrées | **Résolu** : avertissement chiffré + tableau Maintenant → Après |
| O2 | Remplacer arrête la période en cours sans le dire | Annoncé en beta.37 (JSON), **retiré en beta.40** (phrase jugée inutile : l'arrêt est attendu). CSV : silencieux |
| O3 | Fusionner : note écrasée non comptée | **Résolu** : comptée dans l'avertissement |
| O4 | Remplacer : tag perso supprimé mais événements orphelins | **Résolu** : `dropEventsOfUnknownTags()` ; l'app devient le fichier |
| O5 | Fusion : « Jour OK » et « MPE » le même jour | **Résolu** : règle de polarité |
| O6 | Remplacer ne normalise pas les chevauchements internes | **Ouvert** (RP6, C10) |
| O7 | Période du fichier dans le futur acceptée | **Résolu** (JSON) : ignorée > 5 min ; CSV non filtré |
| O8 | Fusion : le profil du fichier remplace celui de l'app | **Résolu** : types/profil de l'app jamais modifiés en Fusionner ; types « sans nom » possibles seulement par la correspondance (S3) ou Remplacer |
| O9 | Sans `typesConfig`, périodes d'un type inactif importées sans question | **Ouvert** (TP8, à juger) |
| O10 | Profil personnalisé remplacé sans avertissement spécifique | **Accepté** : le profil fait partie de ce que Remplacer annonce |
| O11 | CSV : libellé avec virgule tronqué | **Ouvert** (C8) |
| O12 | Note importée non limitée à 80 caractères | **Reporté** (R8, `TODO.md`) |
| O13 | CSV : type #5 inactif ciblé d'office | **Toléré** (R11) |

**Solide** : validation avant écriture (aucune erreur ne modifie les données), détection du format par le contenu, BOM et CRLF, aller-retour JSON et CSV identique, idempotence de la fusion, recollement < 60 s, coupure à minuit, jours de 23 h / 25 h, fusion par jour **et** par tag, retour arrière JSON.

## 8. À retenir

- Reportés (voir `TODO.md`) : R6 retour arrière CSV, R8 limite de longueur des notes, R9 caractères spéciaux dans les libellés, R10 export compact ou indenté.
- Parcours court S1 à S7 passé sur appareil en beta.41 (Windows, Android). Reste : iOS ponctuel si possible ; relecture EN/NL des textes du modal.
- Ajouts beta.38 à 42 : voir `docs/notes-events.md` § 4.2.

## Annexe — les 70 scénarios du harnais (mesurés sur beta.37)

Verdicts : ✔ conforme à l'attendu · 👁 comportement mesuré à juger · ⚠ écart. Colonne « Manuel » : l'étape de l'**ancien** parcours (beta.37) qui le contrôle à l'écran ; équivalence avec le parcours court : M1→S1, M2→S2, M3 et M5a→S3, M4→S4, M6→S6, M7→S5, M8→S7.


#### 1. Aller-retour

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| R1 | A importé (Remplacer) sur app vide, puis export JSON | L'app devient A : 9 périodes, 4 jours, 4 tags, profil standard. L'export redonne le contenu de A. | 9 périodes, 4 jours, profil pacingcount_standard | ✔ | M1 |
| R2 | Export de l'app A réimporté (Remplacer) dans une app vide | État identique (périodes, jours, tags, types). | 9 périodes | ✔ | M4 |
| R3 | Export pendant qu’une période tourne depuis 10 min, puis réimport (Remplacer) | La période en cours est exportée comme close (fin = maintenant). Au réimport elle est close, plus en cours. | 👁 après réimport, la période n’est plus « en cours » (elle devient une période close) | 👁 | — |

#### 2. Périodes — Fusionner (B dans A)

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| FP1 | P1 : B 14/09 14:00–15:00 type 2 recouvre exactement A4 (type 1) | Le fichier gagne : A4 disparaît, reste 14:00–15:00 type 2. | 09-14 08:00→09:00 t1 ; 09-14 09:00→09:30 t2 ; 09-14 09:30→10:00 t1 ; 09-14 10:00→10:30 t2 ; 09-14 10:30→12:00 t4 ; 09-14 14:00→15:00 t2 | ✔ | M3 |
| FP2 | P2 : B 09:30–10:00 type 1 à l’intérieur de A2 (09:00–10:30 type 2) | A2 est coupée en 3 : 09:00–09:30 t2, 09:30–10:00 t1, 10:00–10:30 t2. | 09-14 08:00→09:00 t1 ; 09-14 09:00→09:30 t2 ; 09-14 09:30→10:00 t1 ; 09-14 10:00→10:30 t2 ; 09-14 10:30→12:00 t4 ; 09-14 14:00→15:00 t2 | ✔ | M3 |
| FP3 | P3 : B 15/09 07:30–10:30 type 2 couvre A5 et le début de A6 | A5 disparaît ; A6 raccourcie à 10:30–11:00 t1 ; reste 07:30–10:30 t2. | 09-15 07:30→10:30 t2 ; 09-15 10:30→11:00 t1 ; 09-15 13:00→14:00 t2 | ✔ | M3 |
| FP4 | P4 : B 13:30–14:00 type 2, collée à A7 (13:00–13:30 type 2) | Fusion des adjacentes de même type : 13:00–14:00 t2. | 09-15 07:30→10:30 t2 ; 09-15 10:30→11:00 t1 ; 09-15 13:00→14:00 t2 | ✔ | M3 |
| FP5 | P5 : B 12:00:30–13:00 type 4 ; A8 se termine à 12:00:00 (écart 30 s < 60 s) | Recollement : A8 se prolonge jusqu’à 12:00:30, pas de trou. | 09-16 09:00→12:00:30 t1 ; 09-16 12:00:30→13:00 t4 ; 09-16 16:00→17:00 t2 ; 09-16 17:02→18:00 t4 | ✔ | M3 |
| FP6 | P6 : B 17:02–18:00 type 4 ; A9 se termine à 17:00 (écart 2 min ≥ 60 s) | Pas de recollement : le trou 17:00–17:02 reste. | 09-16 09:00→12:00:30 t1 ; 09-16 12:00:30→13:00 t4 ; 09-16 16:00→17:00 t2 ; 09-16 17:02→18:00 t4 | ✔ | M3 |
| FP7 | P7 : B 17/09 22:00 → 18/09 06:00 type 1 (à cheval sur minuit) | Coupée à minuit en 2 entrées : 22:00→23:59:59.999 et 00:00→06:00. | 09-17 22:00→23:59:59.999 t1 / 09-18 00:00→06:00 t1 | ✔ | M3 |
| FP8 | P8 : B 14/09 10:30–12:00 type 4 = doublon exact de A3 | Une seule période 10:30–12:00 t4 (pas de doublon). | 09-14 08:00→09:00 t1 ; 09-14 09:00→09:30 t2 ; 09-14 09:30→10:00 t1 ; 09-14 10:00→10:30 t2 ; 09-14 10:30→12:00 t4 ; 09-14 14:00→15:00 t2 | ✔ | M3 |
| FP9 | Période de B invalide (typeId 9) et décompte global | typeId 9 ignoré ; 15 périodes au total ; A1 intacte ; le modal annonce 3 éléments ignorés. | 15 périodes ; modal : « 3 élément(s) ignoré(s) car invalide(s). » | ✔ | M3 |
| FP10 | B fusionné une 2e fois (idempotence) | Aucun changement. | 15 périodes après 2e fusion | ✔ | M3 |

#### 3. Remplacer, fichiers partiels et cas limites

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| RP1 | B importé en Remplacer sur A | Historique = uniquement les périodes de B (9 entrées, P7 coupée à minuit). Rien de A ne reste, sauf le doublon exact (P8 = A3). | 9 périodes | ✔ | Opt 5 |
| RP2 | Fichier valide mais vide (periodData [] et dailyData {}), Remplacer sur A | Tout est effacé (« l’app devient le fichier »). Le modal doit le dire clairement. | modal : « 0 période(s) · 0 note(s) · 0 événement(s) \| 9 période(s) · 3 note(s) · 6 événement(s) » ; avertissement : 9 période(s), 3 note(s) et 6 événement(s) actuels de l'application seront effacés — 👁 efface tout, comme annoncé (« l’app devient le fichier ») ; l’avertissement chiffre les 9 périodes, 3 notes et 6 événements (observation O1 résolue) | 👁 | Opt 3 |
| RP3 | K (2 périodes dont 1 de type 5 inactif, tags builtin, sans événements ni types) en Remplacer sur A | Périodes = celles de K ; jours vidés (fichier sans dailyData) ; types et profil inchangés (fichier sans typesConfig). | 09-22 09:00→10:00 t5 ; 09-26 09:00→10:00 t1 ; 0 jours restants | ✔ | M6 |
| RP4 | J (événements + tags builtin, sans périodes) en Remplacer sur A | Jours = ceux de J ; périodes vidées (fichier sans periodData). Le tag perso « headache » (absent de J) disparaît. | tags : pem:MPE:presence, sick:Malade:presence, day_ok:Jour OK:presence | ✔ | — |
| RP5 | K (même import que RP3) : tag perso absent du fichier | Le tag « headache » disparaît ; ses événements sont retirés des jours (0 orphelin). | tags : pem:MPE:presence, sick:Malade:presence, day_ok:Jour OK:presence ; événements headache restants dans les jours : 0 | ✔ | M6 |
| RP6 | I (périodes qui se chevauchent dans le fichier), Remplacer sur app vide | Idéalement : pas de chevauchement dans l’historique. | 09-23 10:00→11:00 t1 ; 09-23 10:30→11:30 t2 ; 09-23 14:00→15:00 t4 ; 09-23 14:30→15:30 t4 — 👁 Remplacer ne passe pas par le rouleau compresseur : les 4 périodes chevauchantes sont conservées telles quelles | 👁 | — |
| RP7 | I, Fusionner sur app vide | Idéalement : pas de chevauchement. | 09-23 10:00→11:00 t1 ; 09-23 10:30→11:30 t2 ; 09-23 14:00→15:30 t4 — 👁 en Fusionner, seules les périodes de même type se rejoignent : 09-23 10:00→11:00 t1 \| 09-23 10:30→11:30 t2 \| 09-23 14:00→15:30 t4 | 👁 | — |
| RP8 | M : événements incohérents (presence avec value, tristate avec valeur invalide) | Les 2 événements sont ignorés ; le modal le signale (2 ignorés). | ignorés : 2 ; jours retenus : 0 | ✔ | — |

#### 4. Période en cours

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| LV1 | Remplacer (JSON, fichier K) pendant qu’une période tourne | La période en cours est arrêtée (l’historique devient le fichier) ; le modal devrait prévenir. | période en cours après import : aucune ; alertes annulées +1 — 👁 arrêt de la période en cours sans avertissement dédié (le modal mentionne une période « en cours » : true) | 👁 | M6 |
| LV2 | Remplacer (CSV) pendant qu’une période tourne | Idem LV1. | 👁 arrêt silencieux de la période en cours (CSV) | 👁 | — |
| LV3 | Fusionner : B couvre [−120 min ; −30 min] en type 2, période en cours = type 1 depuis −60 min | Le fichier gagne : la période en cours perd son début et recommence à −30 min (même type, alertes reprogrammées). | début de la période en cours : 30 min avant maintenant | ✔ | — |
| LV4 | Fusionner : B couvre [−120 ; −30 min] en type 1 (même type que la période en cours depuis −60 min) | Les deux se rejoignent : la période en cours recommence à −120 min. | début de la période en cours : 120 min avant maintenant ; alertes reprogrammées : true — 👁 une période importée peut avancer le début d’une période en cours de même type (et donc ses alertes) | 👁 | — |
| LV5 | Fusionner : B (type 2) couvre toute la période en cours et se termine dans le futur (+60 min) | Cas limite : idéalement refusé ou signalé. | période en cours : oui ; périodes closes dans le futur : 0 — 👁 depuis beta.37 la période du fichier qui finit à plus de 5 min dans le futur est ignorée : la période en cours est conservée (O7 résolue ; détail dans `run-passe6.js`) | 👁 | — |

#### 5. Événements & notes — Fusionner (B dans A)

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| FE1 | Jours présents seulement dans l’app (16/09, 18/09) | Intacts (texte + événements). | 16/09 et 18/09 inchangés | ✔ | M3 |
| FE2 | Jours présents seulement dans le fichier (17/09, 19/09) | Ajoutés. 19/09 ne garde que « migraine » (« ghost » inconnu ignoré). | 17/09 : {"text":"Note B 17/09 (seulement dans le fichier)","events":[{"tagId":"day_ok"},{"tagId":"headache","value":"yes"}]} ; 19/09 : {"events":[{"tagId":"migraine"}]} | ✔ | M3 |
| FE3 | Même jour (14/09), notes différentes : « Note A 14/09 » (app) vs « Note B 14/09 » (fichier) | Le fichier gagne (comme annoncé par le modal) ; idéalement signalé comme les autres désaccords. | texte final : « Note B 14/09 » ; avertissement du modal (périodes, notes, événements écrasés) : 4 / 1 / 2 | ✔ | M3 |
| FE4 | Même jour, même tag, même valeur (14/09 pem) | Pas de doublon. | [{"tagId":"pem"},{"tagId":"headache","value":"no"}] | ✔ | M3 |
| FE5 | Tag « headache » (à 3 états) le 14/09 : app = oui, fichier = non | Le fichier gagne (non) ; le modal annonce 2 événements écrasés (cette valeur + 1 événement retiré par la polarité, voir FE6). | valeur finale : no ; modal : périodes/notes/événements écrasés = 4 / 1 / 2 | ✔ | M3 |
| FE6 | 15/09 : app = « Jour OK » (positif), fichier = « MPE » (négatif) | Exclusion par polarité : seul l’événement du fichier (MPE) subsiste. | [{"tagId":"pem"}] | ✔ | M3 |
| FE7 | Tags : définitions de B (labels EN, tag « migraine » nouveau) | Tags connus gardent le libellé de l’app (« MPE », « Céphalée ») ; « migraine » ajouté. | pem:MPE:presence, sick:Malade:presence, day_ok:Jour OK:presence, headache:Céphalée:tristate, migraine:Migraine:presence | ✔ | M3 |
| FE8 | Clé de jour impossible « 2026-02-30 » dans B | Ignorée. | absente des jours | ✔ | M3 |

#### 6. Événements & notes — Remplacer (B sur A)

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| FR1 | B en Remplacer : jours | Jours = ceux de B (14, 15, 17, 19/09). Les jours de l’app absents de B (16 et 18/09) sont effacés ; le modal annonce tout ce que l’app contient (périodes, notes, événements). | jours : 2026-09-14, 2026-09-15, 2026-09-17, 2026-09-19 ; avertissement (périodes/notes/événements effacés) : 9 / 3 / 6 | ✔ | Opt 5 |
| FR2 | B en Remplacer : définitions des tags | Tags builtin reconstruits dans la langue de l’app (« MPE »…) ; tags perso du fichier repris tels quels (« Headache » EN, « migraine »). | pem:MPE:presence, sick:Malade:presence, day_ok:Jour OK:presence, headache:Headache:tristate, migraine:Migraine:presence | ✔ | Opt 5 |
| FR3 | B en Remplacer : même profil (EN) sur app FR | Aucune différence de types signalée ; libellés restent en français. | #1 Couché sans stimulation actif \| #2 Couché actif actif \| #3 ∅ inactif \| #4 Non couché actif \| #5 ∅ inactif \| #6 ∅ inactif | ✔ | Opt 5 |
| FR4 | N : note de 6 000 caractères ; note HTML de plus de 80 caractères | Note tronquée à 5 000 ; HTML conservé tel quel (échappé à l’affichage) ; limite UI de 80 caractères non appliquée (déjà noté au TODO). | 27/09 : 5000 car. ; 28/09 : 120 car., commence par « <img src=x onerror=ale » — 👁 texte HTML stocké brut ; l’affichage Résultats passe par escapeHtml (vérifié dans le code), les autres vues sont à confirmer à l’écran | 👁 | — |

#### 7. Types & profils

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| TP1 | D (UZ Leuven, EN) sur A (standard, FR) : tableau de différences | Différences sur #2, #3, #4, #5 (pas #1 : même libellé, autre langue ; pas #6 : inactif des deux côtés et sans données). | types en différence : #2 #3 #4 #5 | ✔ | M5 |
| TP2 | D en Fusionner sur A | Périodes ajoutées via le tableau de correspondance ; types et profil de l’app inchangés ; écran 2 : tableau proposé. | 13 périodes ; types : #1 Couché sans stimulation actif \| #2 Couché actif actif \| #3 ∅ inactif \| #4 Non couché actif \| #5 ∅ inactif \| #6 ∅ inactif ; profil pacingcount_standard — 👁 périodes de D ramenées par défaut selon la logique du CSV (libellé identique ailleurs, sinon même numéro) : 09-14 08:00→09:00 t1 ; 09-14 09:00→10:30 t2 ; 09-14 10:30→12:00 t4 ; 09-14 14:00→15:00 t1 ; 09-14 18:00→19:00 t3 ; 09-14 19:00→20:00 t5 ; 09-15 08:00→10:00 t4 ; 09-15 10:00→11:00 t1 ; 09-15 13:00→13:30 t2 ; 09-15 15:00→16:00 t2 ; 09-15 16:00→17:00 t4 ; 09-16 09:00→12:00 t1 ; 09-16 16:00→17:00 t2 | 👁 | M5 |
| TP3 | D en Remplacer sur A | Historique = D (4 périodes) ; même résultat de types que TP2. | 4 périodes ; profil uz_leuven_2018 | ✔ | — |
| TP4 | Sens inverse : app en UZ Leuven (avec données types 3 et 5), puis A (standard) en Fusionner | Le profil UZ Leuven de l’app est conservé ; plus de types « fantômes » créés par l’import. | types : #1 Couché sans stimulation actif \| #2 Détente actif \| #3 Repas et hygiène actif \| #4 Activité physique actif \| #5 Activité mentale actif \| #6 ∅ inactif ; périodes portant un type devenu inactif (3 ou 5) : 2 — 👁 2 période(s) restent rattachées à des types désormais inactifs et sans nom (types « fantômes ») : à voir à l’écran | 👁 | M5 |
| TP5 | E (profil personnalisé « Marche » / « Repos… » / « Douleur, forte ») en Fusionner sur A | Types et profil de l’app inchangés (standard) ; aucun profil personnalisé créé. | types : #1 Couché sans stimulation actif \| #2 Couché actif actif \| #3 ∅ inactif \| #4 Non couché actif \| #5 ∅ inactif \| #6 ∅ inactif | ✔ | Opt 1 |
| TP6 | Puis une variante de E (autre libellé au type 1) en Fusionner | Toujours aucun changement de types ni de profil. | profil : pacingcount_standard | ✔ | — |
| TP7 | E : libellés `Repos "calme" <b>d'après</b>` et `Douleur, forte` | Caractères dangereux retirés ; apostrophe droite → ’ ; la virgule est conservée. | (en Remplacer) libellé #2 stocké : « Repos calme bd’après/b » ; libellé #3 : « Douleur, forte » | ✔ | Opt 1 |
| TP8 | K (sans typesConfig, avec une période de type 5 inactif dans l’app), Fusionner | Idéalement signalé. | aucune question posée (tableau de différences affiché : false) ; périodes de type 5 importées : 1 ; type 5 : #5 ∅ inactif — 👁 les périodes d’un type inactif sont importées sans avertissement quand le fichier n’a pas de typesConfig | 👁 | M6 |
| TP9 | H5 : profil de types sans aucun type actif | Refusé (au moins un type actif). | message : « Ce fichier est abîmé ou ne contient aucune donnée valide. » | ✔ | — |
| TP10 | Période en cours de type 4 avec alerte active ; E en Remplacer rend le type 4 inactif | L’alerte du type 4 est désactivée ; Remplacer arrête la période en cours (plus d’alerte programmée). | alerte : désactivée ; période en cours : aucune | ✔ | — |

#### 8. Fichiers invalides et détection

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| IV1 | H1_json_casse.json — JSON tronqué (commence par {) | Message d’erreur clair (« Impossible de lire ce fichier (JSON invalide). »), aucune modification. | message : « Impossible de lire ce fichier (JSON invalide). » | ✔ | — |
| IV2 | H2_autre_json.json — JSON d’une autre origine | Message d’erreur clair (« Ce fichier n'est pas une sauvegarde PacingCount. »), aucune modification. | message : « Ce fichier n'est pas une sauvegarde PacingCount. » | ✔ | M8 |
| IV3 | H3_version_future.json — formatVersion 2 | Message d’erreur clair (« Ce fichier a été créé par une version plus récente de PacingCount. Mettez l'application à jour avant de l'importer. »), aucune modification. | message : « Ce fichier a été créé par une version plus récente de PacingCount. Mettez l'application à jour avant de l'importer. » | ✔ | — |
| IV4 | H4_periodes_toutes_invalides.json — toutes les périodes invalides | Message d’erreur clair (« Ce fichier est abîmé ou ne contient aucune donnée valide. »), aucune modification. | message : « Ce fichier est abîmé ou ne contient aucune donnée valide. » | ✔ | — |
| IV5 | H6_aucune_section.json — format correct mais aucune section | Message d’erreur clair (« Ce fichier ne contient rien à importer. »), aucune modification. | message : « Ce fichier ne contient rien à importer. » | ✔ | — |
| IV6 | H8_vide.json — fichier vide (aiguillé vers le CSV) | Message d’erreur clair (« Fichier illisible : fichier d'origine PacingCount attendu (.json ou .csv). »), aucune modification. | message : « Fichier illisible : fichier d'origine PacingCount attendu (.json ou .csv). » | ✔ | — |
| IV7 | Aucune des erreurs ci-dessus ne modifie les données | État identique avant / après. | état identique | ✔ | — |
| IV8 | H7 : fichier JSON valide précédé d’un BOM | Accepté. | modal affiché : true | ✔ | — |
| IV9 | Détection par le contenu : JSON nommé .csv, CSV nommé .json | Chacun aiguillé selon son contenu, pas son extension. | B.csv → modal JSON : true ; x.json → modal CSV : true | ✔ | — |

#### 9. Changement d’heure

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| DS1 | G : périodes 25→26/10/2025 (23 h–04 h) et 28→29/03/2026 (23 h–04 h), Remplacer | Coupées à minuit ; durées réelles : 00:00→04:00 le 26/10/2025 = 5 h (jour de 25 h), le 29/03/2026 = 3 h (jour de 23 h). | 10-25 23:00→23:59:59.999 t1 ; 10-26 00:00→04:00 t1 ; 03-28 23:00→23:59:59.999 t1 ; 03-29 00:00→04:00 t1 ; durées réelles : 5.00 h et 3.00 h | ✔ | Opt 4 |

#### 10. CSV

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| C1 | Export CSV de l’app A | Ligne « sep=, », en-tête, 9 lignes ; heures avec secondes. | 9 lignes de données ; 1re : 2026-09-14,08:00:00,09:00:00,1,Couché sans stimulation,60 | ✔ | M2 |
| C2 | Aller-retour CSV : export de A importé (Remplacer) dans une app vide | Tous les types reconnus exactement (✅, message vert) ; périodes identiques à A. | ✅ Couché sans stimulation #1 → Couché sans stimulation #1 \| ✅ Couché actif #2 → Couché actif #2 \| ✅ Non couché #4 → Non couché #4 ; message : « ✅ Tous les types du fichier ont été reconnus automatiquement. » ; 9 périodes | ✔ | M7 |
| C3 | CSV_types en Fusionner sur A | A2 coupée en 3 par la ligne 09:30–10:00 ; 15 périodes au total ; « 5 période(s) importée(s) » (le type #7 est ignoré). | 15 périodes ; « 5 période(s) importée(s) avec succès. » | ✔ | M7 |
| C4 | CSV_ancien_format (JJ/MM/AAAA, colonne Type sans id) en Fusionner | Libellés reconnus sans tenir compte de la casse ni des accents (🔍) → types 1 et 4 ; « Marche » inconnu → Ignorer ; 2 périodes importées. | 🔍 COUCHE SANS STIMULATION → Couché sans stimulation #1 \| 🔍 non couche → Non couché #4 \| 🔍 Marche → — Ignorer ce type ; « 2 période(s) importée(s) avec succès. » | ✔ | Opt 2 |
| C5 | CSV_types : type #7 inconnu ; #3 « Non couché » (ancienne numérotation) ; #5 « Détente » (type inactif et sans nom dans l’app) | #1, #2, #4 → ✅ ; #7 → Ignorer ; #3 → redirigé vers #4 ; #5 → type #5 de l’app (inactif) sans avertissement. | ✅ Couché sans stimulation #1 → Couché sans stimulation #1 \| ✅ Couché actif #2 → Couché actif #2 \| 🔍 Non couché #3 → Non couché #4 \| ✅ Non couché #4 → Non couché #4 \| 🔍 Détente #5 → (sans nom) (inactif) #5 \| 🔍 Autre #7 → — Ignorer ce type — 👁 « Détente #5 » est dirigé automatiquement vers le type #5 de l’app, inactif et sans nom : l’import crée des périodes sur un type invisible dans la liste de mesure | 👁 | M7 |
| C6 | CSV_types : avertissement de fusion à l’ouverture (#3 et #4 du fichier visent tous deux le type #4) | Avertissement orange de fusion de types, visible dès l’ouverture du modal. | avertissement : « ⚠️ Plusieurs types du fichier seront fusionnés en un seul type dans l'application ("Non couché"). » | ✔ | M7 |
| C7 | CSV_types : BOM, CRLF, ligne vide, fin avant début, date illisible, ligne à 2 colonnes (mêlées aux lignes valides) | Les lignes invalides sont ignorées sans erreur : 6 types listés, 5 périodes importées. | 6 types listés ; « 5 période(s) importée(s) avec succès. » | ✔ | M7 |
| C8 | CSV5 : libellé contenant une virgule (« Douleur, forte »), non protégé par des guillemets | Idéalement : libellé lu en entier, correspondance ✅. | ✅ Marche #1 → Marche #1 \| 🔍 Douleur #3 → Douleur, forte #3 — 👁 le libellé est tronqué à la lecture (🔍 Douleur #3 → Douleur, forte #3) et l'export écrit « 2026-09-21,09:00:00,10:00:00,3,Douleur, forte,60 » (7 colonnes au lieu de 6) ; la résolution par id garde la bonne cible | 👁 | — |
| C9 | CSV_types en Remplacer sur A | Périodes = celles du CSV (5) ; jours, tags et types inchangés (le CSV n’en contient pas). | 5 périodes ; jours conservés : 4 | ✔ | — |
| C10 | CSV6 : deux lignes qui se chevauchent, Remplacer | Idéalement : pas de chevauchement. | 09-23 10:00→11:00 t1 ; 09-23 10:30→11:30 t2 — 👁 même comportement que RP6 : Remplacer conserve les chevauchements internes du fichier | 👁 | — |

#### 11. Retour arrière (stockage plein)

| ID | Fichier / action | Attendu | Mesuré (harnais) | Verdict | Manuel |
|---|---|---|---|---|---|
| RB1 | B en Fusionner alors que le stockage ne peut plus grandir | Échec détecté, retour arrière complet (mémoire + localStorage), message d’erreur d’écriture. | écritures réussies avant l’échec : aucune ; message : « L'import a échoué (stockage plein ?). Vos données précédentes ont été restaurées. » ; état restauré : true | ✔ | — |
| RB2 | D (changement de profil) en Fusionner avec un quota qui laisse passer une partie des écritures | Si l’échec survient après l’écriture des réglages, ceux-ci sont aussi restaurés. | écritures réussies avant l’échec : pacingSettings, pacingDailyData (import déjà partiellement appliqué) ; profil restauré : pacingcount_standard ; état identique à l’original : true | ✔ | — |
