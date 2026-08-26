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
  const change = plat !== null && plat !== id;
  plat = id;
  if (change){                       // on ne garde rien d'un autre support
    rom = null; romName = ''; ndsRep = null; shinyHits = [];
    table = null; encounters = []; starters = null; ballGift = null;
    customCount = null; rateIdx = 1;
    $('idcard').innerHTML = '';
    if ($('customrate')) $('customrate').value = '';
    ['shinyout','customout','hits'].forEach(k => { if ($(k)) $(k).innerHTML = ''; });
  }
  document.querySelectorAll('.ch-card').forEach(c => c.classList.toggle('on', c.dataset.plat === id));
  $('chooser').hidden = true;
  const eb = document.querySelector('.masthead .eyebrow');
  if (eb) eb.textContent = EYEBROW[id];
  $('tabs').hidden = false;
  majPlafond();
  renderCompat(id);
  renderRates();
  syncExportButtons();
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

/* Retour à l'accueil par le logo. On remet tout à zéro plutôt que de
   seulement réafficher l'écran : garder la ROM et les résultats d'un
   autre support en mémoire est le meilleur moyen d'appliquer un
   traitement à la mauvaise machine sans s'en apercevoir. */
function accueil(){
  plat = null; rom = null; romPath = ''; romName = ''; ndsRep = null;
  shinyHits = []; table = null; encounters = []; starters = null; ballGift = null;
  rateIdx = 1; customCount = null;
  $('idcard').innerHTML = '';
  ['shinyout','customout','hits'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });
  if ($('customrate')) $('customrate').value = '';
  document.querySelectorAll('.ch-card').forEach(c => c.classList.remove('on'));
  $('tabs').hidden = true;
  document.querySelectorAll('.pane').forEach(p => p.hidden = true);
  const eb = document.querySelector('.masthead .eyebrow');
  if (eb) eb.textContent = 'Choisis ton support';
  $('chooser').hidden = false;
  renderCompat(null);
  syncExportButtons();
}

document.addEventListener('DOMContentLoaded', () => {
  const b = document.querySelector('.masthead .brand');
  if (!b) return;
  b.style.cursor = 'pointer';
  b.title = "Revenir au choix du support";
  b.setAttribute('role','button');
  b.setAttribute('tabindex','0');
  b.addEventListener('click', accueil);
  b.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); accueil(); }
  });
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
async function ouvrirNds(f, info){
  /* Si nds.js n'a pas pu se charger, mieux vaut le dire franchement que
     laisser l'interface prétendre qu'aucune fonction n'a été trouvée. */
  if (!window.NDS){
    $('idcard').innerHTML = `<div class="msg"><b>Module Nintendo DS non chargé.</b>
      Le fichier nds.js n'a pas été pris en compte par l'application. Signale-le,
      c'est un défaut d'installation et non un problème de ROM.</div>`;
    return;
  }
  const h = window.NDS.readHeader(rom);
  if (!h){
    $('idcard').innerHTML = `<div class="msg"><b>En-tête Nintendo DS illisible.</b>
      Le fichier est reconnu comme une ROM DS mais son en-tête ne se lit pas.
      Vérifie qu'il n'est ni tronqué ni encore dans une archive.</div>`;
    return;
  }
  ndsRep = window.NDS.patchNds(rom, activeCount());

  const trouve = ndsRep.hits.length > 0;
  const boucles = (ndsRep.loops || []).length;
  const jeu = window.GAMES.ndsGame(h.code);
  const sha = await R.sha1(f.bytes).catch(() => '—');

  /* Le jeu reconnu est la première ligne, volontairement : c'est le
     contrôle le plus rapide qu'un fichier est bien celui qu'on croit.
     Un code inconnu est annoncé comme tel plutôt que deviné. */
  $('idcard').innerHTML = `<div class="panel"><dl class="rows">
    <dt>Jeu</dt><dd>${jeu
        ? `<b>${jeu.nom}</b> · ${jeu.region || 'région inconnue'} · génération ${jeu.gen}`
        : `<span style="color:var(--red)">Jeu non reconnu</span> — code ${h.code || '????'}.
           Le traitement peut être tenté, mais il n'a été vérifié que sur les neuf jeux Pokémon DS.`}</dd>
    <dt>Code</dt><dd>${h.code} · « ${h.title || '—'} » · ${(rom.length/1048576).toFixed(0)} Mo</dd>
    <dt>SHA-1</dt><dd style="font-size:11px">${sha}</dd>
    <dt>arm9</dt><dd>${window.NDS.isCompressed(window.NDS.extractArm9(rom))
        ? 'comprimé en BLZ — sera déplié puis recomprimé' : 'en clair'}</dd>
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
/* Les paliers proposés ne sont pas les mêmes : la 3G bute à 1/256,
   la DS peut monter jusqu'à 100 %. On ne propose donc jamais un
   palier que le support ne saurait pas tenir. */
const RATES_NDS = [
  { label:'1/8192', count:8 },   { label:'1/4096', count:16 },
  { label:'1/1024', count:64 },  { label:'1/256',  count:256 },
  { label:'1/64',   count:1024 },{ label:'1/16',   count:4096 },
  { label:'1/4',    count:16384 },{ label:'100 %', count:65536 }
];
const rates = () => plat === 'nds' ? RATES_NDS : R.SHINY_RATES;
const maxCount = () => plat === 'nds' ? 65536 : R.RATE_MAX_COUNT;

function renderRates() {
  $('rates').innerHTML = rates().map((r, i) =>
    `<button class="chip" data-i="${i}" aria-pressed="${customCount === null && i === rateIdx}">${r.label}</button>`).join('');
  $('rates').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    rateIdx = Math.min(+b.dataset.i, rates().length - 1); customCount = null;
    $('customrate').value = ''; $('customout').innerHTML = '';
    renderRates(); renderShiny();
  });
}

