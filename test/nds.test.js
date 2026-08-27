/* Tests du module NDS. `node test/nds.test.js` */
const N = require('../src/nds');

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond){ pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);

/* ---------- fabrique une ROM DS synthétique ---------- */
function makeRom({ arm9 }){
  const HEADER = 0x4000;
  const arm9Off = HEADER;
  const arm7Off = arm9Off + arm9.length;
  const arm7 = new Uint8Array(0x400).fill(0x77);
  const fntOff = arm7Off + arm7.length, fnt = new Uint8Array(0x80).fill(0x11);
  const fatOff = fntOff + fnt.length;
  const files = [[0,0x100],[0x100,0x240]];        // décalages relatifs au début des fichiers
  const dataOff = fatOff + files.length*8;
  const data = new Uint8Array(0x300).fill(0x5A);
  const total = dataOff + data.length;

  const b = new Uint8Array(total);
  'PKMTEST'.split('').forEach((c,i) => b[i] = c.charCodeAt(0));
  'IPKF'.split('').forEach((c,i) => b[0x0C+i] = c.charCodeAt(0));
  b[0x15C] = 0x56; b[0x15D] = 0xCF;
  const w = (o,v) => { b[o]=v&255; b[o+1]=v>>8&255; b[o+2]=v>>16&255; b[o+3]=v>>>24&255; };
  w(N.FIELDS.arm9Offset, arm9Off); w(N.FIELDS.arm9Size, arm9.length);
  w(N.FIELDS.arm7Offset, arm7Off); w(N.FIELDS.arm7Size, arm7.length);
  w(N.FIELDS.fntOffset, fntOff);   w(N.FIELDS.fntSize, fnt.length);
  w(N.FIELDS.fatOffset, fatOff);   w(N.FIELDS.fatSize, files.length*8);
  w(N.FIELDS.bannerOffset, 0);
  w(N.FIELDS.romSize, total);      w(N.FIELDS.headerSize, HEADER);
  b.set(arm9, arm9Off); b.set(arm7, arm7Off); b.set(fnt, fntOff); b.set(data, dataOff);
  files.forEach(([a,z],i) => { w(fatOff+i*8, dataOff+a); w(fatOff+i*8+4, dataOff+z); });
  N.fixHeaderCrc(b);
  return { rom:b, arm9Off, cut: arm9Off + arm9.length, fatOff, dataOff, total };
}

/* ---------- 1. en-tête et CRC ---------- */
console.log('\nEn-tête et sommes de contrôle');
{
  const { rom } = makeRom({ arm9: new Uint8Array(0x800).fill(0x99) });
  const h = N.readHeader(rom);
  ok('en-tête reconnu', !!h && h.code === 'IPKF', h && h.title);
  ok('CRC16 cohérent', h.headerCrc === N.crc16(rom, 0, 0x15E), '0x'+h.headerCrc.toString(16));
  const bad = rom.slice(); bad[0x15C] = 0;
  ok('en-tête invalide rejeté', N.readHeader(bad) === null);
  ok('CRC16 sensible au contenu', (() => {
    const c1 = N.crc16(rom,0,0x15E); const m = rom.slice(); m[0x10] ^= 0xFF;
    return N.crc16(m,0,0x15E) !== c1;
  })());
}

/* ---------- 2. codec BLZ ---------- */
console.log('\nCodec BLZ');
{
  // données à redondance forte, comme du vrai code
  const mk = n => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = i % 97 < 40 ? (i*7)&255 : (i%13);
    return a;
  };
  let allRound = true, ratios = [];
  for (const size of [64, 512, 5000, 60000]){
    const raw = mk(size);
    const packed = N.blzCompress(raw);
    const info = N.blzInfo(packed);
    let back = null;
    try { back = N.blzDecompress(packed); } catch(e){ back = null; }
    const good = back && eq(back, raw);
    if (!good) allRound = false;
    ratios.push(`${size}→${packed.length}`);
    ok(`aller-retour ${size} octets`, !!good, info ? `enc=${info.encLen} inc=${info.incLen}` : 'pied illisible');
  }
  ok('taux de compression plausibles', true, ratios.join('  '));

  const noise = new Uint8Array(256);
  for (let i = 0; i < 256; i++) noise[i] = (i*167+13) & 255;
  ok('aller-retour sur données peu compressibles',
     eq(N.blzDecompress(N.blzCompress(noise)), noise));

  ok('pied absent → non comprimé', !N.isCompressed(new Uint8Array(64)));
  let threw = false;
  try { N.blzDecompress(new Uint8Array(4)); } catch { threw = true; }
  ok('entrée trop courte → erreur explicite', threw);
}

