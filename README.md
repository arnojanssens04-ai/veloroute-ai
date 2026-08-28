# VeloRoute AI

Génère une boucle vélo sur mesure à partir d'une **durée** et d'un **D+ max**
(pas d'un nombre de km), en se basant sur ta vitesse moyenne réelle. Export
`.gpx` pour l'ouvrir directement dans Garmin Connect.

## Comment ça marche

1. Tu choisis la durée de sortie souhaitée et le dénivelé positif max que tu
   veux t'autoriser.
2. L'appli convertit ça en distance cible via un modèle de vitesse
   personnalisé (`lib/speedModel.ts`) : le D+ demandé coûte un temps à peu
   près fixe (pas une vitesse réduite étalée sur toute la distance), ce qui
   reflète le fait qu'un dénivelé concentré sur une courte section ne
   ralentit que cette section.
3. Elle appelle [OpenRouteService](https://openrouteservice.org/) (mode
   *round trip*) pour générer une boucle réelle sur route/piste cyclable
   depuis ton point de départ, en testant plusieurs variantes pour se
   rapprocher du D+ demandé.
4. Le tracé s'affiche sur la carte avec son profil altimétrique, et tu peux
   l'exporter en `.gpx`.

### Le modèle de vitesse par défaut

Les valeurs par défaut (`lib/athleteProfile.ts`) viennent d'une régression
sur 18 sorties vélo extérieures issues de l'historique Strava réel de
l'utilisateur (~344 km cumulés) :

- **Vitesse à plat** ≈ 24,5 km/h — moyenne pondérée par la distance.
- **Coût du D+** ≈ 3,36 secondes par mètre grimpé (soit environ 22 min pour
  400 m de D+), **indépendamment de la distance sur laquelle ce D+ est
  réparti**. Obtenu en régressant le « temps excédentaire » de chaque sortie
  (temps réel − distance/vitesse à plat) contre son D+ total.

Distance cible = vitesse à plat × (durée − temps de D+ estimé). Ce sont de
simples valeurs de départ modifiables directement dans l'interface (champ
« Vitesse moyenne estimée ») — l'appli ne se reconnecte pas à Strava en
direct pour l'instant.

**Limite assumée** : le modèle ne connaît que le D+ *total* demandé, pas sa
répartition réelle (une bosse de 20 secondes à 3 % coûte beaucoup moins
qu'une côte de 10 minutes à 8 %, à D+ cumulé égal) — cette information
n'existe pas encore à l'étape du calcul, puisque le tracé réel n'est généré
qu'après. Une fois la boucle générée, la distance et le D+ **réels** sont
toujours affichés, donc l'écart éventuel reste visible et tu peux régénérer
ou ajuster manuellement la vitesse si besoin.

## Prérequis : une clé OpenRouteService (gratuite)

1. Crée un compte sur https://openrouteservice.org/dev/#/signup
2. Dans le tableau de bord, crée une clé API (plan gratuit : 2000
   requêtes/jour, largement suffisant).
3. Copie `.env.example` vers `.env.local` et colle ta clé :

```bash
cp .env.example .env.local
# puis édite .env.local :
# ORS_API_KEY=ta_cle_ici
```

## Lancer en local

```bash
npm install
npm run dev
```

Ouvre http://localhost:3000, autorise la géolocalisation (ou clique sur la
carte pour définir ton point de départ), règle la durée et le D+ max, puis
clique sur « Générer mon parcours ».

## Déployer (Vercel, recommandé)

1. Pousse ce dépôt sur GitHub.
2. Sur https://vercel.com, « Add New Project » → importe le dépôt.
3. Dans les réglages du projet Vercel, ajoute la variable d'environnement
   `ORS_API_KEY` avec ta clé OpenRouteService.
4. Déploie. Aucune autre configuration n'est nécessaire (le projet est un
   Next.js standard).

## Préférence pour les infrastructures cyclables