/* Taux libre : l'utilisateur saisit le denominateur voulu. */
function applyCustomRate() {
  const raw = $('customrate').value.trim();
  if (!raw) { customCount = null; $('customout').innerHTML = ''; renderRates(); renderShiny(); return; }
  const r = plat === 'nds' ? window.NDS.countFromDenominator(raw) : R.countFromDenominator(raw);
  customCount = r.count;

  if (r.capped){
    $('customout').innerHTML = plat === 'nds'
      ? `<div class="msg"><b>1/${r.denomAsked} dépasse 100 %.</b>
         Le taux appliqué sera <b>1/${r.denomReal}</b>, soit tous les Pokémon chromatiques.</div>`
      : `<div class="msg"><b>1/${r.denomAsked} est hors de portée en génération 3.</b>
         Le taux appliqué sera <b>1/${r.denomReal}</b>, le maximum atteignable.
         <p>La raison est matérielle : le jeu compare le résultat à une constante logée dans un seul
         octet d'une instruction THUMB. Au-delà de 256 valeurs favorables sur 65536, il faudrait
         injecter du code, pas seulement réécrire un octet.</p></div>`;
  } else {
    const exact = plat === 'nds' && r.count > 255
      ? (() => { const d = window.NDS.decomposer(r.count);
                 return Math.round(65536 / d.effectif); })()
      : r.denomReal;
    $('customout').innerHTML = `<div class="msg good">Taux appliqué : <b>1/${exact}</b>
       (${r.count} valeur${r.count > 1 ? 's' : ''} favorable${r.count > 1 ? 's' : ''} sur 65536).${
       plat === 'nds' && exact !== r.denomAsked
         ? ` <span style="opacity:.75">Arrondi depuis 1/${r.denomAsked} : au-delà de 1/256 la comparaison
             élargie procède par paliers.</span>` : ''}</div>`;
  }
  renderRates(); renderShiny();
}

const activeCount = () => customCount !== null
  ? customCount
  : (rates()[Math.min(rateIdx, rates().length - 1)] || rates()[0]).count;
const shinyList = () => R.shinyPatches(shinyHits, activeCount());

