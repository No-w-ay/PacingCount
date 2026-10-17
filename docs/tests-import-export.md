# Tests systématiques — export / import (JSON et CSV)

> Note de chantier. Source de vérité : le code (`js/import-export.js`, moteur des périodes dans `index.html`, `js/daily-data.js`), branche `dev`, **version `0.9.29-beta.37`**. Mise à jour le 2026-10-17 (remplace les versions beta.27 et beta.31/32 de cette note). Dépôt public : aucun contenu personnel, les fichiers de test sont fictifs.
> Statut : la logique d'import a été **refondue en beta.32 à 37** (voir `docs/notes-events.md` § 4.2). Reste à faire : le **parcours manuel sur appareil** (§ 4).

## 1. En bref

- **70 scénarios** joués par un harnais Node/jsdom sur les **vraies fonctions** du dépôt (logique des périodes, fusion, validation, profils, CSV, retour arrière), plus 25 vérifications spécifiques à la dernière passe (période future, modal 2 écrans, correspondance de types) : **55 conformes à l'attendu, 15 comportements « à juger » (👁), 0 écart (⚠)**. Résultats en annexe.
- Ce que le harnais **ne peut pas voir** reste à faire à la main : sélecteur de fichiers, vrai téléchargement, **lisibilité des deux écrans du modal** (surtout sur téléphone), rendu des écrans après import.
- Parcours manuel : **8 étapes essentielles (M1 à M8)** et 5 compléments optionnels. Les fichiers sont fusionnés pour qu'un seul import vérifie plusieurs choses.
- Jeu de fichiers manuel : 6 essentiels + 4 optionnels (`1_A…` à `6_H…`, `opt_…`), générés par le harnais (`gen-fixtures.js`).

## 2. Les règles à vérifier (rappel)

