/* app.js — câblage de l'interface. Toute la logique ROM vit dans rom.js. */
const R = window.ROM;
window.addEventListener('DOMContentLoaded', () => {
  renderCompat(null);
  const t = document.getElementById('tabs'); if (t) t.hidden = true;
});
const $ = id => document.getElementById(id);
const hex = (n, p = 2) => n.toString(16).toUpperCase().padStart(p, '0');

let rom = null, romPath = '', romName = '';
let plat = null;              // 'gba' | 'nds' — choisi avant d'ouvrir une ROM
let ndsRep = null;            // dernier rapport du module DS
let shinyHits = [], rateIdx = 5, customCount = null;
let table = null, encounters = [], mode = 'global', starters = null, ballGift = null;
let jar = null, settings = null;

/* --------------------- choix du support ---------------------- *
 * On demande la console AVANT la ROM : le traitement, les libellés
 * et le plafond du taux en dépendent. Le choix reste modifiable,
 * mais recharger une ROM d'une autre famille sans le changer serait
 * une source d'erreur silencieuse — d'où la vérification à
 * l'ouverture.                                                     */
const NOMS = { gba:'Game Boy Advance', nds:'Nintendo DS', n3ds:'Nintendo 3DS' };
const EYEBROW = { gba:'Game Boy Advance · Génération 3',
                  nds:'Nintendo DS · Générations 4 et 5' };

function choisir(id){
  if (id !== 'gba' && id !== 'nds') return;
  plat = id;
  document.querySelectorAll('.ch-card').forEach(c => c.classList.toggle('on', c.dataset.plat === id));
  $('chooser').hidden = true;
  const eb = document.querySelector('.masthead .eyebrow');
  if (eb) eb.textContent = EYEBROW[id];
  $('tabs').hidden = false;
  majPlafond();
  renderCompat(id);
  show('shiny');
}

/* Le plafond du taux n'est pas le même partout : en 3G la constante
   tient sur un octet d'instruction, en DS on réécrit la fonction. */
function majPlafond(){
  const n = document.querySelector('#pane-shiny .note');
  if (!n) return;
  n.innerHTML = plat === 'nds'
    ? `En Nintendo DS, la fonction de test est unique dans le jeu : on peut la réécrire entièrement.
       <b>N'importe quel taux est atteignable, jusqu'à 100 %.</b> Au-delà de 1/256 le logiciel remplace
       la comparaison par une version élargie et t'indique le taux exactement obtenu.`
    : `En génération 3, le maximum atteignable est <b>1/256</b> : la constante comparée tient sur un
       octet d'instruction THUMB. Une valeur plus basse sera ramenée à ce plafond, et le logiciel te
       dira exactement ce qu'il a appliqué.`;
}

document.addEventListener('click', e => {
  const c = e.target.closest('.ch-card');
  if (c && !c.disabled) choisir(c.dataset.plat);
});

/* ------------------------- ouverture ------------------------- */
$('open').onclick = async () => {
  const f = await window.api.pickRom();
  if (!f) return;
  rom = new Uint8Array(f.bytes);
  romPath = f.path; romName = f.name;

  ['shiny','wild'].forEach(t => document.querySelector(`.tab[data-t="${t}"]`).disabled = false);
  const info = window.PLATFORMS.describe(rom);

  /* Le support annoncé et celui de la ROM doivent concorder, sinon on
     appliquerait un traitement conçu pour une autre machine. */
  if (info && plat && info.platform.id !== plat){
    $('idcard').innerHTML = `<div class="msg"><b>Ce n'est pas une ROM ${NOMS[plat]}.</b>
      Le fichier ouvert est reconnu comme ${info.platform.label}. Change de support en haut de page,
      ou ouvre une autre ROM.</div>`;
    ['shiny','wild'].forEach(t => document.querySelector(`.tab[data-t="${t}"]`).disabled = true);
    return;
  }
  if (info && info.platform.id === 'nds') return ouvrirNds(f, info);
  if (!info) {
    $('idcard').innerHTML = `<div class="msg"><b>Support non reconnu.</b> Aucun en-tête Game Boy, GBA, DS ou 3DS valide. Vérifie que le fichier n'est pas encore compressé (.zip, .7z) ni chiffré.</div>`;
    return;
  }
  if (!info.usable) {
    $('idcard').innerHTML = platformCard(info, f) + statusCard(info);
    renderCompat(info.platform.id);
    ['shiny','wild'].forEach(t => document.querySelector(`.tab[data-t="${t}"]`).disabled = true);
    show('compat');
    return;
  }
  const h = R.readHeader(rom);

  const sha = await R.sha1(f.bytes).catch(() => '—');
  $('idcard').innerHTML = `<div class="panel"><dl class="rows">
    <dt>Jeu</dt><dd>${h.game ? h.game + ' · ' + h.region : '<span style="color:var(--red)">non reconnu — analyse quand même tentée</span>'}</dd>
    <dt>Code</dt><dd>${h.code} · v1.${h.version} · ${(h.size / 1048576).toFixed(1)} Mo</dd>
    <dt>SHA-1</dt><dd style="font-size:11px">${sha}</dd>
  </dl></div>`;

  shinyHits = R.findShinyChecks(rom);
  table = R.findEncounterTable(rom);
  encounters = table ? R.readEncounters(rom, table) : [];
  starters = R.findStarters(rom, h.code);
  ballGift = R.findBallGift(rom);

  renderCompat(info.platform.id);
  show('shiny');
  renderRates(); renderShiny(); renderWildStatus(); renderStarters(); renderKit();
};


