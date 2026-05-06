# Baccarat Pro — Déploiement Render.com

## 1. Créer une base PostgreSQL
- Render Dashboard → New + → PostgreSQL → plan Free
- Copier la chaîne de connexion **Internal Database URL**

## 2. Créer le Web Service
- New + → Web Service → Build and deploy from a Git repository (ou upload ZIP)
- Runtime: **Node**
- Build command: `npm install && npm run build`
- Start command: `node index.js`

## 3. Variables d'environnement (Settings → Environment)
| Clé              | Valeur                                            |
|------------------|---------------------------------------------------|
| DATABASE_URL     | (Internal Database URL de l'étape 1)              |
| SESSION_SECRET   | (chaîne aléatoire ≥ 32 caractères)                |
| NODE_ENV         | production                                        |
| PORT             | 5000                                              |

## 4. Premier lancement
- L'app initialise la base PostgreSQL automatiquement.
- Connectez-vous avec le compte super admin **sossoukouam**.
- Configurez vos canaux Telegram dans l'interface Admin.

## Notes
- Le frontend est déjà compilé dans `dist/` — le build Render ne refait que `npm install`.
- Aucun fichier `.env` dans le ZIP : tout passe par les variables Render.
- Les comptes Pro ont chacun leur propre bot Telegram (configurable dans l'onglet Config Pro).