| | Remplacer | Fusionner |
|---|---|---|
| Principe | l'app **devient** le fichier | le **fichier gagne** sur les désaccords |
| Section absente du fichier | périodes / jours → vidés ; tags / types → inchangés | rien n'est touché |
| Types et profil | repris du fichier ; langue des tags/profils prédéfinis de l'app conservée | **jamais modifiés** ; tableau de correspondance si un type du fichier n'est pas une correspondance exacte |
| Période en cours | arrêtée (annoncé à l'écran 2) | traitée comme les autres périodes |
| Périodes futures du fichier | ignorées (> 5 min) / ramenées à maintenant (≤ 5 min) | idem |
| Événements | ceux d'un tag inconnu sont supprimés | par jour et par tag ; polarité opposée : le camp du fichier retire les événements opposés de l'app ce jour-là |
| Avertissement (écran 2) | « N période(s), X note(s) et Y événement(s) actuels… seront effacés » + tableau Maintenant → Après | « … seront écrasés par des données du fichier qui diffèrent dans la même plage temporelle » |
| CSV | périodes uniquement ; événements, notes, tags et types intouchés (les deux modes) | |

## 3. Ce qui est critique, et pourquoi

Une étape est jugée **🔴 critique** si elle peut **faire perdre ou altérer des données** (Remplacer, restauration), si elle passe par un chemin que **seul un appareil réel** valide (sélecteur de fichiers Android, téléchargement), ou si c'est un **usage courant** (sauvegarde, restauration, fusion de deux appareils). **🟠 important** : lisibilité d'un modal qui demande une décision. **⚪ optionnel** : cas rares ou bien couverts par le harnais.

| Étape | Priorité | Ce qu'on contrôle à la main |
|---|---|---|
| **M1** A en Remplacer | 🔴 | Premier contact : sélecteur de fichiers, les 2 écrans du modal |
| **M2** Exports JSON et CSV | 🔴 | Vrai téléchargement sur Windows **et** Android |
| **M3** B en Fusionner | 🔴 | Le cœur : fusion, polarité, notes, textes des 2 écrans |
| **M4** Réimport de l'export | 🔴 | Restauration : retour exact à l'état de M1 |
| **M5** Autre profil (D), puis A | 🟠 | Tableau de différences, tableau de correspondance, types intacts |
| **M6** Une période tourne, puis K en Remplacer | 🔴 | Ligne « période en cours sera arrêtée », alerte annulée |
| **M7** CSV | 🟠 | Modal de correspondance sur téléphone |
| **M8** Fichier invalide | 🟠 | Message d'erreur, données intactes |

> **Si le temps manque** : M1 → M2 → M3 → M4 → M6 (les cinq 🔴).

## 4. Parcours manuel

**Préparation.** Version `dev` (`dev.pacingcount.pages.dev`, données séparées de la version publiée). Si l'appareil contient de vraies données : **exporter d'abord en JSON**, ou tester dans un autre profil Chrome. Partir d'une app vide (effacer les données du site). Fichiers : 14 au 30 septembre 2026 (aucun ne touche la période en cours réelle), `opt_G` : octobre 2025 et mars 2026. Boutons : **Exporter (.json)** et **Importer (.json/.csv)** en bas de l'Historique ; **Export partiel (.csv)** et un second **Importer** dans les Réglages. Dans le modal JSON : écran 1 → « Continuer vers Remplacer / Fusionner » ; écran 2 → « ‹ Retour », « Annuler », bouton d'action (rouge pour Remplacer), bouton orange d'export de secours. Notation : `#2` = type de période n° 2.

### M1 🔴 — A en Remplacer (app vide)
**Fichier** `1_A_etat_de_depart.json` → Importer → **écran 1** → « Continuer vers Remplacer » → **écran 2** → « Tout remplacer ».

Écran 1 : « Du 14/09/2026 au 18/09/2026 · 9 période(s) · 3 note(s) · 6 événement(s) » face à l'application « 0 période(s) · 0 note(s) · 0 événement(s) » ; « Les profils sont identiques : PacingCount standard ». Message final : « Import terminé : 9 période(s) et 4 jour(s) avec événements importés. »

| Jour | Périodes (type #) | Note et événements |
|---|---|---|
| 14/09 | 08:00–09:00 #1 · 09:00–10:30 #2 · 10:30–12:00 #4 · 14:00–15:00 #1 | note « Note A 14/09 », MPE, Céphalée (oui) |
| 15/09 | 08:00–10:00 #4 · 10:00–11:00 #1 · 13:00–13:30 #2 | Jour OK |
| 16/09 | 09:00–12:00 #1 · 16:00–17:00 #2 | note « Note A 16/09 », Malade, Céphalée (non) |
| 18/09 | aucune | note « Seulement dans l'app », MPE |

- [ ] Android : le sélecteur permet de choisir le `.json` (type MIME souvent `text/plain`).
- [ ] Les deux écrans sont lisibles sans défiler en largeur ; les boutons se distinguent ; « ‹ Retour » ramène à l'écran 1 sans rien perdre.
- [ ] Le nom du fichier est en monospace ; le tableau Maintenant → Après de l'écran 2 est lisible.
- [ ] Historique et Résultats conformes au tableau ; le 18/09 est absent de Résultats (pas de période, comportement connu) mais présent dans le tableau de saisie 📝.

### M2 🔴 — Exports réels (JSON et CSV)
**État** celui de M1. Historique → **Exporter (.json)** ; Réglages → **Export partiel (.csv)**.
- [ ] Windows **et** Android : `pacing_export_AAAA-MM-JJ.json` téléchargé et retrouvable ; idem `.csv`.
- [ ] **Conserver ces deux fichiers** (M4 et M7).

### M3 🔴 — B en Fusionner
**Fichier** `2_B_a_fusionner.json` → Importer → **lire l'écran 1** → Fusionner → **lire l'écran 2** → Fusionner.

Écran 1 : fichier « 8 période(s) · 2 note(s) · 6 événement(s) », application « 9 période(s) · 3 note(s) · 6 événement(s) », « 3 élément(s) ignoré(s) car invalide(s). », profils identiques. Écran 2 : avertissement chiffré « … actuels de l'application seront écrasés par des données du fichier qui diffèrent dans la même plage temporelle » ; pas de tableau de correspondance (types identiques). Message : « Import terminé : 8 période(s) et 4 jour(s)… ».

| Jour | Périodes (type #) | Note et événements |
|---|---|---|
| 14/09 | 08:00–09:00 #1 · 09:00–09:30 #2 · 09:30–10:00 #1 · 10:00–10:30 #2 · 10:30–12:00 #4 · 14:00–15:00 #2 | note « Note B 14/09 », MPE, Céphalée (**non**) |
| 15/09 | 07:30–10:30 #2 · 10:30–11:00 #1 · 13:00–14:00 #2 | **MPE seul** (« Jour OK » retiré : polarité opposée) |
| 16/09 | 09:00–12:00:30 #1 · 12:00:30–13:00 #4 · 16:00–17:00 #2 · 17:02–18:00 #4 | note « Note A 16/09 », Malade, Céphalée (non) |
| 17/09 | 22:00–24:00 #1 | note « Note B 17/09 (seulement dans le fichier) », Jour OK, Céphalée (oui) |
| 18/09 | 00:00–06:00 #1 | note « Seulement dans l'app », MPE |
| 19/09 | aucune | Migraine |

Profil et types inchangés ; nouveau tag « Migraine » ; les tags prédéfinis gardent leur libellé français.
- [ ] 14/09 : l'ancienne période #2 est coupée en trois ; 14:00–15:00 devient #2. 15/09 : 07:30–10:30 #2 puis 10:30–11:00 #1. 16/09 : recollement sous 60 s à 12:00:30, mais le trou de 2 min (17:00–17:02) est conservé. 17→18/09 : coupure à minuit.
- [ ] Notes : celle du 14/09 est remplacée par celle du fichier ; celles des 16 et 18/09 sont intactes.
- [ ] **15/09 : plus de « Jour OK »** à côté de la MPE (règle de polarité).
- [ ] Refaire la fusion de B une **deuxième fois** : rien ne change.

### M4 🔴 — Restauration : réimporter l'export de M2
**Fichier** le `.json` de M2 → Importer → Continuer vers Remplacer → Tout remplacer.

Écran 1 : fichier « 9 période(s) · 3 note(s) · 6 événement(s) » face à l'application « 15 période(s) · 4 note(s) · 9 événement(s) ».
- [ ] **L'app est exactement revenue à l'état de M1** (le tag « Migraine » et les jours 17 et 19/09 ont disparu). C'est le test de la sauvegarde / restauration.

### M5 🟠 — Autre profil : D, puis A
**a) Fichier** `3_D_profil_UZ_Leuven.json` → Importer → **lire l'écran 1** → Fusionner → écran 2 → Fusionner.

Écran 1 : tableau des différences (#2 Couché actif 3 période(s) / Détente 1 ; #3 (inactif) / Repas et hygiène 1 ; #4 Non couché 2 / Activité physique 1 ; #5 (inactif) / Activité mentale 1) et « Profil : PacingCount standard → UZ Leuven 2018 ». Écran 2 : **tableau de correspondance** des types du fichier vers les types de l'app (modifiable), puis « Les types de l'application sont conservés… ».

Après : **profil et types de l'app inchangés** (standard) ; 13 périodes (A + 4 de D, selon la correspondance par défaut : 14/09 18:00–19:00 #3 et 19:00–20:00 #5 ; 15/09 15:00–16:00 #2 et 16:00–17:00 #4).
- [ ] Le tableau de l'écran 1 est lisible et on comprend ce qui va se passer ; les listes déroulantes de l'écran 2 sont utilisables au doigt ; couleurs de bordure et de flèche cohérentes.
- [ ] Les périodes #3 et #5 (types inactifs sans nom) : comment s'affichent-elles dans Historique et Résultats ? (cibles par défaut de la correspondance : à juger)

**b) Fichier** `1_A_etat_de_depart.json` → Fusionner. Profils identiques : pas de tableau. Les 13 périodes restent, A est refusionné (idempotent).

### M6 🔴 — Une période tourne, puis K en Remplacer
**Préparation** : dans Mesure, démarrer une période (idéalement sur un type avec alerte active) et la laisser tourner.
**Fichier** `4_K_remplacement_partiel.json` → Importer → Continuer vers Remplacer.

Écran 1 : fichier « 2 période(s) · — note(s) · — événement(s) » (« — » = section absente). Écran 2 : tableau Maintenant → Après et la ligne **« La période en cours (…) sera arrêtée. »**

Après : historique = 22/09 09:00–10:00 **#5** et 26/09 09:00–10:00 #1 ; **plus aucune période en cours** ; **plus aucun jour d'événements** (fichier sans `dailyData` : l'app devient le fichier) ; tag « Céphalée » supprimé ; types et profil inchangés.
- [ ] Chrono de Mesure arrêté, alerte annulée.
- [ ] La période du 22/09 est en type #5 (inactif, sans nom) : comment s'affiche-t-elle ?

### M7 🟠 — CSV
**a)** le `.csv` de M2 → Importer → modal de correspondance (3 lignes ✅, « ✅ Tous les types du fichier ont été reconnus automatiquement. ») → Tout remplacer → « 9 période(s) importée(s) avec succès. » (le CSV ne touche ni aux jours, ni aux tags, ni aux types).

**b)** `5_CSV_types_a_mapper.csv` → Fusionner. Le modal liste : ✅ #1, ✅ #2, 🔍 Non couché #3 → #4, ✅ #4, 🔍 Détente #5 → (sans nom) (inactif) #5, 🔍 Autre #7 → Ignorer ; avertissement orange « Plusieurs types du fichier seront fusionnés… ». Message final : « 5 période(s) importée(s) avec succès. »
- [ ] Listes déroulantes utilisables au doigt ; changer un choix met à jour l'avertissement ; les 4 lignes invalides du fichier sont ignorées sans message.

