// ─────────────────────────────────────────────────────────────
// Effets des cartes. Chaque effet reçoit `g` (Game) et utilise
// ses primitives (activate, target, draw, underGroupe…).
//
// Actions activables : `can` = précondition du texte (sinon l'option n'existe pas) ;
// `blocked` = raison pour laquelle l'effet ne ferait rien (R64/R65) : l'option reste visible,
// le coût est payé et l'effet est sans objet, comme à la table.
// ─────────────────────────────────────────────────────────────
import { TEAMS, LIEUX } from './data.js';

const opp = pid => 1 - pid;
const nonBaseKicks = (g, pid) => g.ownKicks(pid).filter(k => !g.isBase(k));
const kwKicks = (g, pid, kw) => g.ownKicks(pid).filter(k => g.kickHasKw(k, kw));
const allKicks = g => [...g.ownKicks(0), ...g.ownKicks(1)];
const sharesKw = (g, k, card) => { const kw = g.keywords(card); return g.def(k).kw.some(w => kw.includes(w)); };

async function boostOne(g, pid, cards, v, title) {
  const k = await g.target(pid, cards, title);
  if (k && v) g.addMarker(k, v, pid);
}

async function yesNo(g, pid, kind, title) {
  return (await g.chooseOption(pid, kind, title, [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }])) === 'yes';
}

/** Provoc' : un combat de plus, une seule par nuit et par joueur. */
async function provoc(g, pid) {
  const mine = g.fighterCandidates(pid).filter(c => g.hasKw(c, 'TITAN'));
  const theirs = g.targetCandidates(pid);
  if (g.p(pid).provocUsed) { g.log("Provoc' impossible : déjà lancée cette nuit.", pid); return; }
  if (!mine.length || !theirs.length) { g.log("Provoc' impossible.", pid); return; }
  g.p(pid).provocUsed = true;
  const a = await g.chooseCard(pid, 'provocFighter', "Provoc' : votre Perso « Titan »", mine);
  const b = await g.chooseCard(pid, 'provocTarget', "Provoc' : le Perso adverse", theirs);
  await g.runCombat(pid, a, b, { provoc: true });
}
const provocBlocked = (g, pid) => {
  if (g.p(pid).provocUsed) return "Provoc' déjà lancée cette nuit";
  if (!g.fighterCandidates(pid).some(c => g.hasKw(c, 'TITAN'))) return 'aucun Perso « Titan » pour combattre';
  if (!g.targetCandidates(pid).length) return 'aucune cible adverse';
  return null;
};

/** Cherche une carte du mot-clé donné dans le Songe, le Groupe ou la Réserve (Savane, Ève). */
async function fetchKeyword(g, pid, kw, selfName) {
  const p = g.p(pid);
  const ok = c => g.def(c).kw.includes(kw) && g.def(c).name !== selfName;
  const where = { songe: 'Songe', groupe: 'Groupe', reserve: 'Réserve' };
  // Une carte par nom et par zone, pour que le joueur choisisse aussi l'endroit
  const cands = [...new Map(['songe', 'groupe', 'reserve'].flatMap(z => p[z].filter(ok)).map(c => [`${c.id}@${c.zone}`, c])).values()];
  if (!cands.length) { g.log(`Aucune carte « ${kw.toLowerCase()} » à prendre.`, pid); return; }
  const id = await g.chooseOption(pid, 'search', `Carte « ${kw.toLowerCase()} » à prendre (Songe, Groupe ou Réserve)`,
    cands.map(c => ({ id: c.uid, label: `${g.label(c)} — ${where[c.zone]}`, card: c })));
  const pick = cands.find(c => c.uid === id);
  if (pick) {
    if (g.def(pick).type !== 'P') { const from = where[pick.zone]; g.put(pick, 'hand'); g.log(`${g.pname(pid)} ajoute ${g.label(pick)} à sa Main.`, pid, from === 'Réserve' ? null : { to: pid, masked: `${g.pname(pid)} ajoute une carte de son ${from} à sa Main.` }); }
    else if (pick.zone === 'reserve') g.log(`${g.label(pick)} est déjà dans la Réserve.`, pid);
    else g.recruit(pid, pick);
  }
  if (pick?.zone !== 'reserve') g.shuffle(p.songe);
}

async function fouteursRoll(g, pid) {
  const v = g.roll(pid, 'Fouteurs de merde');
  if (v === 6) g.gainFame(pid, 2, 'Fouteurs de merde');
  else { g.draw(pid, 1); g.log(`${g.pname(pid)} pioche une carte.`, pid); }
}

/** Réactive la capacité « Pose » d'un Kick déjà posé (Raiden, Saturn). */
async function reactivate(g, pid, cands, title) {
  const k = await g.chooseCard(pid, 'reactivate', title, cands);
  if (!k) return;
  k.countered = false;
  k.silenced = false;
  g.log(`${g.label(k)} réactive sa capacité.`, pid);
  k.activated = true;
  await onKickPosed(g, pid, k);
}

// Cartes « Félin » avec un choix Accepter / Refuser : valeurs pour l'annonce (Young Infinity, Rafaelo — R58)
const FELIN_KICKS = {
  NEGOCIATION: () => ({ accept: 1.5, refuse: 0.6 }),
  CROCS: (g, pid) => { const os = g.side(opp(pid)); return { accept: 2, refuse: os.turns < os.max ? 2 : 0 }; },
};
export function felinValues(g, pid, k) { return FELIN_KICKS[k.id]?.(g, pid) ?? null; }

