# Shiny Race Studio

Logiciel de bureau pour préparer des ROMs de *shiny race* sur Pokémon génération 3
(Rubis, Saphir, Émeraude, Rouge Feu, Vert Feuille).

- Modifie le **taux d'apparition des shiny** jusqu'à 1/256
- **Randomise les rencontres sauvages**, avec une graine reproductible
- Exporte une ROM patchée **ou** un patch `.ips` à partager
- Délègue la randomisation avancée (dresseurs, capacités, stats, starters) à
  l'Universal Pokémon Randomizer ZX, lancé comme programme séparé

Aucun jeu n'est inclus, téléchargé ou distribué. Le logiciel travaille sur une
ROM que tu fournis toi-même.

## Démarrer

```bash
npm install
npm start
```

## Fabriquer les installeurs

### Par GitHub, sans rien installer (recommandé)

`.github/workflows/build.yml` construit les trois installeurs à chaque
poussée. Chaque système compile pour lui-même — Windows sur une machine
Windows, macOS sur un Mac — donc aucune compilation croisée, aucun Wine.

```bash
git push                          # → artefacts téléchargeables dans l'onglet Actions
git tag v0.1.0 && git push --tags # → publication en Release
```

Les liens de Release se collent ensuite dans la constante `RELEASES` en haut
du script du site, et les boutons de téléchargement s'activent.

### En local

```bash
npm install
npm test
npm run build:win     # NSIS  (.exe)
npm run build:mac     # DMG
npm run build:linux   # AppImage
```

Les fichiers sortent dans `dist/`. Tu ne peux construire que pour ton propre
système : un `.dmg` demande un Mac.

## Mettre à jour

**Le site** : tu remplaces le fichier HTML sur ton hébergement. Les visiteurs
ont la nouvelle version au rafraîchissement suivant.

**Le logiciel** : `electron-updater` interroge les Releases GitHub au
démarrage, télécharge la nouvelle version en tâche de fond et l'installe à la
fermeture. Tes utilisateurs n'ont rien à faire, jamais.

Pour publier un correctif :

1. Modifie le fichier concerné
2. Monte `"version"` dans `package.json` (0.1.0 → 0.1.1)
3. Crée une Release avec l'étiquette correspondante (`v0.1.1`)

Le workflow reconstruit tout, et les installations existantes se mettent à
jour seules dans les heures qui suivent.

⚠️ Renseigne `build.publish.owner` dans `package.json` avec ton pseudo GitHub,
sinon l'application ne saura pas où chercher ses mises à jour.

La mise à jour automatique fonctionne sur Windows et Linux. Sur macOS elle
exige une application signée : sans certificat Apple, les utilisateurs Mac
devront retélécharger à la main.

### Signature

Sans certificat, Windows affiche un avertissement SmartScreen et macOS bloque
l'ouverture au premier lancement. C'est normal pour un projet amateur et ça
n'empêche pas d'installer, mais prévois de l'expliquer à tes utilisateurs.

## Comment ça marche

### Taux de shiny

En génération 3, un Pokémon est shiny si
`(OTID_haut ^ OTID_bas ^ PID_haut ^ PID_bas) < 8`.
Compilé en THUMB, ce test donne `cmp Rd,#7 / bhi` ou `cmp Rd,#8 / bcs`, précédé
de plusieurs `EOR` et d'au moins un `LSR #16`.

`findShinyChecks()` cherche cette **signature d'instructions** plutôt qu'une
adresse codée en dur : le même code fonctionne sur toutes les versions et toutes
les langues, sans base de données d'offsets à maintenir.

Le plafond de 1/256 n'est pas un choix : l'immédiat d'un `cmp` THUMB tient sur
un octet, donc au maximum 256 valeurs favorables sur 65536. Pour aller au-delà
il faudrait injecter du code, pas seulement changer une constante.

Toutes les occurrences sont patchées ensemble. La génération 3 ne stocke pas la
shininess : elle la recalcule à chaque affichage. En rater une produit des
Pokémon shiny au sprite normal.

### Rencontres sauvages

La table des rencontres est une suite de `WildPokemonHeader` de 20 octets
(`mapGroup`, `mapNum`, 2 octets de padding, puis quatre pointeurs : herbe, eau,
éclate-roc, pêche), terminée par `FF FF`. `findEncounterTable()` la repère en
cherchant une longue série d'en-têtes dont les pointeurs sont valides.