### M8 🟠 — Fichier qui n'est pas une sauvegarde
**Fichier** `6_H_pas_une_sauvegarde.json` → Importer.
- [ ] Alerte « Ce fichier n'est pas une sauvegarde PacingCount. » ; **aucun modal** ; les données ne bougent pas.

## 5. Compléments optionnels ⚪

Depuis l'état A (réimporter `1_A…` en Remplacer avant).

| Option | Fichier | À contrôler |
|---|---|---|
| **Opt 1** Profil personnalisé | `opt_E_profil_perso.json` (Fusionner) | Écran 1 : tableau de différences, « Profil : PacingCount standard → ✏️ Personnalisé ». Écran 2 : correspondance ; **types de l'app inchangés** ; 3 périodes ajoutées (20/09 #1, #2 ; 21/09 #3). Les libellés du fichier dans le tableau sont nettoyés (`< > "` retirés) |
| **Opt 2** Ancien CSV | `opt_CSV_ancien_format.csv` (Fusionner) | Lignes 🔍 : « COUCHE SANS STIMULATION » → #1, « non couche » → #4, « Marche » → Ignorer ; « 2 période(s) importée(s) » |
| **Opt 3** Fichier vide ⚠️ destructif | `opt_V_vide_mais_valide.json` (Remplacer) | **Après avoir exporté.** Écran 2 : « 9 période(s), 3 note(s) et 6 événement(s) actuels… seront effacés » ; après : tout est vide |
| **Opt 4** Changement d'heure | `opt_G_changement_heure.json` (Fusionner) | Résultats au 26/10/2025 (jour de 25 h) et au 29/03/2026 (jour de 23 h) : la période 00:00–04:00 vaut **5 h** puis **3 h** |
| **Opt 5** B en Remplacer | `2_B_a_fusionner.json` (Remplacer) | Après : 8 périodes de B (celle de 22:00 à 06:00 coupée à minuit), jours 14, 15, 17, 19/09 ; le tag perso est repris en anglais (« Headache »), les tags prédéfinis restent en français |

