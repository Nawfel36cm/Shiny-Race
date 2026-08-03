/* app.js — câblage de l'interface. Toute la logique ROM vit dans rom.js. */
const R = window.ROM;
window.addEventListener('DOMContentLoaded', () => renderCompat(null));
const $ = id => document.getElementById(id);
const hex = (n, p = 2) => n.toString(16).toUpperCase().padStart(p, '0');

let rom = null, romPath = '', romName = '';
let shinyHits = [], rateIdx = 5;
let table = null, encounters = [], mode = 'global';
let jar = null, settings = null;

/* ------------------------- ouverture ------------------------- */
$('open').onclick = async () => {
  const f = await window.api.pickRom();
  if (!f) return;
  rom = new Uint8Array(f.bytes);
  romPath = f.path; romName = f.name;

  ['shiny','wild'].forEach(t => document.querySelector(`.tab[data-t="${t}"]`).disabled = false);
  const info = window.PLATFORMS.describe(rom);
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

  renderCompat(info.platform.id);
  show('shiny');
  renderRates(); renderShiny(); renderWildStatus();
};


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
  ['shiny', 'wild', 'upr', 'compat'].forEach(p => $('pane-' + p).hidden = p !== t);
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { if (!b.disabled) show(b.dataset.t); });

/* ---------------------------- shiny --------------------------- */
function renderRates() {
  $('rates').innerHTML = R.SHINY_RATES.map((r, i) =>
    `<button class="chip" data-i="${i}" aria-pressed="${i === rateIdx}">${r.label}</button>`).join('');
  $('rates').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    rateIdx = +b.dataset.i; renderRates(); renderShiny();
  });
}

const shinyList = () => R.shinyPatches(shinyHits, R.SHINY_RATES[rateIdx].count);

