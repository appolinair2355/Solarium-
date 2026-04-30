BACCARAT PRO — CORRECTIF STRATÉGIES PRO
  ========================================

  Ce paquet contient UNIQUEMENT les fichiers modifiés pour corriger les
  problèmes signalés sur les stratégies Pro (S5001-S5100).

  📁 FICHIERS INCLUS
  ------------------

  BACKEND (Node.js) :
    • admin.js          → Routes Pro corrigées (DELETE nettoie tg_pred,
                          annule les messages Telegram en cours et synchronise
                          Render. POST/PUT tg-targets appellent syncProStrategy.)
    • render-sync.js    → Nouvelles fonctions syncProStrategy /
                          syncProStrategies / syncDeleteStrategy pour
                          synchroniser les stratégies Pro vers la base
                          PostgreSQL distante (Render).
    • engine.js         → Pré-charge automatiquement state.dbData pour les
                          scripts JS Pro à partir de la table cartes_jeu
                          (500 derniers jeux). Ceci permet aux stratégies
                          comme « judo » qui utilisent state.dbData[N] de
                          prédire dès le 1er tour, sans devoir attendre que
                          des jeux LIVE soient accumulés.

  FRONTEND (React + Vite) :
    • src/pages/Admin.jsx   → Carte « Stratégies Pro » ajoutée dans la
                              section CANAUX TELEGRAM, juste après les
                              stratégies personnalisées (visibilité +
                              auto-refresh). Exemple avancé documenté sur
                              l'utilisation de state.dbData[N] dans le
                              template JS téléchargeable depuis Config Pro.
    • dist/index.html       → Fichier d'entrée HTML reconstruit.
    • dist/assets/*.js,css  → Assets compilés correspondants.

  🔧 INSTALLATION
  ---------------

  1. Décompresser ce ZIP à la racine du projet (en écrasant les fichiers
     existants).
  2. Aucun npm install requis (aucune nouvelle dépendance).
  3. Redémarrer le serveur (sur Render : nouveau Deploy ; en local :
     relancer node index.js).

  ✅ CORRECTIONS APPORTÉES
  -----------------------

  1. Stratégies Pro maintenant visibles dans le panneau Telegram, comme les
     canaux par défaut (carte dédiée à côté des stratégies personnalisées).
  2. Synchronisation bidirectionnelle des stratégies Pro entre la base
     PostgreSQL locale et la base Render (création, modification,
     suppression).
  3. La suppression d'une stratégie Pro nettoie maintenant TOUTES ses
     traces : tg_pred_<id>, messages Telegram en attente annulés, et
     suppression répliquée sur la base distante.
  4. Erreur « Cannot access 'Rr' before initialization » corrigée
     (réordonnancement du useEffect après son useCallback).
  5. Stratégie Pro « judo » fonctionne immédiatement : le moteur garnit
     désormais state.dbData à partir de cartes_jeu, donc les scripts qui
     font state.dbData[gameNumber - H] obtiennent les données historiques.

  📚 EXEMPLE DOCUMENTÉ
  -------------------

  Le fichier d'exemple JS téléchargeable depuis « Config Pro » contient
  maintenant une section « EXEMPLE AVANCÉ » qui explique :
    • la structure de chaque entrée state.dbData[N] (playerSuits,
      bankerSuits, winner, dist, playerCards, bankerCards),
    • un exemple complet de stratégie qui regarde N jeux en arrière,
    • les helpers async disponibles via ctx.cartes (byGameNumber, getCard,
      getNear) et ctx.live.gameNumber.

  Tester : Admin → Config Pro → bouton « Télécharger exemple » sur la
  carte JavaScript.
  