// ── Actions activables (fenêtres) ────────────────────────────
// window : crepuscule | combatStart | combat | denouement | finCombat | finBaston | aurore | finNuit (ou un tableau)
// once   : 'night' (par nom de capacité) | 'combat'
// selfMove : la capacité renvoie, exile ou retourne le Perso lui-même (bloquée par Fan Boy)
const IN_COMBAT = ['combatStart', 'combat', 'denouement', 'finCombat'];
export const PERSO_ACTIONS = {
  NEIL1: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: (g, pid) => (kwKicks(g, pid, 'FEU').length ? null : 'aucun Kick « Feu » posé'),
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Épée Diderot', async () => {
        const k = await g.target(pid, kwKicks(g, pid, 'FEU'), 'Kick « Feu » qui reçoit +X (X = sa Force globale)');
        // Force globale = Force de la carte + tous ses marqueurs (règles v1.1), y compris les marqueurs continus [+X]
        if (k) g.addMarker(k, g.kickForce(k), pid);
      });
    } },
  CHARLY1: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: (g, pid) => (g.ownKicks(pid).some(k => k.rang === 'B') ? null : 'aucun Kick B posé'),
    run: async (g, pid, c) => {
      g.flipDown(c);
      // Marqueurs posés maintenant : seuls les Kicks B déjà posés les reçoivent
      await g.activate(pid, c, 'Choisi par Asmodheus', () => g.ownKicks(pid).filter(k => k.rang === 'B').forEach(k => g.addMarker(k, 1, pid)));
    } },
  // « Une fois par combat » : à tout moment du combat
  CHARLY3: { window: ['combatStart', 'combat', 'denouement', 'finCombat'], once: 'combat',
    can: (g, pid, c) => g.isFighter(c),
    blocked: (g, pid, c) => (fireMates(g, pid, c).length ? null : 'aucun autre Perso voyageur « Feu » à renvoyer'),
    run: async (g, pid, c) => {
      const mate = await g.chooseCard(pid, 'cost', 'Fire Eater : Perso « Feu » à renvoyer sous le Groupe', fireMates(g, pid, c));
      if (!mate) { g.log('Fire Eater : aucun Perso à renvoyer, sans effet.', pid); return; }
      g.underGroupe(mate, null);
      await g.activate(pid, c, 'Fire Eater', () => g.ownKicks(pid).forEach(k => g.addMarker(k, 2, pid)));
    } },
  EPONY3: { window: 'combat', once: 'night',
    run: async (g, pid, c) => {
      // « Si vous avez activé cette capacité » : appliqué même si elle est contrée (règles, point 9)
      c.tmp.notInControl = true;
      await g.activate(pid, c, 'Le numéro 2', () => {
        g.side(pid).effects.push({ rang: 'M', v: 1, label: 'Le numéro 2' });
        g.log('Vos Kicks M reçoivent +1. Epony ne compte plus dans votre Contrôle cette nuit.', pid);
      });
    } },
  VULCAIN: { window: 'combat', once: 'night',
    blocked: (g, pid) => (g.def(g.fighter(pid)).combo ? null : 'le combattant n’a pas de Combo'),
    run: async (g, pid, c) => g.activate(pid, c, 'Conseiller des rois', () => { g.side(pid).comboExtra += 3; g.log('Bonus Combo +3.', pid); }) },
  TERRENCE1: { window: 'combat', once: 'night',
    run: async (g, pid, c) => g.activate(pid, c, 'Motiver les autres', () => g.side(pid).effects.push({ rang: '★', v: 1, label: 'Motiver les autres' })) },
  SABBA: { window: 'combat', once: 'night', selfMove: true,
    run: async (g, pid, c) => {
      c.tmp.flipEndBaston = true; // « Si vous avez activé cette capacité » : même si elle est contrée
      await g.activate(pid, c, 'Élu du pinceau', async () => {
        const roll = g.roll(pid, 'Sabba');
        if (roll <= 3 || roll === 6) g.draw(pid, 1);
        if (roll >= 4 && g.ownKicks(pid).length) await boostOne(g, pid, g.ownKicks(pid), 1, 'Kick qui reçoit +1');
      });
    } },
  PAULY: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: (g, pid) => (nonBaseKicks(g, pid).length ? null : 'aucun Kick non « Base » posé'),
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      const v = g.hasKw(g.fighter(pid), 'LUCKY STARS') ? 2 : 1;
      await g.activate(pid, c, 'Kill Kill Kill', () => boostOne(g, pid, nonBaseKicks(g, pid), v, `Kick non « Base » qui reçoit +${v}`));
    } },
  KAIN0: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: (g, pid) => (nonBaseKicks(g, pid).length ? null : 'aucun Kick non « Base » posé'),
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      const v = g.hasKw(g.fighter(pid), 'V.NOIRS') ? 2 : 1;
      await g.activate(pid, c, 'Tu peux le faire', () => boostOne(g, pid, nonBaseKicks(g, pid), v, `Kick non « Base » qui reçoit +${v}`));
    } },
  KAIN2: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: (g, pid) => (!g.ownKicks(pid).length ? 'aucun Kick posé' : !g.ownKicks(opp(pid)).length ? 'aucun Kick adverse posé' : null),
    run: async (g, pid, c) => {
      g.toReserve(c, null);
      await g.activate(pid, c, 'Immobilisation', async () => {
        const theirs = await g.target(pid, g.ownKicks(opp(pid)), 'Kick adverse');
        const mine = await g.chooseCard(pid, 'swapOwn', 'Votre Kick', g.ownKicks(pid));
        if (theirs && mine) {
          [theirs.base, mine.base] = [mine.base, theirs.base];
          g.log(`${g.label(theirs)} et ${g.label(mine)} échangent leur Force de base.`, pid);
        }
      });
    } },
  FUKMI: { window: 'combat', once: 'night', selfMove: true,
    blocked: (g, pid) => (allKicks(g).some(k => k.markers.some(m => m.src === opp(pid))) ? null : 'aucun marqueur adverse à retirer'),
    run: async (g, pid, c) => {
      c.tmp.flipEndBaston = true; // « Si vous activez cette capacité » : même si elle est contrée
      await g.activate(pid, c, 'Absorber la douleur', async () => {
        const cands = allKicks(g).filter(k => k.markers.some(m => m.src === opp(pid)));
        const k = await g.target(pid, cands, 'Carte dont retirer les marqueurs adverses');
        if (k) { k.markers = k.markers.filter(m => m.src !== opp(pid)); g.log(`${g.label(k)} perd ses marqueurs adverses.`, pid); }
      });
    } },
  CELESTE2: { window: 'combat', once: 'night',
    can: (g, pid, c) => g.isFighter(c),
    blocked: (g, pid) => (kwKicks(g, pid, 'TITAN').length ? null : 'aucun Kick « Titan » posé'),
    run: async (g, pid, c) => g.activate(pid, c, 'Double bras du Titan', () => kwKicks(g, pid, 'TITAN').forEach(k => g.addMarker(k, 2, pid))) },
  ISAAK1: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c) && (g.hasKw(g.fighter(pid), 'TITAN') || g.hasKw(g.fighter(pid), 'INDOMPTABLES')),
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Je reviens', () => { g.side(pid).max += 1; g.log('Vous pouvez poser 1 Kick de plus.', pid); });
    } },
  HIKARI1: { window: 'combat', once: 'night',
    blocked: (g, pid) => (!g.ownKicks(opp(pid)).length ? 'aucun Kick adverse posé' : !g.ownKicks(pid).some(k => k.rang === '★') ? 'aucun de vos Kicks ★ posé' : null),
    run: async (g, pid, c) => g.activate(pid, c, 'Shooting star', async () => {
      const x = g.ownKicks(pid).filter(k => k.rang === '★').length;
      await boostOne(g, pid, g.ownKicks(opp(pid)), -x, `Kick adverse qui reçoit −${x}`);
    }) },
  SHAKA1: { window: 'combat', once: 'night',
    can: (g, pid, c) => g.isFighter(c),
    blocked: (g, pid, c) => (g.ownKicks(pid).some(k => sharesKw(g, k, c)) ? null : 'aucun Kick partageant un mot-clé avec Shaka'),
    run: async (g, pid, c) => g.activate(pid, c, 'Silver One', async () => {
      const k = await g.chooseCard(pid, 'boostOwn', 'Kick qui reçoit +2', g.ownKicks(pid).filter(x => sharesKw(g, x, c)));
      if (k) g.addMarker(k, 2, pid);
    }) },
  SHAKA3: { window: 'combat', once: 'night',
    can: (g, pid, c) => g.isFighter(c),
    blocked: (g, pid, c) => (g.ownKicks(pid).some(k => sharesKw(g, k, c)) ? null : 'aucun Kick partageant un mot-clé avec Shaka'),
    run: async (g, pid, c) => g.activate(pid, c, 'Silver Two', () => g.ownKicks(pid).filter(k => sharesKw(g, k, c)).forEach(k => g.addMarker(k, 1, pid))) },
  FLAM2: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c),
    blocked: () => null,
    run: async (g, pid, c) => {
      g.flipDown(c);
      await g.activate(pid, c, 'Joie de vivre', async () => {
        const k = await g.target(pid, allKicks(g), 'Kick dont changer le Rang');
        if (!k) return;
        k.rang = await g.chooseRank(pid, `Nouveau Rang de ${g.label(k)}`, k.rang, k);
        g.log(`${g.label(k)} devient de Rang ${k.rang}.`, pid);
      });
    } },
  GERIKO2: { window: 'combat', once: 'night', selfMove: true,
    run: async (g, pid, c) => {
      c.tmp.flipEndBaston = true; // « Si vous avez activé cette capacité » : même si elle est contrée
      await g.activate(pid, c, 'Dragon loyal', () => {
        g.side(pid).gerikoFirstTwo = true;
        g.log('Vos deux premiers Kicks posés sont inciblables.', pid);
      });
    } },
  MANIAC1: { window: 'combat', once: 'night', selfMove: true,
    can: (g, pid, c) => !g.isFighter(c) && g.hasKw(g.fighter(pid), 'INDOMPTABLES'),
    blocked: (g, pid) => (!g.p(pid).hand.length ? 'aucune carte à défausser' : !nonBaseKicks(g, pid).length ? 'aucun Kick non « Base » posé' : null),
    run: async (g, pid, c) => {
      g.toReserve(c, null);
      // R49/R55 : le coût (défausse) est payé même si la capacité est contrée
      const out = await g.chooseCard(pid, 'discardOwn', 'Carte à défausser (sa Force devient le bonus)', g.p(pid).hand);
      let x = 0;
      if (out) { x = g.def(out).force ?? 0; g.discard(out); g.log(`${g.pname(pid)} défausse ${g.label(out)}.`, pid); }
      await g.activate(pid, c, 'Prince de Dreamland', async () => {
        if (!out) return;
        const k = await g.chooseCard(pid, 'boostOwn', `Kick non « Base » qui reçoit +${x}`, nonBaseKicks(g, pid));
        if (k && x) g.addMarker(k, x, pid);
      });
    } },
  MILAN: { window: 'combat', once: 'night',
    run: async (g, pid, c) => {
      const values = { accept: kwKicks(g, pid, 'FÉLIN').length, refuse: kwKicks(g, pid, 'FÉLIN').length * 0.4 };
      await g.activate(pid, c, 'Le garde royal', async () => {
        // R28 : Accepter et Refuser n'agissent que sur les Kicks « Félin » déjà posés
        const fel = kwKicks(g, pid, 'FÉLIN');
        const ans = await g.acceptRefuse(pid, 'Le garde royal', 'vos Kicks « Félin » posés reçoivent +1', 'vos Kicks « Félin » posés deviennent inciblables', values);
        if (ans !== 'refuse') fel.forEach(k => g.addMarker(k, 1, pid));
        if (ans !== 'accept') { fel.forEach(k => { k.shielded = true; }); g.log('Vos Kicks « Félin » posés sont inciblables.', pid); }
      }, { felin: { values } });
    } },
  // Crépuscule (le vôtre)
  BORO: { window: 'crepuscule', once: 'night', selfMove: true,
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Chute de température', async () => {
        const flocons = g.p(pid).groupe.filter(x => g.hasKw(x, 'FLOCONS'));
        const opts = [{ id: 'search', label: 'Chercher une carte « Glace » dans le Songe' }];
        if (flocons.length) opts.unshift({ id: 'recruit', label: 'Recruter un Perso « Flocons » du Groupe' });
        const ans = await g.chooseOption(pid, 'boro', 'Chute de température', opts);
        if (ans === 'recruit') {
          const pick = await g.chooseCard(pid, 'recruitPick', 'Perso « Flocons » à recruter', flocons);
          if (pick) g.recruit(pid, pick);
        } else await g.searchSonge(pid, d => d.kw.includes('GLACE'), 'Carte « Glace » à prendre');
      });
    } },
  SEALVIA1: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (g.p(pid).groupe.length ? null : 'Groupe vide'),
    run: async (g, pid, c) => g.activate(pid, c, 'Je suis ton nouveau boss', () => g.recruit(pid)) },
  ISAAK2: { window: 'crepuscule', once: 'night', selfMove: true,
    run: async (g, pid, c) => {
      g.underGroupe(c, null);
      await g.activate(pid, c, 'Téléportation', async () => {
        // R63 : Isaak, renvoyé sous le Groupe, peut se choisir lui-même
        const cands = teleportCands(g, pid);
        const pick = await g.chooseCard(pid, 'teleport', `Perso d'Aura ≤ 2 (ou ≤ ${g.s.night} s'il est « Indomptables ») qui entre dans l'Arène`, cands);
        if (pick) await g.enterArena(pid, [pick]);
      });
    } },
  JERZEY1: { window: 'crepuscule', once: 'night',
    run: async (g, pid, c) => g.activate(pid, c, 'Déplacement éclair', () => { g.draw(pid, 1); g.log(`${g.pname(pid)} pioche une carte.`, pid); }) },
  DIEU_CHAT: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (g.visibleArena(pid).filter(x => g.hasKw(x, 'FÉLIN')).length >= 2 ? null : 'moins de 2 Persos « Félin » dans l’Arène'),
    run: async (g, pid, c) => g.activate(pid, c, 'Lever la patte', () => {
      const n = g.visibleArena(pid).filter(x => g.hasKw(x, 'FÉLIN')).length;
      if (n >= 2) g.recruit(pid);
      if (n >= 5) g.gainGold(pid, 1);
      if (n >= 8) g.gainFame(pid, 1, 'Dieu chat noir');
    }) },
  FELIX: { window: 'crepuscule', once: 'night',
    run: async (g, pid, c) => {
      const p = g.p(pid);
      const values = { accept: p.fosse.length ? 1.5 : 0, refuse: p.songe.some(x => g.def(x).kw.includes('FÉLIN')) ? 1.8 : 0 };
      await g.activate(pid, c, 'Fourberie', async () => {
        const ans = await g.acceptRefuse(pid, 'Fourberie', 'il récupère la dernière carte de sa Fosse', 'il cherche une carte « Félin » dans son Songe', values);
        if (ans !== 'refuse' && p.fosse.length) {
          const last = p.fosse[p.fosse.length - 1];
          g.put(last, 'hand');
          g.log(`${p.name} récupère ${g.label(last)}.`, pid);
        }
        if (ans !== 'accept') await g.searchSonge(pid, d => d.kw.includes('FÉLIN'), 'Carte « Félin » à prendre');
      }, { felin: { values } });
    } },
  SAVANE2: { window: 'crepuscule', once: 'night',
    run: async (g, pid, c) => g.activate(pid, c, 'Fishmaker', () => fetchKeyword(g, pid, 'POISSON', 'Savane')) },
  EVE2: { window: 'crepuscule', once: 'night',
    run: async (g, pid, c) => g.activate(pid, c, 'Invocatrice des motifs', () => fetchKeyword(g, pid, 'MOTIF', 'Ève')) },
  ALANA2: { window: 'crepuscule', once: 'night',
    run: async (g, pid, c) => g.activate(pid, c, 'Boîte invisible', async () => {
      const t = await g.chooseCard(pid, 'protect', 'Perso qui devient inciblable cette nuit', [...g.visibleArena(pid), ...g.p(pid).reserve.filter(c => !c.faceDown)]);
      if (t) { t.tmp.nightInciblable = true; g.log(`${g.label(t)} est inciblable cette nuit.`, pid); }
    }) },
  NAORA1: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (g.p(opp(pid)).hand.length ? null : 'la Main adverse est vide'),
    run: async (g, pid, c) => g.activate(pid, c, 'Little Amnésia', async () => {
      const o = opp(pid);
      const x = await g.chooseCard(o, 'discardOwn', 'Carte de votre Main à renvoyer sous votre Songe', g.p(o).hand);
      if (x) { g.put(x, 'songe', { bottom: true }); g.log(`${g.pname(o)} renvoie une carte sous son Songe.`, o); }
    }) },
  NAORA2: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => ([...g.p(opp(pid)).arena, ...g.p(opp(pid)).supports].some(x => x.faceDown && !x.tmp.lockFaceDown) ? null : 'aucune carte adverse face cachée'),
    run: async (g, pid, c) => g.activate(pid, c, 'Big Amnésia', async () => {
      const cands = [...g.p(opp(pid)).arena, ...g.p(opp(pid)).supports].filter(x => x.faceDown && !x.tmp.lockFaceDown);
      const t = await g.chooseCard(pid, 'target', 'Carte face cachée qui ne se relèvera pas', cands);
      if (t) { t.tmp.lockFaceDown = true; g.log(`${g.label(t)} ne se relèvera pas au prochain Crépuscule adverse.`, pid); }
    }) },
  FANBOY: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (g.targetCandidates(pid).length ? null : 'aucune cible adverse'),
    run: async (g, pid, c) => g.activate(pid, c, 'La corde autour du cou', async () => {
      const t = await g.target(pid, g.visibleArena(opp(pid)), 'Perso adverse à surveiller');
      if (t) { t.tmp.fanboyBy = pid; g.log(`${g.label(t)} ne peut plus se renvoyer, s’exiler ni se retourner par sa capacité.`, pid); }
    }) },
  VIOLETTA: { window: 'crepuscule', once: 'night', selfMove: true,
    blocked: (g, pid) => (g.p(opp(pid)).reserve.length ? null : 'la Réserve adverse est vide'),
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Nuée de pétales', async () => {
        const t = await g.target(pid, g.p(opp(pid)).reserve, "Perso adverse de la Réserve (+1 d'Aura cette nuit)");
        if (t) { t.tmp.nightAura = (t.tmp.nightAura || 0) + 1; g.log(`${g.label(t)} reçoit +1 d'Aura tant qu'il reste dans la Réserve.`, pid); }
      });
    } },
  AUSTIN: { window: 'crepuscule', once: 'night', selfMove: true,
    blocked: (g, pid) => (g.p(pid).reserve.some(x => !x.faceDown && g.aura(x) <= g.s.night + 1) ? null : 'aucun Perso éligible dans la Réserve'),
    run: async (g, pid, c) => {
      const cands = g.p(pid).reserve.filter(x => !x.faceDown && g.aura(x) <= g.s.night + 1);
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Mojo', async () => {
        const pick = await g.chooseCard(pid, 'teleport', "Perso qui entre dans l'Arène", cands.filter(x => x.zone === 'reserve'));
        if (!pick) return;
        await g.enterArena(pid, [pick]);
        if (pick.zone === 'arena') { pick.tmp.notInControl = true; pick.tmp.ownLocked = true; }
      });
    } },
  DEBORDMAN: { window: 'crepuscule', once: 'night', selfMove: true,
    run: async (g, pid, c) => {
      g.exile(c, null, { self: true });
      await g.activate(pid, c, 'Vous êtes pas prêts !', () => {
        g.s.crepDone = { enter: false, support: false };
        g.log("Vous pouvez refaire « Entrer dans l'Arène » et « Soutenir ».", pid);
      });
    } },
  FRERES: { window: 'finBaston', once: 'night',
    blocked: (g, pid) => provocBlocked(g, pid),
    run: async (g, pid, c) => g.activate(pid, c, 'Soif de carnage !', () => provoc(g, pid)) },
};

