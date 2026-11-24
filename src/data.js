// ─────────────────────────────────────────────────────────────
// Données : catalogue complet « Fracture des Songes » (166 cartes + 12 Lieux),
// Teams, et validation des decks. Les textes résument fidèlement les effets.
// ─────────────────────────────────────────────────────────────

const P = (num, id, name, sub, aura, kw, cls, cond, text, combo = null, abType = 'CAPACITÉ') =>
  ({ num, id, type: 'P', name, sub, aura, kw, cls, cond, text, combo, abType });
const K = (num, id, name, rang, force, kw, cond, text, abType = 'CAPACITÉ') =>
  ({ num, id, type: 'K', name, rang, force, kw, cond, text, abType });
const S = (num, id, name, kw, cond, text) => ({ num, id, type: 'S', name, kw, cond, text, abType: 'CAPACITÉ' });
const combo = (bonus, ...ranks) => ({ bonus, ranks });

import { OFFICIAL } from './official.js';

export const CARDS = {};
const add = (...defs) => defs.forEach(d => (CARDS[d.id] = d));

// ── Feu ──────────────────────────────────────────────────────
add(
  P(1, 'NEIL1', 'Neil', 'Épée Diderot', 1, ['FEU'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant un combat, exilez Neil : l'un de vos Kicks « Feu » reçoit +X de Force (X = sa Force globale)."),
  P(2, 'NEIL2', 'Neil', "Bouclier d'Aristote", 2, ['FEU'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand l'adversaire active une capacité de Combo, exilez Neil pour la contrer."),
  P(3, 'CHARLY1', 'Charly', 'Choisi par Asmodheus', 1, ['FEU'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, retournez Charly face cachée : vos Kicks B reçoivent +1 de Force.'),
  P(4, 'CHARLY2', 'Charly', 'Uzi Flam', 2, ['FEU'], 'VOYAGEUR', 'Combo activé',
    "L'adversaire défausse l'un de ses Soutiens visibles (ciblé).", combo(2, 'B', 'M')),
  P(5, 'CHARLY3', 'Charly', 'Fire Eater', 3, ['FEU', 'VIF'], 'VOYAGEUR', 'Une fois par combat',
    "Quand Charly combat, renvoyez sous le Groupe un autre de vos Persos voyageurs « Feu » de l'Arène : vos Kicks posés reçoivent +2."),
  P(6, 'EPONY3', 'Epony', 'Le numéro 2', 3, ['FEU', 'VIF', 'BRUTAL'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, vos Kicks M reçoivent +1 de Force. Epony ne compte alors plus dans votre Contrôle cette nuit.'),
  P(7, 'EPONY4', 'Epony', 'Aurora Annihilation', 4, ['FEU', 'VIF', 'BRUTAL'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire renvoie son combattant sous le Groupe, puis son Perso d'Aura la plus basse de l'Arène dans la Réserve.",
    combo(5, 'B', 'M', 'M'), 'DÉGÂT'),
  P(8, 'VULCAIN', 'Vulcain', 'Conseiller des rois', 4, ['FEU', 'VIF', 'GARDE'], 'CRÉATURE', 'Une fois par nuit',
    'Pendant un combat, le bonus Combo de votre combattant augmente de +3.'),
  P(9, 'ASMODHEUS', 'Asmodheus', 'Météore Punition', 5, ['FEU', 'BRUTAL', 'SEIGNEUR'], 'CRÉATURE', 'Combo activé + Victoire',
    "L'adversaire renvoie sous le Groupe son combattant et chaque Perso de l'Arène d'Aura ≤ à celle du combattant.",
    combo(6, 'S', 'M', 'B'), 'DÉGÂT'),
  K(10, 'PREMIERE_FLAMME', 'Première Flamme', '★', 1, ['FEU'], 'Continue', 'Combattant « Feu » : vos Kicks « Feu » reçoivent +1 de Force.'),
  K(11, 'PIEGE', 'Piège incendiaire', 'B', 1, ['FEU'], 'Continue', "Combattant « Feu » : +1 de Force chaque fois que l'adversaire cible l'une de vos cartes en jeu pendant ce combat (max +3)."),
  K(12, 'BOULE_FEU', 'Boule de Feu', 'M', 2, ['FEU'], 'Continue', 'Combattant « Feu » : vos Kicks M reçoivent +1 de Force (2 Boules de Feu max par combat).'),
  K(13, 'LIBERER', 'Libérer son potentiel', 'S', 2, ['KAISER', 'SEIGNEUR'], 'Continue', 'Combattant « Kaiser » ou « Seigneur » : +X de Force, X = vos Kicks partageant un mot-clé avec lui (max +3).'),
  S(14, 'BAGUE_FEU', 'Bague de feu', ['FEU'], 'Une fois par nuit', 'Combattant « Feu » : défaussez-la, un de vos Kicks « Feu » reçoit +1.'),
);

// ── Glace ────────────────────────────────────────────────────
add(
  P(15, 'BORO', 'Boro', 'Chute de température', 1, ['GLACE'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant votre Crépuscule, exilez Boro : recrutez un Perso « Flocons » du Groupe, ou cherchez une carte « Glace » dans le Songe.'),
  P(16, 'RIBA', 'Riba', 'Rumeurs incessantes', 1, ['GLACE'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand l'adversaire inflige un dégât, exilez Riba pour le contrer."),
  P(17, 'LOCKI', 'Locki', 'Armure de glace', 2, ['GLACE', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand l'adversaire active une capacité (sauf Combo), exilez Locki pour la contrer."),
  P(18, 'ZERO2', 'Zéro', 'Nova Bang', 2, ['GLACE', 'GARDE'], 'VOYAGEUR', 'Combo activé',
    'Le combattant adverse reçoit −1 de Puissance.', combo(1, 'B', 'M')),
  P(19, 'ZERO3', 'Zéro', 'Aurora Extermination', 3, ['GLACE', 'GARDE', 'VIF'], 'VOYAGEUR', 'Combo activé',
    'Le combattant adverse reçoit −2 de Puissance.', combo(2, 'S', 'M', 'B')),
  P(20, 'SHUN1', 'Shun', 'Hagen Dass Cross', 1, ['GLACE'], 'VOYAGEUR', 'Durant la Baston',
    "Tant que Shun combat, l'adversaire pose 1 Kick de moins (minimum 1)."),
  P(21, 'SHUN2', 'Shun', 'Miko Double', 2, ['GLACE', 'GARDE'], 'VOYAGEUR', 'Combo activé',
    'Ciblez un Kick adverse B ou M : sa Force de base devient 0.', combo(1, 'B', 'M')),
  P(22, 'SHUN3', 'Shun', 'Suprême Magnum', 3, ['GLACE', 'GARDE', 'FOUDRE'], 'VOYAGEUR', 'Combo activé',
    'Le dernier Kick adverse posé perd son Rang et sa Force de base devient 0.', combo(3, 'S', 'M', 'B')),
  P(23, 'PREVICE', 'Prévice', 'Il suffit !', 5, ['GLACE', 'GARDE', 'ROYAL', 'SEIGNEUR'], 'CRÉATURE', 'Combo activé',
    'Tous les Kicks adverses posés ont une Force de base de 0.', combo(3, 'S', 'M', 'B')),
  K(24, 'PICS', 'Projection de pics', 'B', 2, ['GLACE'], 'Continue', "Combattant « Glace » : choisissez — l'adversaire ne peut plus piocher, ou ne peut plus vous faire défausser, jusqu'à la fin du combat."),
  K(25, 'DAGUE', 'Dague de givre', 'M', 2, ['GLACE'], 'Continue', 'Combattant « Glace » : au Dénouement, ciblez un Kick adverse, sa Force globale est limitée à 3.'),
  K(26, 'BIG_NOVA', 'Big Nova Bang', 'S', 2, ['GLACE'], 'Continue', "Combattant « Glace » : l'adversaire ne peut plus activer les capacités de ses Persos non combattants."),
  K(27, 'BLOCAGE', 'Blocage', 'B', 1, ['GARDE'], 'Continue', 'Combattant « Garde » : +X de Force, X = Kicks adverses posés (max +3).'),
  S(28, 'EN_MISSION', 'En mission pour la Reine', ['GLACE', 'FLOCONS'], 'Pose', "Team : vos voyageurs « Glace » deviennent « Flocons ». Un Perso « Flocons » que vous devriez exiler par sa propre capacité retourne sous le Groupe."),
  S(29, 'JAI_FROID', "J'ai froid", ['GLACE', 'FLOCONS'], "Durant l'Aurore", "Avec 2 Persos « Glace » dans l'Arène, défaussez-la : un Perso adverse reçoit −2 d'Aura cette nuit."),
);

// ── Foudre ───────────────────────────────────────────────────
add(
  P(30, 'JERZEY1', 'Jerzey', 'Déplacement éclair', 1, ['FOUDRE', 'SON'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant votre Crépuscule, piochez une carte.'),
  P(31, 'JERZEY2', 'Jerzey', 'Electro Rock', 2, ['FOUDRE', 'SON'], 'VOYAGEUR', 'Combo activé',
    'Recrutez une carte de votre Groupe et piochez une carte.', combo(1, 'B', 'M')),
  P(32, 'INNA', 'Inna', 'Foudre noire', 3, ['FOUDRE', 'VIF'], 'VOYAGEUR', 'Combo activé',
    "L'adversaire renvoie sous le Groupe une carte de sa Réserve.", combo(3, 'B', 'B', 'M')),
  P(33, 'ACTARUS', 'Actarus', 'Fulguro Flash', 4, ['FOUDRE', 'VIF', 'CÉRÉBRAL', 'SEIGNEUR'], 'CRÉATURE', 'Combo activé + Victoire',
    "À son prochain Crépuscule, l'adversaire ne fait qu'une seule action obligatoire.", combo(5, 'B', 'B', 'S'), 'DÉGÂT'),
  K(34, 'ATT_FOUDROYANTE', 'Attaque foudroyante', 'B', 1, ['FOUDRE'], 'Pose', 'Combattant « Foudre » : un Kick adverse reçoit −2 de Force.'),
  K(35, 'ELECTRO_CHOC', 'Electro choc', 'B', 2, ['FOUDRE'], 'Pose', "Combattant « Foudre » : l'adversaire renvoie au-dessus ou en dessous de son Groupe une carte de sa Réserve (une fois par combat)."),
  K(36, 'REFLEXE', 'Réflexe instinctif', 'M', 2, ['VIF'], 'Pose', "Combattant « Vif » : le prochain Kick adverse posé n'active pas sa capacité, et son dégât ne peut pas toucher votre combattant."),
  S(37, 'IMPERIAL_VEGA', 'Imperial Vega', ['FOUDRE'], 'Une fois par nuit', 'Pendant votre Crépuscule, si votre Actarus est en jeu, défaussez-la : vos Persos de l’Arène sont « Foudre » cette nuit.'),
  S(38, 'CITY_VOLT', 'Ingénierie de City Volt', ['FOUDRE'], 'Une fois par nuit', 'Pendant votre Crépuscule, défaussez-la : un Perso adverse d’Aura ≤ à vos Persos « Foudre » de l’Arène ne peut pas combattre cette nuit.'),
);

// ── Félin ────────────────────────────────────────────────────
add(
  P(39, 'DIEU_CHAT', 'Dieu chat noir', 'Lever la patte', 0, ['FÉLIN'], 'CRÉATURE', 'Une fois par nuit',
    'Pendant votre Crépuscule, selon vos Persos « Félin » dans l’Arène : 2+ recrutez une carte ; 5+ gagnez une pièce d’or ; 8+ gagnez 1 de Renommée.'),
  P(40, 'RAFAELO', 'Rafaelo', 'Roi des chats', 1, ['FÉLIN', 'ROYAL'], 'CRÉATURE', 'Une fois par nuit',
    'En entrant dans l’Arène, gagnez une pièce d’or. Quand vous activez une carte « Félin », vous choisissez Accepter ou Refuser à la place de l’adversaire.'),
  P(41, 'FELIX', 'Félix', 'Fourberie', 1, ['FÉLIN'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant votre Crépuscule, l’adversaire choisit : Accepter, vous récupérez la dernière carte de votre Fosse ; Refuser, vous cherchez une carte « Félin » dans votre Songe.'),
  P(42, 'YOUNG_INF', 'Young Infinity', "L'aîné Midas", 1, ['FÉLIN', 'OR'], 'CRÉATURE', 'Une fois par nuit',
    'En entrant dans l’Arène, gagnez une pièce d’or. Quand vous activez une carte « Félin », vous pouvez obtenir Accepter et Refuser ; Young Infinity retourne alors dans la Réserve à la fin de la phase.'),
  P(43, 'ELVIS', 'Elvis', 'Le garde perché', 2, ['FÉLIN', 'GARDE'], 'CRÉATURE', 'Une fois par nuit',
    'Quand l’adversaire inflige un dégât à votre combattant « Félin », contrez-le. À la fin de la Baston, exilez Elvis ou dépensez 3 pièces d’or pour le retourner face cachée.'),
  P(44, 'MILAN', 'Milan', 'Le garde royal', 3, ['FÉLIN', 'TRANCHANT', 'GARDE'], 'CRÉATURE', 'Une fois par nuit',
    'Pendant un combat, l’adversaire choisit : Accepter, vos Kicks « Félin » posés reçoivent +1 ; Refuser, ils deviennent inciblables.'),
  P(45, 'MAGOSS', 'Magoss', 'Griffes empoisonnées', 3, ['FÉLIN', 'TRANCHANT', 'GARDE'], 'CRÉATURE', 'Combo activé',
    "Le combattant adverse devient « Larbin ». À l'Aurore, l'adversaire choisit : Accepter, ses Larbins reçoivent −1 d'Aura ; Refuser, il renvoie un Larbin dans la Réserve.",
    combo(2, 'B', 'M', 'M')),
  P(46, 'JIMMY2', 'Jimmy', 'Férocité du lion', 2, ['FÉLIN', 'TRANCHANT'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire retourne son combattant face cachée, puis recrutez un Jimmy de votre Groupe.", combo(3, 'B', 'M'), 'DÉGÂT'),
  P(47, 'JIMMY3', 'Jimmy', 'Violence du lion', 3, ['FÉLIN', 'TRANCHANT', 'VIF'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire renvoie son combattant dans la Réserve, puis recrutez un Jimmy de votre Groupe.", combo(4, 'B', 'M', 'M'), 'DÉGÂT'),
  P(48, 'SATURN', 'Saturn', 'Le garde acéré', 4, ['FÉLIN', 'TRANCHANT', 'VIF', 'GARDE'], 'CRÉATURE', 'Combo activé',
    'Activez ou réactivez la capacité d’un de vos Kicks « Félin » ou « Tranchant » posés, en choisissant à la place de l’adversaire.', combo(5, 'B', 'M', 'M')),
  K(49, 'NEGOCIATION', 'Négociation féroce', 'M', 2, ['FÉLIN'], 'Pose', 'Combattant « Félin » : l’adversaire choisit — Accepter, son prochain Kick posé perd son texte ; Refuser, il devra Refuser à votre prochaine carte « Félin » de la nuit.'),
  K(50, 'CROCS', 'Crocs saillants', 'M', 2, ['FÉLIN'], 'Pose', 'Combattant « Félin » : l’adversaire choisit — Accepter, ce Kick reçoit +2 ; Refuser, son prochain Kick posé a une Force de base de 0.'),
  K(51, 'TAILLADE', 'Taillade', 'B', 1, ['TRANCHANT'], 'Pose', 'Combattant « Tranchant » : ce Kick reçoit +2 de Force.'),
  K(52, 'COUPER_COURT', 'Couper court', 'B', 2, ['TRANCHANT'], 'Pose', 'Combattant « Tranchant » : l’adversaire défausse un de ses Soutiens visibles (ciblé).'),
  S(53, 'FIESTA', 'Fiesta féline', ['FÉLIN'], 'Une fois par phase', 'Quand l’adversaire choisit Accepter ou Refuser, piochez une carte.'),
);

// ── Titan ────────────────────────────────────────────────────
add(
  P(54, 'TITAN_METRO', 'Titan Métro', 'Manger !', 1, ['TITAN'], 'CRÉATURE', "À la fin d'un combat",
    'Quand Titan Métro est votre combattant, piochez deux cartes.'),
  P(55, 'FRERES', 'Frères Carnages', 'Soif de carnage !', 2, ['TITAN', 'ROCHE', 'BRUTAL'], 'CRÉATURE', 'Une fois par nuit',
    "À la fin de votre Baston, lancez une Provoc' : un combat de plus entre l'un de vos Persos « Titan » et un Perso adverse (une Provoc' par nuit)."),
  P(56, 'ROI_FURY', 'Roi Fury', 'Courage ou inconscience ?', 4, ['TITAN', 'ROCHE', 'BRUTAL', 'GARDE'], 'CRÉATURE', 'Combo activé',
    "Si vous infligez un dégât à la fin du combat, l'adversaire inflige le même dégât à l'un de ses Persos non combattants d'Aura ≤ à celle de son combattant.",
    combo(6, 'B', 'M', 'M')),
  K(57, 'ATTAQUE_TITANS', 'Attaque des Titans', 'M', 1, ['TITAN'], 'Continue', "Combattant « Titan » : +X de Force, X = cartes à dégât visibles dans l'Arène (max +3)."),
  K(58, 'MANDALE_TITAN', 'Mandale titanesque', 'M', 2, ['TITAN'], 'Victoire', "Combattant « Titan » : l'adversaire renvoie son combattant dans la Réserve et reçoit −2 de Contrôle cette nuit.", 'DÉGÂT'),
  S(59, 'MUR_FORCE', 'Mur de force', ['TITAN'], "À la fin d'un combat", 'Combattant « Titan » : défaussez-la, piochez autant de cartes que son Aura.'),
  S(60, 'COURAGE', 'Courage de taille', ['TITAN'], 'Une fois par nuit', "À la fin de votre Baston, défaussez-la : lancez une Provoc' (une par nuit)."),
);

// ── Lucky stars (Terrence, Savane, Sabba, Ève) ───────────────
add(
  P(61, 'TERRENCE1', 'Terrence', 'Motiver les autres', 1, ['FEU'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, vos Kicks ★ reçoivent +1 de Force.'),
  P(62, 'TERRENCE2', 'Terrence', 'Cramage de gueule', 2, ['FEU'], 'VOYAGEUR', 'Combo activé',
    "Lancez un dé — pair : l'adversaire défausse un Soutien visible ciblé ; impair : bonus Combo +2.", combo(2, 'M', 'M')),
  P(63, 'TERRENCE3', 'Terrence', 'Méga cramage de gueule', 3, ['FEU', 'VIF'], 'VOYAGEUR', 'Combo activé',
    "Lancez un dé : l'adversaire retourne face cachée autant de ses Persos en jeu (Arène ou Réserve) que le résultat.", combo(3, 'B', 'M', 'M')),
  P(64, 'SAVANE2', 'Savane', 'Fishmaker', 2, ['POISSON', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant votre Crépuscule, cherchez une carte « Poisson » (sauf Savane) dans le Songe, le Groupe ou la Réserve : un Perso est recruté, une autre carte va en Main.'),
  P(65, 'SAVANE3', 'Savane', 'Fais dodo !', 3, ['POISSON', 'GARDE', 'VIF'], 'VOYAGEUR', 'Combo activé',
    "Les prochains Kicks posés par l'adversaire dans ce combat n'activent pas leur capacité.", combo(3, 'B', 'M', 'M')),
  P(66, 'BIBI', 'Bibi', 'Sauvez Savane !', 0, ['POISSON'], 'CRÉATURE', "À la fin d'un combat",
    "Quand l'adversaire inflige un dégât à votre Savane, exilez Bibi pour le contrer."),
  P(67, 'MOBY', 'Moby Dick', 'Aplatir', 0, ['POISSON'], 'CRÉATURE', "À la fin d'un combat",
    "Quand vous gagnez avec un combattant « Poisson » ou « Lucky stars », exilez Moby Dick : dégât, l'adversaire renvoie son combattant dans la Réserve."),
  P(68, 'EVE2', 'Ève', 'Invocatrice des motifs', 2, ['MOTIF', 'ANATOMIE'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant votre Crépuscule, cherchez une carte « Motif » (sauf Ève) dans le Songe, le Groupe ou la Réserve : un Perso est recruté, une autre carte va en Main.'),
  P(69, 'EVE3', 'Ève', "Invok' d'urgence", 3, ['MOTIF', 'ANATOMIE', 'GARDE'], 'VOYAGEUR', 'Combo activé',
    "Un de vos Persos « Motif » exilés peut entrer dans l'Arène.", combo(3, 'B', 'B', 'B')),
  P(70, 'PAULY', 'Pauly & Love Metal', 'Kill Kill Kill', 0, ['MOTIF'], 'CRÉATURE', 'Durant la Baston',
    'Pendant un combat, exilez cette carte : un de vos Kicks non « Base » reçoit +1 (+2 si votre combattant est « Lucky stars »).'),
  P(71, 'SABBA', 'Sabba', 'Élu du pinceau', 1, ['ART', 'VIF'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant un combat, lancez un dé : 1-3 piochez 1 carte ; 4-5 un Kick reçoit +1 ; 6 les deux. Sabba se retourne face cachée à la fin de la Baston."),
  K(72, 'AGUERRI', 'Combattant aguerri', '★', 0, ['GARDE', 'VIF'], 'Continue', 'Quand le Combo de votre combattant « Garde » ou « Vif » s’active, sa Force de base devient 3.'),
  K(73, 'KANINE', 'Kanine', '★', 1, ['POISSON'], 'Pose', 'Combattant « Poisson » : l’adversaire défausse une carte de sa Main, puis un Kick adverse reçoit −1.'),
  K(74, 'MOUSTIK', 'Moustik', 'M', 2, ['POISSON'], 'Pose', 'Combattant « Poisson » : l’adversaire défausse une carte de sa Main, puis ce Kick reçoit +1.'),
  K(75, 'NADINE', 'Nadine', 'B', 0, ['MOTIF'], 'Pose', "Combattant « Motif » : +X de Force, X = l'Aura du combattant adverse (max +3)."),
  K(76, 'SUCETTE', 'Ça part en sucette', '★', 1, ['LUCKY STARS'], 'Pose', "Votre combattant est « Lucky stars » : selon votre dernier Kick posé — « Feu » ou « Poisson » : cette carte reçoit +1 de Force ; « Motif » ou « Art » : tous vos Kicks B reçoivent +1 de Force ; « Lucky stars » : activez une seconde fois la capacité de votre Soutien « Lucky stars » visible."),
  K(77, 'TOMBE_PIC', 'Tombé à pic', '★', 1, ['LUCKY STARS'], 'Pose', 'Combattant « Lucky stars » : défaussez ce Kick pour poser à sa place un Kick « Feu », « Poisson », « Motif » ou « Art » cherché dans le Songe.'),
  S(78, 'FOUTEURS', 'Fouteurs de merde', ['LUCKY STARS'], 'Une fois par combat', 'Team : Terrence, Savane, Sabba et Ève deviennent « Lucky stars ». Combattant « Lucky stars » et Kick ★ posé : lancez un dé, 6 = +2 de Renommée, sinon piochez une carte.'),
);

// ── Attila band ──────────────────────────────────────────────
add(
  P(79, 'FANBOY', 'Fan Boy', 'La corde autour du cou', 1, [], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, ciblez un Perso adverse : tant que Fan Boy est visible, l'adversaire ne peut pas activer de capacité qui renvoie, exile, échange ou retourne le Perso ciblé, jusqu'à votre prochain Crépuscule."),
  P(80, 'VIOLETTA', 'Violetta', 'Nuée de pétales', 1, ['VENIN'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, exilez Violetta : un Perso adverse de la Réserve reçoit +1 d'Aura tant qu'il y reste cette nuit."),
  P(81, 'DJKILLA2', 'DJ Killa', 'Mange pierre', 2, ['ROCHE', 'BRUTAL'], 'VOYAGEUR', 'Pose',
    "En entrant dans l'Arène, piochez autant de cartes que de capacités activées de votre Lieu."),
  P(82, 'DJKILLA3', 'DJ Killa', 'Golem de pierre', 3, ['ROCHE', 'BRUTAL'], 'VOYAGEUR', 'Combo activé',
    'Le bonus Combo devient égal au nombre de capacités activées des deux Lieux.', combo(0, 'B', 'M', 'M')),
  P(83, 'AKIM', 'Akim', 'Pluie de météorites', 3, ['ROCHE', 'VIF'], 'VOYAGEUR', 'Combo activé',
    "À la fin du combat, lancez un dé : le combattant adverse reçoit −X d'Aura cette nuit.", combo(3, 'M', 'M', 'M')),
  P(84, 'ROMUALD', 'Romuald', 'Golden Hand', 3, ['OR', 'VIF'], 'VOYAGEUR', 'Combo activé + Victoire',
    "Gagnez 1 de Renommée et autant de pièces d'or que l'Aura du combattant adverse.", combo(4, 'B', 'M', 'M'), 'DÉGÂT'),
  P(85, 'ATTILA', 'Attila', 'Aura terrifiante', 4, ['FEU', 'BRUTAL', 'KAISER'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire choisit deux de ses Persos non combattants : eux et son combattant ont une Aura de 0 cette nuit.", combo(6, 'M', 'M', 'S'), 'DÉGÂT'),
  K(86, 'TELLURIQUE', 'Projection tellurique', 'M', 1, ['ROCHE'], 'Pose', 'Combattant « Roche » : +X de Force, X = capacités activées de votre Lieu.'),
  K(87, 'EBOULEMENT', 'Éboulement de terrain', 'M', 2, ['ROCHE'], 'Victoire', "Combattant « Roche » : l'adversaire retourne son combattant face cachée (sous le Groupe si votre Lieu a ses 3 capacités activées).", 'DÉGÂT'),
  K(88, 'PARTAGE', 'Partage de puissance', 'M', 1, ['ATTILA BAND', 'FEU'], 'Continue', "Combattant « Attila band » : il est « Feu » cette nuit. À la fin du combat, sans dégât reçu, renvoyez-le dans la Réserve pour rendre « Feu » vos Persos « Attila band »."),
  K(89, 'DECOIS', 'Ne me déçois pas !', 'M', 2, ['ATTILA BAND'], 'Continue', "Si l'adversaire inflige un dégât à votre combattant « Attila band », renvoyez-le sous le Groupe pour le contrer ; l'adversaire donne −2 d'Aura à l'un de ses Persos cette nuit."),
  S(90, 'ART_DESTRUCTION', "L'art de la destruction", ['ATTILA BAND'], 'Une fois par phase', "Team : Attila, Violetta, Fan Boy, Akim, Romuald et DJ Killa deviennent « Attila band ». Quand un de vos Persos « Attila band » quitte l'Arène, l'adversaire défausse un Soutien, gâche une capacité de son Lieu ou renvoie un Perso dans la Réserve."),
);

// ── Fantasy stars ────────────────────────────────────────────
add(
  P(91, 'ALANA1', 'Alana', 'Cache cache', 1, ['CÉRÉBRAL'], 'VOYAGEUR', 'Pose',
    "En entrant dans l'Arène, vous pouvez retourner face cachée l'une de vos cartes."),
  P(92, 'ALANA2', 'Alana', 'Boîte invisible', 2, ['CÉRÉBRAL', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, un de vos Persos en jeu devient inciblable cette nuit."),
  P(93, 'HUAM', 'Huam', 'Retour de balançoire', 2, ['VIDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand l'adversaire cible l'une de vos cartes, changez la cible pour une autre carte du même type."),
  P(94, 'ALANA_HUAM', 'Alana & Huam', "Jump dans l'inconnu", 3, ['CÉRÉBRAL', 'GARDE', 'VIDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand l'adversaire inflige un dégât à votre combattant « Fantasy stars », exilez cette carte pour le contrer : Huam ou Alana de votre Réserve entre dans l'Arène."),
  P(95, 'HIKARI1', 'Hikari', 'Shooting star', 1, ['FOUDRE'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, un Kick adverse reçoit −X, X = vos Kicks ★ posés dans ce combat.'),
  P(96, 'HIKARI_RAIDEN', 'Hikari & Raiden', 'Lightning star', 2, ['FOUDRE'], 'VOYAGEUR', 'Combo activé',
    'Un Kick adverse reçoit −2 de Force.', combo(1, 'B', 'B')),
  P(97, 'RAIDEN', 'Raiden', 'Lightning bolt', 4, ['FOUDRE', 'VIF', 'TRANCHANT'], 'VOYAGEUR', 'Combo activé',
    'Activez ou réactivez la capacité « Pose » de l’un de vos Kicks posés.', combo(4, 'B', 'B', 'M')),
  K(98, 'PLAN', "J'ai un plan", 'B', 2, ['CÉRÉBRAL'], 'Pose', 'Combattant « Cérébral » : piochez deux cartes.'),
  K(99, 'FUITE', 'Préparer la fuite', 'B', 2, ['CÉRÉBRAL'], 'Pose', 'Combattant « Cérébral » : regardez les 5 premières cartes du Songe, remettez chacune dessus ou dessous.'),
  S(100, 'EXTREMIS', 'Sauvé in extremis', ['FOUDRE'], 'Durant la Baston', "Quand votre adversaire inflige un dégât à votre Hikari ou votre Raiden, vous pouvez défausser cette carte. Si vous le faites, contrez ce dégât. Puis vous pouvez échanger de place votre combattant avec un autre Hikari ou Raiden de votre Réserve. L'Aura de ce Perso peut être supérieure de +1 à la nuit actuelle."),
  S(101, 'SURVIVRE', 'Survivre une nuit de plus', ['FANTASY STARS'], 'Durant la Baston', "Team : Hikari, Huam, Alana et Raiden deviennent « Fantasy stars ». Quand l'adversaire gagne sans infliger de dégât à votre combattant « Fantasy stars », gagnez 1 de Renommée et recrutez."),
);

// ── Kill stars ───────────────────────────────────────────────
add(
  P(102, 'NAORA1', 'Naora', 'Little Amnésia', 1, ['CÉRÉBRAL'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, l'adversaire renvoie une carte de sa Main sous son Songe."),
  P(103, 'NAORA2', 'Naora', 'Big Amnésia', 2, ['CÉRÉBRAL', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Ciblez une carte adverse face cachée dans l'Arène : elle ne se relève pas à son prochain Crépuscule."),
  P(104, 'SHAKA1', 'Shaka', 'Silver One', 1, ['GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    'Quand Shaka combat, un de vos Kicks partageant un mot-clé avec lui reçoit +2.'),
  P(105, 'SHAKA3', 'Shaka', 'Silver Two', 3, ['GARDE', 'TRANCHANT', 'BRUTAL'], 'VOYAGEUR', 'Une fois par nuit',
    'Quand Shaka combat, vos Kicks partageant un mot-clé avec lui reçoivent +1.'),
  P(106, 'FLAM2', 'Flam', 'Joie de vivre', 2, ['SON', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant un combat, retournez Flam face cachée : changez le Rang d'un Kick en S, M, B ou ★."),
  P(107, 'FLAM3', 'Flam', 'Zero Sound', 3, ['SON', 'GARDE', 'BRUTAL'], 'VOYAGEUR', 'Combo activé',
    'Le bonus Combo du combattant adverse tombe à zéro.', combo(2, 'B', 'M', 'M')),
  P(108, 'LION2', 'Lion', 'Aqua Bomb', 2, ['EAU', 'GARDE'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire retourne son combattant face cachée. Cette nuit, quand il lance un combat, il renvoie sous le Groupe un de ses Persos face cachée.",
    combo(3, 'B', 'B'), 'DÉGÂT'),
  P(109, 'LION4', 'Lion', 'Aqua Testamento', 4, ['EAU', 'GARDE', 'TRANCHANT'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire retourne face cachée son combattant et ses Persos de l'Arène d'Aura inférieure.", combo(5, 'B', 'B', 'M'), 'DÉGÂT'),
  K(110, 'DEVIATION', 'Déviation sonique', 'B', 1, ['SON'], 'Continue', 'Combattant « Son » : ciblez un Kick adverse ; les Kicks adverses de son Rang reçoivent −1 (2 fois max par combat).'),
  K(111, 'TYMPANS', 'Explosion de tympans', '★', 1, ['SON'], 'Pose', 'Combattant « Son » : changez le Rang du dernier Kick adverse posé.'),
  K(112, 'VIRTUOSITE', 'Virtuosité', '★', 1, ['EAU'], 'Continue', 'Combattant « Eau » : choisissez un Rang, vos Kicks de ce Rang reçoivent +2 (une fois par combat).'),
  K(113, 'TRAVAIL', "Travail d'équipe", 'B', 1, ['KILL STARS'], 'Pose', 'Combattant « Kill stars » : +X de Force, X = vos Persos « Kill stars » dans l’Arène (max +3).'),
  S(114, 'DANSE_KILL', 'Danse des Kill stars', ['KILL STARS'], 'Une fois par nuit', "Team : Shaka, Naora, Lion et Flam deviennent « Kill stars ». Pendant un combat, votre combattant « Kill stars » reçoit les mots-clés de vos autres « Kill stars » de l'Arène."),
);

// ── Indomptables ─────────────────────────────────────────────
add(
  P(115, 'CELESTE2', 'Céleste', 'Double bras du Titan', 2, ['TITAN', 'BRUTAL'], 'VOYAGEUR', 'Une fois par nuit',
    'Quand Céleste est votre combattant, vos Kicks « Titan » reçoivent +2 de Force.'),
  P(116, 'CELESTE3', 'Céleste', 'Over Punch', 3, ['TITAN', 'BRUTAL', 'GARDE'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire retourne son combattant face cachée et reçoit −2 de Contrôle cette nuit.", combo(3, 'B', 'M', 'M'), 'DÉGÂT'),
  P(117, 'ISAAK1', 'Isaak', 'Je reviens', 1, ['SPATIAL', 'TITAN'], 'VOYAGEUR', 'Une fois par nuit',
    'Si votre combattant est « Titan » ou « Indomptables », exilez Isaak : vous pouvez poser 1 Kick de plus.'),
  P(118, 'ISAAK2', 'Isaak', 'Téléportation', 2, ['SPATIAL', 'TITAN', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, renvoyez Isaak sous le Groupe : un Perso d'Aura ≤ 2 de la Réserve ou du Groupe entre dans l'Arène. Si ce Perso est « Indomptables », son Aura peut être égale à la nuit."),
  P(119, 'GERIKO2', 'Gériko', 'Dragon loyal', 2, ['DRAGON', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, vos deux premiers Kicks posés sont inciblables. Gériko se retourne face cachée à la fin de la Baston.'),
  P(120, 'GERIKO3', 'Gériko', 'Dragon en chasse', 3, ['DRAGON', 'GARDE', 'BRUTAL'], 'VOYAGEUR', 'Durant la Baston',
    'Tant que Gériko combat, lui et vos Kicks sont inciblables.'),
  P(121, 'MANIAC1', 'Maniac', 'Prince de Dreamland', 1, ['SANG', 'BRUTAL', 'KAISER'], 'VOYAGEUR', 'Une fois par nuit',
    'Combattant « Indomptables » : renvoyez Maniac dans la Réserve, défaussez une carte : un Kick non « Base » reçoit +X (X = Force de la carte défaussée).'),
  P(122, 'MANIAC4', 'Maniac', 'Maniac 50 %', 4, ['SANG', 'BRUTAL', 'KAISER'], 'VOYAGEUR', 'Combo activé',
    'Choisissez « Brutal », « Sang » ou « Indomptables » : vos Kicks de ce mot-clé reçoivent +2 dans ce combat.', combo(5, 'M', 'M', 'S')),
  K(123, 'ETALE', 'Étalé en un coup', 'M', 2, ['BRUTAL'], 'Continue', 'Combattant « Brutal » : +3 de Force tant que vous posez moins de Kicks que votre Aura ne le permet.'),
  K(124, 'VIOLENCE', 'Plus de violence !', 'M', 2, ['BRUTAL'], 'Pose', 'Combattant « Brutal » : révélez la 1ʳᵉ carte du Songe, ce Kick reçoit +X (X = sa Force, Soutien = 0).'),
  K(125, 'FUREUR', 'Fureur du dragon', 'S', 2, ['DRAGON'], 'Continue', 'Combattant « Dragon » : vos Kicks inciblables reçoivent +1 (2 fois max par combat).'),
  K(126, 'ENVIE_SANG', 'Envie de sang', 'S', 2, ['SANG'], 'Pose', 'Combattant « Sang » : ce Kick reçoit une copie d’un marqueur de Force posé sur l’un de vos Kicks.'),
  K(127, 'PATATE', 'Patate cataclysmique', 'M', 1, ['INDOMPTABLES'], 'Pose', 'Combattant « Indomptables » : votre prochain Kick posé a une Force de base de 4.'),
  S(128, 'INDOMPTABLES', 'Puissance des Indomptables', ['INDOMPTABLES'], "À la fin d'un combat", 'Team : Isaak, Gériko, Céleste et Maniac deviennent « Indomptables ». Fin de combat : Puissance ≥ 17, +1 de Renommée ; sinon piochez une carte.'),
  S(129, 'BATTE', 'Batte des Titans', ['TITAN', 'ARME'], "À la fin d'un combat", "Si vous gagnez, défaussez-la : dégât, le combattant adverse est retourné face cachée (sous le Groupe si votre Puissance ≥ 17)."),
);

// ── Voyageurs noirs (Killer) ─────────────────────────────────
add(
  P(130, 'KAIN0', 'Kain', 'Tu peux le faire', 0, ['VENIN', 'KILLER'], 'VOYAGEUR', 'Une fois par nuit',
    'Pendant un combat, exilez Kain : un de vos Kicks non « Base » reçoit +1 (+2 si votre combattant est « V.Noirs »).'),
  P(131, 'KAIN2', 'Kain', 'Immobilisation', 2, ['VENIN', 'KILLER'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant un combat, renvoyez Kain dans la Réserve : un Kick adverse et l'un des vôtres échangent leur Force de base."),
  P(132, 'FUKMI', 'Fukmi', 'Absorber la douleur', 2, ['ANATOMIE', 'KILLER', 'GARDE'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant un combat, ciblez une carte : retirez-lui les marqueurs venant de capacités adverses. Fukmi se retourne à la fin de la Baston."),
  P(133, 'SONIC1', 'Sonic', 'Même pas mal', 1, ['KILLER'], 'VOYAGEUR', 'Pose',
    "En entrant dans l'Arène, Sonic devient inciblable (l'adversaire ne peut ni le cibler ni le choisir comme combattant)."),
  P(134, 'SONIC3', 'Sonic', 'Force brute', 3, ['KILLER', 'GARDE', 'BRUTAL'], 'VOYAGEUR', 'Combo activé',
    'Ciblez un Kick : retirez-lui les marqueurs venant de capacités adverses.', combo(4, 'S', 'M', 'B')),
  P(135, 'SEALVIA1', 'Sealvia', 'Je suis ton nouveau boss', 1, ['CIEL', 'KILLER'], 'VOYAGEUR', 'Une fois par nuit',
    'Durant votre Crépuscule, recrutez une carte de votre Groupe.'),
  P(136, 'SEALVIA2', 'Sealvia', 'Vento Kutt', 2, ['CIEL', 'KILLER', 'BRUTAL'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire renvoie sous le Groupe tous ses Persos de la Réserve d'Aura < 2.", combo(2, 'B', 'S'), 'DÉGÂT'),
  P(137, 'SEALVIA3', 'Sealvia', 'Tornado Megapunch', 3, ['CIEL', 'KILLER', 'BRUTAL'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire renvoie dans la Réserve son combattant et ses Persos de l'Arène d'Aura < 3.", combo(3, 'S', 'M', 'B'), 'DÉGÂT'),
  K(138, 'INTRUSION', 'Intrusion mortelle', 'B', 2, ['VENIN'], 'Pose', 'Combattant « Venin » : ciblez un Kick adverse et retirez-lui un marqueur.'),
  K(139, 'BLESSURE', 'Blessure venimeuse', 'M', 2, ['VENIN'], 'Pose', "Combattant « Venin » : l'adversaire défausse une carte de sa Main."),
  K(140, 'ENVOL', 'Prendre son envol', 'B', 2, ['VIDE', 'CIEL'], 'Pose', "Combattant « Vide » ou « Ciel » : un Soutien adverse est retourné face cachée."),
  K(141, 'DANSE_VENTS', 'Danse des vents', 'M', 2, ['VIDE', 'CIEL'], 'Pose', 'Combattant « Vide » ou « Ciel » : récupérez une carte de votre Fosse.'),
  S(142, 'DEBARRASSER', 'Se débarrasser des inutiles', ['V.NOIRS'], 'Une fois par nuit', "Team : Sealvia, Kain, Fukmi et Sonic deviennent « V.Noirs ». Combattant « V.Noirs » : un Kick adverse reçoit −X (X = vos Kicks posés sans capacité activée)."),
  P(143, 'EXTHA', 'Extha', 'Explosion piquante', 2, ['SANG', 'KILLER', 'TRANCHANT'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire perd 1 de Renommée.", combo(2, 'B', 'S'), 'DÉGÂT'),
  P(144, 'SACHA', 'Sacha', 'Tu dois mourir', 3, ['VIDE', 'KILLER', 'TRANCHANT'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire renvoie son combattant sous le Groupe. Vous pouvez chercher Angélito dans le Songe et le poser.",
    combo(4, 'S', 'M', 'B'), 'DÉGÂT'),
  P(145, 'ARKA', 'Arka', 'Prison de toiles', 4, ['VENIN', 'KILLER', 'TRANCHANT', 'BRUTAL'], 'VOYAGEUR', 'Combo activé + Victoire',
    "L'adversaire exile son combattant, puis retourne face cachée un de ses Persos de l'Arène, qui ne se relèvera pas à son prochain Crépuscule.",
    combo(5, 'S', 'M', 'B'), 'DÉGÂT'),
  K(146, 'SANS_PITIE', 'Sans pitié', 'S', 1, ['KILLER'], 'Pose', 'Combattant « Killer » : le Rang du dernier Kick adverse posé devient S.'),
  K(147, 'COUP_TRAITRE', 'Coup en traître', 'S', 1, ['KILLER'], 'Pose', 'Combattant « Killer » : le dernier Kick adverse posé a une Force de base de 0.'),
  S(148, 'ANGELITO', 'Angélito', ['VIDE', 'ARME'], "Au début d'un combat", "Quand Sacha combat, défaussez-la : vos Kicks « Tranchant » et « Vide » reçoivent +1, et vous pouvez choisir le combattant adverse."),
  S(149, 'NATHALIE', 'Nathalie', ['ARAIGNÉE'], 'Durant un combat', "Quand Arka combat, défaussez-la : le Combo du combattant adverse ne peut pas s'activer."),
);

// ── Divers ───────────────────────────────────────────────────
add(
  P(150, 'AUSTIN', 'Austin', 'Mojo', 2, ['SPATIAL', 'PLAISIR'], 'VOYAGEUR', 'Une fois par nuit',
    "Pendant votre Crépuscule, exilez Austin : un Perso de votre Réserve (Aura ≤ nuit + 1) entre dans l'Arène ; cette nuit, il ne combat pas et ne compte pas dans le Contrôle."),
  P(151, 'JUNG', 'Jung', 'Cartographe onirique', 2, ['SPATIAL', 'ROCHE', 'CÉRÉBRAL'], 'VOYAGEUR', 'Une fois par nuit',
    "Quand une capacité de Lieu est activée, renvoyez Jung sous le Groupe pour copier et appliquer cette capacité."),
  P(152, 'TORO', 'Toro Picana', 'Humilier les Seigneurs', 3, ['FEU', 'OBSCUR', 'TITAN', 'BRUTAL'], 'VOYAGEUR', 'Combo activé',
    "Le combattant adverse ne compte pas dans le Contrôle cette nuit. S'il est « Seigneur », « Kaiser » ou « Duc », le bonus Combo passe à +10.",
    combo(3, 'B', 'M', 'M')),
  P(153, 'DOLCHE', 'Dolche', 'Aura du corbeau', 4, ['CIEL', 'VIF', 'KAISER', 'CORBEAU'], 'VOYAGEUR', 'Combo activé',
    'Posez face cachée une carte de votre Main ; vous pouvez la révéler pendant ce combat (un Kick est posé, un Soutien est posé). Non révélée, elle revient en Main.',
    combo(5, 'S', 'M', 'B')),
  S(154, 'MALICE', 'Malice du corbeau', ['CORBEAU'], "Au début d'un combat", "Avec votre Perso « Corbeau » dans l'Arène, défaussez-la : échangez votre combattant avec un de vos Persos de l'Arène d'Aura entre 2 et celle du combattant adverse."),
  P(155, 'DEBORDMAN', 'Debordman', 'Vous êtes pas prêts !', 2, ['ART'], '???????', 'Une fois par nuit',
    "Pendant votre Crépuscule, exilez Debordman : refaites « Entrer dans l'Arène » et/ou « Soutenir ». S'il subit un dégât, contrez-le et exilez-le à la place."),
);

// ── Cartes « Base » ──────────────────────────────────────────
add(
  K(156, 'FORCE_ENFOUIE', 'Force enfouie', '★', 0, ['BASE'], 'Pose', "Si votre combattant a moins d'Aura que l'adverse : +3 de Force."),
  K(157, 'PAS_VU_VENIR', "Il l'a pas vu venir", '★', 0, ['BASE'], 'Pose', "L'adversaire perd 1 de Renommée."),
  K(158, 'SAUVE', 'Sauvé de justesse', '★', 0, ['BASE'], 'Pose', "Si l'adversaire inflige un dégât, retournez votre combattant face cachée pour le contrer ; l'adversaire gagne 1 de Renommée et reprend un de ses Kicks."),
  K(159, 'FOU_RAGE', 'Fou de rage', 'B', 1, ['BASE'], 'Continue', 'Si vous avez deux Kicks posés de même Rang : +2 de Force.'),
  K(160, 'PUNCH', 'Punch', 'B', 2, ['BASE'], 'Victoire', "L'adversaire renvoie son combattant sous le Groupe.", 'DÉGÂT'),
  K(161, 'COUP_BOULE', 'Coup de boule', 'M', 2, ['BASE'], 'Victoire', "L'adversaire retourne son combattant face cachée.", 'DÉGÂT'),
  K(162, 'UPPERCUT', 'Uppercut', 'M', 2, ['BASE'], 'Victoire', "L'adversaire renvoie son combattant dans la Réserve.", 'DÉGÂT'),
  K(163, 'MEGA_MANDALE', 'Méga mandale', 'S', 3, ['BASE'], 'Victoire', "Combattant adverse face cachée, puis l'adversaire renvoie sous le Groupe une carte de sa Réserve. Contré en cas d'égalité.", 'DÉGÂT'),
  K(164, 'DEBOITAGE', 'Déboîtage de mâchoire', 'S', 3, ['BASE'], 'Victoire', 'Cherchez une carte au choix dans votre Songe.', 'DÉGÂT'),
  S(165, 'TEMPO', 'Tempo Temperus', ['SCEAU'], 'Une fois par nuit', "Pendant votre Crépuscule, défaussez-la : un Perso de l'Arène ne peut plus être renvoyé, exilé ni échangé par l'adversaire cette nuit."),
  S(166, 'REJOINS', 'Rejoins-nous !', ['BASE'], 'Une fois par nuit', "À la fin de la nuit, défaussez-la : avec 4+ cartes dans le Groupe, un Perso de votre Réserve entre dans l'Arène ; sinon, votre prochaine pioche obligatoire va jusqu'à 8."),
);

// ── Lieux : 12 cartes, 4 effets (3 capacités, une fois chacune par partie, une seule par nuit) ──
const LIEU_EFFECTS = {
  CRANE: [
    { when: 'combat', text: 'Durant la Baston : piochez une carte.' },
    { when: 'denouement', text: 'Au Dénouement, si vos Kicks n’ont aucun marqueur : un Kick non « Base » reçoit +1.' },
    { when: 'finCombat', text: "Fin d'un combat : renvoyez un Perso de votre Réserve sous le Groupe, piochez autant que son Aura." },
  ],
  DEESSES: [
    { when: 'crepuscule', text: 'Recrutez la première carte de votre Groupe.' },
    { when: 'crepuscule', text: 'Cherchez un Soutien dans votre Songe.' },
    { when: 'crepuscule', text: "Cherchez un Perso d'Aura ≤ 2 dans votre Groupe et recrutez-le." },
  ],
  DELIRIUM: [
    { when: 'crepuscule', text: 'Piochez deux cartes.' },
    { when: 'crepuscule', text: 'Défaussez une carte pour récupérer une carte de votre Fosse.' },
    { when: 'aurore', text: 'Regardez les 2 premières cartes du Songe, remettez chacune dessus ou dessous.' },
  ],
  PLAINES: [
    { when: 'aurore', text: "Un de vos Persos ayant combattu cette nuit reçoit +1 d'Aura." },
    { when: 'aurore', text: 'Cherchez une carte dans votre Songe.' },
    { when: 'aurore', text: 'Regardez la 1ʳᵉ carte du Groupe, remettez-la dessus ou dessous.' },
  ],
};
const L = (num, id, name, effect) => ({ num, id, type: 'L', name, effect, abilities: LIEU_EFFECTS[effect], kw: [], text: '' });
export const LIEUX = {};
[
  L(189, 'PUZZLE', 'Puzzle Village', 'CRANE'), L(190, 'LAC_BLANC', 'Lac Blanc', 'CRANE'), L(191, 'CRANE', 'Crâne du Dragon', 'CRANE'),
  L(192, 'CHAMPILAND', 'Champiland', 'DEESSES'), L(193, 'ZONE2', 'Zone 2', 'DEESSES'), L(194, 'DEESSES', 'Royaume des 2 Déesses', 'DEESSES'),
  L(195, 'METRO', 'Métro de Dreamland', 'DEESSES'), L(196, 'ZONE3', 'Zone 3', 'DELIRIUM'), L(197, 'DELIRIUM', 'Délirium City', 'DELIRIUM'),
  L(198, 'MOEBIUS', 'Désert de Moebius', 'PLAINES'), L(199, 'PELOTE', 'Plaine de la Pelote', 'PLAINES'), L(200, 'PLAINES', 'Royaume des Plaines', 'PLAINES'),
].forEach(l => (LIEUX[l.id] = l));

// ── Teams : un Soutien « Team » donne définitivement un mot-clé à certains Persos ──
export const TEAMS = {
  EN_MISSION: { kw: 'FLOCONS', match: d => d.kw.includes('GLACE') && d.cls === 'VOYAGEUR' },
  DEBARRASSER: { kw: 'V.NOIRS', names: ['Sealvia', 'Kain', 'Fukmi', 'Sonic'] },
  FOUTEURS: { kw: 'LUCKY STARS', names: ['Terrence', 'Savane', 'Sabba', 'Ève'] },
  ART_DESTRUCTION: { kw: 'ATTILA BAND', names: ['Attila', 'Violetta', 'Fan Boy', 'Akim', 'Romuald', 'DJ Killa'] },
  SURVIVRE: { kw: 'FANTASY STARS', names: ['Hikari', 'Huam', 'Alana', 'Raiden', 'Hikari & Raiden', 'Alana & Huam'] },
  DANSE_KILL: { kw: 'KILL STARS', names: ['Shaka', 'Naora', 'Lion', 'Flam'] },
  INDOMPTABLES: { kw: 'INDOMPTABLES', names: ['Isaak', 'Gériko', 'Céleste', 'Maniac'] },
};
// Textes et conditions affichés : ceux de l'app officielle
for (const c of Object.values(CARDS)) { const o = OFFICIAL[c.num]; if (o) { c.cond = o[0]; c.text = o[1]; } }

export const teamMatches = (team, d) => d.type === 'P' && (team.match ? team.match(d) : team.names.includes(d.name));

// ── Noms d'une carte (règle 40) ──────────────────────────────
// Une carte « XXX & YYY » porte les deux noms : elle ne peut pas être dans l'Arène avec un autre Perso
// qui en porte un. Les noms se comparent à la chaîne exacte.
export const cardNames = d => String(d.name).split(' & ');
export const sharesName = (a, b) => { const nb = cardNames(b); return cardNames(a).some(n => nb.includes(n)); };

// ── Index par numéro de set ──────────────────────────────────
export const BY_NUM = {};
for (const d of [...Object.values(CARDS), ...Object.values(LIEUX)]) BY_NUM[d.num] = d;
/** Numéro imprimé sur la carte : « 081/FDS 1 » (le « 1 » est l'édition). */
export const numLabel = n => `${String(n).padStart(3, '0')}/FDS 1`;

// ── Construction de deck ─────────────────────────────────────
// Un Groupe peut être vide (R54) ; chaque Perso n'y figure qu'une fois (R67).
export const DECK_RULES = { maxAura: 20, minSonge: 30, maxSonge: 60, maxCopies: 4 };
/** Exemplaires maximum d'une carte dans un deck : 1 pour un Perso (R67), 4 pour le reste. */
export const maxCopies = d => (d?.type === 'P' ? 1 : DECK_RULES.maxCopies);

/** Vérifie un deck { name, lieu, groupe: [ids], songe: [ids] }. */
export function validateDeck(deck) {
  const errors = [];
  const R = DECK_RULES;
  if (!deck.lieu || !LIEUX[deck.lieu]) errors.push('Choisissez un Lieu.');
  const groupe = deck.groupe ?? [], songe = deck.songe ?? [];
  const aura = groupe.reduce((a, id) => a + (CARDS[id]?.aura ?? 0), 0);
  if (aura > R.maxAura) errors.push(`Groupe : ${aura} d'Aura, ${R.maxAura} maximum.`);
  if (songe.length < R.minSonge) errors.push(`Songe : ${songe.length} cartes, ${R.minSonge} minimum.`);
  if (songe.length > R.maxSonge) errors.push(`Songe : ${songe.length} cartes, ${R.maxSonge} maximum.`);
  if (groupe.some(id => CARDS[id]?.type !== 'P')) errors.push('Le Groupe ne contient que des Persos.');
  if (songe.some(id => !['K', 'S'].includes(CARDS[id]?.type))) errors.push('Le Songe ne contient que des Kicks et des Soutiens.');
  const counts = {};
  [...groupe, ...songe].forEach(id => (counts[id] = (counts[id] || 0) + 1));
  for (const [id, n] of Object.entries(counts)) {
    const max = maxCopies(CARDS[id]);
    if (n > max) errors.push(`${cardLabel(CARDS[id])} : ${n} exemplaires, ${max} maximum.`);
  }
  return { ok: errors.length === 0, errors, aura };
}

export const cardLabel = d => (d ? (d.sub ? `${d.name} (${d.sub})` : d.name) : '?');
