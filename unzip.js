/* =====================================================================
   unzip.js — extraction d'archives ZIP, sans dépendance externe.

   Node ne sait pas lire un ZIP. Plutôt que d'ajouter une bibliothèque
   npm — qui alourdirait l'installeur et ajouterait une dépendance à
   suivre — on lit le format directement : il tient en une centaine de
   lignes et n'a pas changé depuis trente ans.

   ⚠ Le bit exécutable compte. L'archive du randomizer contient un Java
   complet ; sans le droit d'exécution sur `java/bin/java`, rien ne
   démarre sur macOS et Linux. Les permissions Unix sont rangées dans
   les 16 bits de poids fort du champ « attributs externes », qu'on
   reporte donc à l'écriture.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

/** Repère la fin du répertoire central, en partant de la fin du fichier. */
function trouverEocd(buf){
  /* Le commentaire final peut faire jusqu'à 64 Ko : on ne remonte pas
     plus loin, sinon on risquerait de tomber sur une signature fortuite
     au milieu des données comprimées. */
  const min = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= min; i--){
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

/** Liste les entrées de l'archive, sans rien décomprimer. */
function lireEntrees(buf){
  const eocd = trouverEocd(buf);
  if (eocd < 0) throw new Error("archive illisible : fin de répertoire introuvable");

  const nb = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xFFFFFFFF) throw new Error('archive au format ZIP64, non pris en charge');

  const out = [];
  for (let i = 0; i < nb; i++){
    if (buf.readUInt32LE(p) !== CEN) throw new Error(`entrée ${i} corrompue`);
    const methode  = buf.readUInt16LE(p + 10);
    const tailleC  = buf.readUInt32LE(p + 20);
    const tailleD  = buf.readUInt32LE(p + 24);
    const lNom     = buf.readUInt16LE(p + 28);
    const lExtra   = buf.readUInt16LE(p + 30);
    const lComm    = buf.readUInt16LE(p + 32);
    const attrExt  = buf.readUInt32LE(p + 38);
    const offLocal = buf.readUInt32LE(p + 42);
    const nom      = buf.toString('utf8', p + 46, p + 46 + lNom);
    out.push({ nom, methode, tailleC, tailleD, offLocal,
               mode: (attrExt >>> 16) & 0xFFF });
    p += 46 + lNom + lExtra + lComm;
  }
  return out;
}

/** Rend le contenu décomprimé d'une entrée. */
function contenu(buf, e){
  if (buf.readUInt32LE(e.offLocal) !== LOC)
    throw new Error(`en-tête local absent pour ${e.nom}`);
  const lNom   = buf.readUInt16LE(e.offLocal + 26);
  const lExtra = buf.readUInt16LE(e.offLocal + 28);
  const debut  = e.offLocal + 30 + lNom + lExtra;
  const brut   = buf.subarray(debut, debut + e.tailleC);

  if (e.methode === 0) return brut;
  if (e.methode === 8) return zlib.inflateRawSync(brut);
  throw new Error(`compression ${e.methode} non prise en charge (${e.nom})`);
}

/**
 * Extrait l'archive dans `dest`.
 * `onProgress(fait, total, nom)` est appelé à chaque fichier écrit.
 */
function extraire(zipPath, dest, onProgress){
  const buf = fs.readFileSync(zipPath);
  const entrees = lireEntrees(buf);
  const fichiers = entrees.filter(e => !e.nom.endsWith('/'));
  let fait = 0;

  for (const e of entrees){
    /* Une entrée dont le chemin remonte hors du dossier de destination
       est un piège classique. On refuse au lieu d'écrire. */
    const cible = path.resolve(dest, e.nom);
    if (cible !== dest && !cible.startsWith(dest + path.sep))
      throw new Error(`chemin hors du dossier de destination : ${e.nom}`);

    if (e.nom.endsWith('/')){ fs.mkdirSync(cible, { recursive: true }); continue; }

    fs.mkdirSync(path.dirname(cible), { recursive: true });
    const data = contenu(buf, e);
    if (data.length !== e.tailleD)
      throw new Error(`taille inattendue pour ${e.nom} : ${data.length} au lieu de ${e.tailleD}`);
    fs.writeFileSync(cible, data);

    /* Droits d'exécution : indispensables pour le Java embarqué et les
       lanceurs. Sur Windows le champ vaut souvent 0, on n'y touche pas. */
    if (e.mode) { try { fs.chmodSync(cible, e.mode); } catch {} }

    fait++;
    if (onProgress) onProgress(fait, fichiers.length, e.nom);
  }
  return fichiers.length;
}

module.exports = { extraire, lireEntrees, contenu, trouverEocd };
