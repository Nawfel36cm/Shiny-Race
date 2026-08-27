/* =====================================================================
   upr-modes.js — les trois modes de randomisation des rencontres.

   La ligne de commande du randomizer accepte deux formes de réglages :
   un fichier `.rnqs` produit par son interface graphique, ou une
   « chaîne de réglages » passée avec `-S`. C'est la seconde qui rend
   l'intégration possible : elle tient sur une ligne, on peut la livrer
   avec l'application, et l'utilisateur n'a jamais à ouvrir l'interface
   du randomizer.

   ⚠ CES CHAÎNES NE SONT PAS ÉCRITES À LA MAIN.
   Elles ont été produites par le randomizer lui-même — on instancie sa
   classe `Settings`, on pose le mode voulu, on demande sa
   représentation textuelle. Les trois derniers octets sont une somme de
   contrôle : un seul caractère changé et le randomizer refuse la chaîne
   avec « Malformed input string ». Ne jamais les retoucher à la main.
   Pour en produire d'autres, il faut repasser par la classe Settings.

   Le préfixe `427` est la version du format. Le randomizer sait relire
   une chaîne plus ancienne que lui et la met à jour au vol ; il refuse
   en revanche une chaîne abîmée. Si une version future changeait le
   format au point de rejeter les nôtres, le message d'erreur le dirait
   et il faudrait les régénérer.

   Tout le reste est laissé aux valeurs par défaut. En particulier :
   AUCUN dresseur n'est touché, aucun starter, aucune statistique. Seules
   les rencontres sauvages changent — c'est exactement le périmètre
   voulu pour une course.
   ===================================================================== */

const UPR_MODES = [
  {
    id: 'global',
    label: 'Correspondance globale',
    court: 'Une espèce → une espèce, partout',
    aide: "Chaque espèce d'origine est remplacée par la même espèce dans tout le jeu. "
        + "Les Roucool restent des Roucool entre eux, mais deviennent tous autre chose. "
        + "C'est le mode le plus lisible en course : ce que tu apprends sur une route "
        + "reste vrai partout ailleurs.",
    settings: '427AAgEBQQAAAAAAAAEAAHkCAARBAEUAAAUAEAEAAEY/wAAAAAAAADkBOQBAAgJ5AAAAOQAAgABAAEBAAAAAAAJAAAAKAEAAA1e2roAAAAA'
  },
  {
    id: 'zone',
    label: 'Par zone',
    court: 'Une correspondance différente selon la carte',
    aide: "La correspondance est retirée au sort zone par zone. Une même espèce peut "
        + "devenir différente selon la route. Plus de variété qu'en global, sans le "
        + "chaos complet du mode par emplacement.",
    settings: '427AAgEBQQAAAAAAAAEAAHkQAARBAEUAAAUAEAEAAEY/wAAAAAAAADkBOQBAAgJ5AAAAOQAAgABAAEBAAAAAAAJAAAAKAEAACvjrTYAAAAA'
  },
  {
    id: 'slot',
    label: 'Chaque emplacement au hasard',
    court: 'Aucune correspondance, tout est indépendant',
    aide: "Chaque emplacement de rencontre est tiré indépendamment des autres. "
        + "Le plus chaotique, et le plus difficile à mémoriser : deux Roucool de la "
        + "même route peuvent devenir deux espèces différentes.",
    settings: '427AAgEBQQAAAAAAAAEAAHkAgARBAEUAAAUAEAEAAEY/wAAAAAAAADkBOQBAAgJ5AAAAOQAAgABAAEBAAAAAAAJAAAAKAEAAII1IlsAAAAA'
  }
];

const uprMode = id => UPR_MODES.find(m => m.id === id) || UPR_MODES[0];

if (typeof module !== 'undefined' && module.exports) module.exports = { UPR_MODES, uprMode };
if (typeof window !== 'undefined') window.UPR_MODES = { UPR_MODES, uprMode };