function fireMates(g, pid, self) {
  return g.visibleArena(pid).filter(x => x !== self && !g.fanboyLocked(x) && g.hasKw(x, 'FEU') && g.def(x).cls === 'VOYAGEUR');
}
function teleportCands(g, pid) {
  const p = g.p(pid);
  // Aura ≤ 2, ou ≤ numéro de la nuit pour un Perso « Indomptables » (Team Puissance des Indomptables)
  return [...p.reserve, ...p.groupe].filter(x => !x.faceDown
    && (g.def(x).aura <= 2 || (g.hasKw(x, 'INDOMPTABLES') && g.def(x).aura <= g.s.night)));
}
function unactivated(g, pid) { return g.ownKicks(pid).filter(k => !k.activated).length; }

export const SUPPORT_ACTIONS = {
  BAGUE_FEU: { window: 'combat', once: 'night',
    can: (g, pid) => g.hasKw(g.fighter(pid), 'FEU'),
    blocked: (g, pid) => (kwKicks(g, pid, 'FEU').length ? null : 'aucun Kick « Feu » posé'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Bague de feu', () => boostOne(g, pid, kwKicks(g, pid, 'FEU'), 1, 'Kick « Feu » qui reçoit +1'));
    } },
  DEBARRASSER: { window: 'combat', once: 'night',
    can: (g, pid) => g.hasKw(g.fighter(pid), 'V.NOIRS'),
    blocked: (g, pid) => (!g.ownKicks(opp(pid)).length ? 'aucun Kick adverse posé' : unactivated(g, pid) === 0 ? 'aucun de vos Kicks sans capacité activée' : null),
    run: async (g, pid, c) => g.activate(pid, c, 'Se débarrasser des inutiles', async () => {
      const x = unactivated(g, pid);
      const k = await g.target(pid, g.ownKicks(opp(pid)), `Kick adverse qui reçoit −${x}`);
      if (k && x) g.addMarker(k, -x, pid);
    }) },
  NATHALIE: { window: 'combat', once: 'night',
    can: (g, pid) => g.fighter(pid)?.id === 'ARKA',
    blocked: (g, pid) => {
      const os = g.side(opp(pid));
      return !g.def(g.fighter(opp(pid))).combo ? 'le combattant adverse n’a pas de Combo' : os.comboActive ? 'le Combo adverse est déjà activé' : os.comboBlocked ? 'déjà bloqué' : null;
    },
    run: async (g, pid, c) => {
      g.discard(c);
      // R66 : seul le texte de la capacité de Combo est bloqué, pas son bonus de Force
      await g.activate(pid, c, 'Nathalie', () => { g.side(opp(pid)).comboBlocked = true; g.log('La capacité de Combo adverse ne peut pas s’activer.', pid); });
    } },
  ANGELITO: { window: 'combatStart', once: 'night',
    can: (g, pid) => g.fighter(pid)?.id === 'SACHA',
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Angélito', async () => {
        g.side(pid).effects.push({ kws: ['TRANCHANT', 'VIDE'], v: 1, label: 'Angélito' });
        const cur = g.fighter(opp(pid));
        const others = g.targetCandidates(pid).filter(x => x !== cur);
        const t = others.length ? await g.target(pid, others, 'Nouveau combattant adverse (optionnel)', { optional: true }) : null;
        if (t && t.zone === 'arena') {
          const sd = g.side(opp(pid));
          sd.fighter = t.uid;
          sd.max = g.aura(t);
          g.p(opp(pid)).fought.add(t.uid);
          g.log(`${g.label(t)} devient le combattant adverse.`, pid);
        }
      });
    } },
  MALICE: { window: 'combatStart', once: 'night',
    can: (g, pid) => g.visibleArena(pid).some(x => g.hasKw(x, 'CORBEAU')),
    blocked: (g, pid) => (maliceCands(g, pid).length ? null : 'aucun Perso éligible pour l’échange'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Malice du corbeau', async () => {
        const t = await g.chooseCard(pid, 'malice', 'Votre nouveau combattant', maliceCands(g, pid));
        if (!t) return;
        const sd = g.side(pid);
        sd.fighter = t.uid;
        sd.max = g.aura(t);
        g.p(pid).fought.add(t.uid);
        g.log(`${g.label(t)} devient votre combattant.`, pid);
      });
    } },
  DANSE_KILL: { window: 'combat', once: 'night',
    can: (g, pid) => g.hasKw(g.fighter(pid), 'KILL STARS'),
    blocked: (g, pid) => (g.visibleArena(pid).some(x => !g.isFighter(x) && g.hasKw(x, 'KILL STARS')) ? null : 'aucun autre Perso « Kill stars »'),
    run: async (g, pid, c) => g.activate(pid, c, 'Danse des Kill stars', () => {
      const kws = new Set();
      g.visibleArena(pid).filter(x => !g.isFighter(x) && g.hasKw(x, 'KILL STARS')).forEach(x => g.keywords(x).forEach(k => kws.add(k)));
      g.side(pid).extraKw = [...kws];
      g.log(`Votre combattant reçoit : ${[...kws].map(k => k.toLowerCase()).join(', ')}.`, pid);
    }) },
  MUR_FORCE: { window: 'finCombat', once: null,
    can: (g, pid) => g.hasKw(g.fighter(pid), 'TITAN'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Mur de force', () => { const n = g.draw(pid, g.aura(g.fighter(pid))); g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid); });
    } },
  COURAGE: { window: 'finBaston', once: 'night',
    blocked: (g, pid) => provocBlocked(g, pid),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Courage de taille', () => provoc(g, pid));
    } },
  TEMPO: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (g.visibleArena(pid).length ? null : 'aucun Perso visible dans l’Arène'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Tempo Temperus', async () => {
        const t = await g.chooseCard(pid, 'protect', 'Perso à protéger cette nuit', g.visibleArena(pid));
        if (t) { t.tmp.protected = true; g.log(`${g.label(t)} est protégé jusqu'à la fin de la nuit.`, pid); }
      });
    } },
  IMPERIAL_VEGA: { window: 'crepuscule', once: 'night',
    can: (g, pid) => [...g.p(pid).arena, ...g.p(pid).reserve].some(x => x.id === 'ACTARUS'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Imperial Vega', () => {
        g.visibleArena(pid).forEach(x => (x.tmp.nightKw = [...(x.tmp.nightKw ?? []), 'FOUDRE']));
        g.log('Vos Persos de l’Arène sont « Foudre » cette nuit.', pid);
      });
    } },
  CITY_VOLT: { window: 'crepuscule', once: 'night',
    blocked: (g, pid) => (cityVoltCands(g, pid).length ? null : 'aucun Perso adverse éligible'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Ingénierie de City Volt', async () => {
        const t = await g.target(pid, cityVoltCands(g, pid), 'Perso adverse qui ne pourra pas combattre cette nuit');
        if (t) { t.tmp.cannotFight = true; g.log(`${g.label(t)} ne peut pas combattre cette nuit.`, pid); }
      });
    } },
  JAI_FROID: { window: 'aurore', once: 'night',
    can: (g, pid) => g.visibleArena(pid).filter(x => g.hasKw(x, 'GLACE')).length >= 2,
    blocked: (g, pid) => (g.visibleArena(opp(pid)).length ? null : 'aucun Perso adverse visible'),
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, "J'ai froid", async () => {
        const t = await g.target(pid, g.visibleArena(opp(pid)), "Perso adverse qui reçoit −2 d'Aura");
        if (t) { t.tmp.nightAura = (t.tmp.nightAura || 0) - 2; g.log(`${g.label(t)} reçoit −2 d'Aura cette nuit.`, pid); }
      });
    } },
  REJOINS: { window: 'finNuit', once: 'night',
    run: async (g, pid, c) => {
      g.discard(c);
      await g.activate(pid, c, 'Rejoins-nous !', async () => {
        const p = g.p(pid);
        if (p.groupe.length >= 4) {
          // Règle « Entrer dans l'Arène » : Aura ≤ numéro de la nuit, la carte ne dit pas le contraire
          const pick = await g.chooseCard(pid, 'teleport', `Perso de la Réserve (Aura ≤ ${g.s.night}) qui entre dans l'Arène`, p.reserve.filter(c => !c.faceDown && g.aura(c) <= g.s.night), { optional: true });
          if (pick) await g.enterArena(pid, [pick]);
        } else { p.drawTo8 = true; g.log('Votre prochaine pioche obligatoire ira jusqu’à 8 cartes.', pid); }
      });
    } },
};