Le profil « Polyvalent » (`cycling-regular`, par défaut) est celui
qu'OpenRouteService construit spécifiquement pour privilégier les
pistes/bandes cyclables et les routes calmes quand une alternative
raisonnable existe, au prix d'un tracé parfois moins direct. Le profil
« Vélo de route » (`cycling-road`) reste optimisé pour l'itinéraire le plus
direct sur route goudronnée, quitte à partager la chaussée avec les
voitures.

La case « Éviter pavés et chemins non asphaltés » ajoute une contrainte
`profile_params.restrictions.surface_type: asphalt` à la requête ORS. C'est
du *best-effort* : si aucune boucle purement asphaltée n'existe pour la
distance demandée, l'appli repasse automatiquement sans cette contrainte
plutôt que d'échouer, et te le signale sous les résultats.

**Limite technique connue** : l'API publique d'OpenRouteService ne permet
pas d'imposer une hiérarchie stricte du type « pistes 100% séparées d'abord,
puis bandes cyclables, puis route partagée en dernier recours » — ce sont
des préférences/contraintes globales du profil, pas un filtre par type
d'infrastructure précis. Pour un contrôle aussi fin, il faudrait un moteur
différent (ex. GraphHopper avec ses `custom_model`, disponibles uniquement
sur un plan payant chez eux, ou un ORS auto-hébergé avec un profil sur
mesure) — voir la discussion dans l'historique du projet.

## Point de départ

En plus de la géolocalisation automatique et du clic sur la carte, un champ
de recherche d'adresse (`/api/geocode`, proxy vers l'API Geocoding
d'OpenRouteService — utilise la même clé `ORS_API_KEY`) permet de saisir une
adresse ou une ville directement.

## Optimisation vent (expérimental)

La case « Optimiser pour le vent » interroge [Open-Meteo](https://open-meteo.com/)
(gratuit, sans clé) pour connaître la vitesse et la direction du vent
actuelles au point de départ, puis choisit — parmi les boucles déjà générées
pour respecter le D+ (jusqu'à 5 variantes par seed) — celle dont la première
moitié (en distance) est la plus face au vent et la seconde moitié la plus
favorable (vent de dos).

**Comment ça marche techniquement** : pour chaque segment du tracé, on
calcule le cap parcouru et son alignement avec la direction du vent
(`cos(cap − direction du vent)`, +1 = vent de face, -1 = vent de dos),
pondéré par la distance du segment. Le résultat affiché après génération
(`orientation favorable / neutre / défavorable`) reflète ce score pour la
boucle réellement choisie — ce n'est pas toujours favorable, faute de mieux
parmi les variantes testées.

**Limites** : l'API de routage ne permet pas d'imposer un cap de départ, on
ne fait donc que choisir la moins mauvaise option parmi des boucles générées
pour d'autres critères (distance, D+) — pas une vraie optimisation dédiée.
Sur une boucle très arrondie (peu allongée), l'effet est faible par nature.
Si Open-Meteo est injoignable, la génération continue normalement sans
optimisation vent (repli silencieux, signalé dans l'interface).

## Envoyer le parcours vers Garmin Connect

Le bouton « Télécharger le GPX » génère un fichier `.gpx` standard
(balises `<trk>`/`<trkpt>` avec élévation). Sur mobile, télécharge le
fichier puis utilise le menu de partage du navigateur pour l'ouvrir avec
l'app Garmin Connect (qui l'importera comme un parcours/course). Sur
ordinateur, importe le fichier depuis Garmin Connect → Parcours → Importer.

## Limites connues de cette première version

- Le D+ max est une **cible best-effort** : l'API OpenRouteService ne permet
  pas de contraindre directement le dénivelé d'une boucle générée. L'appli
  teste jusqu'à 5 variantes (seeds différentes) et garde la plus proche de
  ta limite, mais un point de départ très vallonné peut ne pas avoir de
  boucle plate disponible à proximité.
- Le calcul de vitesse personnalisé est une régression simple (linéaire) sur
  un historique Strava figé au 28/08/2026, pas une connexion Strava en
  direct. Pour la reproduire avec des données plus récentes, il suffit de
  remplacer les constantes dans `lib/athleteProfile.ts`.
- Pas d'authentification multi-utilisateurs : c'est un outil personnel à
  usage individuel.