Les espèces utilisent les **indices internes** de la génération 3, pas l'ordre du
Pokédex national. Les slots 252 à 276 sont inutilisés : le tirage se limite donc
à 1–251 et 277–411, soit les 386 espèces réelles.

Le tirage passe par un PRNG déterministe alimenté par la graine saisie. Même
graine + même ROM = ROM identique au bit près : tu peux donner la même graine à
tous les participants d'une race, ou une graine différente à chacun.

### Randomizer complet

Randomiser les dresseurs, les capacités apprises, les statistiques, les types,
les objets et les starters demande une table d'offsets pour chaque version et
chaque langue de chaque jeu. L'Universal Pokémon Randomizer ZX rassemble ce
travail depuis plus de dix ans, sur les 28 jeux.

Le logiciel l'embarque et l'appelle comme processus séparé :

```
java -jar PokeRandoZX.jar cli -i entrée -o sortie -s préréglage.rnqs -l
```

Côté utilisateur, rien de tout ça n'est visible : un préréglage à choisir, un
bouton. La résolution du runtime et du moteur se fait au démarrage
(`vendor.js`), avec repli sur le Java du système en développement.

## Structure

```
main.js            processus principal : fenêtre, dialogues, fs, appel au moteur
vendor.js          résolution du runtime, du moteur et des préréglages embarqués
preload.js         pont IPC, contextIsolation activé
src/rom.js         toute la logique ROM, sans dépendance et testable seule
src/games.js       les 28 jeux et leur état de prise en charge
src/platforms.js   reconnaissance du support (GB, GBA, DS, 3DS)
src/app.js         câblage de l'interface
src/index.html     interface
src/style.css      styles
```

`src/rom.js` n'utilise ni Node ni Electron : tu peux le charger dans une page web
ou dans un test Node pour valider le scanner sur des ROMs de référence.

## Couverture par génération

`src/platforms.js` reconnaît le support à partir de marqueurs d'en-tête
vérifiables, jamais de l'extension du fichier, et annonce clairement ce qu'il
sait faire. Un support non pris en charge affiche pourquoi au lieu de produire
une ROM corrompue.

Les 28 jeux de la 1G à la 7G sont décrits dans `src/games.js`, source unique
utilisée par l'onglet Compatibilité et par les messages du logiciel.

| Gén | Jeux | Support | Taux shiny | Randomizer |
|-----|------|---------|------------|------------|
| 1 | Rouge, Bleu, Jaune | GB | **impossible** | via UPR |
| 2 | Or, Argent, Cristal | GB/GBC | à venir | via UPR |
| 3 | Rubis, Saphir, Émeraude, **Rouge Feu, Vert Feuille** | GBA | **natif** | **natif** |
| 4 | Diamant, Perle, Platine, **HeartGold, SoulSilver** | NDS | à venir | via UPR |
| 5 | Noir, Blanc, Noir 2, Blanc 2 | NDS | à venir | via UPR |
| 6 | X, Y, **Rubis Oméga, Saphir Alpha** | 3DS | à venir | via UPR |
| 7 | Soleil, Lune, Ultra-Soleil, Ultra-Lune | 3DS | à venir | via UPR |

Les remakes suivent la console de sortie, pas l'original : Rouge Feu et Vert
Feuille sont de la 3G et fonctionnent nativement dès aujourd'hui.

Le **randomizer couvre les 28 jeux**. C'est le taux de shiny qui reste limité à
la 3G en natif.

## Tout embarquer

Pour que l'utilisateur n'installe rien d'autre que l'application, le dossier
`vendor/` est copié tel quel dans l'installeur (`extraResources`). À remplir
avant de builder :

```
vendor/
  PokeRandoZX.jar     moteur de randomisation
  jre/                runtime Java réduit
  presets/*.rnqs      préréglages de randomisation
```

**Le runtime Java**, réduit avec `jlink` pour ne garder que le nécessaire
(environ 40 Mo au lieu de 200) :

```bash
jlink --add-modules java.desktop,java.logging,java.xml \
      --strip-debug --no-header-files --no-man-pages --compress=2 \
      --output vendor/jre
```