function maliceCands(g, pid) {
  const of = g.fighter(opp(pid));
  const max = of ? g.aura(of) : 0;
  if (g.fanboyLocked(g.fighter(pid))) return [];
  return g.visibleArena(pid).filter(x => !g.isFighter(x) && !g.fanboyLocked(x) && g.aura(x) >= 2 && g.aura(x) <= max);
}
function cityVoltCands(g, pid) {
  const n = g.visibleArena(pid).filter(x => g.hasKw(x, 'FOUDRE')).length;
  return g.visibleArena(opp(pid)).filter(x => g.aura(x) <= n);
}

// ── Lieux (par effet) ────────────────────────────────────────
// `can` : précondition du texte ; `blocked` : raison d'impuissance ; `cost` : coût payé avant la partie
// contrable (R49/R55) — `ctx` est transmis à `run`. Puzzle Village (Crâne) est entièrement contrable.
const lookTop = async (g, pid, n) => {
  const p = g.p(pid);
  const top = p.songe.slice(-n).reverse();
  for (const c of top) {
    const ans = await g.chooseOption(pid, 'topBottom', `${g.label(c)} : où la remettre dans votre Songe ?`, [
      { id: 'top', label: 'Au-dessus du Songe (vous la piocherez bientôt)', card: c }, { id: 'bottom', label: 'En dessous du Songe (elle s’éloigne)', card: c }]);
    if (ans === 'bottom') { p.songe.splice(p.songe.indexOf(c), 1); p.songe.unshift(c); }
    g.log(`${g.pname(pid)} remet une carte ${ans === 'bottom' ? 'en dessous' : 'au-dessus'} de son Songe.`, pid);
  }
};
const fought = (g, pid) => g.visibleArena(pid).filter(c => g.p(pid).fought.has(c.uid));
const need = (cond, why) => (cond ? null : why);

export const LIEU_ACTIONS = {
  DELIRIUM: [
    { run: (g, pid) => { const n = g.draw(pid, 2); g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid); } },
    { blocked: (g, pid) => need(g.p(pid).hand.length, 'aucune carte à défausser') ?? need(g.p(pid).fosse.length, 'la Fosse est vide'),
      cost: async (g, pid, ctx) => {
        ctx.out = await g.chooseCard(pid, 'discardOwn', 'Carte à défausser', g.p(pid).hand);
        if (ctx.out) { g.discard(ctx.out); g.log(`${g.pname(pid)} défausse ${g.label(ctx.out)}.`, pid); }
      },
      run: async (g, pid, ctx) => {
        if (!ctx.out) return;
        // La carte qui vient d'être défaussée ne peut pas être récupérée
        const pick = await g.chooseCard(pid, 'fromFosse', 'Carte à récupérer dans la Fosse', g.p(pid).fosse.filter(c => c !== ctx.out));
        if (pick) { g.put(pick, 'hand'); g.log(`${g.pname(pid)} récupère ${g.label(pick)}.`, pid); }
      } },
    { blocked: (g, pid) => need(g.p(pid).songe.length, 'le Songe est vide'), run: (g, pid) => lookTop(g, pid, 2) },
  ],
  DEESSES: [
    { blocked: (g, pid) => need(g.p(pid).groupe.length, 'le Groupe est vide'), run: (g, pid) => g.recruit(pid) },
    { blocked: (g, pid) => need(g.p(pid).songe.some(c => g.def(c).type === 'S'), 'aucun Soutien dans le Songe'),
      run: (g, pid) => g.searchSonge(pid, d => d.type === 'S', 'Soutien à prendre') },
    { blocked: (g, pid) => need(g.p(pid).groupe.some(c => g.def(c).aura <= 2), 'aucun Perso d’Aura ≤ 2 dans le Groupe'),
      run: async (g, pid) => {
        const pick = await g.chooseCard(pid, 'recruitPick', "Perso d'Aura ≤ 2 à recruter", g.p(pid).groupe.filter(c => g.def(c).aura <= 2));
        if (pick) g.recruit(pid, pick);
      } },
  ],
  CRANE: [
    { run: (g, pid) => g.draw(pid, 1) },
    { can: (g, pid) => g.ownKicks(pid).every(k => !k.markers.length),
      blocked: (g, pid) => need(nonBaseKicks(g, pid).length, 'aucun Kick non « Base » posé'),
      run: async (g, pid) => {
        const k = await g.chooseCard(pid, 'boostOwn', 'Kick non « Base » qui reçoit +1', nonBaseKicks(g, pid));
        if (k) g.addMarker(k, 1, pid);
      } },
    { blocked: (g, pid) => need(g.p(pid).reserve.length, 'la Réserve est vide'),
      run: async (g, pid) => {
        const c = await g.chooseCard(pid, 'recycle', 'Perso de la Réserve à renvoyer sous le Groupe', g.p(pid).reserve);
        if (!c) return;
        const a = g.def(c).aura;
        g.underGroupe(c, null);
        const n = g.draw(pid, a);
        g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid);
      } },
  ],
  PLAINES: [
    { blocked: (g, pid) => need(fought(g, pid).length, 'aucun de vos Persos n’a combattu cette nuit'),
      run: async (g, pid) => {
        const t = await g.chooseCard(pid, 'auraBoost', "Perso qui reçoit +1 d'Aura cette nuit", fought(g, pid));
        if (t) { t.tmp.nightAura = (t.tmp.nightAura || 0) + 1; g.log(`${g.label(t)} reçoit +1 d'Aura cette nuit.`, pid); }
      } },
    { blocked: (g, pid) => need(g.p(pid).songe.length, 'le Songe est vide'), run: (g, pid) => g.searchSonge(pid, () => true, 'Carte à prendre dans le Songe') },
    { blocked: (g, pid) => need(g.p(pid).groupe.length, 'le Groupe est vide'),
      run: async (g, pid) => {
        const p = g.p(pid), top = p.groupe[p.groupe.length - 1];
        const ans = await g.chooseOption(pid, 'topBottomGroupe', `1ʳᵉ carte de votre Groupe : ${g.label(top)}. Où la mettre ?`, [
          { id: 'top', label: 'La laisser au-dessus du Groupe (recrutée au prochain Crépuscule)', card: top },
          { id: 'bottom', label: 'La mettre en dessous du Groupe', card: top }]);
        if (ans === 'bottom') { p.groupe.pop(); p.groupe.unshift(top); }
        g.log(`${g.label(top)} ${ans === 'bottom' ? 'passe en dessous du' : 'reste au-dessus du'} Groupe.`, pid,
          { to: pid, masked: `La 1ʳᵉ carte du Groupe de ${g.pname(pid)} ${ans === 'bottom' ? 'passe en dessous' : 'reste au-dessus'}.` });
      } },
  ],
};

/** Jung : quand une capacité de Lieu est activée, il peut la copier (coût inclus). */
async function afterLieu(g, effect, idx) {
  for (const q of [0, 1]) {
    const jung = g.p(q).arena.find(c => c.id === 'JUNG' && g.persoCanAct(c) && !g.fanboyLocked(c));
    if (!jung || g.usedTonight(q, 'Cartographe onirique')) continue;
    const spec = LIEU_ACTIONS[effect][idx];
    if ((spec.can && !spec.can(g, q)) || spec.blocked?.(g, q)) continue;
    const text = Object.values(LIEUX).find(l => l.effect === effect)?.abilities[idx]?.text ?? '';
    const ans = await g.chooseOption(q, 'jung', `Jung : copier « ${text} » (il retourne sous le Groupe) ?`,
      [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }], { effect, idx });
    if (ans !== 'yes') continue;
    g.markUsed(q, 'Cartographe onirique');
    g.underGroupe(jung, null);
    const ctx = {};
    await spec.cost?.(g, q, ctx);
    await g.activate(q, jung, 'Cartographe onirique', () => spec.run(g, q, ctx));
  }
}

/** Liste des actions disponibles pour `pid` dans la fenêtre `win`. Chaque entrée : { label, card, blocked, run }. */
export function actionsFor(g, pid, win) {
  const p = g.p(pid), out = [];
  const combat = g.s.combat;
  if (IN_COMBAT.includes(win) && !combat?.sides[pid]) return out;
  const inWin = spec => [].concat(spec.window).includes(win);
  const onceOk = (spec, card) => {
    const key = g.def(card).sub || g.def(card).name;
    if (spec.once === 'night' && g.usedTonight(pid, key)) return false;
    if (spec.once === 'combat' && combat?.usedCombat.has(`${pid}:${key}`)) return false;
    return true;
  };
  const wrap = (spec, card) => {
    const why = spec.blocked?.(g, pid, card) ?? null;
    return {
      label: `${g.def(card).name} — ${g.def(card).sub || 'activer'}${why ? ` — impossible : ${why}` : ''}`, card, blocked: !!why,
      run: async () => {
        const key = g.def(card).sub || g.def(card).name;
        if (spec.once === 'night') g.markUsed(pid, key);
        if (spec.once === 'combat') combat.usedCombat.add(`${pid}:${key}`);
        await spec.run(g, pid, card);
      },
    };
  };
  for (const c of p.arena) {
    const spec = PERSO_ACTIONS[c.id];
    if (!spec || !inWin(spec) || !g.persoCanAct(c) || !onceOk(spec, c)) continue;
    if (win === 'crepuscule' && g.s.active !== pid) continue;
    if (spec.selfMove && g.fanboyLocked(c)) continue;
    if (spec.can && !spec.can(g, pid, c)) continue;
    out.push(wrap(spec, c));
  }
  const seen = new Set();
  for (const c of g.visibleSupports(pid)) {
    const spec = SUPPORT_ACTIONS[c.id];
    if (!spec || !inWin(spec) || seen.has(c.id) || !onceOk(spec, c)) continue;
    if (c.byEffectNight === g.s.night) continue; // posé par un effet : inactivable cette nuit
    if (win === 'crepuscule' && g.s.active !== pid) continue;
    if (spec.can && !spec.can(g, pid, c)) continue;
    seen.add(c.id);
    out.push(wrap(spec, c));
  }
  // Dolche : la carte posée face cachée peut être révélée pendant le combat (R57)
  const hidden = combat?.sides[pid]?.hidden;
  if (hidden && win === 'combat')
    out.push({
      label: `Révéler la carte cachée (${g.label(hidden)})`, card: hidden, reveal: true,
      run: async () => {
        g.log(`${g.pname(pid)} révèle ${g.label(hidden)}.`, pid);
        if (g.def(hidden).type === 'K') await g.poseKick(pid, hidden, { reveal: true });
        else await g.poseSupport(pid, hidden, { byEffect: true });
      },
    });
  // Lieu : une capacité par nuit, chacune une fois par partie
  const lieu = g.lieu(pid);
  if (!p.lieuUsedNight) {
    lieu.abilities.forEach((ab, i) => {
      if (p.lieuUsed[i] || ab.when !== win) return;
      if (win === 'crepuscule' && g.s.active !== pid) return;
      const spec = LIEU_ACTIONS[lieu.effect][i];
      if (spec.can && !spec.can(g, pid)) return;
      const why = spec.blocked?.(g, pid) ?? null;
      out.push({
        label: `${lieu.name} — ${ab.text}${why ? ` — impossible : ${why}` : ''}`, lieu: true, lieuIndex: i, blocked: !!why,
        run: async () => {
          p.lieuUsed[i] = true;
          p.lieuUsedNight = true;
          const ctx = {};
          await spec.cost?.(g, pid, ctx);
          const ok = await g.activate(pid, null, `${lieu.name} (capacité ${i + 1})`, () => spec.run(g, pid, ctx));
          if (ok) await afterLieu(g, lieu.effect, i);
        },
      });
    });
  }
  return out;
}

