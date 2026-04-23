# Baccarat Pro — Déploiement Render.com

## 1. Créer une base PostgreSQL
- Render Dashboard → New + → PostgreSQL → plan Free
- Copier l'Internal Database URL

## 2. Créer le Web Service
- New + → Web Service → upload ZIP ou Git
- Runtime: Node
- Build: npm install && npm run build
- Start: node index.js

## 3. Variables d'environnement
- DATABASE_URL = (Internal URL étape 1)
- SESSION_SECRET = (chaîne aléatoire ≥ 32 car.)
- NODE_ENV = production
- PORT = 5000

## 4. Premier lancement
- L'app initialise PostgreSQL automatiquement.
- Connexion super admin: sossoukouam.
