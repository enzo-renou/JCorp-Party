# 🎉 JCorp Party

Jeu de soirée en ligne pour la JCorp : on rejoint un salon avec un **code à 4 lettres**, on a un **avatar aléatoire**, et à chaque manche un **maître du jeu** (qui tourne) choisit le mini-jeu.

| Jeu | Principe |
|---|---|
| 🎨 Skribbl | Chacun dessine à son tour, points selon la rapidité de la bonne réponse |
| 🧠 Culture G | ~600 questions (foot, ciné, rap, anime, rébus, emojis, photos « qui est-ce ? », tableaux, monuments, 4 images 1 mot…), le maître corrige, 1 pt/bonne réponse, catégories au choix |
| 🌍 Quiz Géo | 9 questions : 3 sur la carte, 3 capitales, 3 drapeaux, de facile à dur |
| 🕵️ L'Imposteur | Citoyens / imposteurs / M. White : indices, vote, réunion d'urgence |
| 🎤 Mastergoon | « Ne dis pas la même chose que moi » : le maître part à 10 pts et en perd 1 si personne n'est éliminé |

## 1. Lancer chez soi

```bash
npm install
npm start          # http://localhost:3000
```
Même Wi-Fi : l'adresse réseau s'affiche au démarrage. Le QR code du salon permet de rejoindre depuis un téléphone.

## 2. Mettre le projet sur GitHub

1. Sur https://github.com/new, crée un dépôt vide (ex. `jcorp-party`), **sans** README ni .gitignore.
2. Dans le dossier du projet :
   ```bash
   git remote add origin https://github.com/TON-PSEUDO/jcorp-party.git
   git push -u origin main
   ```
   (le dépôt local est déjà initialisé et commité ; GitHub te demandera de te connecter, ou utilise `gh auth login` puis `gh repo create jcorp-party --private --source=. --push`).

## 3. Héberger sur Render (gratuit)

1. https://render.com → **New +** → **Web Service** → connecte ton compte GitHub → choisis `jcorp-party`.
2. Render lit `render.yaml` tout seul (sinon : Build `npm install`, Start `npm start`, plan Free).
3. Au bout de 2 minutes tu as une URL `https://jcorp-party.onrender.com` : envoie-la à tes potes.

À savoir sur l'offre gratuite : le service s'endort après ~15 min sans visite (le premier chargement prend ~30 s), et les salons sont gardés en mémoire (une mise à jour ou un redémarrage les efface, sauf sauvegarde sur disque, qui n'est pas persistante en gratuit). Rien à configurer d'autre, le jeu utilise le port fourni par Render.

## 4. Photos du quiz (« Qui est ce joueur ? », tableaux, monuments)

Les ~80 questions photo (et les « 4 images, 1 mot ») utilisent l'image principale de la page Wikipédia indiquée dans `data/culture/*.json` (champ `"wiki"`). Le serveur la récupère et la relaie aux joueurs (le nom du fichier, qui donnerait la réponse, n'est jamais visible).

- **Sur Render, ça marche tout seul** : le serveur a internet. Si une photo ne charge pas, un indice texte s'affiche à la place.
- **Déjà fait** : les ~100 photos sont dans `data/photos/` (compressées, 5 Mo) et servies directement par le serveur. Pour en ajouter, mets le titre Wikipédia dans la question puis relance :
  ```bash
  npm run photos          # télécharge dans data/photos/ et liste les pages sans image
  git add data/photos && git commit -m "photos du quiz" && git push
  ```
  Render redéploie et les photos sont servies depuis le projet, sans dépendre de Wikipédia pendant la partie.
- Ajouter une photo : une entrée `{"t":"image","q":"Qui est ce joueur ?","wiki":"Titre_de_la_page_Wikipédia","a":["Réponse","Variante"],"hint":"Indice si la photo manque"}`.

## 5. Ajouter du contenu

- Mots Skribbl : `data/skribbl-words.json`
- Questions culture : `data/culture/*.json` (`npm run check` vérifie la banque)
- Mots Imposteur : `data/imposteur/words.js` · questions Mastergoon : `data/mastergoon/*.js`
- Pays / capitales : `data/geo-source.js`, puis `npm run build:geo`

## 6. Test automatique

`npm test` joue une partie complète des 5 jeux avec des bots.
