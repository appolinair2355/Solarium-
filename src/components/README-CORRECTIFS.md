# Correctifs Baccarat Pro

## Fichiers modifiés

- `index.js` — Anti page-noire : renvoie un 404 propre pour les anciens hashs JS/CSS au lieu de servir `index.html`, ce qui cassait l'exécution React.
- `admin.js` — Suppression de l'attribution automatique des canaux (C1/C2/C3/DC) lors de l'approbation d'un compte ; suppression du backfill côté `/my-strategies`. Désormais aucun canal n'est visible tant que l'admin n'en assigne pas.
- `src/components/ContactAdminModal.jsx` — Charge l'historique au montage + rafraîchissement toutes les 30 s, pour que le badge "réponse non-lue" s'affiche AVANT même que l'utilisateur n'ouvre la modale.
- `dist/` — Frontend rebuilt (les nouveaux noms hashés des assets correspondent aux fichiers présents).

## Déploiement sur Render

1. Uploader/écraser les fichiers ci-dessus dans votre dépôt.
2. Render relancera `npm install && npm run build` automatiquement.
3. Vider le cache du navigateur (ou `Ctrl+Shift+R`) lors de la première ouverture.