// ── Déclencheurs ─────────────────────────────────────────────
export async function onEnter(g, pid, c) {
  switch (c.id) {
    case 'SONIC1':
      await g.activate(pid, c, 'Même pas mal', () => { c.tmp.inciblable = true; g.log('Sonic devient inciblable.', pid); });
      break;
    case 'RAFAELO': case 'YOUNG_INF':
      // R51 : un effet (pas une capacité) — ni contrable ni limité
      g.gainGold(pid, 1);
      break;
    case 'DJKILLA2': {
      const n = g.lieuActivated(pid);
      if (n) await g.activate(pid, c, 'Mange pierre', () => { g.draw(pid, n); g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid); });
      break;
    }
    case 'ALANA1': {
      const mine = [...g.visibleArena(pid), ...g.visibleSupports(pid)].filter(x => x !== c);
      const t = mine.length ? await g.chooseCard(pid, 'alanaFlip', 'Cache cache : retourner une de vos cartes face cachée ?', mine, { optional: true }) : null;
      if (t) await g.activate(pid, c, 'Cache cache', () => g.flipDown(t));
      break;
    }
  }
}

export async function onSupportPosed(g, pid, c) {
  const team = TEAMS[c.id];
  // R51 : la phrase « Team » est un effet, pas une capacité
  if (team && !g.p(pid).teams.has(team.kw)) {
    g.p(pid).teams.add(team.kw);
    g.log(`Vos Persos ${team.names ? team.names.join(', ') : 'voyageurs « Glace »'} deviennent « ${team.kw.toLowerCase()} ».`, pid);
  }
}

/** Après la pose d'un Kick (déclencheurs indépendants de sa propre capacité). */
export async function afterKickPosed(g, pid, k, star = k.zone === 'kicks' && k.rang === '★') {
  const c = g.s.combat;
  if (c && star && g.hasKw(g.fighter(pid), 'LUCKY STARS') && g.hasSupport(pid, 'FOUTEURS') && !c.usedCombat.has(`fouteurs${pid}`)) {
    c.usedCombat.add(`fouteurs${pid}`);
    await g.activate(pid, g.hasSupport(pid, 'FOUTEURS'), 'Fouteurs de merde', () => fouteursRoll(g, pid));
  }
}

/**
 * Envie de sang (R68) : liste des marqueurs copiables. Si Envie est le dernier Kick posable, Étalé en un
 * coup s'éteint : les deux effets sont simultanés, le joueur choisit l'ordre quand cela change la liste (8.4).
 */
async function envieList(g, pid, k) {
  const sd = g.side(pid);
  const now = g.copyableMarkers(k);
  sd.realPosed--;
  const before = g.copyableMarkers(k);
  sd.realPosed++;
  const key = l => l.map(m => `${m.kick.uid}:${m.v}:${m.label}`).join('|');
  if (key(now) === key(before)) return now;
  const ans = await g.chooseOption(pid, 'envieOrder', 'Envie de sang et Étalé en un coup sont simultanés : lequel d’abord ?', [
    { id: 'envie', label: 'Envie de sang d’abord (Étalé encore actif)' }, { id: 'etale', label: 'Étalé d’abord (il s’éteint)' }]);
  return ans === 'etale' ? now : before;
}

export async function onKickPosed(g, pid, k) {
  const o = opp(pid), last = g.lastKick(o), sd = g.side(pid), os = g.side(o);
  switch (k.id) {
    case 'PICS': {
      const ans = await g.chooseOption(pid, 'pics', 'Projection de pics', [
        { id: 'draw', label: "L'adversaire ne peut plus piocher" },
        { id: 'discard', label: "L'adversaire ne peut plus vous faire défausser" }]);
      if (ans === 'draw') os.noDraw = true; else sd.noDiscardByOpp = true;
      break;
    }
    case 'BIG_NOVA': g.s.combat.restrict[o] = true; g.log("L'adversaire ne peut plus activer ses Persos non combattants.", pid); break;
    case 'COUP_TRAITRE': if (last) { const t = await g.target(pid, [last], 'Dernier Kick adverse'); if (t) { t.base = 0; g.log(`${g.label(t)} a une Force de base de 0.`, pid); } } break;
    case 'SANS_PITIE': if (last) { const t = await g.target(pid, [last], 'Dernier Kick adverse'); if (t) { t.rang = 'S'; g.log(`${g.label(t)} devient de Rang S.`, pid); } } break;
    case 'INTRUSION': {
      const cands = g.ownKicks(o).filter(x => x.markers.length);
      const t = cands.length ? await g.target(pid, cands, 'Kick adverse dont retirer un marqueur', { optional: true }) : null;
      if (t && t.markers.length) {
        t.markers.sort((a, b) => b.v - a.v);
        const m = t.markers.shift();
        g.log(`${g.label(t)} perd un marqueur [${m.v > 0 ? '+' : ''}${m.v}].`, pid);
      }
      break;
    }
    case 'BLESSURE': await g.forceDiscard(o); break;
    case 'ENVOL': {
      const t = await g.target(pid, g.visibleSupports(o), 'Soutien adverse à retourner');
      if (t) g.flipDown(t);
      break;
    }
    case 'DANSE_VENTS': {
      const pick = await g.chooseCard(pid, 'fromFosse', 'Carte à récupérer dans votre Fosse', g.p(pid).fosse);
      if (pick) { g.put(pick, 'hand'); g.log(`${g.pname(pid)} récupère ${g.label(pick)}.`, pid); }
      break;
    }
    case 'FORCE_ENFOUIE':
      if (g.aura(g.fighter(pid)) < g.aura(g.fighter(o))) g.addMarker(k, 3, pid);
      break;
    case 'PAS_VU_VENIR': g.gainFame(o, -1, "Il l'a pas vu venir"); break;
    case 'SAUVE': k.armed = true; break;
    case 'ATT_FOUDROYANTE': if (g.ownKicks(o).length) await boostOne(g, pid, g.ownKicks(o), -2, 'Kick adverse qui reçoit −2'); break;
    case 'ELECTRO_CHOC': {
      const key = `electro${pid}`;
      if (g.s.combat.usedCombat.has(key) || !g.p(o).reserve.length) break;
      g.s.combat.usedCombat.add(key);
      const c = await g.chooseCard(o, 'reserveToBottom', 'Electro choc : carte de votre Réserve à renvoyer dans le Groupe', g.p(o).reserve);
      if (!c) break;
      const pos = await g.chooseOption(o, 'groupePos', 'Au-dessus ou en dessous du Groupe ?', [{ id: 'top', label: 'Au-dessus' }, { id: 'bottom', label: 'En dessous' }]);
      g.put(c, 'groupe', { bottom: pos === 'bottom' });
      g.log(`${g.label(c)} retourne ${pos === 'bottom' ? 'sous' : 'sur'} le Groupe.`, o);
      break;
    }
    case 'REFLEXE': os.silenceNext += 1; g.log("Le prochain Kick adverse n'activera pas sa capacité.", pid); break;
    case 'NEGOCIATION': {
      const ans = await g.acceptRefuse(pid, 'Négociation féroce', 'son prochain Kick posé perd son texte', 'il devra Refuser à votre prochaine carte « Félin »', felinValues(g, pid, k));
      if (ans !== 'refuse') os.silenceNext += 1;
      if (ans !== 'accept') g.p(pid).oppMustRefuse = true;
      break;
    }
    case 'CROCS': {
      const ans = await g.acceptRefuse(pid, 'Crocs saillants', 'ce Kick reçoit +2', 'son prochain Kick posé a une Force de base de 0', felinValues(g, pid, k));
      if (ans !== 'refuse') g.addMarker(k, 2, pid);
      if (ans !== 'accept') os.nextBase = 0;
      break;
    }
    case 'TAILLADE': g.addMarker(k, 2, pid); break;
    case 'COUPER_COURT': {
      const t = await g.target(pid, g.visibleSupports(o), 'Soutien adverse à défausser');
      if (t) { g.discard(t); g.log(`${g.label(t)} est défaussé.`, pid); }
      break;
    }
    case 'KANINE':
      await g.forceDiscard(o);
      if (g.ownKicks(o).length) await boostOne(g, pid, g.ownKicks(o), -1, 'Kick adverse qui reçoit −1');
      break;
    case 'MOUSTIK': await g.forceDiscard(o); g.addMarker(k, 1, pid); break;
    case 'NADINE': { const x = Math.min(3, g.aura(g.fighter(o))); if (x) g.addMarker(k, x, pid); break; }
    case 'SUCETTE': {
      const prev = sd.kicks[sd.kicks.indexOf(k) - 1];
      if (!prev) break;
      const kw = g.def(prev).kw;
      // Chaque mot-clé du Kick précédent déclenche son effet (un Kick « Feu » et « Motif » donne les deux)
      if (kw.includes('FEU') || kw.includes('POISSON')) g.addMarker(k, 1, pid);
      if (kw.includes('MOTIF') || kw.includes('ART')) sd.kicks.filter(x => x.rang === 'B').forEach(x => g.addMarker(x, 1, pid));
      if (kw.includes('LUCKY STARS') && g.hasSupport(pid, 'FOUTEURS')) await fouteursRoll(g, pid);
      break;
    }
    case 'TOMBE_PIC': {
      const ok = d => d.type === 'K' && ['FEU', 'POISSON', 'MOTIF', 'ART'].some(w => d.kw.includes(w));
      if (!g.p(pid).songe.some(x => ok(g.def(x)))) break;
      if (!(await yesNo(g, pid, 'tombePic', 'Tombé à pic : défausser ce Kick pour en poser un autre depuis le Songe ?'))) break;
      g.discard(k);
      sd.realPosed--;
      const pick = await g.chooseCard(pid, 'search', 'Kick à poser', [...new Map(g.p(pid).songe.filter(x => ok(g.def(x))).map(x => [x.id, x])).values()]);
      g.shuffle(g.p(pid).songe);
      if (pick) await g.poseKick(pid, pick);
      break;
    }
    case 'TELLURIQUE': { const x = g.lieuActivated(pid); if (x) g.addMarker(k, x, pid); break; }
    case 'PLAN': { const n = g.draw(pid, 2); g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid); break; }
    case 'FUITE': await lookTop(g, pid, 5); break;
    case 'DEVIATION': {
      const t = g.ownKicks(o).length ? await g.target(pid, g.ownKicks(o), 'Kick adverse : son Rang subira −1') : null;
      if (t?.rang) { k.devRank = t.rang; g.log(`Les Kicks adverses de Rang ${t.rang} reçoivent −1.`, pid); }
      break;
    }
    case 'TYMPANS': {
      if (!last) break;
      const t = await g.target(pid, [last], 'Dernier Kick adverse');
      if (t) { t.rang = await g.chooseRank(pid, `Nouveau Rang de ${g.label(t)}`, t.rang, t); g.log(`${g.label(t)} devient de Rang ${t.rang}.`, pid); }
      break;
    }
    case 'VIRTUOSITE': k.virtRank = await g.chooseRank(pid, 'Virtuosité : Rang qui reçoit +2'); g.log(`Vos Kicks de Rang ${k.virtRank} reçoivent +2.`, pid); break;
    case 'TRAVAIL': { const x = Math.min(3, g.visibleArena(pid).filter(c => g.hasKw(c, 'KILL STARS')).length); if (x) g.addMarker(k, x, pid); break; }
    case 'VIOLENCE': {
      const top = g.p(pid).songe[g.p(pid).songe.length - 1];
      if (!top) break;
      const x = g.def(top).force ?? 0;
      g.log(`${g.pname(pid)} révèle ${g.label(top)} (${x}).`, pid);
      if (x) g.addMarker(k, x, pid);
      break;
    }
    case 'ENVIE_SANG': {
      // R68 : tout marqueur [+X] du texte officiel (posé ou continu), copié à sa valeur du moment
      const list = await envieList(g, pid, k);
      if (!list.length) break;
      const sign = v => (v > 0 ? `+${v}` : `${v}`);
      const ans = await g.chooseOption(pid, 'envieSang', 'Envie de sang : marqueur à copier', list.map((m, i) => ({
        id: String(i), value: m.v, card: m.kick,
        label: `[${sign(m.v)}] ${m.label === 'posé' ? 'marqueur posé' : m.label} — sur ${g.label(m.kick)}` })));
      const pick = list[+ans];
      if (pick) { g.addMarker(k, pick.v, pid); g.log(`Envie de sang copie le marqueur [${sign(pick.v)}] de ${g.label(pick.kick)}.`, pid); }
      break;
    }
    case 'PATATE': sd.nextBase = 4; g.log('Votre prochain Kick aura une Force de base de 4.', pid); break;
    case 'PARTAGE': {
      const f = g.fighter(pid);
      f.tmp.nightKw = [...(f.tmp.nightKw ?? []), 'FEU'];
      g.log(`${g.label(f)} est « Feu » cette nuit.`, pid);
      break;
    }
  }
}

