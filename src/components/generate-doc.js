const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  info: {
    Title: 'Baccarat Pro — Documentation Complète de Mise à Jour',
    Author: 'Baccarat Pro System',
    Subject: 'Guide technique de mise à jour',
  },
});

const OUT = path.join(__dirname, 'public', 'documentation-baccarat-pro.pdf');
doc.pipe(fs.createWriteStream(OUT));

// ── Couleurs ──────────────────────────────────────────────────────────
const C = {
  primary:   '#6366f1',
  secondary: '#a855f7',
  green:     '#22c55e',
  red:       '#ef4444',
  orange:    '#f59e0b',
  cyan:      '#06b6d4',
  dark:      '#0f0e17',
  gray:      '#64748b',
  light:     '#e2e8f0',
  white:     '#ffffff',
  codeBg:    '#1e1b2e',
  sectionBg: '#f8f9ff',
};

// ── Helpers ───────────────────────────────────────────────────────────
let y = 0;

function pageCheck(needed = 80) {
  if (doc.y + needed > doc.page.height - 60) doc.addPage();
}

function coverPage() {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f0e17');
  doc.rect(0, 0, doc.page.width, 8).fill('#6366f1');
  doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill('#a855f7');

  doc.fontSize(42).fillColor('#6366f1').font('Helvetica-Bold')
    .text('BACCARAT PRO', 50, 180, { align: 'center' });
  doc.fontSize(18).fillColor('#a855f7').font('Helvetica')
    .text('Documentation Complète de Mise à Jour', 50, 238, { align: 'center' });

  doc.moveTo(100, 275).lineTo(doc.page.width - 100, 275).strokeColor('#6366f1').lineWidth(1).stroke();

  doc.fontSize(13).fillColor('#94a3b8').font('Helvetica')
    .text('Système de mise à jour JSON — Modes de stratégie', 50, 290, { align: 'center' })
    .text('Bot Telegram — Variables critiques — Exemples complets', 50, 310, { align: 'center' });

  const sections = [
    '01 — Système de mise à jour JSON',
    '02 — Type "code" : modifier les fichiers source',
    '03 — Type "css" : CSS instantané sans rebuild',
    '04 — Type "styles" : variables CSS prédéfinies',
    '05 — Type "sequences" : séquences de relance',
    '06 — Modes de stratégie',
    '07 — Bot Telegram & commande /predire',
    '08 — Variables & constantes critiques',
    '09 — Fichiers importants & leur rôle',
    '10 — Erreurs fréquentes & bonnes pratiques',
    '11 — Exemples JSON complets prêts à l\'emploi',
  ];

  let sy = 360;
  doc.fontSize(11).fillColor('#64748b').font('Helvetica').text('TABLE DES MATIÈRES', 50, sy, { align: 'center' });
  sy += 22;
  sections.forEach(s => {
    doc.fontSize(10).fillColor('#a5b4fc').font('Helvetica').text(s, 130, sy);
    sy += 18;
  });

  doc.fontSize(9).fillColor('#334155').font('Helvetica')
    .text(`Généré le ${new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })}`, 50, doc.page.height - 70, { align: 'center' });
}

function sectionTitle(num, title, color = C.primary) {
  pageCheck(60);
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 6).fill(color);
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor(color).font('Helvetica-Bold')
    .text(`SECTION ${num}`, 50, 60);
  doc.fontSize(22).fillColor('#1e293b').font('Helvetica-Bold')
    .text(title, 50, 76);
  doc.moveTo(50, 108).lineTo(doc.page.width - 50, 108).strokeColor(color).lineWidth(2).stroke();
  doc.moveDown(1.5);
}

function h2(text, color = C.primary) {
  pageCheck(50);
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor(color).font('Helvetica-Bold').text(text, { continued: false });
  doc.moveDown(0.3);
}

function h3(text) {
  pageCheck(40);
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#475569').font('Helvetica-Bold').text(text);
  doc.moveDown(0.2);
}

function para(text, color = '#1e293b') {
  pageCheck(30);
  doc.fontSize(10).fillColor(color).font('Helvetica').text(text, { lineGap: 3 });
  doc.moveDown(0.4);
}

function warn(text) {
  pageCheck(50);
  doc.moveDown(0.3);
  const bx = 50, bw = doc.page.width - 100, bh = 36;
  doc.rect(bx, doc.y, bw, bh).fill('#fef9c3').stroke('#f59e0b');
  doc.fontSize(9.5).fillColor('#92400e').font('Helvetica-Bold')
    .text('⚠  ' + text, bx + 10, doc.y - bh + 10, { width: bw - 20 });
  doc.moveDown(1.2);
}

function danger(text) {
  pageCheck(50);
  doc.moveDown(0.3);
  const bx = 50, bw = doc.page.width - 100, bh = 36;
  doc.rect(bx, doc.y, bw, bh).fill('#fee2e2').stroke('#ef4444');
  doc.fontSize(9.5).fillColor('#991b1b').font('Helvetica-Bold')
    .text('🚫  ' + text, bx + 10, doc.y - bh + 10, { width: bw - 20 });
  doc.moveDown(1.2);
}

