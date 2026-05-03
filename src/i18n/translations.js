/**
 * Dictionnaire de traductions — Baccarat Prediction Pro
 * Langues : FR, EN, ES, DE, AR, RU, PT, IT
 */

export const LANGUAGES = [
  { code: 'fr', label: 'Français',   flag: '🇫🇷', dir: 'ltr' },
  { code: 'en', label: 'English',    flag: '🇬🇧', dir: 'ltr' },
  { code: 'es', label: 'Español',    flag: '🇪🇸', dir: 'ltr' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪', dir: 'ltr' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦', dir: 'rtl' },
  { code: 'ru', label: 'Русский',    flag: '🇷🇺', dir: 'ltr' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷', dir: 'ltr' },
  { code: 'it', label: 'Italiano',   flag: '🇮🇹', dir: 'ltr' },
];

export const DEFAULT_LANG = 'fr';

const T = {
  /* ── App ─────────────────────────────────────────────────── */
  'app.name': {
    fr: 'Prediction Baccara Pro',
    en: 'Baccarat Prediction Pro',
    es: 'Predicción Baccara Pro',
    de: 'Baccarat Vorhersage Pro',
    ar: 'تنبؤ الباكارا برو',
    ru: 'Баккара Прогноз Про',
    pt: 'Previsão Bacará Pro',
    it: 'Previsione Baccarat Pro',
  },
  'app.tagline': {
    fr: 'Vos signaux live, en temps réel',
    en: 'Your live signals, in real time',
    es: 'Tus señales en vivo, en tiempo real',
    de: 'Ihre Live-Signale in Echtzeit',
    ar: 'إشاراتك المباشرة في الوقت الفعلي',
    ru: 'Ваши живые сигналы в реальном времени',
    pt: 'Seus sinais ao vivo, em tempo real',
    it: 'I tuoi segnali live, in tempo reale',
  },
  'app.subtitle': {
    fr: 'Inscrivez-vous, choisissez votre canal et recevez des prédictions automatiques générées en direct à partir des parties 1xBet — sans rien rater.',
    en: 'Sign up, choose your channel and receive automatic predictions generated live from 1xBet games — never miss a beat.',
    es: 'Regístrate, elige tu canal y recibe predicciones automáticas generadas en vivo desde las partidas de 1xBet.',
    de: 'Registrieren Sie sich, wählen Sie Ihren Kanal und erhalten Sie automatische Vorhersagen aus 1xBet-Spielen in Echtzeit.',
    ar: 'سجّل، اختر قناتك واستقبل تنبؤات تلقائية مباشرة من مباريات 1xBet.',
    ru: 'Зарегистрируйтесь, выберите канал и получайте автоматические прогнозы в прямом эфире из игр 1xBet.',
    pt: 'Cadastre-se, escolha seu canal e receba previsões automáticas geradas ao vivo das partidas do 1xBet.',
    it: 'Registrati, scegli il tuo canale e ricevi previsioni automatiche generate in diretta dalle partite 1xBet.',
  },

  /* ── Nav / Actions ───────────────────────────────────────── */
  'nav.login': {
    fr: 'Connexion', en: 'Login', es: 'Iniciar sesión', de: 'Anmelden',
    ar: 'تسجيل الدخول', ru: 'Войти', pt: 'Entrar', it: 'Accedi',
  },
  'nav.register': {
    fr: "S'inscrire", en: 'Sign Up', es: 'Registrarse', de: 'Registrieren',
    ar: 'إنشاء حساب', ru: 'Регистрация', pt: 'Cadastrar', it: 'Registrati',
  },
  'nav.logout': {
    fr: 'Déconnexion', en: 'Logout', es: 'Cerrar sesión', de: 'Abmelden',
    ar: 'تسجيل الخروج', ru: 'Выйти', pt: 'Sair', it: 'Disconnetti',
  },
  'nav.dashboard': {
    fr: 'Tableau de bord', en: 'Dashboard', es: 'Panel', de: 'Dashboard',
    ar: 'لوحة التحكم', ru: 'Панель', pt: 'Painel', it: 'Dashboard',
  },
  'nav.payment': {
    fr: 'Paiement', en: 'Payment', es: 'Pago', de: 'Zahlung',
    ar: 'الدفع', ru: 'Оплата', pt: 'Pagamento', it: 'Pagamento',
  },
  'nav.admin': {
    fr: 'Admin', en: 'Admin', es: 'Admin', de: 'Admin',
    ar: 'الإدارة', ru: 'Админ', pt: 'Admin', it: 'Admin',
  },
  'nav.back': {
    fr: '← Retour', en: '← Back', es: '← Volver', de: '← Zurück',
    ar: '→ رجوع', ru: '← Назад', pt: '← Voltar', it: '← Indietro',
  },

  /* ── Auth ────────────────────────────────────────────────── */
  'auth.login.title': {
    fr: 'Connectez-vous à votre compte', en: 'Sign in to your account',
    es: 'Inicia sesión en tu cuenta', de: 'Melden Sie sich an',
    ar: 'تسجيل الدخول إلى حسابك', ru: 'Войдите в свой аккаунт',
    pt: 'Entre em sua conta', it: 'Accedi al tuo account',
  },
  'auth.login.btn': {
    fr: '🚀 Se connecter', en: '🚀 Sign In', es: '🚀 Iniciar sesión',
    de: '🚀 Anmelden', ar: '🚀 تسجيل الدخول', ru: '🚀 Войти',
    pt: '🚀 Entrar', it: '🚀 Accedi',
  },
  'auth.login.loading': {
    fr: 'Connexion...', en: 'Signing in...', es: 'Iniciando sesión...',
    de: 'Anmelden...', ar: 'جارٍ الدخول...', ru: 'Вход...',
    pt: 'Entrando...', it: 'Accesso...',
  },
  'auth.no_account': {
    fr: "Pas encore de compte ?", en: "Don't have an account?",
    es: '¿No tienes cuenta?', de: 'Noch kein Konto?',
    ar: 'ليس لديك حساب؟', ru: 'Нет аккаунта?', pt: 'Não tem conta?', it: 'Non hai un account?',
  },
  'auth.register_free': {
    fr: "S'inscrire gratuitement", en: 'Sign up for free',
    es: 'Regístrate gratis', de: 'Kostenlos registrieren',
    ar: 'إنشاء حساب مجاناً', ru: 'Зарегистрироваться бесплатно',
    pt: 'Cadastrar gratuitamente', it: 'Registrati gratuitamente',
  },
  'auth.register.title': {
    fr: 'Créer un nouveau compte', en: 'Create a new account',
    es: 'Crear una nueva cuenta', de: 'Neues Konto erstellen',
    ar: 'إنشاء حساب جديد', ru: 'Создать новый аккаунт',
    pt: 'Criar uma nova conta', it: 'Crea un nuovo account',
  },
  'auth.register.btn': {
    fr: '✨ Créer mon compte', en: '✨ Create my account',
    es: '✨ Crear mi cuenta', de: '✨ Konto erstellen',
    ar: '✨ إنشاء حسابي', ru: '✨ Создать аккаунт',
    pt: '✨ Criar minha conta', it: '✨ Crea il mio account',
  },
  'auth.register.loading': {
    fr: 'Inscription en cours...', en: 'Creating account...',
    es: 'Creando cuenta...', de: 'Konto wird erstellt...',
    ar: 'جارٍ إنشاء الحساب...', ru: 'Создание аккаунта...',
    pt: 'Criando conta...', it: 'Creazione account...',
  },
  'auth.already_account': {
    fr: 'Déjà inscrit ?', en: 'Already have an account?',
    es: '¿Ya tienes cuenta?', de: 'Schon registriert?',
    ar: 'لديك حساب بالفعل؟', ru: 'Уже есть аккаунт?',
    pt: 'Já tem conta?', it: 'Hai già un account?',
  },
  'auth.field.username': {
    fr: "Nom d'utilisateur", en: 'Username', es: 'Nombre de usuario',
    de: 'Benutzername', ar: 'اسم المستخدم', ru: 'Имя пользователя',
    pt: 'Nome de usuário', it: 'Nome utente',
  },
  'auth.field.email': {
    fr: 'Adresse email', en: 'Email address', es: 'Correo electrónico',
    de: 'E-Mail-Adresse', ar: 'البريد الإلكتروني', ru: 'Адрес эл. почты',
    pt: 'Endereço de email', it: 'Indirizzo email',
  },
  'auth.field.password': {
    fr: 'Mot de passe', en: 'Password', es: 'Contraseña',
    de: 'Passwort', ar: 'كلمة المرور', ru: 'Пароль',
    pt: 'Senha', it: 'Password',
  },
  'auth.field.confirm': {
    fr: 'Confirmer le mot de passe', en: 'Confirm password',
    es: 'Confirmar contraseña', de: 'Passwort bestätigen',
    ar: 'تأكيد كلمة المرور', ru: 'Подтвердите пароль',
    pt: 'Confirmar senha', it: 'Conferma password',
  },
  'auth.field.account_type': {
    fr: 'Type de compte', en: 'Account type', es: 'Tipo de cuenta',
    de: 'Kontotyp', ar: 'نوع الحساب', ru: 'Тип аккаунта',
    pt: 'Tipo de conta', it: 'Tipo di account',
  },
  'auth.field.promo': {
    fr: 'Code promotionnel', en: 'Promo code', es: 'Código promocional',
    de: 'Aktionscode', ar: 'الرمز الترويجي', ru: 'Промо-код',
    pt: 'Código promocional', it: 'Codice promozionale',
  },
  'auth.field.promo_hint': {
    fr: "Avec un code valide, vous obtenez 20 % de réduction sur votre 1er paiement.",
    en: "With a valid code, you get 20% off your first payment.",
    es: "Con un código válido, obtienes un 20% de descuento en tu primer pago.",
    de: "Mit einem gültigen Code erhalten Sie 20 % Rabatt auf Ihre erste Zahlung.",
    ar: "مع رمز صحيح، تحصل على خصم 20٪ على دفعتك الأولى.",
    ru: "С действующим кодом вы получаете скидку 20% на первый платёж.",
    pt: "Com um código válido, você obtém 20% de desconto no primeiro pagamento.",
    it: "Con un codice valido, ottieni il 20% di sconto sul primo pagamento.",
  },
  'auth.field.language': {
    fr: 'Langue de l\'interface', en: 'Interface language',
    es: 'Idioma de la interfaz', de: 'Sprache der Oberfläche',
    ar: 'لغة الواجهة', ru: 'Язык интерфейса',
    pt: 'Idioma da interface', it: 'Lingua dell\'interfaccia',
  },
  'auth.field.photo': {
    fr: 'Photo de profil', en: 'Profile photo', es: 'Foto de perfil',
    de: 'Profilfoto', ar: 'صورة الملف الشخصي', ru: 'Фото профиля',
    pt: 'Foto de perfil', it: 'Foto profilo',
  },
  'auth.field.photo_optional': {
    fr: '(optionnelle)', en: '(optional)', es: '(opcional)',
    de: '(optional)', ar: '(اختياري)', ru: '(необязательно)',
    pt: '(opcional)', it: '(facoltativo)',
  },
  'auth.field.identifier': {
    fr: 'Identifiant ou email', en: 'Username or email',
    es: 'Usuario o correo', de: 'Benutzername oder E-Mail',
    ar: 'اسم المستخدم أو البريد', ru: 'Имя пользователя или email',
    pt: 'Usuário ou email', it: 'Username o email',
  },
  'auth.success.title': {
    fr: 'Bienvenue à bord !', en: 'Welcome aboard!', es: '¡Bienvenido!',
    de: 'Willkommen!', ar: 'مرحباً بك!', ru: 'Добро пожаловать!',
    pt: 'Bem-vindo!', it: 'Benvenuto!',
  },
  'auth.success.registered': {
    fr: 'INSCRIPTION RÉUSSIE', en: 'REGISTRATION SUCCESSFUL',
    es: 'REGISTRO EXITOSO', de: 'REGISTRIERUNG ERFOLGREICH',
    ar: 'تم التسجيل بنجاح', ru: 'РЕГИСТРАЦИЯ УСПЕШНА',
    pt: 'CADASTRO REALIZADO', it: 'REGISTRAZIONE RIUSCITA',
  },
  'auth.promo.your_code': {
    fr: '🎁 VOTRE CODE PROMO PERSONNEL', en: '🎁 YOUR PERSONAL PROMO CODE',
    es: '🎁 TU CÓDIGO PROMO PERSONAL', de: '🎁 IHR PERSÖNLICHER AKTIONSCODE',
    ar: '🎁 رمزك الترويجي الشخصي', ru: '🎁 ВАШ ЛИЧНЫЙ ПРОМО-КОД',
    pt: '🎁 SEU CÓDIGO PROMO PESSOAL', it: '🎁 IL TUO CODICE PROMO PERSONALE',
  },
  'auth.promo.copy': {
    fr: '📋 Copier le code', en: '📋 Copy code', es: '📋 Copiar código',
    de: '📋 Code kopieren', ar: '📋 نسخ الرمز', ru: '📋 Копировать',
    pt: '📋 Copiar código', it: '📋 Copia codice',
  },
  'auth.login_now': {
    fr: '🚀 Se connecter maintenant', en: '🚀 Login now',
    es: '🚀 Iniciar sesión ahora', de: '🚀 Jetzt anmelden',
    ar: '🚀 تسجيل الدخول الآن', ru: '🚀 Войти сейчас',
    pt: '🚀 Entrar agora', it: '🚀 Accedi ora',
  },
  'auth.or': {
    fr: 'ou', en: 'or', es: 'o', de: 'oder',
    ar: 'أو', ru: 'или', pt: 'ou', it: 'o',
  },

  /* ── Status ──────────────────────────────────────────────── */
  'status.live': {
    fr: 'EN DIRECT', en: 'LIVE', es: 'EN VIVO', de: 'LIVE',
    ar: 'مباشر', ru: 'ПРЯМОЙ ЭФИР', pt: 'AO VIVO', it: 'IN DIRETTA',
  },
  'status.in_progress': {
    fr: 'EN COURS', en: 'IN PROGRESS', es: 'EN CURSO', de: 'LAUFEND',
    ar: 'جارٍ', ru: 'В ПРОЦЕССЕ', pt: 'EM ANDAMENTO', it: 'IN CORSO',
  },
  'status.won': {
    fr: 'Gagné', en: 'Won', es: 'Ganado', de: 'Gewonnen',
    ar: 'فاز', ru: 'Выиграно', pt: 'Ganhou', it: 'Vinto',
  },
  'status.lost': {
    fr: 'Perdu', en: 'Lost', es: 'Perdido', de: 'Verloren',
    ar: 'خسر', ru: 'Проиграно', pt: 'Perdeu', it: 'Perso',
  },
  'status.expired': {
    fr: 'Expiré', en: 'Expired', es: 'Expirado', de: 'Abgelaufen',
    ar: 'منتهي', ru: 'Истёк', pt: 'Expirado', it: 'Scaduto',
  },
  'status.pending': {
    fr: 'En attente', en: 'Pending', es: 'Pendiente', de: 'Ausstehend',
    ar: 'في الانتظار', ru: 'Ожидание', pt: 'Pendente', it: 'In attesa',
  },
  'status.active': {
    fr: 'Actif', en: 'Active', es: 'Activo', de: 'Aktiv',
    ar: 'نشط', ru: 'Активен', pt: 'Ativo', it: 'Attivo',
  },

  /* ── Predictions ─────────────────────────────────────────── */
  'pred.prediction': {
    fr: 'Prédiction', en: 'Prediction', es: 'Predicción', de: 'Vorhersage',
    ar: 'التنبؤ', ru: 'Прогноз', pt: 'Previsão', it: 'Previsione',
  },
  'pred.active': {
    fr: 'Prédiction active', en: 'Active prediction', es: 'Predicción activa',
    de: 'Aktive Vorhersage', ar: 'تنبؤ نشط', ru: 'Активный прогноз',
    pt: 'Previsão ativa', it: 'Previsione attiva',
  },
  'pred.history': {
    fr: 'Historique', en: 'History', es: 'Historial',
    de: 'Verlauf', ar: 'السجل', ru: 'История', pt: 'Histórico', it: 'Cronologia',
  },
  'pred.game': {
    fr: 'Partie', en: 'Game', es: 'Partida', de: 'Spiel',
    ar: 'مباراة', ru: 'Игра', pt: 'Partida', it: 'Partita',
  },
  'pred.awaited': {
    fr: 'attendu', en: 'expected', es: 'esperado', de: 'erwartet',
    ar: 'متوقع', ru: 'ожидается', pt: 'esperado', it: 'atteso',
  },
  'pred.no_active': {
    fr: 'Aucune prédiction active', en: 'No active prediction',
    es: 'Sin predicción activa', de: 'Keine aktive Vorhersage',
    ar: 'لا يوجد تنبؤ نشط', ru: 'Нет активного прогноза',
    pt: 'Nenhuma previsão ativa', it: 'Nessuna previsione attiva',
  },
  'pred.waiting_game': {
    fr: 'En attente de la prochaine partie...', en: 'Waiting for next game...',
    es: 'Esperando la próxima partida...', de: 'Warten auf das nächste Spiel...',
    ar: 'في انتظار المباراة التالية...', ru: 'Ожидание следующей игры...',
    pt: 'Aguardando a próxima partida...', it: 'In attesa del prossimo gioco...',
  },

  /* ── Channels ────────────────────────────────────────────── */
  'channel.select': {
    fr: 'Choisir ce canal', en: 'Choose this channel',
    es: 'Elegir este canal', de: 'Diesen Kanal wählen',
    ar: 'اختر هذه القناة', ru: 'Выбрать этот канал',
    pt: 'Escolher este canal', it: 'Scegli questo canale',
  },
  'channel.your_channel': {
    fr: 'Votre canal', en: 'Your channel', es: 'Tu canal',
    de: 'Ihr Kanal', ar: 'قناتك', ru: 'Ваш канал', pt: 'Seu canal', it: 'Il tuo canale',
  },
  'channel.available': {
    fr: 'Canaux disponibles', en: 'Available channels',
    es: 'Canales disponibles', de: 'Verfügbare Kanäle',
    ar: 'القنوات المتاحة', ru: 'Доступные каналы',
    pt: 'Canais disponíveis', it: 'Canali disponibili',
  },
  'channel.live': {
    fr: 'Live', en: 'Live', es: 'En vivo', de: 'Live',
    ar: 'مباشر', ru: 'Прямой', pt: 'Ao vivo', it: 'Live',
  },

  /* ── Suits / Card families ───────────────────────────────── */
  'suit.heart':   { fr: 'Cœur',    en: 'Heart',    es: 'Corazón',  de: 'Herz',     ar: 'قلب',     ru: 'Червы',    pt: 'Copas',    it: 'Cuori'   },
  'suit.spade':   { fr: 'Pique',   en: 'Spade',    es: 'Pica',     de: 'Pik',      ar: 'بستوني',   ru: 'Пики',     pt: 'Espadas',  it: 'Picche'  },
  'suit.diamond': { fr: 'Carreau', en: 'Diamond',  es: 'Diamante', de: 'Karo',     ar: 'ماس',      ru: 'Бубны',    pt: 'Ouros',    it: 'Quadri'  },
  'suit.club':    { fr: 'Trèfle',  en: 'Club',     es: 'Trébol',   de: 'Kreuz',    ar: 'نادي',     ru: 'Трефы',    pt: 'Paus',     it: 'Fiori'   },
  'suit.red':     { fr: 'Rouge',   en: 'Red',      es: 'Rojo',     de: 'Rot',      ar: 'أحمر',     ru: 'Красный',  pt: 'Vermelho', it: 'Rosso'   },
  'suit.black':   { fr: 'Noir',    en: 'Black',    es: 'Negro',    de: 'Schwarz',  ar: 'أسود',     ru: 'Чёрный',   pt: 'Preto',    it: 'Nero'    },

  /* ── Payment ─────────────────────────────────────────────── */
  'payment.title': {
    fr: 'Abonnement', en: 'Subscription', es: 'Suscripción', de: 'Abonnement',
    ar: 'الاشتراك', ru: 'Подписка', pt: 'Assinatura', it: 'Abbonamento',
  },
  'payment.subscribe': {
    fr: 'S\'abonner', en: 'Subscribe', es: 'Suscribirse', de: 'Abonnieren',
    ar: 'اشترك', ru: 'Подписаться', pt: 'Assinar', it: 'Abbonati',
  },
  'payment.expired': {
    fr: 'Abonnement expiré', en: 'Subscription expired',
    es: 'Suscripción expirada', de: 'Abonnement abgelaufen',
    ar: 'انتهى الاشتراك', ru: 'Подписка истекла',
    pt: 'Assinatura expirada', it: 'Abbonamento scaduto',
  },
  'payment.renew': {
    fr: 'Renouveler', en: 'Renew', es: 'Renovar', de: 'Erneuern',
    ar: 'تجديد', ru: 'Продлить', pt: 'Renovar', it: 'Rinnova',
  },
  'payment.plan.1j':  { fr: '1 jour',     en: '1 day',     es: '1 día',      de: '1 Tag',       ar: 'يوم واحد',     ru: '1 день',      pt: '1 dia',      it: '1 giorno'    },
  'payment.plan.1s':  { fr: '1 semaine',  en: '1 week',    es: '1 semana',   de: '1 Woche',     ar: 'أسبوع واحد',    ru: '1 неделя',    pt: '1 semana',   it: '1 settimana' },
  'payment.plan.2s':  { fr: '2 semaines', en: '2 weeks',   es: '2 semanas',  de: '2 Wochen',    ar: 'أسبوعان',       ru: '2 недели',    pt: '2 semanas',  it: '2 settimane' },
  'payment.plan.1m':  { fr: '1 mois',     en: '1 month',   es: '1 mes',      de: '1 Monat',     ar: 'شهر واحد',      ru: '1 месяц',     pt: '1 mês',      it: '1 mese'      },
  'payment.discount': {
    fr: 'Remise', en: 'Discount', es: 'Descuento', de: 'Rabatt',
    ar: 'خصم', ru: 'Скидка', pt: 'Desconto', it: 'Sconto',
  },

  /* ── Actions ─────────────────────────────────────────────── */
  'action.copy':      { fr: '📋 Copier', en: '📋 Copy',   es: '📋 Copiar',  de: '📋 Kopieren', ar: '📋 نسخ',    ru: '📋 Копировать', pt: '📋 Copiar',  it: '📋 Copia'    },
  'action.copied':    { fr: 'Copié !',   en: 'Copied!',  es: '¡Copiado!', de: 'Kopiert!',   ar: 'تم النسخ!', ru: 'Скопировано!', pt: 'Copiado!',  it: 'Copiato!'    },
  'action.close':     { fr: 'Fermer',    en: 'Close',    es: 'Cerrar',    de: 'Schließen',  ar: 'إغلاق',    ru: 'Закрыть',      pt: 'Fechar',    it: 'Chiudi'      },
  'action.send':      { fr: 'Envoyer',   en: 'Send',     es: 'Enviar',    de: 'Senden',     ar: 'إرسال',    ru: 'Отправить',    pt: 'Enviar',    it: 'Invia'       },
  'action.cancel':    { fr: 'Annuler',   en: 'Cancel',   es: 'Cancelar',  de: 'Abbrechen',  ar: 'إلغاء',    ru: 'Отмена',       pt: 'Cancelar',  it: 'Annulla'     },
  'action.save':      { fr: 'Enregistrer', en: 'Save',   es: 'Guardar',   de: 'Speichern',  ar: 'حفظ',      ru: 'Сохранить',    pt: 'Salvar',    it: 'Salva'       },
  'action.refresh':   { fr: '🔄 Actualiser', en: '🔄 Refresh', es: '🔄 Actualizar', de: '🔄 Aktualisieren', ar: '🔄 تحديث', ru: '🔄 Обновить', pt: '🔄 Atualizar', it: '🔄 Aggiorna' },
  'action.continue':  { fr: 'Continuer vers mon espace ▶', en: 'Continue to my space ▶', es: 'Continuar a mi espacio ▶', de: 'Weiter zu meinem Bereich ▶', ar: 'المتابعة إلى مساحتي ▶', ru: 'Перейти в мой раздел ▶', pt: 'Continuar para meu espaço ▶', it: 'Continua al mio spazio ▶' },
  'action.watch':     { fr: '▶ Regarder', en: '▶ Watch', es: '▶ Ver', de: '▶ Ansehen', ar: '▶ مشاهدة', ru: '▶ Смотреть', pt: '▶ Assistir', it: '▶ Guarda' },

  /* ── Dashboard ───────────────────────────────────────────── */
  'dash.subscription': {
    fr: 'Abonnement', en: 'Subscription', es: 'Suscripción', de: 'Abonnement',
    ar: 'الاشتراك', ru: 'Подписка', pt: 'Assinatura', it: 'Abbonamento',
  },
  'dash.expires': {
    fr: 'Expire le', en: 'Expires on', es: 'Expira el', de: 'Läuft ab am',
    ar: 'تنتهي في', ru: 'Истекает', pt: 'Expira em', it: 'Scade il',
  },
  'dash.remaining': {
    fr: 'Temps restant', en: 'Time remaining', es: 'Tiempo restante',
    de: 'Verbleibende Zeit', ar: 'الوقت المتبقي', ru: 'Оставшееся время',
    pt: 'Tempo restante', it: 'Tempo rimanente',
  },
  'dash.messages': {
    fr: 'Messages', en: 'Messages', es: 'Mensajes', de: 'Nachrichten',
    ar: 'الرسائل', ru: 'Сообщения', pt: 'Mensagens', it: 'Messaggi',
  },
  'dash.promo_code': {
    fr: 'VOTRE CODE PROMO PERSONNEL', en: 'YOUR PERSONAL PROMO CODE',
    es: 'TU CÓDIGO PROMO PERSONAL', de: 'IHR PERSÖNLICHER AKTIONSCODE',
    ar: 'رمزك الترويجي الشخصي', ru: 'ВАШ ЛИЧНЫЙ ПРОМО-КОД',
    pt: 'SEU CÓDIGO PROMO PESSOAL', it: 'IL TUO CODICE PROMO PERSONALE',
  },
  'dash.bonus_earned': {
    fr: 'Bonus déjà gagné', en: 'Bonus already earned',
    es: 'Bono ya ganado', de: 'Bonus bereits verdient',
    ar: 'مكافأة مكتسبة', ru: 'Заработанный бонус',
    pt: 'Bônus já ganho', it: 'Bonus già guadagnato',
  },
  'dash.change_channel': {
    fr: '← Changer de canal', en: '← Change channel',
    es: '← Cambiar canal', de: '← Kanal wechseln',
    ar: '← تغيير القناة', ru: '← Сменить канал',
    pt: '← Trocar canal', it: '← Cambia canale',
  },
  'dash.subscription_expired': {
    fr: 'Abonnement expiré', en: 'Subscription expired',
    es: 'Suscripción expirada', de: 'Abonnement abgelaufen',
    ar: 'انتهى الاشتراك', ru: 'Подписка истекла',
    pt: 'Assinatura expirada', it: 'Abbonamento scaduto',
  },
  'dash.renew_now': {
    fr: '💳 Renouveler', en: '💳 Renew', es: '💳 Renovar', de: '💳 Erneuern',
    ar: '💳 تجديد', ru: '💳 Продлить', pt: '💳 Renovar', it: '💳 Rinnova',
  },

  /* ── Messages (Contact Admin) ────────────────────────────── */
  'msg.title': {
    fr: 'Mes messages', en: 'My messages', es: 'Mis mensajes', de: 'Meine Nachrichten',
    ar: 'رسائلي', ru: 'Мои сообщения', pt: 'Minhas mensagens', it: 'I miei messaggi',
  },
  'msg.subtitle': {
    fr: 'Notifications, échanges avec l\'administration',
    en: 'Notifications, exchanges with administration',
    es: 'Notificaciones, intercambios con la administración',
    de: 'Benachrichtigungen, Austausch mit der Verwaltung',
    ar: 'الإشعارات، التواصل مع الإدارة',
    ru: 'Уведомления, переписка с администрацией',
    pt: 'Notificações, trocas com a administração',
    it: 'Notifiche, scambi con l\'amministrazione',
  },
  'msg.inbox': {
    fr: '📬 Boîte de réception', en: '📬 Inbox', es: '📬 Bandeja de entrada',
    de: '📬 Posteingang', ar: '📬 البريد الوارد', ru: '📬 Входящие',
    pt: '📬 Caixa de entrada', it: '📬 Posta in arrivo',
  },
  'msg.compose': {
    fr: '✏️ Nouveau message', en: '✏️ New message', es: '✏️ Nuevo mensaje',
    de: '✏️ Neue Nachricht', ar: '✏️ رسالة جديدة', ru: '✏️ Новое сообщение',
    pt: '✏️ Nova mensagem', it: '✏️ Nuovo messaggio',
  },
  'msg.write_admin': {
    fr: 'Écrire à l\'admin', en: 'Write to admin', es: 'Escribir al admin',
    de: 'An Admin schreiben', ar: 'الكتابة للمسؤول', ru: 'Написать администратору',
    pt: 'Escrever ao admin', it: 'Scrivi all\'admin',
  },
  'msg.your_message': {
    fr: '👤 Votre message', en: '👤 Your message', es: '👤 Tu mensaje',
    de: '👤 Ihre Nachricht', ar: '👤 رسالتك', ru: '👤 Ваше сообщение',
    pt: '👤 Sua mensagem', it: '👤 Il tuo messaggio',
  },
  'msg.admin_reply': {
    fr: '↩️ Réponse de l\'administrateur', en: '↩️ Administrator reply',
    es: '↩️ Respuesta del administrador', de: '↩️ Antwort des Administrators',
    ar: '↩️ رد المسؤول', ru: '↩️ Ответ администратора',
    pt: '↩️ Resposta do administrador', it: '↩️ Risposta dell\'amministratore',
  },
  'msg.waiting': {
    fr: '⏳ En attente de réponse de l\'administrateur…', en: '⏳ Waiting for administrator reply…',
    es: '⏳ Esperando respuesta del administrador…', de: '⏳ Warten auf Antwort des Administrators…',
    ar: '⏳ في انتظار رد المسؤول…', ru: '⏳ Ожидание ответа администратора…',
    pt: '⏳ Aguardando resposta do administrador…', it: '⏳ In attesa della risposta dell\'amministratore…',
  },
  'msg.reply': {
    fr: '↩️ Répondre', en: '↩️ Reply', es: '↩️ Responder', de: '↩️ Antworten',
    ar: '↩️ رد', ru: '↩️ Ответить', pt: '↩️ Responder', it: '↩️ Rispondi',
  },
  'msg.empty': {
    fr: 'Aucun message pour l\'instant.', en: 'No messages yet.',
    es: 'Sin mensajes por ahora.', de: 'Noch keine Nachrichten.',
    ar: 'لا توجد رسائل حتى الآن.', ru: 'Пока нет сообщений.',
    pt: 'Nenhuma mensagem ainda.', it: 'Nessun messaggio per ora.',
  },
  'msg.send_btn': {
    fr: '📨 Envoyer', en: '📨 Send', es: '📨 Enviar', de: '📨 Senden',
    ar: '📨 إرسال', ru: '📨 Отправить', pt: '📨 Enviar', it: '📨 Invia',
  },
  'msg.sending': {
    fr: '⏳ Envoi…', en: '⏳ Sending…', es: '⏳ Enviando…', de: '⏳ Senden…',
    ar: '⏳ جارٍ الإرسال…', ru: '⏳ Отправка…', pt: '⏳ Enviando…', it: '⏳ Invio…',
  },
  'msg.sent': {
    fr: '✅ Message envoyé à l\'administrateur.', en: '✅ Message sent to administrator.',
    es: '✅ Mensaje enviado al administrador.', de: '✅ Nachricht an Administrator gesendet.',
    ar: '✅ تم إرسال الرسالة إلى المسؤول.', ru: '✅ Сообщение отправлено администратору.',
    pt: '✅ Mensagem enviada ao administrador.', it: '✅ Messaggio inviato all\'amministratore.',
  },
  'msg.placeholder': {
    fr: 'Écrivez votre message ici…', en: 'Write your message here…',
    es: 'Escribe tu mensaje aquí…', de: 'Schreiben Sie hier Ihre Nachricht…',
    ar: 'اكتب رسالتك هنا…', ru: 'Напишите ваше сообщение здесь…',
    pt: 'Escreva sua mensagem aqui…', it: 'Scrivi qui il tuo messaggio…',
  },
  'msg.system_notif': {
    fr: 'NOTIFICATION SYSTÈME', en: 'SYSTEM NOTIFICATION',
    es: 'NOTIFICACIÓN DEL SISTEMA', de: 'SYSTEMBENACHRICHTIGUNG',
    ar: 'إشعار النظام', ru: 'СИСТЕМНОЕ УВЕДОМЛЕНИЕ',
    pt: 'NOTIFICAÇÃO DO SISTEMA', it: 'NOTIFICA SISTEMA',
  },
  'msg.new': {
    fr: 'NOUVEAU', en: 'NEW', es: 'NUEVO', de: 'NEU',
    ar: 'جديد', ru: 'НОВОЕ', pt: 'NOVO', it: 'NUOVO',
  },

  /* ── Home page ───────────────────────────────────────────── */
  'home.create_account': {
    fr: '✨ Créer mon compte', en: '✨ Create my account',
    es: '✨ Crear mi cuenta', de: '✨ Konto erstellen',
    ar: '✨ إنشاء حسابي', ru: '✨ Создать аккаунт',
    pt: '✨ Criar minha conta', it: '✨ Crea il mio account',
  },
  'home.connect': {
    fr: '🚀 Se connecter', en: '🚀 Sign In', es: '🚀 Iniciar sesión',
    de: '🚀 Anmelden', ar: '🚀 تسجيل الدخول', ru: '🚀 Войти',
    pt: '🚀 Entrar', it: '🚀 Accedi',
  },
  'home.promo_1xbet': {
    fr: 'CODE PROMO 1XBET :', en: '1XBET PROMO CODE:', es: 'CÓDIGO PROMO 1XBET:',
    de: '1XBET AKTIONSCODE:', ar: 'رمز 1xBet الترويجي:', ru: 'ПРОМО-КОД 1XBET:',
    pt: 'CÓDIGO PROMO 1XBET:', it: 'CODICE PROMO 1XBET:',
  },
  'home.tutorials': {
    fr: 'Nos tutoriels animés', en: 'Our animated tutorials',
    es: 'Nuestros tutoriales animados', de: 'Unsere animierten Tutorials',
    ar: 'دروسنا المتحركة', ru: 'Наши анимированные уроки',
    pt: 'Nossos tutoriais animados', it: 'I nostri tutorial animati',
  },
  'home.guides': {
    fr: 'GUIDES VIDÉO', en: 'VIDEO GUIDES', es: 'GUÍAS EN VÍDEO',
    de: 'VIDEO-ANLEITUNGEN', ar: 'أدلة الفيديو', ru: 'ВИДЕО-РУКОВОДСТВА',
    pt: 'GUIAS EM VÍDEO', it: 'GUIDE VIDEO',
  },
  'home.join': {
    fr: 'REJOINDRE L\'APPLICATION', en: 'JOIN THE APPLICATION',
    es: 'UNIRSE A LA APLICACIÓN', de: 'DER ANWENDUNG BEITRETEN',
    ar: 'الانضمام إلى التطبيق', ru: 'ПРИСОЕДИНИТЬСЯ К ПРИЛОЖЕНИЮ',
    pt: 'ENTRAR NA APLICAÇÃO', it: 'UNISCITI ALL\'APPLICAZIONE',
  },
  'home.channels': {
    fr: '4 Canaux de Prédiction', en: '4 Prediction Channels',
    es: '4 Canales de Predicción', de: '4 Vorhersage-Kanäle',
    ar: '4 قنوات للتنبؤ', ru: '4 Канала прогнозов',
    pt: '4 Canais de Previsão', it: '4 Canali di Previsione',
  },

  /* ── StrategySelect ──────────────────────────────────────── */
  'strategy.title': {
    fr: 'Choisissez votre canal', en: 'Choose your channel',
    es: 'Elige tu canal', de: 'Wählen Sie Ihren Kanal',
    ar: 'اختر قناتك', ru: 'Выберите ваш канал',
    pt: 'Escolha seu canal', it: 'Scegli il tuo canale',
  },
  'strategy.subtitle': {
    fr: 'Sélectionnez un canal de prédiction pour accéder à vos signaux en temps réel.',
    en: 'Select a prediction channel to access your real-time signals.',
    es: 'Selecciona un canal de predicción para acceder a tus señales en tiempo real.',
    de: 'Wählen Sie einen Vorhersagekanal für Echtzeit-Signale.',
    ar: 'اختر قناة تنبؤ للوصول إلى إشاراتك في الوقت الفعلي.',
    ru: 'Выберите канал прогнозов для доступа к сигналам в реальном времени.',
    pt: 'Selecione um canal de previsão para acessar seus sinais em tempo real.',
    it: 'Seleziona un canale di previsione per accedere ai segnali in tempo reale.',
  },
  'strategy.pending_title': {
    fr: 'Compte en attente de validation', en: 'Account pending validation',
    es: 'Cuenta pendiente de validación', de: 'Konto wartet auf Validierung',
    ar: 'الحساب في انتظار التحقق', ru: 'Аккаунт ожидает проверки',
    pt: 'Conta aguardando validação', it: 'Account in attesa di convalida',
  },
  'strategy.pending_desc': {
    fr: 'Votre demande d\'accès est en cours d\'examen par notre équipe. Vous serez notifié dès la validation.',
    en: 'Your access request is being reviewed by our team. You will be notified upon validation.',
    es: 'Tu solicitud de acceso está siendo revisada por nuestro equipo. Serás notificado al validar.',
    de: 'Ihre Zugriffsanfrage wird von unserem Team geprüft. Sie werden bei Validierung benachrichtigt.',
    ar: 'طلب وصولك قيد المراجعة من فريقنا. ستتلقى إشعاراً عند التحقق.',
    ru: 'Ваш запрос на доступ проверяется нашей командой. Вы получите уведомление после проверки.',
    pt: 'Sua solicitação de acesso está sendo analisada pela nossa equipe. Você será notificado após a validação.',
    it: 'La tua richiesta di accesso è in corso di esame dal nostro team. Sarai notificato alla convalida.',
  },

  /* ── Lang switcher ───────────────────────────────────────── */
  'lang.choose': {
    fr: 'Choisir la langue', en: 'Choose language', es: 'Elegir idioma',
    de: 'Sprache wählen', ar: 'اختر اللغة', ru: 'Выбрать язык',
    pt: 'Escolher idioma', it: 'Scegli lingua',
  },

  /* ── Loading ─────────────────────────────────────────────── */
  'loading.checking': {
    fr: '🔐 Vérification de vos identifiants...', en: '🔐 Checking your credentials...',
    es: '🔐 Verificando tus credenciales...', de: '🔐 Überprüfe Ihre Anmeldedaten...',
    ar: '🔐 التحقق من بياناتك...', ru: '🔐 Проверка данных...',
    pt: '🔐 Verificando suas credenciais...', it: '🔐 Verifica delle credenziali...',
  },
  'loading.connecting': {
    fr: '📡 Connexion sécurisée en cours...', en: '📡 Secure connection in progress...',
    es: '📡 Conexión segura en curso...', de: '📡 Sichere Verbindung wird hergestellt...',
    ar: '📡 جارٍ الاتصال الآمن...', ru: '📡 Устанавливается защищённое соединение...',
    pt: '📡 Conexão segura em andamento...', it: '📡 Connessione sicura in corso...',
  },
  'loading.connected': {
    fr: '✅ Connexion établie !', en: '✅ Connected!',
    es: '✅ ¡Conexión establecida!', de: '✅ Verbindung hergestellt!',
    ar: '✅ تم الاتصال!', ru: '✅ Соединение установлено!',
    pt: '✅ Conexão estabelecida!', it: '✅ Connessione stabilita!',
  },
};

/**
 * Translate a key to the current language.
 * Falls back to French, then the raw key.
 */
export function translate(key, lang = 'fr', vars = {}) {
  const entry = T[key];
  if (!entry) return key;
  let str = entry[lang] || entry['fr'] || key;
  // Simple variable substitution: {name} → vars.name
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return str;
}

export default T;
