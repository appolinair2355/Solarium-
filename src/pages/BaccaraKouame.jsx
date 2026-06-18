import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ── Devises ───────────────────────────────────────────────────────────────────
const CURRENCIES = [
  { id:'XOF', sym:'₣', presets:[100,500,1000,2000,5000], min:100 },
  { id:'EUR', sym:'€', presets:[1,2,5,10,20],             min:1   },
  { id:'USD', sym:'$', presets:[1,2,5,10,25],             min:1   },
  { id:'RUB', sym:'₽', presets:[50,100,200,500,1000],     min:10  },
];

// ── Catégories de paris ────────────────────────────────────────────────────────
const SUIT_LABELS = { H:'Cœurs ♥', D:'Carreaux ♦', S:'Piques ♠', C:'Trèfles ♣' };
const RANK_LABELS = {
  r1:'As (A)', r2:'2', r3:'3', r4:'4', r5:'5', r6:'6', r7:'7', r8:'8',
  r9:'9', r10:'10', r11:'Valet (J)', r12:'Dame (Q)', r13:'Roi (K)',
};

function buildCategories() {
  const valPlayer  = Object.entries(RANK_LABELS).map(([k,l]) => ({ id:`val_p_${k}`, label:l, odd:5.40 }));
  const valBanker  = Object.entries(RANK_LABELS).map(([k,l]) => ({ id:`val_b_${k}`, label:l, odd:5.40 }));
  const suitPlayer = Object.entries(SUIT_LABELS).map(([k,l]) => ({ id:`suit_p_${k}`, label:l, odd:1.90 }));
  const suitBanker = Object.entries(SUIT_LABELS).map(([k,l]) => ({ id:`suit_b_${k}`, label:l, odd:1.90 }));

  return [
    {
      id:'1x2', label:'1X2', layout:'row3',
      bets:[
        { id:'player',  label:'V1', sublabel:'Joueur gagne',   odd:2.10 },
        { id:'tie',     label:'X',  sublabel:'Égalité',        odd:8.00 },
        { id:'banker',  label:'V2', sublabel:'Banquier gagne', odd:2.15 },
      ],
    },
    {
      id:'nb_cartes_joueur', label:'Joueur Va Recevoir 2 Cartes', layout:'row2',
      bets:[
        { id:'player_2cards', label:'Oui', sublabel:'Joueur reçoit 2 cartes', odd:1.95 },
        { id:'player_3cards', label:'Non', sublabel:'Joueur reçoit 3 cartes', odd:1.95 },
      ],
    },
    {
      id:'cards', label:'Combinaisons de Cartes (Joueur/Banquier)', layout:'grid2_labeled',
      bets:[
        { id:'cards_2_2', label:'2/2', sublabel:'Joueur:2 / Banquier:2', odd:2.40 },
        { id:'cards_2_3', label:'2/3', sublabel:'Joueur:2 / Banquier:3', odd:8.00 },
        { id:'cards_3_2', label:'3/2', sublabel:'Joueur:3 / Banquier:2', odd:2.30 },
        { id:'cards_3_3', label:'3/3', sublabel:'Joueur:3 / Banquier:3', odd:2.40 },
      ],
    },
    {
      id:'paires', label:'Paires', layout:'row2',
      bets:[
        { id:'player_pair', label:'Paire Joueur',   sublabel:'Joueur a une paire', odd:11.00 },
        { id:'banker_pair', label:'Paire Banquier',  sublabel:'Banquier a une paire', odd:11.00 },
      ],
    },
    {
      id:'pair_impair_joueur', label:'Pair / Impair — Score Joueur', layout:'row2',
      bets:[
        { id:'p_score_even', label:'Pair',   sublabel:'Score joueur pair (0,2,4,6,8)', odd:1.91 },
        { id:'p_score_odd',  label:'Impair', sublabel:'Score joueur impair (1,3,5,7,9)', odd:1.91 },
      ],
    },
    {
      id:'pair_impair_total', label:'Pair / Impair — Total Points (Joueur + Banquier)', layout:'row2',
      bets:[
        { id:'total_even', label:'Pair',   sublabel:'Total points pair', odd:1.95 },
        { id:'total_odd',  label:'Impair', sublabel:'Total points impair', odd:1.95 },
      ],
    },
    {
      id:'enseigne_joueur', label:'Joueur Va Obtenir Carte (Enseigne)', layout:'list',
      bets: suitPlayer,
    },
    {
      id:'enseigne_banquier', label:'Banquier Va Obtenir Carte (Enseigne)', layout:'list',
      bets: suitBanker,
    },
    {
      id:'valeur_joueur', label:'Joueur Va Obtenir Une Carte (Valeur)', layout:'list',
      bets: valPlayer,
    },
    {
      id:'valeur_banquier', label:'Banquier Va Obtenir Une Carte (Valeur)', layout:'list',
      bets: valBanker,
    },
    {
      id:'total', label:'Total Points', layout:'pairs2col',
      bets:[
        { id:'total_o7',  label:'(7.5) Plus de',   odd:1.54 },
        { id:'total_u7',  label:'(7.5) Moins de',  odd:2.47 },
        { id:'total_o8',  label:'(8.5) Plus de',   odd:1.78 },
        { id:'total_u8',  label:'(8.5) Moins de',  odd:2.10 },
        { id:'total_o9',  label:'(9.5) Plus de',   odd:2.10 },
        { id:'total_u9',  label:'(9.5) Moins de',  odd:1.75 },
        { id:'total_o10', label:'(10.5) Plus de',  odd:2.48 },
        { id:'total_u10', label:'(10.5) Moins de', odd:1.54 },
        { id:'total_o11', label:'(11.5) Plus de',  odd:3.07 },
        { id:'total_u11', label:'(11.5) Moins de', odd:1.36 },
        { id:'total_o12', label:'(12.5) Plus de',  odd:4.50 },
        { id:'total_u12', label:'(12.5) Moins de', odd:1.20 },
      ],
    },
    {
      id:'fin_nat', label:'Le Jeu Se Termine Directement Après La Distribution', layout:'row2',
      bets:[
        { id:'natural',    label:'Oui', sublabel:'Sans 3ème carte', odd:2.05 },
        { id:'no_natural', label:'Non', sublabel:'Avec 3ème carte', odd:1.78 },
      ],
    },
    {
      id:'banker3', label:'Banquier Va Obtenir La Troisième Carte', layout:'row2',
      bets:[
        { id:'banker_third',    label:'Oui', sublabel:'Banquier tire',      odd:2.30 },
        { id:'no_banker_third', label:'Non', sublabel:'Banquier reste à 2', odd:1.60 },
      ],
    },
  ];
}

const BET_CATEGORIES = buildCategories();

// ── Résolution label ──────────────────────────────────────────────────────────
function betLabel(id) {
  for (const cat of BET_CATEGORIES) {
    const b = cat.bets.find(x => x.id === id);
    if (b) return b.sublabel || b.label;
  }
  return id;
}
function betCategoryLabel(id) {
  for (const cat of BET_CATEGORIES) {
    if (cat.bets.find(x => x.id === id)) return cat.label;
  }
  return '';
}
function betOdd(id) {
  for (const cat of BET_CATEGORIES) {
    const b = cat.bets.find(x => x.id === id);
    if (b) return b.odd;
  }
  return 1;
}