function renderShiny() {
  if (!shinyHits.length) {
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

function renderWildStatus() {
  const ok = table && encounters.length;
  $('wildstatus').innerHTML = ok
    ? `<div class="msg good"><b>${table.count} zones trouvées</b> à partir de 0x${hex(table.start, 6)}, soit ${encounters.length} emplacements de rencontre modifiables (herbe, eau, éclate-roc, pêche).</div>`
    : `<div class="msg"><b>Table de rencontres introuvable.</b> Le randomizer intégré ne peut pas travailler sur cette ROM. L'onglet « Randomizer avancé » reste utilisable.</div>`;
  $('gen').disabled = !ok; $('genips').disabled = !ok;
}

function buildPatched() {
  const out = rom.slice();
  const writes = R.randomizeEncounters(encounters, {
    mode, seed: $('seed').value || 'race', noDupes: $('nodupes').checked
  });
  R.applyEncounters(out, writes);
  if ($('alsoshiny').checked) shinyList().forEach(p => out[p.off] = p.value);
  return { out, writes };
}

const stem = () => romName.replace(/\.[^.]+$/, '') +
  ` [${$('seed').value}${$('alsoshiny').checked ? ' ' + R.SHINY_RATES[rateIdx].label.replace('/', '-') : ''}]`;

$('gen').onclick = async () => {
  const { out, writes } = buildPatched();
  const p = await window.api.saveBytes({
    data: out, defaultName: stem() + '.gba',
    filters: [{ name: 'ROM GBA', extensions: ['gba'] }]
  });
  if (p) done(p, writes.length);
};

$('genips').onclick = async () => {
  const { out, writes } = buildPatched();
  const ips = R.buildIPS(rom, out);
  const p = await window.api.saveBytes({
    data: ips, defaultName: stem() + '.ips',
    filters: [{ name: 'Patch IPS', extensions: ['ips'] }]
  });
  if (p) done(p, writes.length);
};

function done(p, n) {
  $('wildout').innerHTML = `<div class="msg good"><b>Terminé.</b> ${n} rencontres réécrites. Fichier enregistré. Teste-le dans un émulateur avant de lancer la race.</div>`;
  $('wildout').querySelector('.msg').onclick = () => window.api.reveal(p);
}

/* --------------------- randomizer complet ---------------------- */
let presets = [];

async function refreshSetup() {
  const st = await window.api.setupState();
  presets = st.presets;

  const line = (label, ok, detail) =>
    `<span class="badge ${ok ? 'ok' : 'ko'}">${label}</span> <span class="dimtxt">${detail}</span>`;

  $('setup').innerHTML = st.ready
    ? `<div class="msg good"><b>Randomizer prêt.</b> Moteur ${st.jar.source}, runtime Java ${st.java.source}. Rien d'autre à installer.</div>`
    : `<div class="msg"><b>Randomizer non disponible.</b>
        <ul class="tight">
          <li>${line('Java', st.java.ok, st.java.ok ? st.java.version : 'introuvable')}</li>
          <li>${line('Moteur', !!st.jar.path, st.jar.path || 'PokeRandoZX.jar absent du dossier vendor/')}</li>
        </ul>
        Cette version n'embarque pas le moteur. Voir la section « Tout embarquer » du README pour le livrer dans l'installeur.
        <div class="acts"><button class="btn ghost small" id="pickjar">Indiquer le .jar</button>
        <button class="btn ghost small" id="pickjava">Indiquer Java</button></div></div>`;

  if (!st.ready) {
    const ask = async (key, title, filters) => {
      const f = await window.api.pickFile({ title, filters });
      if (f) { await window.api.setPath({ key, value: f }); refreshSetup(); }
    };
    const j = $('pickjar'), v = $('pickjava');
    if (j) j.onclick = () => ask('jarPath', 'PokeRandoZX.jar', [{ name: 'Java', extensions: ['jar'] }]);
    if (v) v.onclick = () => ask('javaPath', 'Exécutable Java', []);
  }

  $('preset').innerHTML = presets.length
    ? presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')
    : `<option value="">aucun préréglage</option>`;

  uprReady(st.ready);
}

$('addpreset').onclick = async () => {
  const f = await window.api.pickFile({ title: 'Préréglage', filters: [{ name: 'Réglages', extensions: ['rnqs'] }] });
  if (!f) return;
  await window.api.setPath({ key: 'presetDir', value: f.replace(/[\/][^\/]+$/, '') });
  refreshSetup();
};

function uprReady(ready) {
  $('runupr').disabled = !(ready && presets.length && romPath);
}

window.api.onUprLog(line => {
  $('uprlog').hidden = false;
  $('uprlog').textContent += line;
  $('uprlog').scrollTop = $('uprlog').scrollHeight;
});

$('runupr').onclick = async () => {
  const preset = presets[+$('preset').value];
  if (!preset) return;
  const output = await window.api.saveBytes({
    data: new Uint8Array(0),
    defaultName: romName.replace(/\.[^.]+$/, '') + ' [random]' + romName.match(/\.[^.]+$/)[0],
    filters: [{ name: 'ROM', extensions: ['gba', 'nds', '3ds', 'gb', 'gbc'] }]
  });
  if (!output) return;

  $('uprlog').hidden = false; $('uprlog').textContent = '';
  $('runupr').disabled = true;
  const r = await window.api.runUpr({ input: romPath, output, settings: preset.path, log: true });

  if (r.ok && $('uprshiny').checked && shinyHits.length) {
    const patched = await window.api.readRom(output);
    const b = new Uint8Array(patched.bytes);
    R.shinyPatches(R.findShinyChecks(b), R.SHINY_RATES[rateIdx].count).forEach(x => b[x.off] = x.value);
    await window.api.saveBytes({ data: b, defaultName: output, filters: [] });
    $('uprlog').textContent += `\n→ Taux de shiny porté à ${R.SHINY_RATES[rateIdx].label}.`;
  }
  $('runupr').disabled = false;
  $('uprlog').textContent += r.ok ? '\n→ Terminé.' : '\n→ Échec. Le préréglage correspond-il à la génération de la ROM ?';
};

window.addEventListener('DOMContentLoaded', refreshSetup);