export const COMBO_CAPS = {
  CHARLY2: async (g, pid) => {
    const t = await g.target(pid, g.visibleSupports(opp(pid)), 'Soutien adverse à défausser');
    if (t) { g.discard(t); g.log(`${g.label(t)} est défaussé.`, pid); }
  },
  ZERO2: (g, pid) => { g.side(opp(pid)).puissanceMod -= 1; g.log('Le combattant adverse reçoit −1 de Puissance.', pid); },
  ZERO3: (g, pid) => { g.side(opp(pid)).puissanceMod -= 2; g.log('Le combattant adverse reçoit −2 de Puissance.', pid); },
  SHUN2: async (g, pid) => {
    const t = await g.target(pid, g.ownKicks(opp(pid)).filter(k => k.rang === 'B' || k.rang === 'M'), 'Kick adverse B ou M à annuler');
    if (t) { t.base = 0; g.log(`${g.label(t)} a une Force de base de 0.`, pid); }
  },
  SHUN3: async (g, pid) => {
    const last = g.lastKick(opp(pid));
    const t = last ? await g.target(pid, [last], 'Dernier Kick adverse') : null;
    if (t) { t.base = 0; t.rang = null; g.log(`${g.label(t)} perd son Rang et sa Force de base.`, pid); }
  },
  PREVICE: (g, pid) => {
    const ks = g.ownKicks(opp(pid)).filter(k => !g.isInciblable(k, pid));
    ks.forEach(k => { k.base = 0; });
    pingPiege(g, opp(pid), ks.length);
    g.log('Les Kicks adverses ciblés ont une Force de base de 0.', pid);
  },
  TORO: (g, pid) => {
    const f = g.fighter(opp(pid));
    f.tmp.notInControl = true;
    if (['SEIGNEUR', 'KAISER', 'DUC'].some(k => g.hasKw(f, k))) { g.side(pid).comboOverride = 10; g.log('Bonus Combo de Toro Picana : +10 !', pid); }
    g.log(`${g.label(f)} ne compte pas dans le Contrôle cette nuit.`, pid);
  },
  ROI_FURY: (g, pid) => { g.side(pid).roiFury = true; },
  JERZEY2: (g, pid) => { g.recruit(pid); g.draw(pid, 1); g.log(`${g.pname(pid)} pioche une carte.`, pid); },
  INNA: async (g, pid) => {
    const o = opp(pid);
    const c = await g.chooseCard(o, 'reserveToBottom', 'Foudre noire : carte de votre Réserve à renvoyer sous le Groupe', g.p(o).reserve);
    if (c) g.underGroupe(c, pid);
  },
  MAGOSS: (g, pid) => {
    const f = g.fighter(opp(pid));
    f.tmp.larbin = true;
    g.p(opp(pid)).magossVictim = true;
    g.log(`${g.label(f)} devient « Larbin ».`, pid);
  },
  SATURN: async (g, pid) => {
    const cands = g.ownKicks(pid).filter(k => (g.kickHasKw(k, 'FÉLIN') || g.kickHasKw(k, 'TRANCHANT')) && g.def(k).abType === 'CAPACITÉ' && g.kickCondMet(k));
    if (!cands.length) return;
    g.s.combat.chooseFor = pid;
    await reactivate(g, pid, cands, 'Kick « Félin » ou « Tranchant » à réactiver');
    g.s.combat.chooseFor = null;
  },
  TERRENCE2: async (g, pid) => {
    const v = g.roll(pid, 'Cramage de gueule');
    if (v % 2 === 0) {
      const t = await g.target(pid, g.visibleSupports(opp(pid)), 'Soutien adverse à défausser');
      if (t) { g.discard(t); g.log(`${g.label(t)} est défaussé.`, pid); }
    } else { g.side(pid).comboExtra += 2; g.log('Bonus Combo +2.', pid); }
  },
  TERRENCE3: async (g, pid) => {
    const o = opp(pid), v = g.roll(pid, 'Méga cramage de gueule');
    const cands = [...g.visibleArena(o), ...g.p(o).reserve.filter(c => !c.faceDown)];
    const n = Math.min(v, cands.length);
    const out = await g.chooseCards(o, 'flipOwn', `Retournez face cachée ${n} de vos Persos en jeu (Arène ou Réserve)`, cands, n, n);
    out.forEach(c => g.flipDown(c));
  },
  SAVANE3: (g, pid) => { g.side(opp(pid)).silenceAll = true; g.log("Les prochains Kicks adverses n'activent plus leur capacité.", pid); },
  EVE3: async (g, pid) => {
    const exiled = g.p(pid).exil.filter(c => g.def(c).type === 'P' && g.def(c).kw.includes('MOTIF') && g.aura(c) <= g.s.night);
    const pick = await g.chooseCard(pid, 'teleport', "Perso « Motif » exilé qui entre dans l'Arène", exiled, { optional: true });
    if (pick) await g.enterArena(pid, [pick]);
  },
  AKIM: (g, pid) => { g.side(pid).akim = true; },
  HIKARI_RAIDEN: async (g, pid) => { if (g.ownKicks(opp(pid)).length) await boostOne(g, pid, g.ownKicks(opp(pid)), -2, 'Kick adverse qui reçoit −2'); },
  RAIDEN: async (g, pid) => {
    const cands = g.ownKicks(pid).filter(k => g.def(k).cond === 'Pose' && g.def(k).abType === 'CAPACITÉ' && g.kickCondMet(k));
    if (cands.length) await reactivate(g, pid, cands, 'Kick « Pose » à activer de nouveau');
  },
  FLAM3: (g, pid) => { g.side(opp(pid)).comboZero = true; g.log('Le bonus Combo adverse tombe à zéro.', pid); },
  MANIAC4: async (g, pid) => {
    const kw = await g.chooseOption(pid, 'maniacKw', 'Maniac 50 % : mot-clé dont les Kicks reçoivent +2', ['BRUTAL', 'SANG', 'INDOMPTABLES'].map(k => ({ id: k, label: k.toLowerCase() })));
    g.side(pid).effects.push({ kws: [kw], v: 2, label: 'Maniac 50 %' });
    g.log(`Vos Kicks « ${kw.toLowerCase()} » reçoivent +2.`, pid);
  },
  SONIC3: async (g, pid) => {
    const cands = allKicks(g).filter(k => k.markers.some(m => m.src === opp(pid)));
    const k = cands.length ? await g.target(pid, cands, 'Kick dont retirer les marqueurs adverses') : null;
    if (k) { k.markers = k.markers.filter(m => m.src !== opp(pid)); g.log(`${g.label(k)} perd ses marqueurs adverses.`, pid); }
  },
  DOLCHE: async (g, pid) => {
    const p = g.p(pid), sd = g.side(pid);
    const c = await g.chooseCard(pid, 'dolcheHide', 'Aura du corbeau : carte de votre Main à poser face cachée', p.hand, { optional: true });
    if (!c) return;
    g.remove(c);
    c.zone = 'hidden';
    sd.hidden = c;
    g.log(`${g.pname(pid)} pose une carte face cachée.`, pid);
  },
};

// ── Ciblage : Piège incendiaire et Huam ──────────────────────
function pingPiege(g, victim, n = 1) {
  if (!g.s.combat?.sides[victim]) return;
  for (const k of g.ownKicks(victim))
    if (k.id === 'PIEGE' && g.kickActive(k) && (k.piege || 0) < 3) {
      k.piege = Math.min(3, (k.piege || 0) + n);
      g.log(`Piège incendiaire se renforce (+${k.piege}).`, victim);
    }
}

