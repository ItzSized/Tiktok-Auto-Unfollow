# ⚡ TikTok Auto Unfollow (Manifest V3)

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="TikTok Auto Unfollow Logo">
</p>

<p align="center">
  <b>Extension de navigateur moderne et sécurisée pour automatiser le désabonnement en masse de vos comptes TikTok suivis.</b>
  <br>
  <i>Compatible Google Chrome (Manifest V3), Mozilla Firefox, Brave, Microsoft Edge et Opera.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-success?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Browsers-Chrome%20%7C%20Firefox%20%7C%20Edge%20%7C%20Brave-blue?style=flat-square" alt="Browsers">
  <img src="https://img.shields.io/badge/License-MIT-orange?style=flat-square" alt="License MIT">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome">
</p>

---

## 🌟 Fonctionnalités

- 🛡️ **Protection Anti-Bot & Anti-Ban** : Délais aléatoires et personnalisables (ex: entre 2.5s et 5s) simulant un comportement humain pour éviter le rate-limiting TikTok.
- 🎚️ **Réglage de la vitesse** : Préréglages *Lent*, *Normal*, *Rapide* et *Turbo* directement dans la popup, appliqués en direct même pendant l'exécution.
- 🔄 **Rechargement automatique** : TikTok bloque la liste après quelques dizaines de comptes. L'extension recharge la page tous les N désabonnements (50 par défaut), ou dès que TikTok ne répond plus, rouvre la liste et reprend toute seule.
- 🪟 **Fonctionne en arrière-plan** : Pas besoin de rester sur l'onglet, ni même d'être sur TikTok. *Lancer* ouvre votre profil dans un onglet en arrière-plan, et la popup le contrôle depuis n'importe quelle page.
- ✔️ **Désabonnements vérifiés** : Chaque désabonnement n'est compté qu'une fois que TikTok l'a réellement pris en compte (le bouton repasse à *Suivre*).
- 🎯 **Détection Parfaite "Suivis" / "Following"** : Compatible avec l'interface TikTok française actuelle (boutons gris *"Suivis"*), anglaise (*"Following"*), et amis mutuels (*"Amis"* / *"Friends"*).
- ♾️ **Mode Illimité (Mass Unfollow)** : Conçu pour les comptes avec des milliers d'abonnements (ex: 8 500+). Réglez la limite sur `0` pour un désabonnement complet sans interruption.
- 🎯 **Gestion des Popups de Confirmation** : Détecte et valide automatiquement les fenêtres de confirmation *"Se désabonner de @pseudo ?"*.
- 📜 **Défilement Automatique Intelligent** : Scrolle automatiquement la modale d'abonnements au fur et à mesure que les comptes visibles sont traités.
- ⏱️ **Contrôles en Temps Réel** : Boutons **Lancer**, **Pause / Reprendre** et **Arrêter** réactifs instantanément.
- 📊 **Compteur Visuel en Direct** : Suivi précis du nombre de désabonnements effectués avec jauge d'avancement et limite personnalisable.
- 📝 **Journal d'Activité (Logs)** : Console intégrée affichant chaque action en direct (pseudo ciblé, délai appliqué, défilement, statut).


---

## 📥 Installation Locale (Mode Développeur)

### Sur Google Chrome, Brave, Opera ou Microsoft Edge

1. **Téléchargez** ou clonez ce dépôt sur votre machine :
   ```bash
   git clone https://github.com/ItzSized/Tiktok-Auto-Unfollow.git
   ```
2. Ouvrez votre navigateur et accédez à la page des extensions :
   - Sur **Chrome** : `chrome://extensions/`
   - Sur **Brave** : `brave://extensions/`
   - Sur **Edge** : `edge://extensions/`
3. Activez le **Mode développeur** (interrupteur en haut à droite).
4. Cliquez sur le bouton **"Charger l'extension non empaquetée"** (ou *"Load unpacked"*).
5. Sélectionnez le dossier contenant ce projet (où se situe le fichier `manifest.json`).
6. L'icône de l'extension apparaît dans votre barre d'extensions ! Épinglez-la pour un accès rapide.

---

### Sur Mozilla Firefox

1. Ouvrez Firefox et entrez l'adresse suivante dans la barre d'URL :
   ```text
   about:debugging#/runtime/this-firefox
   ```
2. Cliquez sur le bouton **"Charger un module temporaire..."**.
3. Sélectionnez le fichier `manifest.json` à la racine du projet.
4. L'extension est prête à l'emploi.

---

## 🚀 Guide d'Utilisation