function renderShiny() {
  const has = shinyHits.length > 0;
  syncExportButtons();
  if (!has) {
    /* Le rapport du module dit précisément où ça s'est arrêté. Sans ça,
       une décompression ratée s'affichait comme « fonction introuvable ». */
    const bloc = plat === 'nds' && ndsRep
      ? (ndsRep.steps || []).find(x => !x.ok) : null;
    $('hits').innerHTML = plat === 'nds'
      ? (bloc && !/fonction de test/.test(bloc.name)
          ? `<div class="msg"><b>Traitement interrompu à l'étape « ${bloc.name} ».</b>
             ${bloc.detail ? bloc.detail + '<br>' : ''}
             La fonction de test n'a donc jamais été cherchée.</div>`
          : `<div class="msg"><b>Fonction de test introuvable.</b> Elle est identique sur les neuf jeux DS ;
             son absence signale une ROM déjà modifiée, un ROM hack, ou un jeu hors 4G/5G.</div>`)
      : `<div class="msg"><b>Aucun test de shininess trouvé.</b> Normal sur une ROM déjà patchée, un ROM hack, ou un jeu hors génération 3.</div>`;
    return;
  }

  /* Les résultats DS n'ont pas la même forme que ceux de la 3G : une
     seule fonction au lieu de plusieurs occurrences, et la modification
     peut porter sur un octet ou sur vingt-six. */
  if (plat === 'nds'){
    const c = activeCount();
    const p = window.NDS.shinyPatches(shinyHits, c)[0];
    const h = shinyHits[0];
    const obtenu = !p ? 8192
      : p.type === 'reecriture' ? Math.round(65536 / p.effectif) : Math.round(65536 / p.N);
    const boucles = ndsRep && ndsRep.loops ? ndsRep.loops.length : 0;
    $('hits').innerHTML = `<div class="hit">
      <div class="hit-top"><span class="addr">0x${hex(h.off, 6)}</span>
        <span class="tag">signature vérifiée sur les 9 jeux</span></div>
      <div class="asm">
        <span class="lbl">avant</span><span><span class="was">cmp r0, #${h.old}</span> ; bhs — 1/${Math.round(65536 / h.old)}</span>
        <span class="lbl">après</span><span><span class="now">${
          !p ? 'inchangé' : p.type === 'reecriture'
            ? 'fonction réécrite (26 octets)' : 'cmp r0, #' + p.bytes[0]}</span> ; 1/${obtenu}</span>
        <span class="lbl">portée</span><span>${!p ? '0' : p.bytes.length} octet(s) dans arm9${
          boucles ? ` · ${boucles} boucle anti-shiny neutralisée` : ''}</span>
      </div></div>
      <p class="note">${p && p.type === 'reecriture'
        ? `Au-delà de 1/256 la comparaison est élargie : le taux obtenu procède par paliers, d'où le 1/${obtenu} affiché.`
        : `Un seul octet suffit jusqu'à 1/256.`} La fonction est unique dans le jeu et appelée de trois à huit fois selon le titre : la modifier couvre tous les cas.</p>`;
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
  /* R.readHeader ne sait lire qu'un en-tête GBA et rend null ailleurs.
     L'appeler sur une ROM DS levait une erreur qui interrompait tout le
     chargement — et laissait le bouton d'export désactivé sans le
     moindre message. */
  if (plat === 'nds'){
    $('wildstatus').innerHTML = `<div class="msg"><b>Randomizer indisponible en Nintendo DS.</b>
      <p>Les rencontres, les starters et les objets sont rangés dans les archives internes de la ROM,
      pas dans le code. Le taux de shiny, lui, <b>est pleinement opérationnel</b> depuis l'onglet précédent.</p></div>`;
    syncExportButtons();
    return;
  }
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
  /* L'extension suit le support de la ROM ouverte, pas un défaut écrit
     en dur : une ROM DS enregistrée en .gba n'est ouverte par aucun
     émulateur. On repart de l'extension du fichier d'origine quand elle
     est exploitable, sinon de celle du support. */
  const ext = plat === 'nds' ? 'nds' : 'gba';
  const orig = (romName.match(/\.([A-Za-z0-9]+)$/) || [])[1];
  const finale = (orig && orig.toLowerCase() === ext) ? orig : ext;
  const p = await window.api.saveBytes({
    data: info.out, defaultName: stem() + '.' + finale,
    filters: [
      { name: plat === 'nds' ? 'ROM Nintendo DS' : 'ROM Game Boy Advance', extensions: [ext] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  });
  if (p) reportTo(box, p, info);
}

async function exportIps(box) {
  const info = buildPatched();
  if (!info.shiny.length && !info.writes.length && !info.start.writes.length && !info.kit.writes.length) {
    $(box).innerHTML = `<div class="msg"><b>Rien à écrire.</b> Aucun changement à appliquer sur cette ROM.</div>`;
    return;
  }

  /* Le format IPS code ses adresses sur trois octets : il ne sait pas
     désigner un octet au-delà de 16 Mo. Une ROM DS en fait 128. Nos
     modifications restent dans arm9, tout en bas du fichier, mais il
     faut le vérifier plutôt que le supposer — un patch qui déborde
     s'applique silencieusement au mauvais endroit. */
  if (info.out.length !== rom.length){
    $(box).innerHTML = `<div class="msg"><b>Patch IPS impossible.</b>
      La ROM produite n'a pas la même taille que l'originale ; le format IPS ne sait pas
      représenter ça. Utilise « Générer la ROM ».</div>`;
    return;
  }
  let dernier = -1;
  for (let i = rom.length - 1; i >= 0; i--) if (rom[i] !== info.out[i]) { dernier = i; break; }
  if (dernier >= 0xFFFFFF){
    $(box).innerHTML = `<div class="msg"><b>Patch IPS impossible.</b>
      Une modification se situe à l'adresse 0x${hex(dernier, 6)}, au-delà des 16 Mo que le format
      IPS sait adresser. Utilise « Générer la ROM », qui n'a pas cette limite.</div>`;
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
  : (rates()[Math.min(rateIdx, rates().length - 1)] || rates()[0]).label.replace('/', '-').replace(' %','pc').replace(' ','');
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
