# Joueur contre joueur — conception

Branche `feature/pvp`. Décisions validées le 25/11/2026.

## Principes
- **Serveur qui fait autorité** : le serveur Node (sur le Raspberry Pi) fait tourner `src/engine.js`. Les navigateurs ne font qu'afficher et répondre aux questions.
- **Aucune information cachée côté client** : ni graine RNG, ni ordre des pioches, ni main adverse, ni carte face cachée (dont `sd.hidden`).
- **Pas de P2P, pas de chat, pas d'emotes, pas de voix ni de vidéo.**
- **Compte Discord obligatoire** pour tous les modes (pas d'invités).

## Formats
| Mode | Particularité |
|---|---|
| Casu | Non classé, salon privé par lien d'invitation |
| Casu deck ouvert | La vue contient la decklist adverse (nombre de chaque carte), jamais l'ordre |
| Classé | Matchmaking par Elo/Glicko-2, compte Discord âgé d'au moins 7 jours |
| Tournoi | Rondes suisses puis top 8, appariements par le serveur (pas de lien) |

## Architecture
```
Navigateur (site statique)  ⇄ WebSocket (wss) ⇄  Serveur Node 20 (Pi 4, 4 Go)
  - affiche viewFor(pid)                           - engine.js inchangé
  - envoie { seq, réponse }                        - RemoteAgent (ask → WebSocket)
                                                   - salons, matchmaking, pendule
                                                   - SQLite (WAL) : comptes, sessions, parties, Elo
```

### Moteur
- `viewFor(game, pid)` : projection de l'état pour un joueur. Pioches et main adverse réduites à des nombres, cartes cachées remplacées par des cartes vierges, `uid` renumérotés par joueur (on ne suit pas une carte cachée d'une zone à l'autre), pas de `config.seed`, pas de `trace`.
- `RemoteAgent.ask(game, pid, req)` : envoie la question (avec un `seq` croissant), attend la réponse, **vérifie qu'elle figure dans `req.options`** (et respecte `min`/`max`), sinon la rejette.
- Graine : `seed = H(graine_serveur ‖ graine_J1 ‖ graine_J2)`. `H(graine_serveur)` est publié avant la partie, la graine serveur est révélée à la fin (mélange vérifiable).
- Parties en cours **en RAM** (pour ménager la carte SD). Sur la SD on n'écrit que : comptes, sessions, Elo et, en fin de partie, `config + answers + résultat` (~1 Ko).
- Arrêt propre (`SIGTERM` : déploiement, `systemctl restart`) : les parties en cours sont écrites sur disque, puis rejouées au démarrage à partir de `config + answers`. Coupure brutale (courant, plantage) : les parties en cours sont annulées, sans effet sur l'Elo.
- Le bouton « Rapport » n'est disponible qu'une fois la partie terminée.

### Fuite par le temps de réponse
Le moteur ne pose une question de contre (`offerCounter`) que si le joueur a un contre possible : l'adversaire devinerait, à la durée de l'attente, qu'on avait un contre en main. Parade en place : sans contre possible, l'agent distant marque une pause aléatoire (0,8 à 2 s, `counterDelay`). Limite : une longue réflexion devant un vrai contre reste visible.

## Identification
- Discord OAuth2 (scope `identify`, avec `state` contre le CSRF). On garde : identifiant Discord, pseudo, date de création du compte (déduite de l'identifiant).
- Session : jeton aléatoire de 256 bits dans un cookie `HttpOnly; Secure; SameSite=Lax`. En base, seulement son hash et `expires_at` (30 jours, prolongée à chaque usage). Révocation possible.
- WebSocket : on vérifie le cookie et l'en-tête `Origin` à l'ouverture de la connexion.
- RGPD : données minimales, suppression du compte possible (les replays restent, anonymisés).

## Salons, liens et changement d'appareil
- Lien d'invitation : jeton de 128 bits (hash en base), **usage unique**, expire au bout de 15 minutes.
- Une fois l'invitation acceptée, le **siège est lié au compte Discord**, plus au lien. Se connecter avec le même compte sur un autre appareil renvoie dans la partie, avec l'état et la question en attente. La connexion la plus récente gagne et l'ancienne reçoit « Partie ouverte sur un autre appareil ».
- Déconnexion : la pendule continue, délai de grâce de 3 à 5 minutes, puis forfait.
- Nettoyage toutes les minutes : invitations expirées, salons vides, parties inactives (forfait ou annulation). Les parties non classées terminées sont supprimées après quelques jours.
- Lien spectateur (plus tard) : lecture seule, différé, informations cachées masquées jusqu'à la fin.

## Protection du Pi
- 1 partie en cours par compte, nombre limité de salons ou invitations créés par heure.
- Plafond global de parties simultanées (environ 100), puis file d'attente.
- Limite de requêtes par IP sur `/auth/*` et à l'ouverture des WebSockets.
- Limite de messages par connexion WebSocket ; une connexion qui dépasse est fermée.
- Âge minimum du compte Discord : 7 jours pour le mode classé.
- Node limité en mémoire (`--max-old-space-size`, `MemoryMax` dans systemd). Le Pi n'a pas de swap.

## Matériel (Pi 4 Model B, 4 Go, carte SD de 16 Go, Node 20.19)
Mesure du moteur sur PC (Ryzen 5800X) : 15 ms par partie complète, 4,3 Mo pour 25 parties, environ 154 décisions par partie. Sur le Pi 4, il faut compter un facteur 5 à 8 plus lent : 50 joueurs simultanés restent très en dessous de ses capacités.
Point faible : **la carte SD** (usure en écriture). Il faut un SSD en USB pour la base, ou au minimum SQLite en WAL, des journaux en RAM et une sauvegarde quotidienne de la base.

## Étapes
1. ✅ `viewFor` + `RemoteAgent` + tests (`src/pvp/`, `node test/pvp.mjs`).
2. ✅ Serveur WebSocket (`server/`, paquet `ws`) : salons, invitation à usage unique (15 min), jeton de siège provisoire, reprise et connexion remplacée, forfait après 3 min, nettoyage, limites (origine, 8 connexions par IP, 10 messages/s, 16 Ko par message, 100 salons). Client de test : `npm install` puis `node server/index.mjs` → http://127.0.0.1:8787, deux onglets. Tests : `node test/server.mjs`.
3. ✅ Discord OAuth (`server/auth.mjs`) et SQLite (`server/db.mjs`, paquet `better-sqlite3`) : sessions par cookie (haché en base, 30 jours glissants, prolongées au plus une fois par jour), déconnexion de tous les appareils, sièges liés au compte (reprise automatique sur un autre appareil), 1 salon ou partie à la fois, 10 salons par heure, annulation d'un salon. Connexion factice `DEV=1`, refusée hors 127.0.0.1 ou en HTTPS. Les secrets Discord sont dans un fichier `.env` créé à la main sur le Pi (pas dans Git ni dans GitHub).
4. ✅ Pendule (20 min par joueur, +5 s par réponse, ne s'écoule que pendant ses questions ; défaite au temps), pause sans contre possible, parties terminées enregistrées en base (table `games` : résultat + `config`/`answers` pour les rejouer), arrêt propre : parties en cours écrites dans `parties-en-cours.json` (droits 600, à côté de la base), reprises au redémarrage puis fichier supprimé ; moteur modifié entre-temps → parties annulées sans effet sur l'Elo. Tests : `node test/lifecycle.mjs`.
5. Interface PvP dans `ui.js` (lobby, partie à distance).
6. Mode deck ouvert, puis classé (Glicko-2, âge du compte), puis tournois.
7. Déploiement sur le Pi (service systemd, proxy wss, sauvegardes).