/* ------------------------ ouverture DS ------------------------ *
 * Le module DS travaille en un seul passage : il extrait arm9, le
 * déplie si besoin, localise la fonction de test, neutralise la
 * boucle anti-chromatique quand elle existe, puis reconstruit. On ne
 * fait ici qu'un tour à blanc pour afficher ce qui a été trouvé ;
 * la vraie écriture a lieu à l'export.                             */
function ouvrirNds(f, info){
  const h = window.NDS.readHeader(rom);
  ndsRep = window.NDS.patchNds(rom, activeCount());

  const trouve = ndsRep.hits.length > 0;
  const boucles = (ndsRep.loops || []).length;

  $('idcard').innerHTML = `<div class="panel"><dl class="rows">
    <dt>Jeu</dt><dd>${h.title || '—'} · ${h.code}</dd>
    <dt>Support</dt><dd>Nintendo DS · ${(rom.length/1048576).toFixed(0)} Mo</dd>
    <dt>arm9</dt><dd>${window.NDS.isCompressed(window.NDS.extractArm9(rom))
        ? 'comprimé (BLZ)' : 'en clair'}</dd>
    <dt>Test de shiny</dt><dd>${trouve
        ? 'localisé en 0x' + ndsRep.hits[0].off.toString(16).toUpperCase()
        : '<span style="color:var(--red)">introuvable</span>'}</dd>
    <dt>Boucle anti-shiny</dt><dd>${boucles
        ? boucles + ' — sera neutralisée (génération 4)'
        : 'absente (génération 5)'}</dd>
  </dl></div>`;

  shinyHits = ndsRep.hits;
  table = null; encounters = []; starters = null; ballGift = null;

  renderCompat('nds');
  show('shiny');
  renderRates(); renderShiny(); renderWildStatus();
  syncExportButtons();
}

/* --------------------- cartes d'information -------------------- */
function platformCard(info, f) {
  const p = info.platform;
  return `<div class="panel"><dl class="rows">
    <dt>Support</dt><dd>${p.label}</dd>
    <dt>Titre interne</dt><dd>${p.title || '—'} ${p.code ? '· ' + p.code : ''}</dd>
    <dt>Taille</dt><dd>${(f.bytes.byteLength / 1048576).toFixed(1)} Mo</dd>
  </dl></div>`;
}
function statusCard(info) {
  const gens = window.GAMES.gensFor(info.platform.id);
  const lines = gens.map(g => `<li><b>${g.gen}G</b> — ${g.why}</li>`).join('');
  return `<div class="msg"><b>Taux de shiny : pas encore pris en charge sur ce support.</b>
    <ul class="tight">${lines}</ul>
    Le randomizer reste disponible via l'onglet Randomizer avancé. Voir l'onglet Compatibilité pour le détail.</div>`;
}


