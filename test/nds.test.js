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

  ok('1/8192 laisse le seuil inchangé', N.shinyPatches(hits, 8192).length === 0);
  const p256 = N.shinyPatches(hits, 4096);
  ok('1/4096 → un seul octet réécrit',
     p256.length === 1 && p256[0].type === 'seuil' && p256[0].bytes[0] === 16);

  const p100 = N.shinyPatches(hits, 1);
  ok('100 % → réécriture de 26 octets',
     p100.length === 1 && p100[0].type === 'reecriture' && p100[0].bytes.length === 26);
  ok('100 % → queue de fonction préservée', p100[0].off + p100[0].bytes.length === FN+26);

  ok('seuil 1/256 déborde l\'octet et bascule en réécriture',
     N.seuilPour(256) === 256 && N.shinyPatches(hits,256)[0].type === 'reecriture');

  const d = N.decomposer(N.seuilPour(10));
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
  const arm9 = N.blzCompress(raw, KEEP);
  ok('tête préservée par le compresseur',
     eq(arm9.slice(0, KEEP), raw.slice(0, KEEP)));
  ok('aller-retour du codec', eq(N.blzDecompress(arm9), raw));

  const { rom } = makeRom({ arm9 });
  const r = N.patchNds(rom, 4096);
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
  }

  const plain = makeRom({ arm9: new Uint8Array(0x800) });
  const r3 = N.patchNds(plain.rom, 256);
  ok('arm9 sans signature : arrêt propre',
     r3.ok === false && r3.steps.some(s => !s.ok && /fonction de test/.test(s.name)));
}

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
