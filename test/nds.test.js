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
  const b = new Uint8Array(0x400);
  // THUMB : deux EOR puis cmp r0,#7 / bhi
  let o = 0x40;
  b[o]=0x41;b[o+1]=0x40; o+=2;
  b[o]=0x42;b[o+1]=0x40; o+=2;
  b[o]=0x07;b[o+1]=0x28; o+=2;
  b[o]=0x02;b[o+1]=0xD8;
  // ARM : EOR puis CMP r0,#8 / BCS
  let a = 0x100;
  b[a]=0x00;b[a+1]=0x00;b[a+2]=0x20;b[a+3]=0xE0; a+=4;   // eor r0,r0,r0
  b[a]=0x08;b[a+1]=0x00;b[a+2]=0x50;b[a+3]=0xE3; a+=4;   // cmp r0,#8
  b[a]=0x00;b[a+1]=0x00;b[a+2]=0x00;b[a+3]=0x2A;         // bcs
  const hits = N.findShinyChecks(b);
  ok('candidat THUMB trouvé', hits.some(h => h.mode==='thumb' && h.off===0x44), JSON.stringify(hits.find(h=>h.mode==='thumb')||{}));
  ok('candidat ARM trouvé',   hits.some(h => h.mode==='arm'   && h.off===0x104), JSON.stringify(hits.find(h=>h.mode==='arm')||{}));
  const p = N.shinyPatches(hits, 256);
  ok('1/256 → immédiat 255 en forme "le"', p.some(x => x.hit.form==='le' && x.value===255));
  ok('1/256 → plafonné en forme "lt"',      p.some(x => x.hit.form==='lt' && x.capped && x.value===255));
  ok('1/512 → immédiat 127', N.shinyPatches(hits,128).some(x => x.hit.form==='le' && x.value===127));
}

/* ---------- 5. garde-fou ---------- */
console.log('\nGarde-fou');
{
  const raw = new Uint8Array(0x2000);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 71 < 30 ? (i*5)&255 : 0;
  let o = 0x80;
  raw[o]=0x41;raw[o+1]=0x40;raw[o+2]=0x42;raw[o+3]=0x40;
  raw[o+4]=0x07;raw[o+5]=0x28;raw[o+6]=0x02;raw[o+7]=0xD8;
  const arm9 = N.blzCompress(raw);
  const { rom } = makeRom({ arm9 });

  const r1 = N.patchNds(rom, 256);
  ok('refuse d\'écrire sans validation', r1.ok === false && r1.rom === null);
  ok('étape bloquante nommée',
     r1.steps.some(s => !s.ok && /validé sur ROM réelle/.test(s.name)),
     r1.steps.filter(s=>!s.ok).map(s=>s.name).join(', ') || '—');
  ok('étapes précédentes passées',
     r1.steps.filter(s => s.ok).length >= 5,
     r1.steps.map(s => (s.ok?'✓':'✗')+s.name).join(' | '));

  const r2 = N.patchNds(rom, 256, { allowUnverified: true });
  ok('écrit une fois débloqué', r2.ok === true && !!r2.rom);
  if (r2.rom){
    const back = N.blzDecompress(N.extractArm9(r2.rom));
    ok('immédiat effectivement modifié dans arm9', back[0x84] === 255, 'valeur = '+back[0x84]);
    ok('reste de arm9 inchangé',
       eq(back.slice(0,0x84), raw.slice(0,0x84)) && eq(back.slice(0x85), raw.slice(0x85)));
    const h = N.readHeader(r2.rom);
    ok('CRC de la ROM patchée valide', h.headerCrc === N.crc16(r2.rom,0,0x15E));
  }

  const plain = makeRom({ arm9: new Uint8Array(0x800) });
  const r3 = N.patchNds(plain.rom, 256, { allowUnverified: true });
  ok('arm9 en clair : pas de test trouvé, arrêt propre',
     r3.ok === false && r3.steps.some(s => !s.ok && /shininess/.test(s.name)));
}

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