// ── Helpers cartes ────────────────────────────────────────────────────────────
function cv(R){ const r=parseInt(R); return (isNaN(r)||r>=10)?0:r; }
function score(cards){ if(!cards?.length)return null; return cards.reduce((s,c)=>s+cv(c.R),0)%10; }
const RANK_MAP_K = { 0:'A',1:'A',11:'J',12:'Q',13:'K','0':'A','1':'A','11':'J','12':'Q','13':'K' };
function rankLabel(R){ if(RANK_MAP_K[R]!==undefined)return RANK_MAP_K[R]; const n=parseInt(R); if(isNaN(n))return '?'; return String(n); }
// Normalise les enseignes : supprime le sélecteur de variation U+FE0F (♥️ → ♥)
function normS(s){ return s ? String(s).replace(/\uFE0F/g,'') : ''; }
function isRed(s){ const n=normS(s); return n==='♥'||n==='♦'; }
function isRedSuit(s){ return s && (s.includes('♥')||s.includes('♦')||s==='❤️'); }
function fmtAmt(n,sym){ if(n===null||n===undefined)return `${sym}—`; return `${sym}${parseFloat(n).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})}`; }

// ── Carte ─────────────────────────────────────────────────────────────────────
function suitDisplay(s){ const n=normS(s); if(n==='♥')return '❤️'; if(n==='♦')return '♦️'; return n||'?'; }
function Card({ suit, R, size=38 }) {
  const rank=rankLabel(R); const red=isRed(suit); const h=Math.round(size*1.42);
  const sd=suitDisplay(suit);
  return (
    <div style={{ width:size, height:h, borderRadius:4, background:'#fff',
      border:'1px solid #d1d5db', display:'flex', flexDirection:'column',
      padding:'2px 3px', boxShadow:'0 2px 8px rgba(0,0,0,0.28)', flexShrink:0, position:'relative',
    }}>
      <div style={{fontSize:size*0.27,fontWeight:900,color:red?'#dc2626':'#111',lineHeight:1}}>{rank}</div>
      <div style={{fontSize:size*0.30,color:red?'#dc2626':'#111',lineHeight:1}}>{sd}</div>
      <div style={{position:'absolute',bottom:2,right:2,transform:'rotate(180deg)',fontSize:size*0.27,fontWeight:900,color:red?'#dc2626':'#111'}}>{rank}</div>
    </div>
  );
}
function CardBack({ size=38 }){
  const h=Math.round(size*1.42);
  return <div style={{width:size,height:h,borderRadius:4,flexShrink:0,background:'#fff',border:'1px solid #d1d5db',boxShadow:'0 2px 8px rgba(0,0,0,0.18)'}}/>;
}

