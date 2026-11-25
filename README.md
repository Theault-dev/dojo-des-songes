# Dojo des Songes — simulateur Dreamland TCG (FDS1, règles v1.1)

Site statique pour jouer à Dreamland TCG contre des bots (Débutant heuristique, Expert ISMCTS).

- **Page publiée** : https://claude.ai/artifact/AhQ78ZgPLhD2sZxCv7oT14 (artifact « Dojo des Songes », privé à Théault)
- Pour la modifier depuis une autre conversation : récupérer ces sources, modifier, rebâtir, puis publier avec l'outil Artifact en passant cette URL (`url`), après l'avoir lue (`action: read`). Capabilities (db, downloads, user) à conserver.

## Fichiers (ordre de build)
| Fichier | Rôle |
|---|---|
| `official.js` | Textes officiels des cartes (map num → [condition, texte]), tirés de l'API app.dreamlandtcg.com |
| `data.js` | Définition des 178 cartes (Persos, Kicks, Soutiens, Lieux) ; applique `official.js` ; validation de deck (1 exemplaire par Perso, 4 pour les autres, R67) |
| `effects.js` | Effets de cartes, déclencheurs de fin de combat, contres (`counterOptions`) |
| `engine.js` | Moteur asynchrone : nuits, Baston, combats, Combos, contres (`offerCounter`, R1), mulligans R69/R70, Soutiens en piles, `kickForce` / `liveMarker`, suivi de diagnostic (`trace`, `report`) |
| `bot.js` | Bot Débutant (heuristique) ; ignore les options `blocked` (`withoutBlocked`) |
| `expert.js` | Bot Expert **ISMCTS** (voir ci-dessous) + `VALUE_MODEL` logistique |
| `fx.js` | Hooks d'effets visuels |
| `deckio.js` | Import/export de decklists (format `1 039/FDS   # NOM`) |
| `store.js` | Préférences / sauvegarde locale |
| `art.js` | Images des cartes en IndexedDB (locales) |
| `ui.js` | Interface, journal, inspecteur, builder, workers Expert, bouton « Rapport » |
| `index.src.html` | Gabarit HTML + CSS (`/*BUNDLE*/`, `MAT_DATA_URI`) |
| `build.mjs` | Assemble tout en `dist/index.html` (modules → IIFE, worker Expert en blob) |
| `test/replay.mjs`, `test/decks.mjs` | Rejeu d'un rapport de diagnostic ; decks de test (dont J1) |

`assets/mat.webp` (tapis, binaire) n'est pas stocké ici : sans lui, `build.mjs` utilise un aplat (`MAT_COLOR`, défaut `#1b2147`). La version publiée utilise le tapis (image fournie par Théault) ; pour rebâtir à l'identique il faut ce fichier.