function tip(text) {
  pageCheck(50);
  doc.moveDown(0.3);
  const bx = 50, bw = doc.page.width - 100, bh = 36;
  doc.rect(bx, doc.y, bw, bh).fill('#dcfce7').stroke('#22c55e');
  doc.fontSize(9.5).fillColor('#14532d').font('Helvetica-Bold')
    .text('✅  ' + text, bx + 10, doc.y - bh + 10, { width: bw - 20 });
  doc.moveDown(1.2);
}

function code(lines, label = '') {
  pageCheck(40 + lines.length * 14);
  doc.moveDown(0.3);
  const bx = 50, bw = doc.page.width - 100;
  const bh = lines.length * 14 + 22;
  doc.rect(bx, doc.y, bw, bh).fill('#1e1b2e').stroke('#3b3560');
  if (label) {
    doc.fontSize(7.5).fillColor('#6366f1').font('Helvetica-Bold')
      .text(label.toUpperCase(), bx + 10, doc.y - bh + 6);
  }
  lines.forEach((line, i) => {
    const ty = doc.y - bh + (label ? 18 : 8) + i * 14;
    doc.fontSize(8.5).fillColor('#e2e8f0').font('Courier').text(line, bx + 10, ty, { width: bw - 20 });
  });
  doc.y += 8;
  doc.moveDown(0.5);
}

function table(headers, rows) {
  pageCheck(30 + rows.length * 22);
  const bx = 50, bw = doc.page.width - 100;
  const colW = bw / headers.length;
  let ty = doc.y;

  doc.rect(bx, ty, bw, 20).fill('#e0e7ff').stroke('#6366f1');
  headers.forEach((h, i) => {
    doc.fontSize(8.5).fillColor('#3730a3').font('Helvetica-Bold')
      .text(h, bx + i * colW + 6, ty + 5, { width: colW - 10 });
  });
  ty += 20;

  rows.forEach((row, ri) => {
    const bg = ri % 2 === 0 ? '#f8f9ff' : '#ffffff';
    doc.rect(bx, ty, bw, 20).fill(bg).stroke('#e2e8f0');
    row.forEach((cell, ci) => {
      doc.fontSize(8).fillColor('#1e293b').font('Helvetica')
        .text(String(cell), bx + ci * colW + 6, ty + 5, { width: colW - 10 });
    });
    ty += 20;
  });
  doc.y = ty + 8;
  doc.moveDown(0.4);
}

function bullet(items, color = '#6366f1') {
  items.forEach(item => {
    pageCheck(20);
    doc.fontSize(10).fillColor(color).font('Helvetica-Bold').text('•', 55, doc.y, { continued: true, width: 12 });
    doc.fillColor('#1e293b').font('Helvetica').text('  ' + item, { lineGap: 2 });
  });
  doc.moveDown(0.4);
}

// ══════════════════════════════════════════════════════════════════════
// PAGE COUVERTURE
// ══════════════════════════════════════════════════════════════════════
coverPage();

// ══════════════════════════════════════════════════════════════════════
// SECTION 01 — SYSTÈME DE MISE À JOUR JSON
// ══════════════════════════════════════════════════════════════════════
sectionTitle('01', 'Système de Mise à Jour JSON', C.primary);

para('Le site Baccarat Pro intègre un système de mise à jour par fichier JSON. Depuis le panneau Admin → onglet Système, vous glissez un fichier .json et le serveur applique les changements automatiquement.');

h2('Comment fonctionne une mise à jour ?', C.primary);
bullet([
  'Vous préparez un fichier .json selon le format décrit dans ce document',
  'Dans le panneau Admin, onglet "Système", vous uploadez le fichier',
  'Le serveur analyse le champ "type" et applique la mise à jour correspondante',
  'Un rapport indique ce qui a été appliqué, ignoré ou en erreur',
  'Si type="code" : un rebuild Vite (~15 sec) se déclenche automatiquement',
  'Si type="css"  : l\'injection est instantanée, sans rebuild',
  'Si type="styles" : les variables CSS sont mises à jour instantanément',
]);

h2('Structure de base d\'un fichier JSON', C.primary);
code([
  '{',
  '  "type": "<type>",   // "code" | "css" | "styles" | "sequences"',
  '  "data": {           // Contenu dépend du type',
  '    ...',
  '  }',
  '}',
], 'structure-base.json');

warn('Le champ "type" est obligatoire. Un type inconnu fait échouer la mise à jour.');

h2('Les 4 types disponibles', C.primary);
table(
  ['Type', 'Usage', 'Rebuild ?', 'Instantané ?'],
  [
    ['"code"', 'Modifier le code source JS/JSX', 'Oui (~15s)', 'Non'],
    ['"css"', 'Injecter du CSS libre (animations...)', 'Non', 'Oui'],
    ['"styles"', 'Modifier des variables CSS prédéfinies', 'Non', 'Oui'],
    ['"sequences"', 'Définir des séquences de relance', 'Non', 'Oui'],
  ]
);

// ══════════════════════════════════════════════════════════════════════
// SECTION 02 — TYPE "code"
// ══════════════════════════════════════════════════════════════════════
sectionTitle('02', 'Type "code" — Modifier les Fichiers Source', C.secondary);

para('Ce type permet de modifier directement le code source du projet. Il supporte deux opérations : "append" (ajouter du texte à la fin d\'un fichier) et "find+replace" (chercher et remplacer du texte précis).');