// ── Bead ──────────────────────────────────────────────────────────────────────
function Bead({ winner, size=20 }){
  const c=winner==='Player'?{bg:'#2563eb',l:'J'}:winner==='Banker'?{bg:'#dc2626',l:'B'}:winner==='Tie'?{bg:'#16a34a',l:'T'}:{bg:'#9ca3af',l:'?'};
  return <div style={{width:size,height:size,borderRadius:'50%',background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*0.42,fontWeight:900,color:'#fff',flexShrink:0}}>{c.l}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function BaccaraKouame() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isExpired = !!user && !user.is_admin && user.status === 'expired';

  const [currency,    setCurrency]    = useState(CURRENCIES[0]);
  const [wallet,      setWallet]      = useState({ balance:0, pending_bets:[], history:[], fund_requests:[] });
  const [walletLoad,  setWalletLoad]  = useState(true);
  const [games,       setGames]       = useState([]);
  const [pastGames,   setPastGames]   = useState([]);
  const [selectedGN,  setSelectedGN]  = useState(null); // game_number sélectionné
  const [openCats,    setOpenCats]    = useState({}); // { catId: bool }
  const [slip,        setSlip]        = useState(null);
  const [histTab,     setHistTab]     = useState('pending');
  const [rechargeOpen,setRechargeOpen]= useState(false);
  const [rechargeAmt, setRechargeAmt] = useState('');
  const [rechargeNote,setRechargeNote]= useState('');
  const [rechargeBusy,setRechargeBusy]= useState(false);
  const [rechargeMsg, setRechargeMsg] = useState(null);
  const [balanceFlash, setBalanceFlash] = useState(null); // {dir:'up'|'down', prev, next, delta}
  const prevBalanceRef = useRef(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchWallet = useCallback(async () => {
    try {
      const r = await fetch(`/api/baccara-wallet/me?currency=${currency.id}`,{credentials:'include'});
      if(r.ok){ const d=await r.json(); setWallet(d); }
    } catch{} finally{ setWalletLoad(false); }
  },[currency.id]);

  const fetchGames = useCallback(async () => {
    try {
      const r = await fetch('/api/games/live',{credentials:'include'});
      if(r.ok){
        const d = await r.json();
        if(Array.isArray(d)) setGames(d.sort((a,b)=>b.game_number-a.game_number));
      }
    } catch{}
  },[]);

  const fetchPastGames = useCallback(async () => {
    try {
      const r = await fetch('/api/baccara-wallet/past-games',{credentials:'include'});
      if(r.ok){ const d=await r.json(); if(Array.isArray(d)) setPastGames(d); }
    } catch{}
  },[]);

  useEffect(()=>{
    if(isExpired) return;
    fetchWallet(); fetchGames(); fetchPastGames();
    const i1=setInterval(fetchWallet,3000);
    const i2=setInterval(fetchGames,1500);
    const i3=setInterval(fetchPastGames,8000);
    return()=>{ clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  },[fetchWallet,fetchGames,fetchPastGames,isExpired]);

  // Flash solde quand le balance change
  useEffect(()=>{
    const next = parseFloat(wallet.balance) || 0;
    const prev = prevBalanceRef.current;
    if(prev !== null && prev !== next){
      const delta = next - prev;
      const dir = delta > 0 ? 'up' : 'down';
      setBalanceFlash({ dir, prev, next, delta });
      const t = setTimeout(()=>setBalanceFlash(null), 2200);
      return ()=>clearTimeout(t);
    }
    prevBalanceRef.current = next;
  },[wallet.balance]);

  // Auto-bascule vers "Résultats" quand une nouvelle mise est résolue
  const prevHistLen = useRef(0);
  useEffect(()=>{
    const newLen = wallet.history.length;
    if(newLen > prevHistLen.current && prevHistLen.current > 0) {
      setHistTab('history');
    }
    prevHistLen.current = newLen;
  },[wallet.history.length]);

  // ── Construction des jeux à afficher ──────────────────────────────────────
  // Uniquement les jeux du moteur principal (/api/games/live).
  // Les pastGames viennent d'une table différente (numéros incompatibles) —
  // on ne les mélange plus ici pour éviter la désynchronisation de l'affichage.
  const allGames = [...games].sort((a,b)=>b.game_number-a.game_number);
  // Parmi les jeux non-terminés, le vrai jeu "LIVE" (en cours de distribution sur 1xBet)
  // est celui avec le PLUS PETIT numéro : c'est le premier démarré, donc en cours de deal.
  // Les jeux avec un numéro plus élevé sont en "Prematch" (paris ouverts mais pas encore distribués).
  // L'ancien code prenait le numéro le PLUS HAUT (allGames.find → décroissant), ce qui donnait
  // un écart de 3-4 parties entre le live affiché en haut et le dernier jeu terminé en bas.
  const _unfinished = allGames.filter(g=>!g.is_finished);
  const liveGame = _unfinished.length > 0 ? _unfinished[_unfinished.length - 1] : null;
  const finished = allGames.filter(g=>g.is_finished);
  const baseNum      = liveGame?.game_number ?? (finished[0]?.game_number??0);

  const displayGames = [
    // 1. Jeu live ou dernier fini
    liveGame
      ? { ...liveGame, _label:'LIVE', _status:'live' }
      : finished[0]
        ? { ...finished[0], _label:'TERMINÉ', _status:'finished' }
        : { game_number: baseNum||1, _label:'EN ATTENTE', _status:'waiting', player_cards:[], banker_cards:[] },
    // 2. Prochain
    { game_number: baseNum+1, _label:'PROCHAIN', _status:'upcoming', player_cards:[], banker_cards:[] },
    // 3. Suivant
    { game_number: baseNum+2, _label:'SUIVANT',  _status:'upcoming', player_cards:[], banker_cards:[] },
    // 4. Après le suivant
    { game_number: baseNum+3, _label:'APRÈS',    _status:'upcoming', player_cards:[], banker_cards:[] },
  ];

  // Auto-suivre le jeu live : mise à jour à chaque nouveau jeu live
  useEffect(()=>{
    if(displayGames[0]?.game_number) {
      setSelectedGN(displayGames[0].game_number);
    }
  },[displayGames[0]?.game_number]);

  const selectedGame = displayGames.find(g=>g.game_number===selectedGN) || displayGames[0];
  const isLiveSelected   = selectedGame?._status === 'live';
  const isUpcoming       = selectedGame?._status === 'upcoming';
  const phaseRaw = (selectedGame?.phase||'').toLowerCase();
  // Phases connues de l'API 1xBet : "Prematch" (paris ouverts), "PlayerMove" (distribution),
  // "Win1"/"Win2"/"Tie"/"Match finished" (terminé)
  const isPreMatch = isUpcoming || phaseRaw.includes('prematch')||phaseRaw.includes('pre-game')||phaseRaw.includes('betting');
  const isDealing  = phaseRaw.includes('playermove')||phaseRaw.includes('dealing')||phaseRaw.includes('playermov');
  // Présence de cartes = distribution commencée → verrouillage même si la phase dit encore "Prematch"
  const hasCards   = (selectedGame?.player_cards||[]).length > 0 || (selectedGame?.banker_cards||[]).length > 0;
  // Bloqué si : jeu live ET (phase non-prematch OU cartes déjà là) ET pas encore terminé
  const betsLocked = isLiveSelected && (!isPreMatch || hasCards) && !selectedGame?.is_finished;

  const pScore = score(selectedGame?.player_cards||[]);
  const bScore = score(selectedGame?.banker_cards||[]);

  const myBetsThisGame = wallet.pending_bets.filter(b=>b.game_number===selectedGame?.game_number);
  const alreadyBetTypes = new Set(myBetsThisGame.map(b=>b.bet_type));

  const toggleCat = (id) => setOpenCats(p=>({...p,[id]:!p[id]}));

  const openSlip = (bet) => {
    if (betsLocked || alreadyBetTypes.has(bet.id)) return;
    setSlip({ bet, amt:'', busy:false, msg:null });
  };

  const placeBet = async () => {
    if(!slip||slip.busy) return;
    const amt = parseFloat(slip.amt);
    if(!amt||amt<currency.min){ setSlip(s=>({...s,msg:{ok:false,text:`Minimum ${fmtAmt(currency.min,currency.sym)}`}})); return; }
    if(amt>wallet.balance){ setSlip(s=>({...s,msg:{ok:false,text:'Solde insuffisant'}})); return; }
    setSlip(s=>({...s,busy:true,msg:null}));
    try {
      const r=await fetch('/api/baccara-wallet/bet',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bet_type:slip.bet.id,amount:amt,currency:currency.id,game_number:selectedGame.game_number}),
      });
      const d=await r.json();
      if(r.ok){
        setWallet(prev=>({...prev,balance:d.balance,pending_bets:[d.bet,...prev.pending_bets]}));
        setSlip(null);
      } else {
        setSlip(s=>({...s,busy:false,msg:{ok:false,text:d.error||'Erreur'}}));
      }
    } catch{ setSlip(s=>({...s,busy:false,msg:{ok:false,text:'Erreur réseau'}})); }
  };

  const handleRecharge = async () => {
    if(!rechargeAmt||parseFloat(rechargeAmt)<currency.min) return;
    setRechargeBusy(true); setRechargeMsg(null);
    try {
      const r=await fetch('/api/baccara-wallet/fund-request',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({amount:parseFloat(rechargeAmt),currency:currency.id,note:rechargeNote}),
      });
      const d=await r.json();
      if(r.ok){
        setRechargeMsg({ok:true,text:`✅ Demande envoyée. L'admin créditera ${fmtAmt(rechargeAmt,currency.sym)} prochainement.`});
        setRechargeAmt(''); setRechargeNote('');
        fetchWallet();
        setTimeout(()=>{ setRechargeOpen(false); setRechargeMsg(null); },4000);
      } else { setRechargeMsg({ok:false,text:d.error||'Erreur'}); }
    } catch{ setRechargeMsg({ok:false,text:'Erreur réseau'}); }
    finally{ setRechargeBusy(false); }
  };

  // ── GATE ABONNEMENT EXPIRÉ ─────────────────────────────────────────────────
  if (isExpired) return (
    <div style={{minHeight:'100vh',background:'#f0f2f5',display:'flex',flexDirection:'column'}}>
      <TopNav />
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
        <div style={{textAlign:'center',maxWidth:340}}>
          <div style={{fontSize:56,marginBottom:14}}>🔒</div>
          <div style={{fontSize:20,fontWeight:800,color:'#1e293b',marginBottom:8}}>Accès restreint</div>
          <div style={{fontSize:14,color:'#64748b',marginBottom:24,lineHeight:1.6}}>
            Votre abonnement a expiré. Renouvelez-le pour accéder à Baccara Kouamé.
          </div>
          <Link to="/paiement" style={{display:'inline-block',padding:'12px 28px',borderRadius:10,
            background:'linear-gradient(135deg,#1d4ed8,#3b82f6)',color:'#fff',fontWeight:800,fontSize:15,textDecoration:'none'}}>
            🔄 Renouveler mon abonnement
          </Link>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:'100vh',background:'#f0f2f5',fontFamily:'Inter,-apple-system,sans-serif',paddingBottom:slip?230:24}}>

      {/* ── FLASH SOLDE ── */}
      {balanceFlash && (
        <div style={{
          position:'fixed',inset:0,zIndex:9999,pointerEvents:'none',
          background: balanceFlash.dir==='up'
            ? 'rgba(22,163,74,0.18)'
            : 'rgba(220,38,38,0.18)',
          animation:'balanceFlash 2.2s ease-out forwards',
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          <div style={{
            background: balanceFlash.dir==='up' ? '#dcfce7' : '#fee2e2',
            border: `2px solid ${balanceFlash.dir==='up'?'#16a34a':'#dc2626'}`,
            borderRadius:16,padding:'18px 28px',textAlign:'center',
            boxShadow:'0 8px 30px rgba(0,0,0,0.15)',
            animation:'popIn 0.25s cubic-bezier(.34,1.56,.64,1)',
          }}>
            <div style={{fontSize:13,color:'#64748b',marginBottom:4}}>
              Ancien solde
            </div>
            <div style={{fontSize:18,fontWeight:700,color:'#64748b',marginBottom:6,textDecoration:'line-through'}}>
              {fmtAmt(balanceFlash.prev, currency.sym)}
            </div>
            <div style={{fontSize:13,color:'#64748b',marginBottom:4}}>
              Nouveau solde
            </div>
            <div style={{fontSize:26,fontWeight:900,color: balanceFlash.dir==='up'?'#16a34a':'#dc2626'}}>
              {fmtAmt(balanceFlash.next, currency.sym)}
            </div>
            <div style={{
              marginTop:8,fontSize:18,fontWeight:800,
              color: balanceFlash.dir==='up'?'#16a34a':'#dc2626',
            }}>
              {balanceFlash.dir==='up'?'▲':'▼'}&nbsp;
              {balanceFlash.dir==='up'?'+':''}{fmtAmt(balanceFlash.delta, currency.sym)}
            </div>
          </div>
        </div>
      )}

      <TopNav />

      {/* ── WALLET BAR ── */}
      <div style={{background:'#fff',padding:'8px 14px',display:'flex',alignItems:'center',gap:10,
        boxShadow:'0 1px 3px rgba(0,0,0,0.06)',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:4}}>
          {CURRENCIES.map(c=>(
            <button key={c.id} onClick={()=>setCurrency(c)} style={{
              padding:'3px 8px',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:700,
              border:currency.id===c.id?'1.5px solid #2563eb':'1px solid #e5e7eb',
              background:currency.id===c.id?'#eff6ff':'#f9fafb',
              color:currency.id===c.id?'#2563eb':'#6b7280',
            }}>{c.sym}{c.id}</button>
          ))}
        </div>
        <div style={{flex:1,textAlign:'center'}}>
          <span style={{fontSize:12,color:'#64748b'}}>Solde : </span>
          <span style={{
            fontSize:18,fontWeight:900,
            color: balanceFlash
              ? (balanceFlash.dir==='up'?'#16a34a':'#dc2626')
              : '#1e293b',
            transition:'color 0.4s',
          }}>
            {walletLoad?'...':fmtAmt(wallet.balance,currency.sym)}
          </span>
          {balanceFlash && (
            <span style={{
              marginLeft:6,fontSize:13,fontWeight:800,
              color:balanceFlash.dir==='up'?'#16a34a':'#dc2626',
            }}>
              {balanceFlash.dir==='up'?'▲ +':' ▼ '}{fmtAmt(Math.abs(balanceFlash.delta),currency.sym)}
            </span>
          )}
          {wallet.fund_requests?.some(r=>r.status==='pending')&&<span style={{fontSize:10,marginLeft:8,color:'#f59e0b',fontWeight:700}}>⏳ Recharge en cours</span>}
        </div>
        <button onClick={()=>setRechargeOpen(true)} style={{
          padding:'7px 13px',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:800,
          border:'1.5px solid #22c55e',background:'#f0fdf4',color:'#16a34a',
        }}>+ Recharger</button>
      </div>

      {/* ── SECTION JEUX (style Dashboard) ── */}
      <div className="live-games-layout" style={{padding:'12px 12px 4px',background:'#0f172a'}}>

        {/* ── Jeu principal (live ou dernier terminé) ── */}
        {selectedGame && (
          <div className={`game-live-card${isUpcoming?' upcoming-main':''}`}>
            <div className="glc-header">
              {isUpcoming
                ? <span className="glc-badge coming">🕐 À venir</span>
                : selectedGame.is_finished
                  ? <span className="glc-badge done">✅ Terminé</span>
                  : <span className="glc-badge live">⚡ LIVE</span>
              }
              <span className="glc-num">Partie #{selectedGame.game_number}</span>
              <span style={{marginLeft:'auto',fontSize:'0.68rem',fontWeight:700,
                color: isUpcoming?'#fbbf24': betsLocked?'#f87171':'#4ade80',
                background: isUpcoming?'rgba(245,158,11,0.12)':betsLocked?'rgba(239,68,68,0.15)':'rgba(34,197,94,0.12)',
                border:`1px solid ${isUpcoming?'rgba(245,158,11,0.3)':betsLocked?'rgba(239,68,68,0.3)':'rgba(34,197,94,0.3)'}`,
                borderRadius:12, padding:'2px 9px',
              }}>
                {isUpcoming?'EN ATTENTE':betsLocked?'🔒 VERROUILLÉ':'OUVERT'}
              </span>
            </div>

            {isUpcoming ? (
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,padding:'14px 0',opacity:0.65}}>
                <div style={{fontSize:'2rem'}}>⏳</div>
                <span style={{fontSize:'0.82rem',color:'#94a3b8'}}>Mise en place de la partie...</span>
              </div>
            ) : (
              <div className="glc-sides">
                <div className="glc-side">
                  <div className="glc-side-label">JOUEUR</div>
                  <div className="glc-cards">
                    {(selectedGame.player_cards||[]).length > 0
                      ? (selectedGame.player_cards||[]).map((c,i)=>(
                          <span key={i} className="card-tile" style={{color:isRedSuit(c.S)?'#f87171':'#e2e8f0'}}>
                            {rankLabel(c.R)}{c.S}
                          </span>
                        ))
                      : <span className="card-dash">—</span>
                    }
                  </div>
                  {pScore!==null && <div className="glc-pts">{pScore} pt{pScore!==1?'s':''}</div>}
                </div>
                <div className="glc-vs">VS</div>
                <div className="glc-side">
                  <div className="glc-side-label">BANQUIER</div>
                  <div className="glc-cards">
                    {(selectedGame.banker_cards||[]).length > 0
                      ? (selectedGame.banker_cards||[]).map((c,i)=>(
                          <span key={i} className="card-tile" style={{color:isRedSuit(c.S)?'#f87171':'#e2e8f0'}}>
                            {rankLabel(c.R)}{c.S}
                          </span>
                        ))
                      : <span className="card-dash">—</span>
                    }
                  </div>
                  {bScore!==null && <div className="glc-pts">{bScore} pt{bScore!==1?'s':''}</div>}
                </div>
              </div>
            )}

            {selectedGame.winner && (
              <div style={{marginTop:10,textAlign:'center',fontSize:'0.8rem',fontWeight:800,
                color:selectedGame.winner==='Player'?'#4ade80':selectedGame.winner==='Banker'?'#f87171':'#fbbf24',
                background:'rgba(255,255,255,0.06)',borderRadius:6,padding:'4px 10px',display:'inline-block',width:'100%',boxSizing:'border-box'}}>
                {selectedGame.winner==='Player'?'🟢 Le joueur gagne':selectedGame.winner==='Banker'?'🔴 Le banquier gagne':'🟡 Égalité'}
              </div>
            )}

            {/* Phase / état */}
            <div style={{marginTop:8,fontSize:'0.7rem',color:'#64748b',fontStyle:'italic'}}>
              {isPreMatch?'Paris d\'avant-match':isDealing?'🃏 Distribution en cours':selectedGame.is_finished?'Partie terminée':'En cours'}
            </div>
          </div>
        )}

        {/* ── Prochaines parties (PROCHAIN / SUIVANT / APRÈS) ── */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
          {displayGames.filter(g=>g._status==='upcoming').map((g,idx)=>(
            <div key={g.game_number} className="game-mini-card upcoming"
              onClick={()=>setSelectedGN(g.game_number)}
              style={{cursor:'pointer',outline:g.game_number===selectedGN?'2px solid #fbbf24':'none',minWidth:0,padding:'8px 8px'}}>
              <div className="gmc-header" style={{marginBottom:4}}>
                <span style={{fontSize:'0.6rem',fontWeight:800,color:'#92400e',background:'#fef3c7',
                  borderRadius:4,padding:'1px 5px'}}>
                  {idx===0?'PROCHAIN':idx===1?'SUIVANT':'APRÈS'}
                </span>
              </div>
              <div style={{fontSize:'0.75rem',fontWeight:800,color:'#334155'}}>
                Partie #{g.game_number}
              </div>
              <div style={{fontSize:'0.65rem',color:'#94a3b8',marginTop:2}}>Paris ouverts</div>
            </div>
          ))}
        </div>

        {/* ── Scroll de mini-cartes terminées ── */}
        {finished.length>0 && (
          <div className="game-mini-scroll" style={{marginTop:4}}>
            {finished.slice(0,20).map(g=>{
              const pc=g.player_cards||[], bc=g.banker_cards||[];
              const pP=score(pc), bP=score(bc);
              const wLabel=g.winner==='Player'?'🟢 J':g.winner==='Banker'?'🔴 B':g.winner==='Tie'?'🟡 É':null;
              return (
                <div key={g.game_number} className="game-mini-card finished"
                  onClick={()=>setSelectedGN(g.game_number)}
                  style={{cursor:'pointer',outline:g.game_number===selectedGN?'2px solid #fbbf24':'none'}}>
                  <div className="gmc-header">
                    <span className="glc-badge done">✅</span>
                    <span className="gmc-num">#{g.game_number}</span>
                  </div>
                  <div className="glc-sides compact">
                    <div className="glc-side compact">
                      <div className="glc-side-label" style={{fontSize:'0.6rem'}}>J</div>
                      <div className="glc-cards compact">
                        {pc.length>0
                          ? pc.map((c,i)=><span key={i} className="card-tile" style={{fontSize:'0.7rem',color:isRedSuit(c.S)?'#f87171':'#e2e8f0'}}>{rankLabel(c.R)}{c.S}</span>)
                          : <span className="card-dash">—</span>}
                      </div>
                      <div className="glc-pts">{pP??'—'}</div>
                    </div>
                    <div className="glc-vs" style={{fontSize:'0.65rem'}}>VS</div>
                    <div className="glc-side compact">
                      <div className="glc-side-label" style={{fontSize:'0.6rem'}}>B</div>
                      <div className="glc-cards compact">
                        {bc.length>0
                          ? bc.map((c,i)=><span key={i} className="card-tile" style={{fontSize:'0.7rem',color:isRedSuit(c.S)?'#f87171':'#e2e8f0'}}>{rankLabel(c.R)}{c.S}</span>)
                          : <span className="card-dash">—</span>}
                      </div>
                      <div className="glc-pts">{bP??'—'}</div>
                    </div>
                  </div>
                  {wLabel&&<div className="gmc-winner">{wLabel}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── "Temps réglementaire" ── */}
      <div style={{padding:'10px 12px 0',background:'#f0f2f5'}}>
        <button style={{padding:'8px 18px',borderRadius:20,background:'#2563eb',color:'#fff',
          fontWeight:700,fontSize:13,border:'none',cursor:'default'}}>Temps réglementaire</button>
      </div>

      {/* ── CATÉGORIES DE PARIS ── */}
      <div style={{display:'flex',flexDirection:'column',gap:1,marginTop:8}}>
        {/* Bandeau VERROUILLÉ quand jeu en cours non-prematch */}
        {betsLocked && (
          <div style={{background:'#fef2f2',border:'1px solid #fecaca',padding:'10px 14px',
            display:'flex',alignItems:'center',gap:8,borderRadius:0}}>
            <span style={{fontSize:18}}>🔒</span>
            <div>
              <div style={{fontWeight:800,fontSize:13,color:'#dc2626'}}>Mises verrouillées</div>
              <div style={{fontSize:11,color:'#b91c1c'}}>La partie #{selectedGame?.game_number} est en cours — paris fermés</div>
            </div>
          </div>
        )}
        {BET_CATEGORIES.map(cat=>(
          <div key={cat.id} style={{background:'#fff',borderBottom:'1px solid #f1f5f9'}}>
            {/* Header */}
            <button onClick={()=>toggleCat(cat.id)} style={{
              width:'100%',padding:'12px 14px',display:'flex',alignItems:'center',
              justifyContent:'space-between',background:'transparent',border:'none',cursor:'pointer',
              opacity: betsLocked ? 0.5 : 1,
            }}>
              <span style={{fontWeight:700,fontSize:13,color:'#1e293b',textAlign:'left'}}>{cat.label}</span>
              <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
                {betsLocked && <span style={{fontSize:10,color:'#dc2626',fontWeight:700}}>🔒</span>}
                <span style={{fontSize:12,color:'#94a3b8'}}>({cat.bets.length})</span>
                <span style={{fontSize:12,color:'#94a3b8'}}>{openCats[cat.id]?'▲':'▼'}</span>
              </div>
            </button>
            {openCats[cat.id]&&(
              <div style={{padding:'0 12px 12px'}}>
                <BetGrid cat={cat} locked={betsLocked} alreadyBet={alreadyBetTypes} onSelect={openSlip}/>
              </div>
            )}
          </div>
        ))}

        {/* ── Chemin de perles ── */}
        {finished.length>0&&(
          <div style={{background:'#fff',padding:'12px 14px'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#64748b',marginBottom:7}}>Historique des tours</div>
            <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>
              {finished.slice(0,50).map(g=><Bead key={g.game_number} winner={g.winner}/>)}
            </div>
            <div style={{display:'flex',gap:14,fontSize:11,color:'#94a3b8'}}>
              {['Player','Banker','Tie'].map(w=>{
                const n=finished.filter(g=>g.winner===w).length;
                const p=finished.length?Math.round(n/finished.length*100):0;
                const icon=w==='Player'?'🔵':w==='Banker'?'🔴':'🟢';
                const lbl=w==='Player'?'Joueur':w==='Banker'?'Banquier':'Égalité';
                return <span key={w}>{icon} {lbl} <b style={{color:'#475569'}}>{n}</b> ({p}%)</span>;
              })}
            </div>
          </div>
        )}

        {/* ── Mes paris ── */}
        <div style={{background:'#fff'}}>
          <div style={{display:'flex',borderBottom:'1px solid #f1f5f9'}}>
            {[{id:'pending',label:'⏳ En attente',cnt:wallet.pending_bets.length},{id:'history',label:'📊 Résultats',cnt:wallet.history.length}].map(t=>(
              <button key={t.id} onClick={()=>setHistTab(t.id)} style={{
                flex:1,padding:'10px 4px',border:'none',cursor:'pointer',
                borderBottom:`2px solid ${histTab===t.id?'#2563eb':'transparent'}`,
                background:'transparent',fontWeight:histTab===t.id?700:500,
                fontSize:12,color:histTab===t.id?'#2563eb':'#94a3b8',
                display:'flex',alignItems:'center',justifyContent:'center',gap:5,
              }}>
                {t.label}
                {t.cnt>0&&<span style={{fontSize:10,padding:'1px 5px',borderRadius:8,
                  background:histTab===t.id?'#eff6ff':'#f1f5f9',
                  color:histTab===t.id?'#2563eb':'#94a3b8',fontWeight:800}}>{t.cnt}</span>}
              </button>
            ))}
          </div>
          <div style={{padding:'8px 12px',maxHeight:280,overflowY:'auto'}}>
            {histTab==='pending'&&(wallet.pending_bets.length===0
              ?<EmptyMsg text="Aucune mise en attente"/>
              :wallet.pending_bets.map(b=><HistRow key={b.id} b={b} currency={CURRENCIES.find(c=>c.id===b.currency)||currency} status="pending"/>)
            )}
            {histTab==='history'&&(wallet.history.length===0
              ?<EmptyMsg text="Aucun historique"/>
              :wallet.history.map(b=><HistRow key={b.id} b={b}
                  currency={CURRENCIES.find(c=>c.id===b.currency)||currency}
                  status={b.status}
                  onDelete={async()=>{
                    try{
                      const r=await fetch(`/api/baccara-wallet/bets/${b.id}`,{method:'DELETE',credentials:'include'});
                      if(r.ok) setWallet(prev=>({...prev,history:prev.history.filter(x=>x.id!==b.id)}));
                    }catch{}
                  }}
                />)
            )}
          </div>
        </div>
      </div>

      {/* ── SLIP DE PARI (bottom sheet) ── */}
      {slip&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300}} onClick={()=>setSlip(null)}/>
          <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:301,background:'#fff',
            borderRadius:'16px 16px 0 0',padding:'18px 16px 36px',boxShadow:'0 -8px 30px rgba(0,0,0,0.15)'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'#e5e7eb',margin:'0 auto 14px'}}/>
            <div style={{fontWeight:800,fontSize:16,color:'#1e293b',marginBottom:2}}>{slip.bet.sublabel||slip.bet.label}</div>
            <div style={{fontSize:13,color:'#64748b',marginBottom:14}}>
              Cote : <b style={{color:'#2563eb',fontSize:16}}>{slip.bet.odd.toFixed(2)}</b>
              &nbsp;· Jeu <b>#{selectedGame?.game_number}</b>
            </div>
            {/* Devise */}
            <div style={{display:'flex',gap:5,marginBottom:12}}>
              {CURRENCIES.map(c=>(
                <button key={c.id} onClick={()=>setCurrency(c)} style={{
                  padding:'4px 9px',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:700,
                  border:currency.id===c.id?'1.5px solid #2563eb':'1px solid #e5e7eb',
                  background:currency.id===c.id?'#eff6ff':'#f9fafb',
                  color:currency.id===c.id?'#2563eb':'#6b7280',
                }}>{c.sym}{c.id}</button>
              ))}
            </div>
            {/* Chips rapides */}
            <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:12}}>
              {currency.presets.map(p=>(
                <button key={p} onClick={()=>setSlip(s=>({...s,amt:String(p)}))} style={{
                  padding:'5px 10px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700,
                  border:slip.amt===String(p)?'1.5px solid #2563eb':'1px solid #e5e7eb',
                  background:slip.amt===String(p)?'#eff6ff':'#f9fafb',
                  color:slip.amt===String(p)?'#2563eb':'#374151',
                }}>{currency.sym}{p.toLocaleString()}</button>
              ))}
            </div>
            {/* Input + gain */}
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:10}}>
              <div style={{position:'relative',flex:1}}>
                <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:15,fontWeight:700,color:'#2563eb'}}>{currency.sym}</span>
                <input type="number" min={currency.min} value={slip.amt}
                  onChange={e=>setSlip(s=>({...s,amt:e.target.value}))} placeholder="0"
                  style={{width:'100%',padding:'11px 11px 11px 26px',borderRadius:9,border:'1.5px solid #2563eb',
                    fontSize:18,fontWeight:800,color:'#1e293b',outline:'none',background:'#eff6ff'}} autoFocus/>
              </div>
              {parseFloat(slip.amt)>0&&(
                <div style={{padding:'8px 12px',borderRadius:8,background:'#f0fdf4',border:'1px solid #bbf7d0',textAlign:'center'}}>
                  <div style={{fontSize:9,color:'#16a34a',fontWeight:700,marginBottom:1}}>GAIN POTENTIEL</div>
                  <div style={{fontSize:18,fontWeight:900,color:'#15803d'}}>{fmtAmt(Math.floor(parseFloat(slip.amt)*slip.bet.odd),currency.sym)}</div>
                </div>
              )}
            </div>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:10}}>
              Solde : <b style={{color:'#1e293b'}}>{fmtAmt(wallet.balance,currency.sym)}</b>
            </div>
            {slip.msg&&(
              <div style={{marginBottom:10,padding:'8px 12px',borderRadius:7,fontSize:13,fontWeight:600,
                background:slip.msg.ok?'#f0fdf4':'#fef2f2',
                color:slip.msg.ok?'#16a34a':'#dc2626',
                border:`1px solid ${slip.msg.ok?'#bbf7d0':'#fecaca'}`}}>{slip.msg.text}</div>
            )}
            <button onClick={placeBet}
              disabled={slip.busy||!slip.amt||parseFloat(slip.amt)<currency.min||wallet.balance<parseFloat(slip.amt)}
              style={{width:'100%',padding:'14px',borderRadius:10,border:'none',fontSize:15,fontWeight:800,
                cursor:(slip.busy||!slip.amt||parseFloat(slip.amt)<currency.min||wallet.balance<parseFloat(slip.amt))?'not-allowed':'pointer',
                background:(!slip.amt||parseFloat(slip.amt)<currency.min||wallet.balance<parseFloat(slip.amt)||slip.busy)?'#e5e7eb':'#2563eb',
                color:(!slip.amt||parseFloat(slip.amt)<currency.min||wallet.balance<parseFloat(slip.amt)||slip.busy)?'#9ca3af':'#fff',
              }}>
              {slip.busy?'⏳ Traitement...':`PARIER — ${slip.amt?fmtAmt(slip.amt,currency.sym):'—'}`}
            </button>
          </div>
        </>
      )}

      {/* ── MODALE RECHARGE ── */}
      {rechargeOpen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:400,
          display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>setRechargeOpen(false)}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:'20px 16px 40px',
            width:'100%',maxWidth:480}} onClick={e=>e.stopPropagation()}>
            <div style={{width:40,height:4,borderRadius:2,background:'#e5e7eb',margin:'0 auto 14px'}}/>
            <div style={{fontWeight:800,fontSize:16,color:'#1e293b',marginBottom:4}}>💳 Demande de recharge</div>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:14}}>L'administrateur créditera votre compte après vérification.</div>
            <div style={{display:'flex',gap:5,marginBottom:10}}>
              {CURRENCIES.map(c=>(
                <button key={c.id} onClick={()=>setCurrency(c)} style={{
                  padding:'4px 9px',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:700,
                  border:currency.id===c.id?'1.5px solid #16a34a':'1px solid #e5e7eb',
                  background:currency.id===c.id?'#f0fdf4':'#f9fafb',
                  color:currency.id===c.id?'#16a34a':'#6b7280',
                }}>{c.sym}{c.id}</button>
              ))}
            </div>
            <div style={{position:'relative',marginBottom:10}}>
              <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:15,fontWeight:700,color:'#16a34a'}}>{currency.sym}</span>
              <input type="number" min={currency.min} value={rechargeAmt} onChange={e=>setRechargeAmt(e.target.value)} placeholder="0"
                style={{width:'100%',padding:'11px 11px 11px 26px',borderRadius:9,border:'1.5px solid #22c55e',
                  fontSize:18,fontWeight:800,color:'#1e293b',outline:'none',background:'#f0fdf4'}}/>
            </div>
            <input type="text" value={rechargeNote} onChange={e=>setRechargeNote(e.target.value)}
              placeholder="Note (ex : Orange Money — 11/06/2026)"
              style={{width:'100%',padding:'10px 12px',borderRadius:8,marginBottom:12,
                border:'1px solid #e5e7eb',fontSize:13,color:'#374151',outline:'none',background:'#f9fafb'}}/>
            {rechargeMsg&&(
              <div style={{marginBottom:10,padding:'8px 12px',borderRadius:7,fontSize:13,fontWeight:600,
                background:rechargeMsg.ok?'#f0fdf4':'#fef2f2',color:rechargeMsg.ok?'#16a34a':'#dc2626',
                border:`1px solid ${rechargeMsg.ok?'#bbf7d0':'#fecaca'}`}}>{rechargeMsg.text}</div>
            )}
            <button onClick={handleRecharge} disabled={rechargeBusy||!rechargeAmt||parseFloat(rechargeAmt)<currency.min}
              style={{width:'100%',padding:'13px',borderRadius:10,border:'none',fontSize:14,fontWeight:800,
                cursor:rechargeBusy||!rechargeAmt?'not-allowed':'pointer',
                background:rechargeBusy||!rechargeAmt?'#e5e7eb':'#22c55e',
                color:rechargeBusy||!rechargeAmt?'#9ca3af':'#fff'}}>
              {rechargeBusy?'⏳ Envoi...':`📩 Envoyer — ${rechargeAmt?fmtAmt(rechargeAmt,currency.sym):'—'}`}
            </button>
          </div>
        </div>
      )}
      <style>{`input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}input[type=number]{-moz-appearance:textfield;}`}</style>
    </div>
  );
}