1. Assurez-vous d'être connecté à votre compte sur [TikTok](https://www.tiktok.com).
2. Cliquez sur l'icône de l'extension **TikTok Auto Unfollow**, depuis n'importe quelle page.
3. Choisissez la **vitesse** (*Normal* recommandé).
4. *(Optionnel)* Ajustez les **Paramètres de sécurité** :
   - **Délai Min / Max** : réglage fin de la vitesse.
   - **Limite de sécurité** : nombre max de comptes par session (`0` = illimité).
   - **Recharger la page tous les** : `50` par défaut (`0` = jamais).
   - **Défilement auto** : activé par défaut.
5. Cliquez sur **"Lancer"** :
   - si vous êtes sur TikTok, l'extension va sur votre profil et ouvre la liste *Abonnements* toute seule ;
   - sinon, elle ouvre TikTok dans un onglet en arrière-plan et travaille dedans.
6. Vous pouvez mettre en **Pause** ou **Arrêter** à tout moment, depuis n'importe quel onglet.

---

## ⚠️ Recommandations Anti-Ban & Bonnes Pratiques

TikTok applique des règles strictes de limitation de débit (*Rate Limiting*) pour contrer les comportements automatisés :

| Recommandation | Détail |
| :--- | :--- |
| **Délai entre chaque clic** | Ne descendez **jamais sous 2.0 secondes**. Un délai aléatoire entre 2.5 et 5 secondes est idéal. |
| **Plafond par session** | Limitez chaque session à **40 - 60 désabonnements**, puis laissez reposer votre compte 1 à 2 heures. |
| **Plafond quotidien** | Évitez de dépasser **150 à 200 désabonnements par 24 heures** pour prévenir tout "shadowban" ou blocage temporaire d'action. |
| **En cas de message d'erreur** | Si TikTok affiche *"Action trop fréquente"*, ou si les clics ne passent plus même après un rechargement, l'extension se met en pause. Attendez au moins 12 à 24 heures. |
| **Mode Turbo** | Pratique, mais c'est le plus susceptible de déclencher les limites TikTok. À utiliser avec modération. |

---

## 📂 Structure du Projet

```text
tiktok-auto-unfollow/
├── manifest.json       # Configuration Manifest V3 (Chrome & Firefox)
├── popup.html          # Interface utilisateur moderne (Dark Mode)
├── popup.css           # Feuille de style (Aesthetics TikTok cyan & pink)
├── popup.js            # Logique de contrôle, persistance storage et messaging
├── content.js          # Script d'automatisation, détection DOM, clics, rechargement auto
├── background.js       # Service worker : minuteries non bridées pour les onglets en arrière-plan
├── icons/              # Icônes de l'extension (16, 32, 48, 128 px)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE             # Licence open-source MIT
└── README.md           # Documentation complète
```

---

## 🛠️ Maintenance & Adaptation aux Mises à Jour TikTok

TikTok modifie occasionnellement les classes CSS et les attributs de son interface web.
Le script ne dépend pas des classes CSS. Il combine :
- Une détection par **libellé du bouton**, normalisée (casse, accents, espaces invisibles) : `Suivi(e)s`, `Abonné(e)`, `Amis`, `Following`, `Friends`…
- La détection de la modale (`role="dialog"`, `aria-modal`) qui contient la liste.
- L'ouverture de la liste via `data-e2e="following-count"` sur la page profil.

Si TikTok change ses libellés, il suffit d'éditer les ensembles de mots-clés en haut de [`content.js`](content.js) :

```javascript
const FOLLOWING_LABELS = new Set([ 'following', 'friends', 'suivi(e)s', 'abonné(e)', 'amis', /* ... */ ]);
const FOLLOW_LABELS    = new Set([ 'follow', 'suivre', /* ... */ ]);
```

---

## ⚖️ Avertissement Légal / Disclaimer

Ce projet est fourni à des fins **éducatives et personnelles uniquement**. 
Il n'est ni affilié, ni sponsorisé, ni approuvé par TikTok ou ByteDance Ltd. L'utilisation d'automatisations sur TikTok peut enfreindre leurs [Conditions d'utilisation](https://www.tiktok.com/legal/terms-of-service). L'auteur décline toute responsabilité en cas de restriction temporaire, suspension ou blocage de votre compte consécutifs à une utilisation excessive. Utilisez cet outil de manière responsable et modérée.

---

## 📄 Licence

Ce projet est sous licence [MIT](LICENSE). Vous êtes libre de l'utiliser, l'adapter et le redistribuer.
Les contributions, suggestions et *pull requests* sont les bienvenues !