## 6. Rejouer le harnais

Dossier `harness/` (hors dépôt) : `lib.js` (chargeur), `gen-fixtures.js` (génère `fixtures/` et `manuel/`), `run-scenarios.js` (70 scénarios → `table.md`, `results.json`), `run-parcours.js` (enchaîne M1 à M8 et Opt 1 à 5 → `parcours.json`, 27 états), `run-passe6.js` (25 vérifications : périodes futures, écrans, correspondance), `show-modal3.js` (texte des deux écrans en FR/EN/NL).

```
npm i jsdom
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node gen-fixtures.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-scenarios.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-parcours.js
PC_REPO=/chemin/vers/PacingCount TZ=Europe/Brussels node run-passe6.js
```

Mesuré sur beta.37 : scénarios ✔ 55 · 👁 15 · ⚠ 0 ; parcours : 27 états, 0 incohérence ; passe 6 : 25 vérifications, 0 écart. À relancer après toute modification de `js/import-export.js` ou du moteur des périodes. **Limites** : pas de rendu visuel (modals, pastilles, types sans nom) ; pas de vrai sélecteur de fichiers ni de téléchargement (le harnais appelle `buildJSONExport()` et `buildCSVString()`, pas `exportJSON()` / `exportCSV()`) ; alertes, notifications et rendus sont des stubs.