/* ------------------------- compatibilité ----------------------- */
function badge(k) {
  const b = window.GAMES.BADGES[k];
  return `<span class="badge ${b.cls}" title="${b.tip}">${b.text}</span>`;
}
function renderCompat(activePlatform) {
  const rows = window.GAMES.GENS.map(g => `
    <tr class="${g.platform === activePlatform ? 'here' : ''}">
      <td class="gen">${g.gen}G</td>
      <td>${g.games.map(n => 'Pokémon ' + n).join(', ')}<div class="why">${g.why}</div></td>
      <td class="mid">${g.label}</td>
      <td class="mid">${g.rate || '—'}</td>
      <td class="mid">${badge(g.shiny)}</td>
      <td class="mid">${badge(g.rando)}</td>
    </tr>`).join('');
  $('compat').innerHTML = `
    <p class="note wide">Ce que le logiciel sait faire, jeu par jeu. <b>Natif</b> : écrit dans ce logiciel. <b>Intégré</b> : moteur de randomisation livré avec l'application, onglet Randomizer complet. Dans les deux cas, rien à installer en plus.</p>
    <table class="compat">
      <thead><tr><th></th><th>Jeux</th><th>Support</th><th>Taux d'origine</th><th>Taux de shiny</th><th>Randomizer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note wide">Les remakes suivent la console sur laquelle ils sortent, pas l'original : Rouge Feu et Vert Feuille sont de la 3G et fonctionnent nativement, HeartGold et SoulSilver sont de la 4G, Rubis Oméga et Saphir Alpha de la 6G.</p>
    <p class="note wide">Let's Go et tout ce qui suit tourne sur Switch : ce ne sont plus des ROMs à patcher mais des mods de fichiers, hors du périmètre de ce logiciel.</p>`;
}

/* --------------------------- onglets -------------------------- */
function show(t) {
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  ['shiny', 'wild', 'compat'].forEach(p => $('pane-' + p).hidden = p !== t);
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { if (!b.disabled) show(b.dataset.t); });

/* ---------------------------- shiny --------------------------- */
function renderRates() {
  $('rates').innerHTML = R.SHINY_RATES.map((r, i) =>
    `<button class="chip" data-i="${i}" aria-pressed="${customCount === null && i === rateIdx}">${r.label}</button>`).join('');
  $('rates').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    rateIdx = +b.dataset.i; customCount = null;
    $('customrate').value = ''; $('customout').innerHTML = '';
    renderRates(); renderShiny();
  });
}

/* Taux libre : l'utilisateur saisit le denominateur voulu. */
function applyCustomRate() {
  const raw = $('customrate').value.trim();
  if (!raw) { customCount = null; $('customout').innerHTML = ''; renderRates(); renderShiny(); return; }
  const r = R.countFromDenominator(raw);
  customCount = r.count;
  $('customout').innerHTML = r.capped
    ? `<div class="msg"><b>1/${r.denomAsked} est hors de portee en generation 3.</b>
       Le taux applique sera <b>1/${r.denomReal}</b>, le maximum atteignable.
       <p>La raison est materielle : le jeu compare le resultat a une constante logee dans un seul octet
       d'une instruction THUMB. Au-dela de 256 valeurs favorables sur 65536, il faudrait injecter du code,
       pas seulement reecrire un octet.</p></div>`
    : `<div class="msg good">Taux applique : <b>1/${r.denomReal}</b>
       (${r.count} valeur${r.count > 1 ? 's' : ''} favorable${r.count > 1 ? 's' : ''} sur 65536).</div>`;
  renderRates(); renderShiny();
}

const activeCount = () => customCount !== null ? customCount : R.SHINY_RATES[rateIdx].count;
const shinyList = () => R.shinyPatches(shinyHits, activeCount());