h2('Format : Find & Replace', C.secondary);
code([
  '{',
  '  "type": "code",',
  '  "data": {',
  '    "files": [',
  '      {',
  '        "path": "src/pages/Admin.jsx",',
  '        "find": "texte exact à chercher dans le fichier",',
  '        "replace": "texte de remplacement",',
  '        "replace_all": false   // optionnel, true = remplace toutes occurrences',
  '      }',
  '    ],',
  '    "rebuild": true',
  '  }',
  '}',
], 'find-replace.json');

tip('Copiez le texte à remplacer EXACTEMENT depuis le code source, espaces et indentation compris.');
danger('Ne jamais laisser "find" vide — cela remplace tout le fichier par le contenu de "replace".');

h2('Format : Append (ajouter à la fin)', C.secondary);
code([
  '{',
  '  "type": "code",',
  '  "data": {',
  '    "files": [',
  '      {',
  '        "path": "src/pages/MonFichier.jsx",',
  '        "append": "// Nouveau code ajouté à la fin\\nexport const maVar = 42;"',
  '      }',
  '    ],',
  '    "rebuild": true',
  '  }',
  '}',
], 'append.json');

h2('Fichiers modifiables', C.secondary);
table(
  ['Fichier', 'Rôle', 'Risque'],
  [
    ['src/pages/Admin.jsx', 'Interface admin complète', 'Élevé — rebuild requis'],
    ['src/pages/Home.jsx', 'Interface utilisateur canal', 'Élevé — rebuild requis'],
    ['src/App.jsx', 'Routeur principal React', 'Critique'],
    ['engine.js', 'Moteur de prédiction', 'Critique'],
    ['admin.js', 'Routes API admin', 'Élevé'],
    ['telegram-service.js', 'Bot Telegram', 'Élevé'],
    ['db.js', 'Base de données PostgreSQL', 'Critique'],
    ['index.js', 'Serveur Express principal', 'Critique'],
  ]
);

danger('Ne jamais modifier db.js, index.js, src/App.jsx via JSON sans backup. Risque de casser le serveur.');
warn('"rebuild: true" est nécessaire pour tout fichier .jsx ou .js modifié via find+replace.');

h2('Règles de formatage du champ "find"', C.secondary);
bullet([
  'Chaque saut de ligne dans le code réel → écrire \\n dans le JSON',
  'Les guillemets " dans le code → les échapper \\"',
  'Les backticks ` restent tels quels (non spéciaux en JSON)',
  'Les accolades { } restent telles quelles',
  'Inclure 5 à 10 lignes de contexte pour que le find soit unique dans le fichier',
  'Si le texte apparaît plusieurs fois, ajouter plus de contexte ou utiliser "replace_all": true',
]);

// ══════════════════════════════════════════════════════════════════════
// SECTION 03 — TYPE "css"
// ══════════════════════════════════════════════════════════════════════
sectionTitle('03', 'Type "css" — CSS Instantané Sans Rebuild', C.cyan);

para('Ce type injecte du CSS brut directement dans la balise <style id="baccarat-custom-css"> sans déclencher de rebuild Vite. Idéal pour les animations, effets visuels, keyframes et overrides CSS.');

h2('Format complet', C.cyan);
code([
  '{',
  '  "type": "css",',
  '  "data": {',
  '    "mode": "replace",   // "replace" (écrase) ou "append" (ajoute)',
  '    "css": "@keyframes monAnim { 0% { opacity:0 } 100% { opacity:1 } }\\n.ma-classe { animation: monAnim 1s; }"',
  '  }',
  '}',
], 'css-injection.json');

h2('Modes disponibles', C.cyan);
table(
  ['Mode', 'Comportement'],
  [
    ['"replace"', 'Remplace TOUT le CSS personnalisé existant par le nouveau'],
    ['"append"', 'Ajoute le CSS à la suite du CSS déjà injecté'],
  ]
);

h2('Ce que vous pouvez faire avec type "css"', C.cyan);
bullet([
  '@keyframes : animations et transitions complexes',
  'Overrides de composants : .btn, .admin-card, h1, h2, button...',
  'Effets de fond : body::before, body::after avec position:fixed',
  'Variables CSS dynamiques : :root { --my-var: #fff }',
  'Media queries : @media (max-width: 768px) { ... }',
  'Pseudo-éléments et pseudo-classes : :hover, :focus, ::placeholder',
], C.cyan);

warn('Les styles !important sont nécessaires pour dépasser les styles Tailwind/inline du code React.');
tip('Pour supprimer le CSS injecté : Admin → Système → bouton Supprimer le CSS personnalisé.');

h2('Exemple : Jeu de lumières Joueur/Banquier', C.cyan);
code([
  '{',
  '  "type": "css",',
  '  "data": {',
  '    "mode": "replace",',
  '    "css": "@keyframes jl-overlay { 0%,44% { background: rgba(34,197,94,0.18); } 50%,94% { background: rgba(239,68,68,0.18); } }\\nbody::after { content:\'\'; position:fixed; inset:0; pointer-events:none; z-index:9998; animation: jl-overlay 10s step-end infinite; }"',
  '  }',
  '}',
], 'exemple-lumieres.json');

// ══════════════════════════════════════════════════════════════════════
// SECTION 04 — TYPE "styles"
// ══════════════════════════════════════════════════════════════════════
sectionTitle('04', 'Type "styles" — Variables CSS Prédéfinies', C.orange);