export async function onTargeted(g, actor, t, valid) {
  const owner = t.owner;
  const huam = g.p(owner).arena.find(c => c.id === 'HUAM' && g.persoCanAct(c));
  if (huam && !g.usedTonight(owner, 'Retour de balançoire')) {
    const sameType = sameTypeCards(g, owner, t).filter(x => x !== t && valid.includes(x));
    if (sameType.length) {
      const pick = await g.chooseCard(owner, 'huam', `Huam : rediriger « ${g.label(t)} » vers une autre carte ?`, sameType, { optional: true, ctx: { original: t } });
      if (pick) {
        // R56 : la redirection est une réponse — elle ne passe pas par `activate` (aucune fenêtre de contre)
        g.markUsed(owner, 'Retour de balançoire');
        g.log(`${g.pname(owner)} active Retour de balançoire : la cible devient ${g.label(pick)}.`, owner);
        t = pick;
      }
    }
  }
  if (['arena', 'reserve', 'kicks', 'supports'].includes(t.zone)) pingPiege(g, owner);
  return t;
}

function sameTypeCards(g, owner, t) {
  const type = g.def(t).type;
  if (type === 'K') return g.ownKicks(owner);
  if (type === 'S') return g.visibleSupports(owner);
  if (t.zone === 'reserve') return g.p(owner).reserve;
  return g.visibleArena(owner).filter(c => !g.isFighter(c));
}

// ── Contres ──────────────────────────────────────────────────
export function counterOptions(g, pid, ev) {
  const out = [];
  const p = g.p(pid);
  const perso = (id, abil) => p.arena.find(c => c.id === id && g.persoCanAct(c) && !g.usedTonight(pid, abil) && !g.fanboyLocked(c));
  const add = (card, abil, label, pay, after) => out.push({ id: card.uid, card, label, after, pay: async () => { g.markUsed(pid, abil); await pay(); } });
  if (ev.kind === 'combo') {
    const n = perso('NEIL2', "Bouclier d'Aristote");
    if (n) add(n, "Bouclier d'Aristote", "Neil — Bouclier d'Aristote (exil)", () => g.exile(n, null, { self: true }));
  }
  if (ev.kind === 'capacity') {
    const l = perso('LOCKI', 'Armure de glace');
    if (l) add(l, 'Armure de glace', 'Locki — Armure de glace (exil)', () => g.exile(l, null, { self: true }));
  }
  if (ev.kind === 'damage') {
    const t = ev.target, name = t ? g.def(t).name : '';
    const r = perso('RIBA', 'Rumeurs incessantes');
    if (r) add(r, 'Rumeurs incessantes', 'Riba — Rumeurs incessantes (exil)', () => g.exile(r, null, { self: true }));
    const bibi = name === 'Savane' && perso('BIBI', 'Sauvez Savane !');
    if (bibi) add(bibi, 'Sauvez Savane !', 'Bibi — Sauvez Savane ! (exil)', () => g.exile(bibi, null, { self: true }));
    const elvis = t && g.hasKw(t, 'FÉLIN') && perso('ELVIS', 'Le garde perché');
    if (elvis) add(elvis, 'Le garde perché', 'Elvis — Le garde perché', () => { elvis.tmp.elvisDue = true; });
    // R39 : l'exil est ici le coût de sa propre capacité — son effet fait partie de la même activation
    const ah = t && g.hasKw(t, 'FANTASY STARS') && perso('ALANA_HUAM', "Jump dans l'inconnu");
    if (ah) add(ah, "Jump dans l'inconnu", "Alana & Huam — Jump dans l'inconnu (exil)", () => g.exile(ah, null, { self: true, ownCost: true }), () => alanaHuamEffect(g, pid));
    const ext = t && ['Hikari', 'Raiden', 'Hikari & Raiden'].includes(name) && g.hasSupport(pid, 'EXTREMIS');
    if (ext) out.push({ id: ext.uid, card: ext, label: 'Sauvé in extremis (défausse)', pay: async () => g.discard(ext), after: async () => {
      // Texte de la carte : Aura ≤ nuit + 1
      const swaps = g.fanboyLocked(t) ? [] : p.reserve.filter(c => ['Hikari', 'Raiden', 'Hikari & Raiden'].includes(g.def(c).name) && g.aura(c) <= g.s.night + 1);
      const s = swaps.length ? await g.chooseCard(pid, 'teleport', 'Échanger votre combattant avec :', swaps, { optional: true }) : null;
      if (s && t.zone === 'arena' && !g.fanboyLocked(t)) { g.toReserve(t, null); await g.enterArena(pid, [s]); }
    } });
    const decois = t && g.hasKw(t, 'ATTILA BAND') && g.ownKicks(pid).find(k => k.id === 'DECOIS' && g.kickActive(k));
    if (decois && t.zone === 'arena' && !g.fanboyLocked(t)) out.push({ id: decois.uid, card: decois, label: 'Ne me déçois pas ! (combattant sous le Groupe)', pay: async () => {
      g.underGroupe(t, null);
      const o = ev.by, cands = g.visibleArena(o);
      const x = await g.chooseCard(o, 'lowestToReserve', "Ne me déçois pas ! : votre Perso qui reçoit −2 d'Aura cette nuit", cands);
      if (x) { x.tmp.nightAura = (x.tmp.nightAura || 0) - 2; g.log(`${g.label(x)} reçoit −2 d'Aura cette nuit.`, o); }
    } });
    const sauve = g.ownKicks(pid).find(k => k.id === 'SAUVE' && k.armed && !k.countered && !k.silenced);
    if (sauve && t && !t.faceDown && t.zone === 'arena' && g.isFighter(t) && !g.fanboyLocked(t))
      out.push({ id: sauve.uid, card: sauve, label: 'Sauvé de justesse (combattant face cachée)', pay: async () => {
        sauve.armed = false;
        g.flipDown(t);
        g.gainFame(ev.by, 1, 'Sauvé de justesse');
        const back = await g.chooseCard(ev.by, 'takeBack', 'Sauvé de justesse : reprenez un de vos Kicks', g.ownKicks(ev.by));
        if (back) { g.put(back, 'hand'); g.log(`${g.pname(ev.by)} reprend ${g.label(back)}.`, ev.by); }
      } });
  }
  return out;
}

/** Effet d'Alana & Huam : Huam ou Alana de la Réserve entre dans l'Arène. */
async function alanaHuamEffect(g, pid) {
  const cands = g.p(pid).reserve.filter(c => ['Huam', 'Alana'].includes(g.def(c).name) && g.aura(c) <= g.s.night);
  const pick = await g.chooseCard(pid, 'teleport', "Jump dans l'inconnu : Huam ou Alana entre dans l'Arène", cands, { optional: true });
  if (pick) await g.enterArena(pid, [pick]);
}

/** R39 : exilé par n'importe quel autre moyen, l'effet se déclenche comme une capacité (contrable). */
export async function onAlanaHuamExiled(g, pid, card) {
  await g.activate(pid, card, "Jump dans l'inconnu", () => alanaHuamEffect(g, pid));
}

export async function elvisPayment(g, pid, elvis) {
  elvis.tmp.elvisDue = false;
  const p = g.p(pid);
  let ans = 'exile';
  if (p.gold >= 3) ans = await g.chooseOption(pid, 'elvis', 'Elvis : payer 3 pièces d’or pour le garder (face cachée) ?', [
    { id: 'pay', label: 'Payer 3 pièces d’or' }, { id: 'exile', label: 'Exiler Elvis' }]);
  if (ans === 'pay') { p.gold -= 3; g.flipDown(elvis); g.log(`${p.name} paie 3 pièces d’or pour Elvis.`, pid); }
  else g.exile(elvis, null, { self: true });
  await g.flush();
}

/** L'art de la destruction : un Perso « Attila band » quitte l'Arène. */
export async function onAttilaLeaves(g, pid) {
  const art = g.hasSupport(pid, 'ART_DESTRUCTION');
  if (!art || g.usedThisPhase(`art${pid}`)) return;
  g.markPhase(`art${pid}`);
  const o = opp(pid), po = g.p(o);
  const opts = [];
  if (g.visibleSupports(o).length) opts.push({ id: 'support', label: 'Défausser un de vos Soutiens visibles' });
  if (po.lieuUsed.some(u => !u)) opts.push({ id: 'lieu', label: 'Gâcher une capacité de votre Lieu' });
  if (g.visibleArena(o).length) opts.push({ id: 'perso', label: "Renvoyer un de vos Persos de l'Arène dans la Réserve" });
  if (!opts.length) return;
  await g.activate(pid, art, "L'art de la destruction", async () => {
    const ans = await g.chooseOption(o, 'artDestruction', "L'art de la destruction : que sacrifiez-vous ?", opts);
    if (ans === 'support') {
      const s = await g.chooseCard(o, 'discardOwn', 'Soutien à défausser', g.visibleSupports(o));
      if (s) { g.discard(s); g.log(`${g.label(s)} est défaussé.`, o); }
    } else if (ans === 'lieu') {
      const free = po.lieuUsed.map((u, i) => (u ? null : i)).filter(i => i != null);
      const lieu = LIEUX[po.lieuId];
      const i = await g.chooseOption(o, 'wasteLieu', 'Capacité de Lieu à gâcher', free.map(i => ({ id: String(i), label: lieu.abilities[i].text })));
      po.lieuUsed[+i] = true;
      g.log(`${po.name} gâche une capacité de son Lieu.`, o);
    } else {
      const c = await g.chooseCard(o, 'lowestToReserve', 'Perso à renvoyer dans la Réserve', g.visibleArena(o));
      if (c) g.toReserve(c, null);
    }
  });
}

/** Griffes empoisonnées (Magoss) : à l'Aurore, la victime choisit. */
export async function magossAurore(g, victim) {
  const actor = opp(victim);
  const larbins = [...g.p(victim).arena, ...g.p(victim).reserve].filter(c => c.tmp.larbin);
  if (!larbins.length) return;
  g.log(`Aurore : Griffes empoisonnées (Magoss) frappe les Larbins de ${g.pname(victim)} (${larbins.map(c => g.label(c)).join(', ')}).`, actor);
  const ans = await g.acceptRefuse(actor, 'Griffes empoisonnées', "ses Persos « Larbin » reçoivent −1 d'Aura", 'il renvoie un Larbin dans la Réserve',
    { accept: larbins.length, refuse: Math.max(...larbins.map(c => g.aura(c))) });
  if (ans !== 'refuse') larbins.forEach(c => { c.markers.push({ v: -1, src: actor }); g.log(`${g.label(c)} reçoit −1 d'Aura.`, victim); });
  if (ans !== 'accept') {
    const inArena = larbins.filter(c => c.zone === 'arena');
    const c = await g.chooseCard(victim, 'lowestToReserve', 'Larbin à renvoyer dans la Réserve', inArena);
    if (c) g.toReserve(c, null);
  }
  await g.flush();
}

// ── Dénouement ───────────────────────────────────────────────
export async function denouementTriggers(g, pid) {
  for (const k of g.ownKicks(pid)) {
    if (k.id !== 'DAGUE' || !g.kickActive(k)) continue;
    const t = await g.target(pid, g.ownKicks(opp(pid)), 'Dague de givre : Kick adverse limité à 3');
    if (t) { t.cap = 3; g.log(`${g.label(t)} est limité à 3 de Force.`, pid); }
  }
}

