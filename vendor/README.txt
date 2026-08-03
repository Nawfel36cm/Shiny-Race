Contenu embarqué dans l'installeur.

  PokeRandoZX.jar      Universal Pokemon Randomizer ZX (GPL-3.0)
  jre/                 Runtime Java réduit, produit par jlink
  presets/*.rnqs       Préréglages de randomisation

Ce dossier est copié tel quel dans l'application par electron-builder
(clé "extraResources" du package.json). S'il est vide, le logiciel
bascule sur le Java du système et demande le .jar à l'utilisateur.

Voir la section "Tout embarquer" du README pour le remplir.