para('Ce type permet de modifier les variables CSS prédéfinies du thème. Contrairement au type "css", il est limité à une liste de variables autorisées (ALLOWED_CSS_VARS) et ne supporte pas les animations.');

h2('Format', C.orange);
code([
  '{',
  '  "type": "styles",',
  '  "data": {',
  '    "--primary": "#6366f1",',
  '    "--bg-main": "#0f0e17",',
  '    "--card-bg": "#1a1827",',
  '    "--text-primary": "#e2e8f0",',
  '    "--accent": "#a855f7"',
  '  }',
  '}',
], 'styles.json');

h2('Variables CSS disponibles (ALLOWED_CSS_VARS)', C.orange);
table(
  ['Variable', 'Description', 'Valeur par défaut'],
  [
    ['--primary', 'Couleur principale (indigo)', '#6366f1'],
    ['--secondary', 'Couleur secondaire (violet)', '#a855f7'],
    ['--accent', 'Couleur d\'accent', '#06b6d4'],
    ['--bg-main', 'Fond de la page', '#0f0e17'],
    ['--bg-card', 'Fond des cartes/panels', '#1a1827'],
    ['--bg-card-2', 'Fond secondaire des cartes', '#1e1b2e'],
    ['--text-primary', 'Texte principal', '#e2e8f0'],
    ['--text-secondary', 'Texte secondaire', '#94a3b8'],
    ['--text-muted', 'Texte atténué', '#64748b'],
    ['--border-color', 'Couleur des bordures', 'rgba(255,255,255,0.08)'],
    ['--success', 'Couleur succès', '#22c55e'],
    ['--danger', 'Couleur danger', '#ef4444'],
    ['--warning', 'Couleur avertissement', '#f59e0b'],
    ['--gold', 'Couleur or (Premium)', '#fbbf24'],
    ['--font-size-base', 'Taille de police de base', '14px'],
    ['--border-radius', 'Rayon de bordure global', '10px'],
    ['--shadow-card', 'Ombre des cartes', '0 4px 24px rgba(0,0,0,0.4)'],
    ['--prediction-win', 'Couleur prédiction gagnée', '#22c55e'],
    ['--prediction-loss', 'Couleur prédiction perdue', '#ef4444'],
    ['--prediction-pending', 'Couleur prédiction en attente', '#f59e0b'],
    ['--sidebar-width', 'Largeur du panneau latéral', '280px'],
    ['--header-height', 'Hauteur de l\'en-tête', '60px'],
    ['--tg-msg-bg', 'Fond messages Telegram', '#1e293b'],
    ['--tg-msg-border', 'Bordure messages Telegram', 'rgba(99,102,241,0.2)'],
    ['--btn-primary-bg', 'Fond bouton principal', '#6366f1'],
    ['--btn-primary-color', 'Texte bouton principal', '#ffffff'],
    ['--btn-radius', 'Rayon bouton', '8px'],
  ]
);

warn('Une variable non présente dans ALLOWED_CSS_VARS est ignorée silencieusement. Utilisez type:"css" pour tout le reste.');
danger('Ne pas utiliser type:"styles" pour des @keyframes ou des sélecteurs CSS — utiliser type:"css" à la place.');

// ══════════════════════════════════════════════════════════════════════
// SECTION 05 — TYPE "sequences"
// ══════════════════════════════════════════════════════════════════════
sectionTitle('05', 'Type "sequences" — Séquences de Relance', C.green);

para('Ce type définit des séquences de relance (Rn) pour le mode Séquences de Relance. Les séquences sont sauvegardées en base de données et rechargées au démarrage.');

h2('Format', C.green);
code([
  '{',
  '  "type": "sequences",',
  '  "data": [',
  '    {',
  '      "name": "Séquence Classique",',
  '      "levels": [',
  '        { "level": 1, "suits": ["♥", "♠"] },',
  '        { "level": 2, "suits": ["♣", "♦"] },',
  '        { "level": 3, "suits": ["♥", "♣", "♠", "♦"] }',
  '      ]',
  '    }',
  '  ]',
  '}',
], 'sequences.json');

h2('Champs des niveaux', C.green);
table(
  ['Champ', 'Type', 'Description'],
  [
    ['"level"', 'number (1–5)', 'Niveau de rattrapage R1 à R5'],
    ['"suits"', 'array de string', 'Costumes : "♥", "♠", "♦", "♣"'],
  ]
);

// ══════════════════════════════════════════════════════════════════════
// SECTION 06 — MODES DE STRATÉGIE
// ══════════════════════════════════════════════════════════════════════
sectionTitle('06', 'Modes de Stratégie', C.primary);

para('Chaque stratégie a un champ "mode" qui détermine son algorithme de prédiction. Voici la documentation complète de chaque mode.');

h2('Tableau récapitulatif', C.primary);
table(
  ['Mode', 'Valeur', 'Manuel/Auto', 'Main requise ?'],
  [
    ['Manquants', '"manquants"', 'Auto', 'Oui'],
    ['Apparents', '"apparents"', 'Auto', 'Oui'],
    ['Absence → Apparition', '"absence_apparition"', 'Auto', 'Oui'],
    ['Apparition → Absence', '"apparition_absence"', 'Auto', 'Oui'],
    ['Taux Miroir', '"taux_miroir"', 'Auto', 'Non (4 paires fixées)'],
    ['Séquences de Relance', '"relance"', 'Auto', 'Non (hérite sources)'],
    ['Stratégie Aléatoire', '"aleatoire"', 'Manuel (bot)', 'Non (définie au moment de la pred.)'],
  ]
);