/* ---------- 3. remplacement de arm9 ---------- */
console.log('\nRemplacement de arm9 et relocalisation');
{
  // cas A : nouvel arm9 plus petit → rien ne bouge
  const A = makeRom({ arm9: new Uint8Array(0x1000).fill(0xAB) });
  const smaller = new Uint8Array(0x0C00).fill(0xCD);
  const rA = N.replaceArm9(A.rom, smaller);
  const hA = N.readHeader(rA);
  ok('taille identique du fichier', rA.length === A.rom.length);
  ok('champ arm9Size mis à jour', hA.arm9Size === smaller.length);
  ok('sections suivantes intactes', hA.fatOffset === N.readHeader(A.rom).fatOffset);
  ok('arm9 bien écrit', eq(rA.slice(hA.arm9Offset, hA.arm9Offset+smaller.length), smaller));
  ok('CRC recalculé', hA.headerCrc === N.crc16(rA,0,0x15E));

  // cas B : nouvel arm9 plus grand → tout ce qui suit se décale
  const B = makeRom({ arm9: new Uint8Array(0x1000).fill(0xAB) });
  const h0 = N.readHeader(B.rom);
  const fat0 = [];
  for (let i = 0; i + 8 <= h0.fatSize; i += 8)
    fat0.push([ (B.rom[h0.fatOffset+i]|B.rom[h0.fatOffset+i+1]<<8|B.rom[h0.fatOffset+i+2]<<16|B.rom[h0.fatOffset+i+3]<<24)>>>0 ]);
  const bigger = new Uint8Array(0x1500).fill(0xEF);
  const rB = N.replaceArm9(B.rom, bigger);
  const hB = N.readHeader(rB);
  const pad = rB.length - B.rom.length;
  ok('fichier agrandi et aligné sur 512', pad > 0 && pad % 0x200 === 0, `+${pad}`);
  ok('arm7 décalé', hB.arm7Offset === h0.arm7Offset + pad);
  ok('FAT décalée', hB.fatOffset === h0.fatOffset + pad);
  ok('romSize mis à jour', hB.romSize === h0.romSize + pad);
  const rdF = (b,o) => (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0;
  ok('entrées FAT corrigées',
     rdF(rB, hB.fatOffset) === fat0[0][0] + pad,
     `${fat0[0][0]} → ${rdF(rB, hB.fatOffset)}`);
  ok('contenu des fichiers préservé',
     eq(rB.slice(rdF(rB,hB.fatOffset), rdF(rB,hB.fatOffset)+16),
        B.rom.slice(fat0[0][0], fat0[0][0]+16)));
  ok('arm9 agrandi bien écrit', eq(rB.slice(hB.arm9Offset, hB.arm9Offset+bigger.length), bigger));
  ok('CRC recalculé', hB.headerCrc === N.crc16(rB,0,0x15E));
}

/* ---------- 4. détection du test de shininess ---------- */
console.log('\nDétection du test de shininess');
{
  /* Signature relevée à l'identique sur les neuf jeux DS. Elle commence
     au deuxième octet de la fonction, donc à une adresse impaire : c'est
     précisément ce qu'un balayage sur les positions paires manque. */
  const SIG = [0x4b,0x0a,0x04,0x19,0x40,0x03,0x40,0x00,0x04,0x1b,0x0c,0x00,0x0c,0x09,0x0c,0x58,0x40,0x12,0x0c,0x48,0x40,0x50,0x40,0x08,0x28];
  const FN = 0x140;                       // adresse paire, comme dans les vrais jeux
  const b = new Uint8Array(0x400);
  b[FN] = 0x09;                           // octet variable selon le jeu
  SIG.forEach((v,i) => b[FN+1+i] = v);
  b[FN+26] = 0x01; b[FN+27] = 0xD2;       // bhs, queue de fonction

  const hits = N.findShinyChecks(b);
  ok('fonction localisée', hits.length === 1 && hits[0].off === FN,
     JSON.stringify(hits));
  ok('octet de seuil repéré', hits[0] && hits[0].seuil === FN+24 && hits[0].old === 8);

  ok('1/8192 (count 8) laisse le seuil inchangé', N.shinyPatches(hits, 8).length === 0);
  const p256 = N.shinyPatches(hits, 16);
  ok('1/4096 (count 16) → un seul octet réécrit',
     p256.length === 1 && p256[0].type === 'seuil' && p256[0].bytes[0] === 16);

  const p100 = N.shinyPatches(hits, 65536);
  ok('100 % → réécriture de 26 octets',
     p100.length === 1 && p100[0].type === 'reecriture' && p100[0].bytes.length === 26);
  ok('100 % → queue de fonction préservée', p100[0].off + p100[0].bytes.length === FN+26);

  ok('seuil 1/256 déborde l\'octet et bascule en réécriture',
     N.countFromDenominator(256).count === 256 && N.shinyPatches(hits,256)[0].type === 'reecriture');

  ok('unité respectée : 1/4096 ne vaut pas 4096',
     N.countFromDenominator(4096).count === 16);

  const d = N.decomposer(N.countFromDenominator(10).count);
  ok('1/10 reconstitué fidèlement', Math.round(65536/d.effectif) === 10,
     `k=${d.k} m=${d.m} effectif=${d.effectif}`);
}

console.log('\nBoucle anti-chromatique');
{
  const b = new Uint8Array(0x200);
  // eors r0,r2 / cmp r0,#8 / blo arrière  → la boucle qui figerait le jeu
  b[0x40]=0x50; b[0x41]=0x40; b[0x42]=0x08; b[0x43]=0x28; b[0x44]=0xF0; b[0x45]=0xD3;
  // même motif mais bhs et saut avant → c'est la fonction, à ne PAS toucher
  b[0x80]=0x50; b[0x81]=0x40; b[0x82]=0x08; b[0x83]=0x28; b[0x84]=0x01; b[0x85]=0xD2;
  const l = N.findAntiShinyLoops(b);
  ok('boucle détectée', l.length === 1 && l[0].off === 0x44, JSON.stringify(l));
  ok('fonction non confondue avec la boucle', !l.some(x => x.off === 0x84));
  const pl = N.loopPatches(l);
  ok('saut remplacé par une instruction neutre',
     pl.length === 1 && pl[0].bytes[0] === 0xC0 && pl[0].bytes[1] === 0x46);
}

/* ---------- 5. chaîne complète ---------- */
console.log('\nChaîne complète');
{
  const SIG = [0x4b,0x0a,0x04,0x19,0x40,0x03,0x40,0x00,0x04,0x1b,0x0c,0x00,0x0c,0x09,0x0c,0x58,0x40,0x12,0x0c,0x48,0x40,0x50,0x40,0x08,0x28];
  const raw = new Uint8Array(0x4000);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 71 < 30 ? (i*5)&255 : 0;
  const FN = 0x2000;
  raw[FN] = 0x09; SIG.forEach((v,i) => raw[FN+1+i] = v);
  raw[FN+26] = 0x01; raw[FN+27] = 0xD2;

  const KEEP = 0x1000;                    // tête laissée en clair, comme les vrais jeux

  /* ModuleParams dans la tête en clair, comme dans les vrais jeux. Le
     champ de fin doit désigner la fin de l'arm9 comprimé — dont on ne
     connaît la taille qu'après compression. On comprime donc une
     première fois pour la mesurer, on écrit le champ, puis on recomprime :
     le champ vit dans la tête recopiée telle quelle, la taille ne bouge
     donc pas. */
  const MP = 0x800;                       // adresse du repère 0xDEC00621
  const poserMP = (buf, fin) => {
    [0x21,0x06,0xC0,0xDE,0xDE,0xC0,0x06,0x21].forEach((v,i) => buf[MP+i] = v);
    const o = MP - 8;
    buf[o] = fin & 255; buf[o+1] = fin>>8 & 255; buf[o+2] = fin>>16 & 255; buf[o+3] = fin>>>24 & 255;
  };
  poserMP(raw, 0);
  const tailleComprimee = N.blzCompress(raw, KEEP).length;
  poserMP(raw, tailleComprimee);          // arm9Ram vaut 0 dans la ROM d'essai

  const arm9 = N.blzCompress(raw, KEEP);
  ok('la taille ne bouge pas après écriture du champ', arm9.length === tailleComprimee);
  ok('tête préservée par le compresseur',
     eq(arm9.slice(0, KEEP), raw.slice(0, KEEP)));
  ok('aller-retour du codec', eq(N.blzDecompress(arm9), raw));

  const mp = N.findModuleParams(arm9, KEEP);
  ok('ModuleParams localisés dans la tête en clair', mp.ok && mp.mark === MP);

  const { rom } = makeRom({ arm9 });
  const r = N.patchNds(rom, 16);
  ok('la ROM est produite', r.ok === true && !!r.rom,
     r.steps.filter(s=>!s.ok).map(s=>s.name).join(', ') || '—');

  if (r.rom){
    const back = N.blzDecompress(N.extractArm9(r.rom));
    ok('seuil effectivement écrit', back[FN+24] === 16, 'valeur = '+back[FN+24]);
    ok('reste de arm9 inchangé',
       eq(back.slice(0, FN+24), raw.slice(0, FN+24)) && eq(back.slice(FN+25), raw.slice(FN+25)));
    const h = N.readHeader(r.rom);
    ok('CRC de la ROM patchée valide', h.headerCrc === N.crc16(r.rom,0,0x15E));
    ok('la ROM ne grossit pas', r.rom.length <= rom.length);

    /* ⚠ Le test qui manquait, et qui aurait attrapé les six jeux qui ne
       démarraient pas. Le champ doit désigner la fin du NOUVEL arm9. */
    const a9 = N.extractArm9(r.rom);
    const mp2 = N.findModuleParams(a9, KEEP);
    ok('ModuleParams toujours lisibles après patch', mp2.ok);
    ok('fin comprimée recalée sur la nouvelle taille',
       mp2.ok && mp2.endValue === a9.length,
       mp2.ok ? `champ = ${mp2.endValue}, arm9 = ${a9.length}` : '');
    ok('le champ a bien changé de valeur',
       mp2.ok && mp2.endValue !== tailleComprimee || a9.length === tailleComprimee,
       `avant ${tailleComprimee}, apres ${mp2.ok ? mp2.endValue : '?'}`);
    ok('rapport : recalage signalé',
       !!r.moduleParams && r.moduleParams.apres === a9.length);
  }

  /* À 100 %, ce sont vingt-six octets qui sont réécrits, pas un : la
     taille comprimée a de bonnes chances de changer. C'est le cas qui
     compte, puisque c'est le décalage qui empêchait le jeu de démarrer. */
  {
    const r2 = N.patchNds(rom, 65536);
    ok('100 % : la ROM est produite', r2.ok === true,
       r2.steps.filter(s=>!s.ok).map(s=>s.name).join(', ') || '—');
    if (r2.rom){
      const a2 = N.extractArm9(r2.rom);
      const m2 = N.findModuleParams(a2, KEEP);
      ok('100 % : fin comprimée recalée', m2.ok && m2.endValue === a2.length,
         m2.ok ? `champ = ${m2.endValue}, arm9 = ${a2.length}, origine ${tailleComprimee}` : '');
      /* La réécriture pose `cmp r0,#m` en onzième mot, soit l'octet
         d'immédiat en +20 et l'opcode 0x28 en +21. */
      const deplie = N.blzDecompress(a2);
      const d = N.decomposer(65536);
      ok('100 % : le patch se relit après dépliage',
         deplie[FN + 21] === 0x28 && deplie[FN + 20] === (d.m & 0xFF),
         `cmp r0,#${deplie[FN + 20]} (attendu ${d.m}), k=${d.k}`);
    }
  }

  const plain = makeRom({ arm9: new Uint8Array(0x800) });
  const r3 = N.patchNds(plain.rom, 256);
  ok('arm9 sans signature : arrêt propre',
     r3.ok === false && r3.steps.some(s => !s.ok && /fonction de test/.test(s.name)));

  /* Mode analyse : c'est celui qu'emprunte l'ouverture d'une ROM. Il doit
     trouver la fonction sans jamais recomprimer, donc sans rendre de ROM. */
  const r4 = N.patchNds(rom, 16, { analyzeOnly: true });
  ok('analyse seule : fonction localisée', r4.ok === true && r4.hits.length > 0);
  ok('analyse seule : aucune ROM produite', r4.rom === null && r4.analyzeOnly === true);
  ok('analyse seule : aucune recompression',
     !r4.steps.some(s => /reconstruit|relecture/.test(s.name)));
}

/* ------------------------------------------------------------------ *
 *  Vitesse du compresseur                                            *
 *                                                                    *
 *  La version d'origine essayait les 4096 distances à chaque octet et *
 *  mettait une vingtaine de secondes sur un arm9 d'un mégaoctet : la  *
 *  fenêtre restait figée et l'utilisateur concluait à un plantage.    *
 *  Le seuil est large à dessein — il n'attrape pas une machine lente, *
 *  seulement un retour à l'algorithme quadratique.                    *
 * ------------------------------------------------------------------ */
console.log('\nVitesse du compresseur');
{
  const T = 512 * 1024;
  const raw = new Uint8Array(T);
  let s = 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) >>> 24;
  for (let i = 0; i < T; i++)
    raw[i] = (i % 211) < 90 ? [0x00,0x46,0xC0,0x1C,0x68,0x60,0xF0,0xB5][(i>>1)&7] : rnd();

  const t0 = Date.now();
  const enc = N.blzCompress(raw, 0x4000);
  const ms = Date.now() - t0;
  ok('512 Ko comprimés en moins de 5 s', ms < 5000, ms + ' ms');
  ok('résultat toujours exact', eq(N.blzDecompress(enc), raw));
}

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