function renderShiny() {
  const has = shinyHits.length > 0;
  syncExportButtons();
  if (!has) {
    $('hits').innerHTML = `<div class="msg"><b>Aucun test de shininess trouvé.</b> Normal sur une ROM déjà patchée, un ROM hack, ou un jeu hors génération 3.</div>`;
    return;
  }
  const list = shinyList();
  $('hits').innerHTML = shinyHits.map(h => {
    const p = list.find(x => x.hit === h);
    const imm = p ? p.value : h.old;
    const cond = h.form === 'le' ? 'bhi' : 'bcs';
    const ctx = [...rom.slice(h.off - 2, h.off + 6)];
    return `<div class="hit">
      <div class="hit-top"><span class="addr">0x${hex(h.off, 6)}</span>
      <span class="tag">correspondance ${h.conf}${p && p.capped ? ' · plafonné à 255' : ''}</span></div>
      <div class="asm">
        <span class="lbl">avant</span><span><span class="was">cmp r${h.reg}, #${h.old}</span> ; ${cond}</span>
        <span class="lbl">après</span><span><span class="now">cmp r${h.reg}, #${imm}</span> ; ${cond}</span>
        <span class="lbl">octets</span><span class="bytes">${ctx.map((v, k) =>
          k === 2 ? `<span class="hi">${hex(imm)}</span>` : `<span class="b">${hex(v)}</span>`).join(' ')}</span>
      </div></div>`;
  }).join('') +
  `<p class="note">${shinyHits.length} occurrence(s) · ${list.length} octet(s) à écrire. Toutes sont modifiées ensemble : la gen 3 ne stocke pas la shininess, elle la recalcule à chaque affichage. En rater une donne des Pokémon shiny au sprite normal.</p>`;
}

