# Dojo des Songes : version mobile (25/11/2026)

Ajout sans toucher à `ui.js` ni à `index.src.html` :

- `mobile.css` : mise en page téléphone (`@media (max-width: 700px)`, portrait) + style de l'aperçu en grand. `build.mjs` l'ajoute à la fin de la feuille de style (il gagne à spécificité égale).
- `mobile.js` : dernier module du build. Appui long (400 ms) sur une carte (`[data-uid]`, `[data-insp]`, `[data-def]` dans l'éditeur) = carte en grand, qui reste ouverte jusqu'à un tap. Il s'appuie sur `window.__dojo` (`inspectorHTML()` / `previewDef()`), donc le contenu est celui de l'inspecteur. Une carte adverse face cachée ne révèle rien. Souris ignorée (l'inspecteur au survol reste pour l'ordinateur).
- `build.mjs` : `mobile` ajouté à `ORDER`, injection de `mobile.css`.

Disposition mobile : **tout tient sur un écran, sans défilement** (`.game` = 100dvh, cartes miniatures dont la taille suit `--ch` = 6,8 % de la hauteur d'écran). En-tête sur 2 lignes (Decks · nuits · outils / Vous · phase · Bot), camp adverse en miroir (son Arène touche le combat), zones étiquetées en vertical, Lieu réduit à son nom, Main en bas, barre de décision compacte. Inspecteur masqué (remplacé par l'appui long) ; Journal = volet qui s'ouvre avec le bouton ☰ (ajouté par `mobile.js`).

`mobile.js` retouche aussi le DOM après chaque rendu (MutationObserver) : cache la liste de cartes de la barre de décision quand ces cartes sont déjà touchables sur le plateau, raccourcit le titre du mulligan, numérote sur la Main l'ordre de sélection du mulligan. Attention : ne jamais écrire dans le DOM sans test d'égalité (sinon boucle infinie de l'observateur).

Publication : la page a été modifiée directement par `edit_version` (CSS ajouté avant `</style>`, code de `mobile.js` inséré dans des blocs `{ }` après `window.__dojo = ui;`). L'ancien bloc CSS mobile y reste neutralisé (`max-width: 0px`) : un `node build.mjs` suivi d'une republication le fera disparaître. Un `node build.mjs` donne le même comportement.

Vérifié sur maquette (Chrome tactile, 360 à 412 px de large, 640 à 820 px de haut : pas de défilement, sauf 1 à 10 px sur écrans de 640 px en plein combat) : appui long ouvre l'aperçu, le relâchement ne déclenche pas l'action de la carte, un tap ferme, un tap court agit normalement, un glissé n'ouvre rien. Non testé sur un vrai iPhone.