h2('Mode "manquants"', C.primary);
para('Prédit le costume absent depuis le plus longtemps dans la main surveillée (Joueur ou Banquier). Le seuil B définit le nombre minimum d\'absences pour déclencher.');
bullet([
  'Seuil B : nombre de jeux d\'absence minimum (ex. B=5 → prédit après 5 absences)',
  'Mapping : définit quel costume est prédit pour chaque costume absent',
  'Main : Joueur (cards du joueur) ou Banquier (cards du banquier)',
  'Rattrapage : si la prédiction rate, tente jusqu\'à max_rattrapage jeux de plus',
]);

h2('Mode "apparents"', C.primary);
para('Prédit le costume le plus fréquent dans la main surveillée. Le seuil B définit le nombre minimum d\'apparitions.');
bullet([
  'Seuil B : nombre d\'apparitions minimum pour déclencher',
  'Mapping : idem manquants',
  'Logique inverse des manquants : prédit le costume "chaud" plutôt que le "froid"',
]);

h2('Mode "absence_apparition"', C.primary);
para('Déclenche dès qu\'un costume absent depuis B jeux réapparaît dans la main. La prédiction est toujours le costume déclencheur lui-même (pas de mapping).');
bullet([
  'Seuil B minimum recommandé : 4',
  'Déclenchement en temps réel avant la fin du tirage',
  'Pas de mapping — ignoré même s\'il est défini',
]);

h2('Mode "apparition_absence"', C.primary);
para('Déclenche dès qu\'un costume présent depuis B jeux consécutifs disparaît de la main. La prédiction suit le mapping configuré.');
bullet([
  'Seuil B minimum recommandé : 4',
  'Le mapping est obligatoire et utilisé',
  'Déclenchement en temps réel',
]);

h2('Mode "taux_miroir"', C.primary);
para('Compare des paires de costumes et prédit quand l\'écart entre eux dépasse le seuil B. 4 paires sont fixes : ♥/♠, ♣/♦, ♥/♦, ♣/♠.');
bullet([
  'Pas de main à surveiller (analyse les deux mains ensemble)',
  'Seuil B = écart déclenchant entre les deux costumes de la paire',
  'Remise à zéro des compteurs après chaque déclenchement',
  'Remise à zéro automatique toutes les heures',
]);

h2('Mode "relance"', C.primary);
para('Ne génère pas de prédictions directes. Surveille d\'autres stratégies et déclenche une relance quand leurs conditions sont atteintes. 3 types de conditions :');
bullet([
  'Condition A — Pertes consécutives : N pertes de suite → relance',
  'Condition B — Rattrapages consécutifs : N× le niveau Rn → relance',
  'Condition C — Combo perte+rattrapage : N événements au total → relance',
  'Toute condition peut déclencher indépendamment',
]);
warn('"relance_rules" doit contenir au moins 1 stratégie source. Sans cela, la sauvegarde échoue.');

h2('Mode "aleatoire"', C.primary);
para('Mode 100% manuel. L\'admin ou l\'utilisateur choisit le numéro à prédire via le bot Telegram. Le système calcule automatiquement le costume selon la main choisie.');
bullet([
  'Joueur ❤️♣️♦️♠️ : cycle de 4 sur 1440 tours — formule : SUITS[(num-1) % 4]',
  'Banquier ♣️❤️♠️♦️ : même formule avec ordre différent',
  'Condition : le numéro tapé doit être > tour en cours (sinon erreur bot)',
  'Commande bot : /predire [stratId] → sélection Joueur/Banquier → saisie numéro',
  'Pas de seuil B, pas de mapping, pas de main à surveiller dans le formulaire',
]);

// ══════════════════════════════════════════════════════════════════════
// SECTION 07 — BOT TELEGRAM
// ══════════════════════════════════════════════════════════════════════
sectionTitle('07', 'Bot Telegram & Commande /predire', C.cyan);

h2('Configuration du bot', C.cyan);
bullet([
  'BOT_TOKEN : jeton API fourni par @BotFather sur Telegram',
  'Configurer dans Admin → Canaux Telegram → Token du bot',
  'Le bot doit être administrateur du canal cible',
  'Un seul BOT_TOKEN pour tous les canaux',
  'Maximum 10 canaux configurables',
]);

h2('Commande /predire (mode aléatoire)', C.cyan);
para('Disponible uniquement pour les stratégies de mode "aleatoire". Workflow complet :');
code([
  '1. L\'utilisateur envoie : /predire         (liste toutes les strats aléatoires)',
  '   ou                  : /predire 42       (cible la stratégie id=42)',
  '',
  '2. Le bot répond avec les boutons :',
  '   [ ❤️ Joueur ]   [ ♣️ Banquier ]',
  '',
  '3. L\'utilisateur clique un bouton.',
  '   Le bot demande : "Entrez le numéro à prédire (1–1440) :"',
  '',
  '4. L\'utilisateur envoie un nombre (ex. 735).',
  '',
  '5. Le bot vérifie : 735 > tour_en_cours ?',
  '   → OUI : calcule le costume, envoie la prédiction dans le canal',
  '   → NON : erreur "Ce numéro est déjà passé"',
], 'workflow-predire.txt');