/* -------------------------- randomizer ------------------------ */
const HELP = {
  global: "Chaque espèce d'origine est remplacée par la même espèce partout dans le jeu. Les Roucool restent des Roucool, mais deviennent tous autre chose.",
  area:   "La correspondance est retirée au sort zone par zone. Une même espèce peut devenir différente selon la route.",
  full:   "Chaque emplacement de rencontre est tiré indépendamment. Le plus chaotique, et le plus difficile à mémoriser en race."
};
document.querySelectorAll('#modes .chip').forEach(b => b.onclick = () => {
  mode = b.dataset.m;
  document.querySelectorAll('#modes .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === mode));
  $('modehelp').textContent = HELP[mode];
});
$('reseed').onclick = () => { $('seed').value = Math.random().toString(36).slice(2, 10); };

const KIT_FIELDS = [
  { id: 'kpoke',   item: 4, label: 'Poké Ball',   def: 200 },
  { id: 'kgreat',  item: 3, label: 'Super Ball',  def: 150 },
  { id: 'kultra',  item: 2, label: 'Hyper Ball',  def: 100 },
  { id: 'kmaster', item: 1, label: 'Master Ball', def: 1   }
];

const readKit = () => KIT_FIELDS
  .map(f => ({ item: f.item, qty: Math.min(R.ITEM_QTY_MAX, Math.max(0, parseInt($(f.id).value, 10) || 0)) }))
  .filter(x => x.qty > 0);

function renderKit() {
  const box = $('kitstatus');
  if (!box) return;
  if (!ballGift) {
    box.innerHTML = `<div class="msg"><b>Point d'accroche introuvable.</b> Le don de cinq Poké Balls
      du professeur n'a pas été repéré dans cette ROM, donc la dotation ne peut pas être injectée.</div>`;
    $('dokit').checked = false; $('dokit').disabled = true;
    return;
  }
  if (ballGift.tooMany) {
    box.innerHTML = `<div class="msg"><b>Repérage ambigu.</b> Trop de points d'accroche candidats :
      le logiciel refuse d'écrire plutôt que de risquer une ROM corrompue.</div>`;
    $('dokit').checked = false; $('dokit').disabled = true;
    return;
  }
  $('dokit').disabled = false;
  box.innerHTML = `<div class="msg good"><b>Point d'accroche trouvé</b> —
    ${ballGift.sites.length} occurrence${ballGift.sites.length > 1 ? 's' : ''} du don du professeur
    (0x${ballGift.sites.map(x => hex(x.off, 6)).join(', 0x')}). Le don d'origine sera remplacé par un
    appel vers un script écrit dans l'espace libre de la ROM.</div>`;
}

function renderStarters() {
  const box = $('starterstatus');
  if (!box) return;
  if (!starters) {
    box.innerHTML = `<div class="msg"><b>Jeu non reconnu.</b> Le code d'en-tête ne correspond à aucun
      ensemble de starters connu, donc la recherche n'a pas été tentée.</div>`;
    $('dostarters').checked = false; $('dostarters').disabled = true;
    return;
  }
  if (starters.missing) {
    box.innerHTML = `<div class="msg"><b>Starters introuvables.</b> Jeu identifié comme
      <b>${starters.code}</b>, dont les starters d'origine sont ${starters.label} — mais la suite
      d'octets attendue n'apparaît nulle part. ROM déjà modifiée, ou hack.</div>`;
    $('dostarters').checked = false; $('dostarters').disabled = true;
    return;
  }
  if (starters.tooMany) {
    box.innerHTML = `<div class="msg"><b>Repérage ambigu.</b> La suite d'octets des starters apparaît trop souvent
      pour être identifiée sans risque. Le logiciel refuse d'écrire plutôt que de corrompre la ROM.</div>`;
    $('dostarters').checked = false; $('dostarters').disabled = true;
    return;
  }
  $('dostarters').disabled = false;
  if (starters.kind === 'script') {
    box.innerHTML = `<div class="msg good"><b>Starters trouvés</b> — ${starters.code} · ${starters.label}
      — ${starters.blocks.length} Pokéball${starters.blocks.length > 1 ? 's' : ''} dans le labo.
      <p>Le Pokémon du rival est remplacé en même temps, en gardant le cycle d'origine :
      il prend toujours celui qui bat le tien.</p></div>`;
  } else {
    box.innerHTML = `<div class="msg good"><b>Starters trouvés</b> — ${starters.code} · ${starters.label}
      — table à ${starters.offsets.length} endroit${starters.offsets.length > 1 ? 's' : ''}
      (0x${starters.offsets.map(o => hex(o, 6)).join(', 0x')}).</div>`;
  }
}

function renderWildStatus() {
  const ok = table && encounters.length;
  $('wildstatus').innerHTML = ok
    ? `<div class="msg good"><b>${table.count} zones trouvées</b> à partir de 0x${hex(table.start, 6)}, soit ${encounters.length} emplacements de rencontre modifiables (herbe, eau, éclate-roc, pêche).</div>`
    : `<div class="msg"><b>Table de rencontres introuvable.</b>
       <p>Le randomizer intégré ne peut pas travailler sur cette ROM, mais
       <b>le taux de shiny reste exportable</b> depuis l'onglet précédent, et
       l'onglet « Randomizer complet » reste utilisable.</p>
       <p class="dimtxt">Diagnostic : ROM de ${(rom.length / 1048576).toFixed(1)} Mo,
       code ${R.readHeader(rom).code}, ${shinyHits.length} test(s) de shininess trouvé(s).
       Communique cette ligne si tu signales le problème.</p></div>`;
  syncExportButtons();
}

/* Un seul export pour les deux traitements. Chacun s'applique s'il est
   disponible : une ROM dont la table de rencontres reste introuvable
   sort quand meme avec son taux de shiny modifie. */
function buildPatched() {
  /* En DS tout passe par patchNds : décompression, réécriture,
     recompression et sommes de contrôle sont indissociables. */
  if (plat === 'nds'){
    const rep = window.NDS.patchNds(rom, activeCount());
    ndsRep = rep;
    if (!rep.ok) throw new Error(
      'Traitement DS interrompu — ' +
      (rep.steps.filter(x => !x.ok).map(x => x.name + (x.detail ? ' : ' + x.detail : '')).join(' ; ')
       || 'raison inconnue'));
    return { out: rep.rom, writes: [], shiny: rep.patches || [], start: { writes: [], species: [] },
             kit: { writes: [], items: [] }, nds: rep };
  }

  const out = rom.slice();

  const seed = $('seed').value || 'race';

  let writes = [];
  if (table && encounters.length) {
    writes = R.randomizeEncounters(encounters, { mode, seed, noDupes: $('nodupes').checked });
    R.applyEncounters(out, writes);
  }

  let kit = { writes: [], items: [] };
  if (ballGift && !ballGift.tooMany && $('dokit').checked) {
    kit = R.buildStarterKit(out, ballGift, readKit(), {
      tms: $('dotms').checked, hms: $('dohms').checked,
      badges: $('dobadges').checked, code: R.readHeader(rom).code
    });
    R.applyBytes(out, kit.writes);
  }

  let start = { writes: [], species: [] };
  if (starters && !starters.tooMany && !starters.missing && $('dostarters').checked) {
    start = R.randomizeStarters(starters, seed);
    R.applyStarters(out, start.writes);
  }

  const shiny = shinyList();
  shiny.forEach(p => out[p.off] = p.value);

  return { out, writes, shiny, start, kit };
}

const canExport = () => rom && (shinyHits.length || (table && encounters.length)
  || (starters && !starters.missing && !starters.tooMany) || ballGift);

function syncExportButtons() {
  const ok = !!canExport();
  ['gen', 'genips', 'shinygen', 'shinyips'].forEach(id => { if ($(id)) $(id).disabled = !ok; });
}

function summary({ writes, shiny, start, kit, nds }) {
  const parts = [];
  if (nds){
    const rw = (nds.patches || []).find(p => p.type === 'reecriture');
    const seuil = (nds.patches || []).find(p => p.type === 'seuil');
    const boucles = (nds.patches || []).filter(p => p.type === 'boucle').length;
    parts.push(rw
      ? `Fonction de test réécrite — taux obtenu <b>1/${Math.round(65536 / rw.effectif)}</b>.`
      : `Seuil porté à <b>${seuil ? seuil.N : '—'}</b>, soit un taux de <b>${rateLabel()}</b>.`);
    if (boucles) parts.push(`${boucles} boucle anti-shiny neutralisée : sans ça, un taux élevé fige le jeu.`);
    parts.push(`arm9 reconstruit et sommes de contrôle recalculées.`);
    return parts.join(' ');
  }
  parts.push(shiny.length
    ? `taux de shiny : ${shiny.length} octet(s) réécrit(s)`
    : `taux de shiny : rien à changer`);
  parts.push(writes.length
    ? `rencontres sauvages : ${writes.length} emplacement(s) retirés au sort`
    : `rencontres sauvages : non appliquées (table introuvable)`);
  if (start && start.species.length) parts.push(`starters : ${start.species.length} espèces remplacées (${start.writes.length} écriture(s))`);
  if (kit && kit.writes && kit.writes.length) {
    const d = [];
    if (kit.items && kit.items.length) d.push(`${kit.items.length} objets`);
    if (kit.tmCount) d.push(`${kit.tmCount} CT`);
    if (kit.hmCount) d.push(`${kit.hmCount} CS`);
    if (kit.badgeCount) d.push(`${kit.badgeCount} badges`);
    parts.push('dotation : ' + d.join(', '));
  }
  return parts.join(' · ');
}

function reportTo(box, p, info) {
  $(box).innerHTML = `<div class="msg good"><b>Terminé.</b> ${summary(info)}.
    <p>Fichier enregistré. Teste-le dans un émulateur avant de lancer la race.</p></div>`;
  $(box).querySelector('.msg').onclick = () => window.api.reveal(p);
}

async function exportRom(box) {
  const info = buildPatched();
  if (!info.shiny.length && !info.writes.length && !info.start.writes.length && !info.kit.writes.length) {
    $(box).innerHTML = `<div class="msg"><b>Rien à écrire.</b> Aucun changement à appliquer sur cette ROM.</div>`;
    return;
  }
  const p = await window.api.saveBytes({
    data: info.out, defaultName: stem() + '.gba',
    filters: [{ name: 'ROM GBA', extensions: ['gba'] }]
  });
  if (p) reportTo(box, p, info);
}

async function exportIps(box) {
  const info = buildPatched();
  if (!info.shiny.length && !info.writes.length && !info.start.writes.length && !info.kit.writes.length) {
    $(box).innerHTML = `<div class="msg"><b>Rien à écrire.</b> Aucun changement à appliquer sur cette ROM.</div>`;
    return;
  }
  const p = await window.api.saveBytes({
    data: R.buildIPS(rom, info.out), defaultName: stem() + '.ips',
    filters: [{ name: 'Patch IPS', extensions: ['ips'] }]
  });
  if (p) reportTo(box, p, info);
}

const rateLabel = () => customCount !== null
  ? '1-' + Math.round(65536 / customCount)
  : R.SHINY_RATES[rateIdx].label.replace('/', '-');
const stem = () => {
  const bits = [];
  if (shinyHits.length) bits.push(rateLabel());
  if (table && encounters.length) bits.push($('seed').value || 'race');
  return romName.replace(/\.[^.]+$/, '') + (bits.length ? ` [${bits.join(' ')}]` : ' [patch]');
};

$('gen').onclick      = () => exportRom('wildout');
$('genips').onclick   = () => exportIps('wildout');
$('shinygen').onclick = () => exportRom('shinyout');
$('shinyips').onclick = () => exportIps('shinyout');

/* --------------------- randomizer complet ---------------------- */





/* cablage du taux libre (ici et pas en ligne dans le HTML : la politique
   de securite de la fenetre interdit les scripts inline) */
$('applyrate').onclick = applyCustomRate;
$('customrate').addEventListener('keydown', e => { if (e.key === 'Enter') applyCustomRate(); });


/* ---------------------- diagnostic ----------------------------- *
 * Construit la ROM patchee en memoire, puis RELIT les octets aux
 * adresses visees. Un rapport qui dit « ecrit » sans relire ne
 * prouve rien : ici on affiche ce que la ROM contient vraiment.   */
function diagnostic() {
  if (!rom) return 'Aucune ROM chargee.';
  const L = [];
  const h = R.readHeader(rom);
  L.push('=== SHINY RACE STUDIO — DIAGNOSTIC ===');
  L.push('version appli : ' + (window.__ver || '?'));
  L.push(`ROM : ${h.title} · ${h.code} · ${(h.size/1048576).toFixed(0)} Mo · v1.${h.version}`);
  L.push('');

  L.push('--- ce qui a ete repere ---');
  L.push(`tests de shininess : ${shinyHits.length}`);
  L.push(`table de rencontres : ${table ? table.count + ' zones' : 'INTROUVABLE'}`);
  L.push(`starters : ${!starters ? 'jeu non reconnu'
    : starters.missing ? 'INTROUVABLES'
    : starters.kind === 'script' ? starters.blocks.length + ' blocs de script'
    : starters.offsets.length + ' adresses de table'}`);
  L.push(`dotation : ${!ballGift ? 'point d\'accroche INTROUVABLE'
    : ballGift.sites.length + ' site(s) a 0x' + ballGift.sites.map(x => hex(x.off, 6)).join(', 0x')}`);
  L.push('');

  L.push('--- cases cochees ---');
  L.push(`randomiser les starters : ${$('dostarters').checked ? 'OUI' : 'NON'}` +
         ($('dostarters').disabled ? ' (case desactivee)' : ''));
  L.push(`appliquer la dotation   : ${$('dokit').checked ? 'OUI' : 'NON'}` +
         ($('dokit').disabled ? ' (case desactivee)' : ''));
  L.push(`quantites demandees     : ` + readKit().map(x => x.item + '×' + x.qty).join(', '));
  L.push('');

  const info = buildPatched();
  L.push('--- ecritures calculees ---');
  L.push(`taux de shiny : ${info.shiny.length} octet(s)`);
  L.push(`rencontres    : ${info.writes.length} emplacement(s)`);
  L.push(`starters      : ${info.start.writes.length} octet(s)`);
  L.push(`dotation      : ${info.kit.writes.length} octet(s)` +
         (info.kit.noSpace ? '  <-- AUCUN ESPACE LIBRE TROUVE' : ''));
  L.push('');

  L.push('--- relecture de la ROM patchee ---');
  if (ballGift && info.kit.writes.length) {
    for (const site of ballGift.sites) {
      const op = info.out[site.off];
      const ptr = (info.out[site.off+1] | info.out[site.off+2] << 8
                 | info.out[site.off+3] << 16 | info.out[site.off+4] << 24) >>> 0;
      L.push(`  0x${hex(site.off,6)} : opcode 0x${hex(op,2)} ${op === 0x04 ? '(call)' : '(ATTENDU 0x04)'}`
           + ` -> 0x${hex(ptr,8)}`);
    }
    let o = info.kit.scriptOff;
    L.push(`  script injecte a 0x${hex(o,6)} :`);
    let n = 0;
    while (info.out[o] === 0x44 && n++ < 12) {
      const it = info.out[o+1] | info.out[o+2] << 8;
      const q  = info.out[o+3] | info.out[o+4] << 8;
      L.push(`     objet ${it} x${q}`);
      o += 5;
    }
    L.push(`     fin de script : 0x${hex(info.out[o],2)} ${info.out[o] === 0x03 ? '(return)' : '(ATTENDU 0x03)'}`);
  } else {
    L.push('  dotation non appliquee, rien a relire');
  }

  if (starters && info.start.writes.length && starters.kind === 'script') {
    L.push('  starters relus :');
    for (const bl of starters.blocks) {
      const you = info.out[bl.youOff]   | info.out[bl.youOff+1]   << 8;
      const riv = info.out[bl.rivalOff] | info.out[bl.rivalOff+1] << 8;
      L.push(`     ball ${bl.ball} : toi=${you} rival=${riv}` +
             (you === bl.you ? '   <-- INCHANGE' : ''));
    }
  }

  let diff = 0;
  for (let i = 0; i < rom.length; i++) if (rom[i] !== info.out[i]) diff++;
  L.push('');
  L.push(`total : ${diff} octet(s) different(s) de la ROM d'origine`);
  return L.join('\n');
}

$('diagbtn').onclick = () => {
  let txt;
  try { txt = diagnostic(); }
  catch (e) { txt = 'ERREUR PENDANT LE DIAGNOSTIC\n' + (e && e.stack || e); }
  $('diagout').textContent = txt;
  $('diagout').style.display = 'block';
};

$('diagcopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('diagout').textContent || ''); $('diagcopy').textContent = 'Copié'; }
  catch { $('diagcopy').textContent = 'Copie impossible'; }
  setTimeout(() => { $('diagcopy').textContent = 'Copier'; }, 1800);
};

/* ---------------------- mises a jour -------------------------- */
(function updates(){
  const box = document.getElementById('updbox');
  const btn = document.getElementById('updbtn');
  if (!box || !btn || !window.api.update) return;

  const say = (html, cls) => { box.innerHTML = `<div class="msg${cls ? ' ' + cls : ''}">${html}</div>`; };

  /* Bandeau en tete de fenetre : une ligne fine, qui ne se montre que
     s'il y a reellement une version a installer. Silencieux sinon. */
  const ban = document.getElementById('updbanner');
  const banTxt = document.getElementById('ub-txt');
  const banGo = document.getElementById('ub-go');
  document.getElementById('ub-close').onclick = () => { ban.hidden = true; };
  banGo.onclick = () => window.api.update.install();

  const showBanner = (txt, pret) => {
    banTxt.textContent = txt;
    banGo.hidden = !pret;
    ban.hidden = false;
  };

  window.api.update.on((_evt, msg) => {
    if (msg.state === 'found')
      showBanner(`Version ${msg.version} disponible — téléchargement…`, false);
    if (msg.state === 'progress')
      showBanner(`Téléchargement de la mise à jour — ${Math.round(msg.percent)} %`, false);
    if (msg.state === 'ready')
      showBanner(`Version ${msg.version} prête à installer`, true);

    if (msg.state === 'checking')   say('Recherche d\'une nouvelle version…');
    if (msg.state === 'none')       say('Tu es a jour (version ' + msg.version + ').', 'good');
    if (msg.state === 'found')      say(`<b>Version ${msg.version} disponible.</b> Telechargement en cours…`);
    if (msg.state === 'progress')   say(`Telechargement : ${Math.round(msg.percent)} %`);
    if (msg.state === 'ready') {
      say(`<b>Version ${msg.version} prete.</b> Elle s'installera au redemarrage.
           <div class="acts"><button class="btn primary" id="updnow">Redemarrer et installer</button></div>`, 'good');
      document.getElementById('updnow').onclick = () => window.api.update.install();
    }
    if (msg.state === 'error') {
      const m = String(msg.message || '');
      /* Un depot sans Release n'est pas une panne : c'est l'etat normal
         tant que la premiere n'a pas ete publiee. Le dire clairement. */
      if (/no published versions|404|Not Found/i.test(m)) {
        say("<b>Aucune version publiée sur le dépôt.</b> C'est normal tant qu'aucune Release n'a été"
          + " créée sur GitHub. La connexion, elle, fonctionne : l'application a bien interrogé le dépôt.");
      } else {
        say('<b>Vérification impossible.</b> ' + m);
      }
    }
    if (msg.state === 'portable')   say("Cette copie est la version portable : elle ne se met pas a jour toute seule. Retelecharge la derniere version quand tu veux.");
    btn.disabled = msg.state === 'checking' || msg.state === 'progress';
  });

  btn.onclick = () => { btn.disabled = true; window.api.update.check(); };
})();


/* Version affichee en clair : permet de verifier d'un coup d'oeil
   qu'on lance bien la derniere build et pas une copie precedente. */
(async () => {
  const el = document.getElementById('verline');
  if (!el) return;
  let v = '—';
  try { if (window.api.appVersion) v = await window.api.appVersion(); } catch {}
  window.__ver = v;
  el.textContent = 'version ' + v;
  const p = document.getElementById('updver');
  if (p) p.textContent = 'version ' + v;
})();