## Bot Expert (ISMCTS, 24/11/2026)
Rejoue la partie jusqu'à la décision, détermine les infos cachées (decklist adverse inconnue : devinée à partir des cartes vues), puis construit un arbre d'information (UCB à comptage de disponibilité, bonus a priori du bot heuristique, rollouts heuristiques tronqués à l'horizon + `VALUE_MODEL`, coups adverses minimisés). Choix final = option la plus visitée ; les stats des workers sont fusionnées (`bestOf`) ; arrêt anticipé si > 85 % des visites (≥ 200 sims).

Mesures sous Node (parties automatiques, decks aléatoires d'archétypes, 120 sims/décision, mêmes decks échangés côté et premier joueur) :
- ISMCTS vs bot heuristique : 28–12 (70 % ± 14).
- ISMCTS vs ancien Monte-Carlo à plat : 33–27 sur 60 (55 % ± 12,6), Renommée moyenne 10,2 – 11,1. Avantage faible, non significatif à ce volume.

## Bot heuristique : mulligans, entrée dans l'Arène, Baston (24/11/2026)
- **Mulligans** (le choix multiple n'est pas cherché par l'Expert, c'est donc l'heuristique qui décide) : Persos par simulation du développement des 4 premières nuits sur 24 ordres de pile tirés au hasard ; Songe par valeur de carte rapportée au Groupe du deck (`MULL_MARGIN`).
- **Entrée dans l'Arène** : valeur = Aura + Combo + capacité utile (`ENTRY_ABILITY`) × nuits restantes. Jerzey entre en nuit 1 dans 100 % des parties (43 % avant).
- **Baston** : le risque d'un dégât adverse est chiffré sur toute l'Arène (Asmodheus renvoie le combattant et chaque Perso d'Aura ≤), via `damageValue(g, w, id, cible)`. La Main adverse n'est plus lue : a priori de 0,5 Kick de dégât. La Puissance d'un adversaire à Main inconnue est mise à l'échelle sur ce qu'il a réellement produit (`g.s.fights`, `scaleOf`, borné 0,8–2).
- Mesures : miroir J1 contre l'ancien bot ≈ 50 % (pas de gain mesurable bot contre bot, la correction vise les adversaires plus forts que le bot) ; scénario de la nuit 5 du rapport : face à un adversaire ayant déjà montré 23 à Aura 4, le bot passe sa Baston au lieu de combattre avec Asmodheus.

## Rapport de diagnostic (24/11/2026)
Bouton **Rapport** dans le panneau Journal : copie (ou télécharge) un JSON `{ config, answers, result, trace, log }`. `trace` (hors journal de partie) contient chaque décision (`#n joueur type → choix`), les raisons du bot (`↳ paires`, `entrée`, `passe`, écarts de l'Expert) et l'état complet (Arène, Réserve, Main) au début de chaque nuit et de chaque combat. Rejeu : `node test/replay.mjs rapport.json` vérifie que `config + answers` reproduisent la partie à l'identique puis imprime le suivi. Le suivi n'est actif que dans la vraie partie (`trace: true`), pas dans les mondes simulés de l'Expert.

## Rebâtir et publier
```
mkdir dreamland && cd dreamland   # y mettre tous ces fichiers + package.json {"type":"module"}
node build.mjs                    # → dist/index.html (~1,06 Mo avec le tapis)
```
Puis publier `dist/index.html` avec l'outil Artifact (URL ci-dessus).

## Points de règles tranchés (voir aussi exceptions-aux-regles.md)
- **R1** : un contre ne peut pas être contré (une réponse par activation).
- **R69/R70** : deux mulligans (Songe 7 cartes, puis Persos 3), cartes remises sous leur pile dans l'ordre cliqué, premier joueur d'abord, Songe repioché avant le choix des Persos.
- **R68** : Envie de sang copie tout marqueur [+X] à sa valeur du moment (ordre Étalé/Envie choisi par le joueur si les listes diffèrent). Neil (Épée Diderot) ajoute la Force globale complète du Kick (marqueurs continus compris).
- **R64/R65** : options impossibles visibles, marquées « — impossible : raison » ; le joueur peut se tromper.
- Carte face cachée = carte vierge (ni nom, ni Aura, ni mot-clé). Malice du corbeau : une fois par nuit. Nathalie ne bloque que le texte du Combo, pas le bonus de Force. Fin de baston = fin de combat.
- Rafaelo : une fois par nuit, optionnel ; Fiesta Féline se déclenche aussi via Young Infinity.
- Soutiens : 2 zones, empilables, les couverts comptent comme face cachée ; mots-clés Team définitifs mais l'effet exige le Soutien visible.
- Rejoins-nous : Aura ≤ nuit ; Sauvé in extremis : Aura ≤ nuit + 1.
- Ouvert : Jung (copie de capacité de Lieu).
## Pages légales et déploiement (25/11/2026)
- `server/legal.mjs` : conditions d'utilisation et politique de confidentialité. `node build.mjs` les génère dans `dist/conditions/index.html` et `dist/confidentialite/index.html` (nginx les sert sur `/conditions` et `/confidentialite` sans configuration). Tant que le jeu en ligne n'est pas sur la branche, les textes l'annoncent « à venir », sans liens vers `/contact` ni `/compte`. Le nom du responsable vient de la variable GitHub `OPERATOR_NAME` (facultative).
- Déploiement : le workflow envoie une archive `.tar.gz` de `dist/` au compte `dojo-deploy` du Pi. Le script côté Pi est versionné dans `deploy/dojo-deploy` (accepte aussi l'ancien envoi d'un `index.html` seul ; refuse liens, chemins absolus ou `..`, archives de plus de 200 fichiers ou 60 Mo). À installer en root avant le premier déploiement : `install -o root -g root -m 755 deploy/dojo-deploy /usr/local/bin/dojo-deploy`.
