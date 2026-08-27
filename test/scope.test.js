/* =====================================================================
   scope.test.js — simulation du chargement navigateur.

   ⚠  POURQUOI CE FICHIER EXISTE.
   Dans la fenêtre, games.js, platforms.js, rom.js et nds.js sont chargés
   par quatre balises <script> qui PARTAGENT LA MÊME PORTÉE GLOBALE. Deux
   d'entre eux déclaraient les mêmes noms — readHeader, rd32,
   findShinyChecks, shinyPatches, countFromDenominator, RATE_MAX_COUNT —
   et le navigateur rejetait le second fichier en entier. Résultat :
   window.NDS n'existait pas, et l'interface se comportait comme si
   aucune fonction n'était trouvée, sans le moindre message.

   Les tests Node ne pouvaient pas voir ce défaut : `require` donne à
   chaque fichier sa propre portée, où la collision n'a pas lieu. D'où
   cette simulation, qui concatène les quatre scripts dans une portée
   unique, exactement comme le fait la page.

   `node test/scope.test.js`
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond){ pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};

const SRC = path.join(__dirname, '..', 'src');
/* L'ordre est celui des balises <script> dans index.html. Le changer ici
   sans le changer là-bas ferait passer un test qui ne prouve plus rien. */
const FICHIERS = ['games.js', 'platforms.js', 'rom.js', 'nds.js', 'upr-modes.js'];

console.log('\nChargement navigateur — portée globale partagée');

/* Le strict minimum pour que les scripts s'exécutent hors navigateur.
   On ne simule pas le DOM : aucun des quatre n'y touche au chargement. */
const faux = {
  document: { addEventListener(){}, getElementById(){ return null; },
              querySelector(){ return null; }, querySelectorAll(){ return []; } },
  console, setTimeout, clearTimeout, crypto: global.crypto,
  TextEncoder, TextDecoder
};
faux.window = faux;
faux.self = faux;
faux.globalThis = faux;

const ctx = vm.createContext(faux);

let erreur = null;
for (const f of FICHIERS){
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  try { new vm.Script(code, { filename: f }).runInContext(ctx); }
  catch (e){ erreur = `${f} — ${e.message}`; break; }
}

ok('les quatre scripts se chargent dans une portée unique', erreur === null, erreur || '');
ok('window.GAMES existe',     !!ctx.GAMES);
ok('window.PLATFORMS existe', !!ctx.PLATFORMS);
ok('window.ROM existe',       !!ctx.ROM);
ok('window.NDS existe',       !!ctx.NDS, ctx.NDS ? '' : '← le symptôme exact du bug de portée');
ok('window.UPR_MODES existe', !!ctx.UPR_MODES);

/* Les deux modules doivent rester distincts : si nds.js avait écrasé les
   fonctions de rom.js, l'interface appliquerait le traitement DS à une
   ROM GBA et l'inverse, sans rien signaler. */
if (ctx.ROM && ctx.NDS){
  ok('ROM et NDS ne sont pas le même objet', ctx.ROM !== ctx.NDS);
  ok('les deux readHeader sont distincts', ctx.ROM.readHeader !== ctx.NDS.readHeader);
  ok('les deux findShinyChecks sont distincts',
     ctx.ROM.findShinyChecks !== ctx.NDS.findShinyChecks);
}

/* Le module DS ne doit rien laisser traîner dans la portée globale :
   c'est ce que garantit l'IIFE qui l'enveloppe. */
const FUITES = ['rd32', 'rd16', 'wr32', 'wr16', 'blzInfo', 'blzDecompress',
                'blzCompress', 'chercher', 'decomposer', 'normCount',
                'SIG_SHINY', 'SEUIL', 'CRC_TABLE', 'FIELDS', 'GUARD'];
const fuites = FUITES.filter(n => Object.prototype.hasOwnProperty.call(ctx, n));
ok('nds.js ne fuit aucun nom dans la portée globale',
   fuites.length === 0, fuites.length ? 'fuites : ' + fuites.join(', ') : '');

/* Contrôle de cohérence : la liste des balises du HTML doit correspondre
   aux fichiers testés ici, sinon la simulation dérive de la réalité. */
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const balises = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
ok('index.html charge bien ces scripts, dans cet ordre',
   FICHIERS.every((f, i) => balises[i] === f),
   'html : ' + balises.join(', '));

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