h2('Mapping numéro → costume', C.cyan);
table(
  ['Numéro % 4', 'Joueur ❤️♣️♦️♠️', 'Banquier ♣️❤️♠️♦️'],
  [
    ['1 (1,5,9,...)', '♥ (❤️)', '♣ (♣️)'],
    ['2 (2,6,10,...)', '♣ (♣️)', '♥ (❤️)'],
    ['3 (3,7,11,...)', '♦ (♦️)', '♠ (♠️)'],
    ['0 (4,8,12,...)', '♠ (♠️)', '♦ (♦️)'],
  ]
);

h2('Exemples de calcul', C.cyan);
code([
  'Numéro tapé : 735   → 735 % 4 = 3   → Joueur : ♦️  |  Banquier : ♠️',
  'Numéro tapé : 1440  → 1440 % 4 = 0  → Joueur : ♠️  |  Banquier : ♦️',
  'Numéro tapé : 1     → 1 % 4 = 1     → Joueur : ♥️  |  Banquier : ♣️',
  'Numéro tapé : 200   → 200 % 4 = 0   → Joueur : ♠️  |  Banquier : ♦️',
], 'exemples-calcul.txt');

// ══════════════════════════════════════════════════════════════════════
// SECTION 08 — VARIABLES & CONSTANTES CRITIQUES
// ══════════════════════════════════════════════════════════════════════
sectionTitle('08', 'Variables & Constantes Critiques', C.red);

danger('Ne jamais modifier les variables et constantes listées ci-dessous via le système JSON. Toute modification mal faite peut casser le serveur ou corrompre les données.');

h2('Dans engine.js', C.red);
table(
  ['Variable/Constante', 'Description', 'Ne pas toucher'],
  [
    ['SUITS', 'Tableau ["♥","♠","♦","♣"]', '✗ Jamais'],
    ['this.custom', 'Map des stratégies chargées', '✗ Jamais'],
    ['this.state', 'État interne du moteur', '✗ Jamais'],
    ['_resolvePending()', 'Résout les prédictions en attente', '✗ Jamais'],
    ['_onStratLoss()', 'Callback perte stratégie', '✗ Jamais'],
    ['lossStreaks', 'Compteur de pertes consécutives', '✗ Jamais'],
    ['rattrapStreaks', 'Compteur de rattrapages', '✗ Jamais'],
  ]
);

h2('Dans telegram-service.js', C.red);
table(
  ['Variable', 'Description', 'Ne pas toucher'],
  [
    ['TOKEN', 'Jeton API bot Telegram', '✗ Jamais directement'],
    ['channelStore', 'Map des canaux actifs', '✗ Jamais'],
    ['pendingAleatoire', 'État machine bot aléatoire', '✗ Jamais'],
    ['SUIT_EMOJI_MAP', 'Map costume → emoji', '✗ Jamais'],
    ['SUITS_JOUEUR', 'Ordre costumes joueur', '✗ Jamais'],
    ['SUITS_BANQUIER', 'Ordre costumes banquier', '✗ Jamais'],
    ['bot', 'Instance TelegramBot', '✗ Jamais'],
  ]
);

h2('Dans admin.js', C.red);
table(
  ['Variable', 'Description', 'Risque si modifié'],
  [
    ['SUITS', 'Tableau des 4 costumes', 'Crash validation'],
    ['ALLOWED_CSS_VARS', 'Variables CSS autorisées', 'Variables ignorées'],
    ['validateStrategy()', 'Validation avant save', 'Saves cassés'],
    ['normalizeMappings()', 'Normalisation des mappings', 'Mappings corrompus'],
  ]
);

h2('Dans db.js', C.red);
danger('Ne JAMAIS modifier db.js via JSON. Ce fichier gère la connexion PostgreSQL et toutes les requêtes SQL. Toute erreur ici fait planter le serveur entier.');

h2('Constantes de configuration', C.red);
table(
  ['Constante', 'Valeur', 'Fichier', 'Impact si changé'],
  [
    ['PORT', '5000', 'index.js', 'Site inaccessible'],
    ['MAX_CHANNELS', '10', 'telegram-service.js', 'Canaux bloqués'],
    ['MAX_RATTRAPAGE_GLOBAL', '0–5', 'db.js setting', 'Prédictions faussées'],
    ['SUITS (4 costumes)', '♥♠♦♣', 'partout', 'Crash général'],
    ['MAX_RELANCE_LEVELS', '5', 'engine.js', 'Relances cassées'],
  ]
);

// ══════════════════════════════════════════════════════════════════════
// SECTION 09 — FICHIERS IMPORTANTS
// ══════════════════════════════════════════════════════════════════════
sectionTitle('09', 'Fichiers Importants & Leur Rôle', C.gray);

h2('Architecture générale', C.primary);
code([
  'baccarat-pro/',
  '├── index.js              → Serveur Express (port 5000)',
  '├── admin.js              → Routes API admin (/api/admin/...)',
  '├── engine.js             → Moteur de prédiction (algorithmes)',
  '├── db.js                 → Accès PostgreSQL',
  '├── telegram-service.js   → Bot Telegram + envoi messages',
  '├── src/',
  '│   ├── App.jsx           → Routeur React principal',
  '│   ├── pages/',
  '│   │   ├── Admin.jsx     → Panneau administrateur (4000+ lignes)',
  '│   │   ├── Home.jsx      → Interface canal utilisateur',
  '│   │   └── Login.jsx     → Page de connexion',
  '│   └── main.jsx          → Point d\'entrée React',
  '├── dist/                 → Build Vite (servi par Express)',
  '└── public/               → Fichiers statiques publics',
], 'structure.txt');