**Les préréglages** se créent une fois dans l'interface graphique du moteur
(bouton « Save Settings »), puis se déposent dans `vendor/presets/`. Leur format
binaire n'est pas documenté : impossible de les générer par programme, il faut
passer par cette interface. Prévois-en un par format de race et par génération.

Si `vendor/` est vide, le logiciel bascule sur le Java du système et demande le
`.jar` à l'utilisateur. C'est le mode de développement, et le mode de repli pour
une distribution où l'on ne veut pas redistribuer le moteur.

### Licence

L'Universal Pokémon Randomizer ZX est sous **GPL-3.0**. Le livrer dans ton
installeur, c'est le distribuer : tu dois joindre sa licence et proposer son
code source. Le logiciel l'appelle comme processus séparé et ne lie aucun de son
code, ce qui relève de la simple agrégation — ton propre code n'est donc pas
tenu de passer sous GPL. Cette lecture est la plus courante, mais je ne suis pas
juriste : si tu comptes distribuer largement, fais confirmer, ou publie ton
propre code sous GPL-3.0 pour clore la question.

Trois remarques qui portent à conséquence :

**La génération 1 n'a pas de Pokémon chromatiques.** Ils apparaissent avec Or et
Argent. Aucun patch ne peut en créer : la notion est absente du jeu.

**La génération 2 ne stocke pas la shininess non plus.** Elle la déduit des DV
(Vitesse, Défense et Spécial à 10, Attaque parmi 2/3/6/7/10/11/14/15). Augmenter
le taux force donc mécaniquement certaines statistiques.

**Sur 3DS, la sortie n'est plus une ROM.** On produit un dossier LayeredFS que le
joueur dépose sur sa carte SD et que Luma3DS applique par-dessus son jeu. C'est
la seule forme partageable sans distribuer le jeu, et ça change la fin du
pipeline. Le taux de base y est aussi de 1/4096, et beaucoup de rencontres sont
verrouillées non-shiny par le jeu lui-même.

## Pipeline NDS — état

`src/nds.js` implémente la chaîne complète, `test/nds.test.js` la couvre
(38 assertions, `npm test`) :

| Élément | État |
|---|---|
| En-tête DS, CRC16 Nintendo | testé |
| Décompression BLZ de `arm9.bin` | **à valider sur ROM réelle** |
| Compression BLZ | **à valider sur ROM réelle** |
| Réinsertion de arm9, relocalisation des sections, correction de la FAT | testé |
| Recherche du test de shininess (ARM et THUMB) | heuristique, à confirmer |

Le codec BLZ a été écrit d'après l'algorithme, sans implémentation de
référence sous la main. Les tests prouvent qu'il est **cohérent avec
lui-même** — `décompresser(comprimer(x)) == x` sur quatre tailles et sur
des données peu compressibles — mais pas qu'il parle le même dialecte que
l'outil de Nintendo.

Tant que ce n'est pas vérifié, `patchNds()` **refuse d'écrire**. Il rend un
rapport étape par étape et s'arrête sur « codec validé sur ROM réelle ».
Aucune ROM ne peut être corrompue silencieusement.

### Comment le valider

```js
const N = require('./src/nds');
const rom = new Uint8Array(fs.readFileSync('platine.nds'));
const arm9 = N.extractArm9(rom);
const plain = N.blzDecompress(arm9);
// Un arm9 décomprimé de gen 4 fait environ 1 Mo et commence par du code ARM.
// Compare avec la sortie de blz.exe -d ou de ndspy sur le même fichier :
// si les octets coïncident, passe GUARD.verified à true dans src/nds.js.
```

Une fois validé, il reste à confirmer la signature du test de shininess :
`findShinyChecks()` remonte des candidats avec leur mode et leur adresse,
à recouper avec un désassembleur avant d'activer le patch.

## Pistes suivantes

- Valider le codec BLZ sur un dump réel, puis lever `GUARD.verified`
- Suppression des shiny locks sur les rencontres fixes
- Désynchronisation de la graine RNG au démarrage, pour éviter que deux joueurs
  partant de la même ROM tombent sur exactement les mêmes rencontres
- Générations 6 et 7 : sortie LayeredFS