// ── Grille de paris selon le layout ──────────────────────────────────────────
function BetGrid({ cat, locked, alreadyBet, onSelect }) {
  const { bets, layout } = cat;

  if (layout === 'row3' || layout === 'row2') {
    const cols = layout==='row3' ? 3 : 2;
    return (
      <div style={{display:'grid',gridTemplateColumns:`repeat(${cols},1fr)`,gap:6}}>
        {bets.map(b=><OddBtn key={b.id} b={b} locked={locked} alreadyBet={alreadyBet.has(b.id)} onSelect={onSelect}/>)}
      </div>
    );
  }

  if (layout === 'grid2_labeled') {
    return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
        {bets.map(b=><OddBtn key={b.id} b={b} locked={locked} alreadyBet={alreadyBet.has(b.id)} onSelect={onSelect} showSub/>)}
      </div>
    );
  }

  if (layout === 'pairs2col') {
    return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
        {bets.map(b=>(
          <button key={b.id} onClick={()=>onSelect(b)}
            disabled={locked||alreadyBet.has(b.id)}
            style={{
              padding:'8px 10px',borderRadius:7,border:'1px solid #e5e7eb',
              background:alreadyBet.has(b.id)?'#eff6ff':locked?'#f8fafc':'#fff',
              cursor:(locked||alreadyBet.has(b.id))?'default':'pointer',
              display:'flex',justifyContent:'space-between',alignItems:'center',
              boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
            }}>
            <span style={{fontSize:12,color:locked?'#9ca3af':'#374151',fontWeight:500,textAlign:'left',flex:1,paddingRight:6}}>{b.label}</span>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              {locked&&<span style={{fontSize:10,color:'#9ca3af'}}>🔒</span>}
              {alreadyBet.has(b.id)&&<span style={{fontSize:9,color:'#2563eb',fontWeight:700}}>✓</span>}
              <span style={{fontSize:14,fontWeight:900,color:locked?'#9ca3af':alreadyBet.has(b.id)?'#2563eb':'#1d4ed8'}}>{b.odd.toFixed(2)}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  // layout === 'list'
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {bets.map(b=>(
        <button key={b.id} onClick={()=>onSelect(b)}
          disabled={locked||alreadyBet.has(b.id)}
          style={{
            padding:'9px 12px',borderRadius:7,border:'1px solid #e5e7eb',
            background:alreadyBet.has(b.id)?'#eff6ff':locked?'#f8fafc':'#fff',
            cursor:(locked||alreadyBet.has(b.id))?'default':'pointer',
            display:'flex',justifyContent:'space-between',alignItems:'center',
            boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
          }}>
          <span style={{fontSize:13,color:locked?'#9ca3af':'#374151',fontWeight:500}}>{b.label}</span>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            {locked&&<span style={{fontSize:10,color:'#9ca3af'}}>🔒</span>}
            {alreadyBet.has(b.id)&&<span style={{fontSize:10,color:'#2563eb',fontWeight:700}}>✓ Misé</span>}
            <span style={{fontSize:15,fontWeight:900,color:locked?'#9ca3af':alreadyBet.has(b.id)?'#2563eb':'#1d4ed8'}}>{b.odd.toFixed(2)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Bouton cote (row layout) ──────────────────────────────────────────────────
function OddBtn({ b, locked, alreadyBet, onSelect, showSub=false }) {
  const dis = locked || alreadyBet;
  return (
    <button onClick={()=>onSelect(b)} disabled={dis} style={{
      padding:'10px 6px',borderRadius:8,border:'1px solid #e5e7eb',
      background:alreadyBet?'#eff6ff':locked?'#f8fafc':'#fff',
      cursor:dis?'default':'pointer',
      display:'flex',flexDirection:'column',alignItems:'center',gap:2,
      boxShadow:'0 1px 3px rgba(0,0,0,0.05)', position:'relative',
    }}>
      {locked&&<span style={{position:'absolute',top:4,right:4,fontSize:9,color:'#9ca3af'}}>🔒</span>}
      <span style={{fontSize:11,color:dis?'#9ca3af':'#6b7280',fontWeight:500,textAlign:'center',lineHeight:1.2}}>
        {showSub&&b.sublabel ? b.sublabel : b.label}
      </span>
      <span style={{fontSize:17,fontWeight:900,color:dis?'#9ca3af':alreadyBet?'#2563eb':'#1d4ed8'}}>
        {b.odd.toFixed(2)}
      </span>
      {alreadyBet&&<span style={{fontSize:9,color:'#2563eb',fontWeight:700}}>✓ Misé</span>}
    </button>
  );
}

// ── NavBar ────────────────────────────────────────────────────────────────────
function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div style={{background:'#0f2167',color:'#fff',padding:'0 14px',height:48,
      display:'flex',alignItems:'center',justifyContent:'space-between',
      position:'sticky',top:0,zIndex:200,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <Link to="/choisir" style={{color:'rgba(255,255,255,0.7)',textDecoration:'none',fontSize:20,lineHeight:1}}>←</Link>
        <span style={{fontWeight:800,fontSize:15,letterSpacing:.3}}>Baccara</span>
        <span style={{fontSize:9,fontWeight:800,padding:'2px 6px',borderRadius:3,
          background:'rgba(239,68,68,0.8)',letterSpacing:.8}}>LIVE</span>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        {user?.username&&<span style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>{user.username}</span>}
        <button onClick={()=>{logout();navigate('/');}} style={{
          fontSize:11,padding:'3px 9px',borderRadius:5,
          background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.18)',
          color:'rgba(255,255,255,0.65)',cursor:'pointer',
        }}>Déco</button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function EmptyMsg({ text }) {
  return <div style={{textAlign:'center',padding:'22px',color:'#94a3b8',fontSize:13}}>{text}</div>;
}

function HistRow({ b, currency, status, onDelete }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const won=status==='won'; const lost=status==='lost';
  const pending=status==='pending'; const expired=status==='expired';
  const choice  = betLabel(b.bet_type);
  const catName = betCategoryLabel(b.bet_type);
  const odd     = betOdd(b.bet_type);
  const mise    = parseFloat(b.amount);
  const potWin  = parseFloat(b.potential_win) || Math.floor(mise * odd);
  const gainNet = won ? parseFloat(b.win_amount) : 0;

  const barColor = won?'#16a34a':lost?'#dc2626':pending?'#f59e0b':'#94a3b8';
  const bgColor  = won?'#f0fdf4':lost?'#fef2f2':pending?'#fafafa':'#f8fafc';
  const bdColor  = won?'#86efac':lost?'#fca5a5':pending?'#fde68a':'#e2e8f0';

  const fmtDate = d => {
    if(!d) return '—';
    try { return new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
    catch { return d; }
  };

  const handleDelete = async e => {
    e.stopPropagation();
    if(!window.confirm('Supprimer cette mise de l\'historique ?')) return;
    setDeleting(true);
    try { await onDelete?.(); } finally { setDeleting(false); }
  };

  return (
    <div style={{borderRadius:9,marginBottom:7,overflow:'hidden',
      border:`1.5px solid ${bdColor}`,boxShadow:'0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Header cliquable */}
      <div onClick={()=>setOpen(o=>!o)} style={{background:barColor,padding:'5px 10px',display:'flex',
        alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11,fontWeight:900,color:'#fff'}}>
            {pending?'⏳ EN ATTENTE':won?'✅ GAGNÉ':lost?'❌ PERDU':'⌛ EXPIRÉ'}
          </span>
          <span style={{fontSize:10,fontWeight:800,color:'rgba(255,255,255,0.95)',
            background:'rgba(0,0,0,0.18)',borderRadius:4,padding:'1px 5px'}}>
            Partie #{b.game_number}
          </span>
        </div>
        <span style={{fontSize:12,color:'rgba(255,255,255,0.7)',lineHeight:1}}>{open?'▲':'▼'}</span>
      </div>

      {/* Corps résumé */}
      <div onClick={()=>setOpen(o=>!o)} style={{padding:'7px 10px',background:bgColor,cursor:'pointer'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:10,color:'#64748b',fontWeight:600}}>{catName}</div>
            <div style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>{choice}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:11,color:'#64748b'}}>
              {currency.sym}{mise.toLocaleString('fr-FR')}
              <span style={{color:'#94a3b8',marginLeft:3}}>×{odd.toFixed(2)}</span>
            </div>
            {pending && <div style={{fontSize:12,fontWeight:800,color:'#b45309'}}>
              → {currency.sym}{potWin.toLocaleString('fr-FR')}
            </div>}
            {won && <div style={{fontSize:13,fontWeight:900,color:'#16a34a'}}>+{currency.sym}{gainNet.toLocaleString('fr-FR')}</div>}
            {lost && <div style={{fontSize:13,fontWeight:900,color:'#dc2626'}}>-{currency.sym}{mise.toLocaleString('fr-FR')}</div>}
            {expired && <div style={{fontSize:11,color:'#94a3b8'}}>⌛ Expiré</div>}
          </div>
        </div>
      </div>

      {/* Panel détails (expandable) */}
      {open && (
        <div style={{background:'#f8fafc',borderTop:`1px solid ${bdColor}`,padding:'8px 10px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 8px',marginBottom:6}}>
            <Detail label="Partie" value={`#${b.game_number}`}/>
            <Detail label="Mise" value={`${currency.sym}${mise.toLocaleString('fr-FR')}`}/>
            <Detail label="Cote" value={`×${odd.toFixed(2)}`}/>
            <Detail label="Gain potentiel" value={`${currency.sym}${potWin.toLocaleString('fr-FR')}`}/>
            {!pending && <Detail label="Gagnant réel" value={b.actual_winner||'—'}/>}
            {won && <Detail label="Gain obtenu" value={`+${currency.sym}${gainNet.toLocaleString('fr-FR')}`} hi="green"/>}
            {lost && <Detail label="Perdu" value={`-${currency.sym}${mise.toLocaleString('fr-FR')}`} hi="red"/>}
            <Detail label="Misé le" value={fmtDate(b.created_at)}/>
            {!pending && b.resolved_at && <Detail label="Résolu le" value={fmtDate(b.resolved_at)}/>}
          </div>
          {/* Bouton supprimer (résultats seulement) */}
          {!pending && onDelete && (
            <button onClick={handleDelete} disabled={deleting} style={{
              marginTop:4,width:'100%',padding:'6px',borderRadius:6,border:'1px solid #fca5a5',
              background:deleting?'#f3f4f6':'#fff5f5',color:deleting?'#9ca3af':'#dc2626',
              fontSize:12,fontWeight:700,cursor:deleting?'not-allowed':'pointer',
            }}>
              {deleting?'Suppression…':'🗑 Supprimer cette mise'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, hi }) {
  const color = hi==='green'?'#16a34a':hi==='red'?'#dc2626':'#374151';
  return (
    <div>
      <div style={{fontSize:9,color:'#94a3b8',fontWeight:600,textTransform:'uppercase',letterSpacing:.3}}>{label}</div>
      <div style={{fontSize:12,fontWeight:700,color}}>{value}</div>
    </div>
  );
}