h2('Rôle de chaque fichier', C.primary);

h3('index.js — Point d\'entrée serveur');
bullet([
  'Lance le serveur Express sur le port 5000',
  'Monte les routes : /api/admin (admin.js), /api/* (autres)',
  'Sert le build Vite depuis /dist',
  'Initialise le moteur et le bot Telegram au démarrage',
]);
danger('Ne jamais modifier la logique de montage des routes sans comprendre les dépendances.');

h3('admin.js — API administration');
bullet([
  'POST/PUT/DELETE /api/admin/strategies → CRUD des stratégies',
  'POST /api/admin/update → Système de mise à jour JSON',
  'GET /api/admin/build-status → Statut du rebuild Vite',
  'GET/DELETE /api/admin/custom-css → CSS personnalisé',
  'Validation des stratégies via validateStrategy()',
]);

h3('engine.js — Moteur de prédiction');
bullet([
  'Reçoit chaque nouveau jeu et traite toutes les stratégies',
  'Passe 1 : stratégies simples (manquants, apparents, miroir, aléatoire exclus)',
  'Passe 2 : stratégies multi-source',
  'Passe 3 : stratégies relance (résolution des pending)',
  'Envoie les résultats via telegram-service.js',
]);

h3('telegram-service.js — Bot');
bullet([
  'Gère la connexion au bot avec polling long',
  'Envoie les prédictions formatées dans les canaux',
  'Édite les messages après résolution (gagné/perdu/rattrapage)',
  'Gère la machine d\'état /predire pour le mode aléatoire',
  'buildTgMessage() : formate le message selon le format 1–6 configuré',
]);

// ══════════════════════════════════════════════════════════════════════
// SECTION 10 — ERREURS FRÉQUENTES
// ══════════════════════════════════════════════════════════════════════
sectionTitle('10', 'Erreurs Fréquentes & Bonnes Pratiques', C.orange);

h2('Erreurs lors de l\'upload JSON', C.orange);
table(
  ['Message d\'erreur', 'Cause probable', 'Solution'],
  [
    ['"Mode invalide"', 'Mode inconnu dans stratForm', 'Vérifier la liste des modes valides'],
    ['"Seuil B invalide"', 'threshold manquant ou hors 1–50', 'Ajouter threshold valide'],
    ['"Mappings invalides"', 'Format mappings incorrect', 'Utiliser { "♥":["♠"] }'],
    ['"find not found"', 'Texte à remplacer introuvable', 'Copier le texte exact du fichier'],
    ['"JSON parse error"', 'JSON malformé', 'Valider sur jsonlint.com'],
    ['"rebuild: true absent"', 'Rebuild non déclenché', 'Ajouter "rebuild": true au data'],
    ['"Aucune strat. source"', 'relance sans relance_rules', 'Ajouter au moins 1 source'],
  ]
);

h2('Bonnes pratiques JSON', C.orange);
bullet([
  'Toujours valider votre JSON sur jsonlint.com avant upload',
  'Faire un backup du fichier source avant un find+replace important',
  'Utiliser type:"css" pour tout effet visuel (plus rapide, réversible)',
  'Tester avec une petite modification avant un changement important',
  'Ne jamais laisser "replace" vide — cela supprime le texte ciblé',
  'Attendre la fin du rebuild (~15s) avant de tester les changements type:"code"',
  'Le panneau admin affiche un indicateur de rebuild en cours',
], C.orange);

h2('Choses à ne JAMAIS faire', C.orange);
danger('1. Ne jamais mettre "find" contenant une chaîne unique (ex: un seul caractère) — risque de remplacement multiple non voulu.');
danger('2. Ne jamais modifier SUITS, SUIT_EMOJI_MAP, SUITS_JOUEUR, SUITS_BANQUIER — le système entier dépend de l\'ordre exact.');
danger('3. Ne jamais supprimer les exports de telegram-service.js ou admin.js — crash serveur garanti.');
danger('4. Ne jamais faire un find+replace sur db.js sans avoir testé les requêtes SQL au préalable.');
danger('5. Ne jamais changer le port 5000 dans index.js — le proxy Replit est configuré sur ce port.');

h2('Checklist avant chaque mise à jour', C.orange);
bullet([
  '☐ JSON valide (pas de virgule manquante, accolades fermées)',
  '☐ Le champ "find" est copié exactement depuis le code (espaces, guillemets)',
  '☐ "rebuild": true ajouté pour les fichiers .jsx/.js modifiés',
  '☐ Sauvegarder l\'état actuel (checkpoint) avant d\'uploader',
  '☐ Tester sur un petit changement d\'abord si c\'est une grosse modif',
  '☐ Attendre la fin du rebuild avant de tester',
  '☐ Vérifier les logs si quelque chose ne s\'affiche pas',
], C.orange);