// ── Dégâts ───────────────────────────────────────────────────
function lowestAura(g, cards) {
  const min = Math.min(...cards.map(c => g.aura(c)));
  return cards.filter(c => g.aura(c) === min);
}
async function recruitJimmy(g, w) {
  const jimmys = g.p(w).groupe.filter(c => g.def(c).name === 'Jimmy');
  const pick = await g.chooseCard(w, 'recruitPick', 'Jimmy à recruter', jimmys);
  if (pick) g.recruit(w, pick);
}

/** Dégâts que le vainqueur `w` peut infliger. */
export function availableDamages(g, w) {
  const l = opp(w), out = [];
  const lf = g.fighter(l);
  if (!lf || lf.zone !== 'arena' || g.side(l).damaged) return out;
  const mk = (id, label, card, cost) => {
    const spec = DAMAGES[id];
    const onTarget = spec.onTarget && (t => spec.onTarget(g, w, t));
    return { id, label, card, cost, onTarget,
      apply: async target => { if (onTarget && target?.zone === 'arena') await onTarget(target); if (spec.extra) await spec.extra(g, w, target); } };
  };
  for (const k of g.ownKicks(w))
    if (g.def(k).abType === 'DÉGÂT' && g.kickCondMet(k) && !k.countered && !k.silenced && DAMAGES[k.id]) out.push(mk(k.id, g.def(k).name, k));
  const f = g.fighter(w), sd = g.side(w);
  if (f && sd.comboActive && g.def(f).abType === 'DÉGÂT' && DAMAGES[f.id]) out.push(mk(f.id, `${g.def(f).name} — ${g.def(f).sub}`, f));
  const batte = g.hasSupport(w, 'BATTE');
  if (batte) out.push(mk('BATTE', 'Batte des Titans', batte, () => g.discard(batte)));
  const moby = g.p(w).arena.find(c => c.id === 'MOBY' && g.persoCanAct(c));
  if (moby && (g.hasKw(f, 'POISSON') || g.hasKw(f, 'LUCKY STARS')))
    out.push(mk('MOBY', 'Moby Dick — Aplatir', moby, () => g.exile(moby, null, { self: true })));
  const seen = new Set();
  return out.filter(d => (seen.has(d.id) ? false : seen.add(d.id)));
}

const flipOrBottom = (g, w, t) => (g.lieuActivated(w) >= 3 ? g.underGroupe(t, w) : g.flipDown(t));

export const DAMAGES = {
  PUNCH: { onTarget: (g, w, t) => g.underGroupe(t, w) },
  COUP_BOULE: { onTarget: (g, w, t) => g.flipDown(t) },
  UPPERCUT: { onTarget: (g, w, t) => g.toReserve(t, w) },
  MEGA_MANDALE: {
    onTarget: (g, w, t) => g.flipDown(t),
    extra: async (g, w) => {
      const l = opp(w);
      const c = await g.chooseCard(l, 'reserveToBottom', 'Méga mandale : carte de votre Réserve à renvoyer sous le Groupe', g.p(l).reserve);
      if (c) g.underGroupe(c, w);
    } },
  DEBOITAGE: { extra: (g, w) => g.searchSonge(w, () => true, 'Déboîtage : carte à prendre dans le Songe') },
  MANDALE_TITAN: {
    onTarget: (g, w, t) => g.toReserve(t, w),
    extra: (g, w) => { g.p(opp(w)).controlMod -= 2; g.log(`${g.pname(opp(w))} reçoit −2 de Contrôle cette nuit.`, w); } },
  EBOULEMENT: { onTarget: flipOrBottom },
  EPONY4: {
    onTarget: (g, w, t) => g.underGroupe(t, w),
    extra: async (g, w) => {
      const l = opp(w), arena = g.visibleArena(l);
      if (!arena.length) return;
      const c = await g.chooseCard(l, 'lowestToReserve', "Aurora Annihilation : votre Perso d'Aura la plus basse va dans la Réserve", lowestAura(g, arena));
      if (c) g.toReserve(c, w);
    } },
  ASMODHEUS: {
    onTarget: (g, w, t) => g.underGroupe(t, w),
    extra: (g, w) => {
      const l = opp(w), cap = g.s.combat.targetAura ?? 0;
      g.visibleArena(l).filter(c => g.aura(c) <= cap).forEach(c => g.underGroupe(c, w));
    } },
  CELESTE3: {
    onTarget: (g, w, t) => g.flipDown(t),
    extra: (g, w) => { g.p(opp(w)).controlMod -= 2; g.log(`${g.pname(opp(w))} reçoit −2 de Contrôle cette nuit.`, w); } },
  SEALVIA2: { extra: (g, w) => g.p(opp(w)).reserve.filter(c => g.aura(c) < 2).forEach(c => g.underGroupe(c, w)) },
  SEALVIA3: {
    onTarget: (g, w, t) => g.toReserve(t, w),
    extra: (g, w) => g.visibleArena(opp(w)).filter(c => g.aura(c) < 3).forEach(c => g.toReserve(c, w)) },
  EXTHA: { extra: (g, w) => g.gainFame(opp(w), -1, 'Explosion piquante') },
  SACHA: {
    onTarget: (g, w, t) => g.underGroupe(t, w),
    extra: async (g, w) => {
      const a = g.p(w).songe.find(c => c.id === 'ANGELITO');
      if (!a) return;
      // Soutien posé par un effet : inactivable cette nuit
      if (await yesNo(g, w, 'sachaAngelito', 'Chercher Angélito et le poser ?')) { await g.poseSupport(w, a, { byEffect: true }); g.shuffle(g.p(w).songe); }
    } },
  ARKA: {
    onTarget: (g, w, t) => g.exile(t, w),
    extra: async (g, w) => {
      const l = opp(w), arena = g.visibleArena(l);
      const c = await g.chooseCard(l, 'arkaFlip', 'Prison de toiles : Perso à retourner face cachée', arena);
      if (c) { g.flipDown(c); c.tmp.lockFaceDown = true; }
    } },
  BATTE: { onTarget: (g, w, t) => (g.s.combat.final[w] >= 17 ? g.underGroupe(t, w) : g.flipDown(t)) },
  JIMMY2: { onTarget: (g, w, t) => g.flipDown(t), extra: (g, w) => recruitJimmy(g, w) },
  JIMMY3: { onTarget: (g, w, t) => g.toReserve(t, w), extra: (g, w) => recruitJimmy(g, w) },
  ROMUALD: { extra: (g, w) => { g.gainFame(w, 1, 'Golden Hand'); g.gainGold(w, g.s.combat.targetAura ?? 0); } },
  ATTILA: {
    onTarget: (g, w, t) => { t.tmp.auraZero = true; g.log(`${g.label(t)} a une Aura de 0 cette nuit.`, w); },
    extra: async (g, w) => {
      const l = opp(w), others = g.visibleArena(l).filter(c => !g.isFighter(c));
      const n = Math.min(2, others.length);
      const out = await g.chooseCards(l, 'auraZero', `Aura terrifiante : choisissez ${n} de vos Persos non combattants`, others, n, n);
      out.forEach(c => { c.tmp.auraZero = true; g.log(`${g.label(c)} a une Aura de 0 cette nuit.`, w); });
    } },
  ACTARUS: { extra: (g, w) => { g.p(opp(w)).oneMandatory = true; g.log(`${g.pname(opp(w))} ne fera qu'une action obligatoire à son prochain Crépuscule.`, w); } },
  LION2: { onTarget: (g, w, t) => g.flipDown(t), extra: (g, w) => { g.p(opp(w)).lionCurse = true; } },
  LION4: {
    onTarget: (g, w, t) => g.flipDown(t),
    extra: (g, w) => {
      const cap = g.s.combat.targetAura ?? 0;
      g.visibleArena(opp(w)).filter(c => g.aura(c) < cap).forEach(c => g.flipDown(c));
    } },
  MOBY: { onTarget: (g, w, t) => g.toReserve(t, w) },
};

// ── Fin du combat ────────────────────────────────────────────
// Ordre : les capacités « à la fin d'un combat » avant les dégâts (livret 3.2) ; ce qui dépend des dégâts
// reçus (« sans dégât ») ou qui suit le dégât passe après.
export async function endOfCombatTriggers(g, att) {
  const c = g.s.combat;
  for (const pid of [att, opp(att)]) {
    const f = g.fighter(pid);
    // Titan Métro : condition officielle « À la fin d'un combat »
    if (f?.id === 'TITAN_METRO' && g.persoCanAct(f))
      await g.activate(pid, f, 'Manger !', () => { const n = g.draw(pid, 2); g.log(`${g.pname(pid)} pioche ${n} carte(s).`, pid); });
    const indo = g.hasSupport(pid, 'INDOMPTABLES');
    if (indo && f && g.hasKw(f, 'INDOMPTABLES'))
      await g.activate(pid, indo, 'Puissance des Indomptables', () => {
        if (c.final[pid] >= 17) g.gainFame(pid, 1, 'Puissance des Indomptables');
        else { g.draw(pid, 1); g.log(`${g.pname(pid)} pioche une carte.`, pid); }
      });
  }
}

/** Après les dégâts : Akim, Partage de puissance, Survivre une nuit de plus (« sans dégât », R37). */
export async function afterDamageTriggers(g, att) {
  const c = g.s.combat;
  for (const pid of [att, opp(att)]) {
    const f = g.fighter(pid), sd = c.sides[pid], o = opp(pid);
    if (sd.akim) {
      const of = g.fighter(o);
      if (of?.zone === 'arena') {
        const x = g.roll(pid, 'Pluie de météorites');
        of.tmp.nightAura = (of.tmp.nightAura || 0) - x;
        g.log(`${g.label(of)} reçoit −${x} d'Aura cette nuit.`, pid);
      }
    }
    const partage = sd.kicks.find(k => k.id === 'PARTAGE' && g.kickActive(k));
    if (partage && f?.zone === 'arena' && !sd.damaged && !g.fanboyLocked(f) && await yesNo(g, pid, 'partage', 'Partage de puissance : renvoyer votre combattant dans la Réserve pour rendre « Feu » vos Persos « Attila band » ?')) {
      g.toReserve(f, null);
      g.visibleArena(pid).filter(x => g.hasKw(x, 'ATTILA BAND')).forEach(x => (x.tmp.nightKw = [...(x.tmp.nightKw ?? []), 'FEU']));
      g.log('Vos Persos « Attila band » sont « Feu » cette nuit.', pid);
      await g.flush();
    }
    const surv = g.hasSupport(pid, 'SURVIVRE');
    if (surv && f && g.hasKw(f, 'FANTASY STARS') && c.winners.includes(o) && !sd.damaged)
      await g.activate(pid, surv, 'Survivre une nuit de plus', () => { g.gainFame(pid, 1, 'Survivre une nuit de plus'); g.recruit(pid); });
  }
}