## 7. Observations de la première série (beta.27) et état à beta.37

| N° | Observation d'origine | État beta.37 |
|---|---|---|
| O1 | Fichier vide en Remplacer : périodes effacées sans être chiffrées | **Résolu** : avertissement chiffré + tableau Maintenant → Après |
| O2 | Remplacer arrête la période en cours sans le dire | **Résolu** (JSON) : ligne dédiée à l'écran 2. CSV : toujours silencieux |
| O3 | Fusionner : note écrasée non comptée | **Résolu** : comptée dans l'avertissement |
| O4 | Remplacer : tag perso supprimé mais événements orphelins | **Résolu** : `dropEventsOfUnknownTags()` ; l'app devient le fichier |
| O5 | Fusion : « Jour OK » et « MPE » le même jour | **Résolu** : règle de polarité |
| O6 | Remplacer ne normalise pas les chevauchements internes | **Ouvert** (RP6, C10) |
| O7 | Période du fichier dans le futur acceptée | **Résolu** (JSON) : ignorée > 5 min ; CSV non filtré |
| O8 | Fusion : le profil du fichier remplace celui de l'app | **Résolu** : types/profil de l'app jamais modifiés en Fusionner ; types « sans nom » possibles seulement par la correspondance (M5) ou Remplacer |
| O9 | Sans `typesConfig`, périodes d'un type inactif importées sans question | **Ouvert** (TP8, à juger) |
| O10 | Profil personnalisé remplacé sans avertissement spécifique | **Accepté** : le profil fait partie de ce que Remplacer annonce |
| O11 | CSV : libellé avec virgule tronqué | **Ouvert** (C8) |
| O12 | Note importée non limitée à 80 caractères | **Reporté** (R8, `TODO.md`) |
| O13 | CSV : type #5 inactif ciblé d'office | **Toléré** (R11) |

**Solide** : validation avant écriture (aucune erreur ne modifie les données), détection du format par le contenu, BOM et CRLF, aller-retour JSON et CSV identique, idempotence de la fusion, recollement < 60 s, coupure à minuit, jours de 23 h / 25 h, fusion par jour **et** par tag, retour arrière JSON.

## 8. À retenir

- Reportés (voir `TODO.md`) : R6 retour arrière CSV, R8 limite de longueur des notes, R9 caractères spéciaux dans les libellés, R10 export compact ou indenté.
- Reste à faire : parcours M1 à M8 sur Windows et Android (iOS ponctuel) ; puis relecture EN/NL des textes du modal.

## Annexe — les 70 scénarios du harnais (mesurés sur beta.37)

Verdicts : ✔ conforme à l'attendu · 👁 comportement mesuré à juger · ⚠ écart. Colonne « Manuel » : l'étape du parcours qui le contrôle à l'écran.


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