// ══════════════════════════════════════════════════════════════════════
// SECTION 11 — EXEMPLES JSON COMPLETS
// ══════════════════════════════════════════════════════════════════════
sectionTitle('11', 'Exemples JSON Complets Prêts à l\'Emploi', C.green);

h2('Exemple 1 — Changer la couleur principale du thème', C.green);
code([
  '{',
  '  "type": "styles",',
  '  "data": {',
  '    "--primary": "#e11d48",',
  '    "--secondary": "#db2777",',
  '    "--btn-primary-bg": "#e11d48"',
  '  }',
  '}',
], 'ex1-couleur-theme.json');

h2('Exemple 2 — Animation pulsante sur les titres', C.green);
code([
  '{',
  '  "type": "css",',
  '  "data": {',
  '    "mode": "replace",',
  '    "css": "@keyframes pulse-title { 0%,100% { opacity:1; } 50% { opacity:0.6; } }\\nh1,h2 { animation: pulse-title 2s ease-in-out infinite !important; }"',
  '  }',
  '}',
], 'ex2-animation-titre.json');

h2('Exemple 3 — Ajouter un texte en bas de page', C.green);
code([
  '{',
  '  "type": "css",',
  '  "data": {',
  '    "mode": "append",',
  '    "css": "body::before { content: \'⭐ Baccarat Pro v2\'; position:fixed; bottom:8px; left:50%; transform:translateX(-50%); font-size:10px; color:#6366f1; z-index:9999; pointer-events:none; }"',
  '  }',
  '}',
], 'ex3-texte-bas.json');

h2('Exemple 4 — Supprimer un bloc entier dans Admin.jsx', C.green);
code([
  '{',
  '  "type": "code",',
  '  "data": {',
  '    "files": [',
  '      {',
  '        "path": "src/pages/Admin.jsx",',
  '        "find": "        {/* ── MON BLOC ── */}\\n        <div className=\\"ma-classe\\">\\n          Contenu à supprimer\\n        </div>\\n",',
  '        "replace": ""',
  '      }',
  '    ],',
  '    "rebuild": true',
  '  }',
  '}',
], 'ex4-supprimer-bloc.json');

h2('Exemple 5 — Ajouter une option dans un menu déroulant', C.green);
code([
  '{',
  '  "type": "code",',
  '  "data": {',
  '    "files": [',
  '      {',
  '        "path": "src/pages/Admin.jsx",',
  '        "find": "                    <option value=\\"relance\\">🔁 Séquences de Relance</option>\\n                  </select>",',
  '        "replace": "                    <option value=\\"relance\\">🔁 Séquences de Relance</option>\\n                    <option value=\\"nouveau\\">🆕 Mon Nouveau Mode</option>\\n                  </select>"',
  '      }',
  '    ],',
  '    "rebuild": true',
  '  }',
  '}',
], 'ex5-menu-option.json');

h2('Exemple 6 — Créer une stratégie aléatoire via API (référence)', C.green);
code([
  '// Corps de la requête POST /api/admin/strategies',
  '{',
  '  "name": "Ma Stratégie Aléatoire",',
  '  "mode": "aleatoire",',
  '  "enabled": true,',
  '  "visibility": "all",',
  '  "max_rattrapage": 5,',
  '  "hand": "joueur",',
  '  "threshold": 1,',
  '  "mappings": { "♥":["♠"], "♠":["♥"], "♦":["♣"], "♣":["♦"] }',
  '}',
], 'ex6-strat-aleatoire.json');

h2('Exemple 7 — Mise à jour backend + frontend combinée', C.green);
code([
  '{',
  '  "type": "code",',
  '  "data": {',
  '    "files": [',
  '      {',
  '        "path": "engine.js",',
  '        "find": "// Mon ancienne logique",',
  '        "replace": "// Ma nouvelle logique"',
  '      },',
  '      {',
  '        "path": "src/pages/Admin.jsx",',
  '        "find": "<span>Ancien texte</span>",',
  '        "replace": "<span>Nouveau texte</span>"',
  '      }',
  '    ],',
  '    "rebuild": true',
  '  }',
  '}',
], 'ex7-multi-fichiers.json');

tip('On peut modifier plusieurs fichiers dans un seul JSON — tous sont traités en séquence, un seul rebuild à la fin.');

// ── Page finale ───────────────────────────────────────────────────────
doc.addPage();
doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f0e17');
doc.rect(0, 0, doc.page.width, 6).fill('#6366f1');
doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill('#a855f7');

doc.fontSize(28).fillColor('#6366f1').font('Helvetica-Bold')
  .text('Baccarat Pro', 50, 200, { align: 'center' });
doc.fontSize(14).fillColor('#94a3b8').font('Helvetica')
  .text('Documentation générée automatiquement', 50, 245, { align: 'center' });
doc.fontSize(11).fillColor('#475569').font('Helvetica')
  .text(`${new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`, 50, 270, { align: 'center' });

doc.moveTo(150, 300).lineTo(doc.page.width - 150, 300).strokeColor('#6366f1').lineWidth(1).stroke();

doc.fontSize(10).fillColor('#334155').font('Helvetica')
  .text('Pour toute mise à jour, utilisez uniquement le panneau Admin → Système.', 50, 320, { align: 'center' })
  .text('Conservez toujours un checkpoint avant chaque modification importante.', 50, 338, { align: 'center' });

doc.end();
console.log('PDF généré :', OUT);
