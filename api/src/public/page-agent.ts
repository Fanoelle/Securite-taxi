/**
 * L'écran de l'agent de validation.
 *
 * C'est le poste de travail d'un agent communal : sa file de dossiers,
 * l'examen pièce par pièce, puis la validation qui produit le code QR.
 *
 * Deux principes gouvernent cette page.
 *
 * D'abord, **elle ne décide rien**. Le bouton de validation se grise
 * tant que les quatre pièces ne sont pas jugées lisibles, mais c'est un
 * confort d'affichage : le serveur refuse de toute façon, et c'est lui
 * qui fait foi. L'écran rend la règle visible, il ne la remplace pas.
 *
 * Ensuite, **les pièces d'identité ne transitent jamais par une URL
 * ouverte**. Elles sont chargées par requête authentifiée puis affichées
 * depuis la mémoire du navigateur. Une image dont l'adresse suffirait à
 * l'ouvrir serait partageable par accident — copier l'adresse, la coller
 * dans un message — et une CNI n'a pas à pouvoir circuler ainsi.
 */

function h(valeur: unknown): string {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--vert:#0E3B2E;--vert-cl:#1F6B45;--rouge:#A8342A;--ocre:#9A6B1F;
--encre:#1A1A18;--gris:#5E5C55;--trait:#EDE9E0;--fond:#F5F2EA}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:var(--fond);color:var(--encre);-webkit-font-smoothing:antialiased}
.haut{background:var(--vert);color:#fff;padding:14px 18px;display:flex;
justify-content:space-between;align-items:center;position:sticky;top:0;z-index:9}
.haut b{font-size:16px}.haut span{font-size:12px;opacity:.75}
main{max-width:760px;margin:0 auto;padding:16px 14px 40px}
.carte{background:#fff;border-radius:14px;padding:18px;margin-bottom:14px;
box-shadow:0 1px 2px rgba(0,0,0,.05)}
h1{font-size:20px;margin-bottom:4px}
h2{font-size:15px;margin-bottom:12px}
.muet{color:var(--gris);font-size:13px}
label{display:block;font-size:13px;color:var(--gris);margin:12px 0 5px}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid #D8D4C8;
border-radius:9px;font:inherit;background:#fff}
button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--vert);
color:#fff;font:600 15px inherit;cursor:pointer;margin-top:12px}
button:disabled{background:#C8C4BA;cursor:not-allowed}
button.secondaire{background:#fff;color:var(--encre);border:1px solid #D8D4C8}
button.danger{background:var(--rouge)}
.err{color:var(--rouge);font-size:13px;margin-top:8px}
.ok{color:var(--vert-cl);font-size:13px;margin-top:8px}
.lien{display:block;text-align:center;color:var(--vert-cl);margin-top:14px;
font-size:14px;text-decoration:none;cursor:pointer}

/* File des dossiers */
.dossier{border:1px solid var(--trait);border-radius:12px;padding:14px;
margin-bottom:10px;cursor:pointer;background:#fff;transition:border-color .15s}
.dossier:hover{border-color:var(--vert-cl)}
.dossier .nom{font-weight:600;font-size:15px}
.dossier .meta{color:var(--gris);font-size:13px;margin-top:3px}
.dossier .bas{display:flex;justify-content:space-between;align-items:center;
margin-top:10px;gap:8px;flex-wrap:wrap}
.jauge{font-size:12px;color:var(--gris)}
.urgent{background:#FBEEE9;color:var(--rouge);font-size:11px;font-weight:600;
padding:3px 8px;border-radius:20px;letter-spacing:.4px}
.etiq{background:var(--trait);color:var(--gris);font-size:11px;font-weight:600;
padding:3px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px}

/* Pièces */
.piece{border:1px solid var(--trait);border-radius:12px;margin-bottom:12px;
overflow:hidden}
.piece .tete{display:flex;align-items:center;gap:10px;padding:12px 14px;
cursor:pointer;background:#FCFBF8}
.piece .tete .titre{flex:1;font-weight:600;font-size:14px}
.piece .corps{padding:14px;border-top:1px solid var(--trait);display:none}
.piece.ouverte .corps{display:block}
.apercu{width:100%;max-height:340px;object-fit:contain;background:#F0EDE6;
border-radius:9px;display:block}
.apercu-cadre{position:relative;min-height:120px;display:flex;
align-items:center;justify-content:center;background:#F0EDE6;border-radius:9px}
.marque{width:22px;height:22px;border-radius:50%;display:flex;
align-items:center;justify-content:center;font-size:13px;font-weight:700;
flex-shrink:0;background:var(--trait);color:var(--gris)}
.marque.oui{background:var(--vert-cl);color:#fff}
.marque.non{background:var(--rouge);color:#fff}
.verdicts{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.verdicts button{width:auto;flex:1;min-width:88px;margin:0;padding:9px 10px;
font-size:13px;background:#fff;color:var(--encre);border:1px solid #D8D4C8}
.verdicts button.actif{background:var(--vert-cl);color:#fff;border-color:var(--vert-cl)}
.verdicts button.actif.refus{background:var(--rouge);border-color:var(--rouge)}

/* Bilan et résultat */
.bilan{background:#FCFBF8;border:1px solid var(--trait);border-radius:12px;
padding:14px;margin-top:6px}
.bloque{color:var(--ocre);font-size:13px;margin-top:8px}
.qr{text-align:center;padding:22px;background:#EAF3EE;border-radius:12px;
margin-top:14px}
.qr .jeton{font:700 26px ui-monospace,"DejaVu Sans Mono",monospace;
letter-spacing:3px;color:var(--vert);margin:8px 0}
`;

function page(titre: string, corps: string, script = ''): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0E3B2E">
<title>${h(titre)}</title><style>${STYLE}</style></head>
<body><div class="haut"><b>Sécurité Taxi</b><span>Espace agent</span></div>
<main>${corps}</main>${script ? `<script>${script}</script>` : ''}
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Connexion de l'agent                                                */
/* ------------------------------------------------------------------ */

export function pageAgentConnexion(): string {
  const corps = `
<div class="carte">
  <h1>Espace agent</h1>
  <p class="muet" style="margin-bottom:4px">Validation des dossiers de
  chauffeurs de votre commune.</p>

  <label for="telephone">Téléphone</label>
  <input id="telephone" placeholder="699000002" inputmode="tel" autocomplete="username">

  <label for="mdp">Mot de passe</label>
  <input id="mdp" type="password" autocomplete="current-password">

  <button id="entrer">Se connecter</button>
  <div id="retour"></div>
</div>`;

  const script = `
const $=(i)=>document.getElementById(i);
async function entrer(){
  const telephone=$('telephone').value.trim(),motDePasse=$('mdp').value;
  if(!telephone||!motDePasse){$('retour').innerHTML=
    '<p class="err">Renseignez votre numéro et votre mot de passe.</p>';return}
  const b=$('entrer');b.disabled=true;b.textContent='Connexion…';
  try{
    const r=await fetch('/api/auth/connexion',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({telephone,motDePasse})});
    const d=await r.json();
    if(r.ok&&d.jeton){localStorage.setItem('jeton-agent',d.jeton);
      location.href='/agent'}
    else{b.disabled=false;b.textContent='Se connecter';
      $('retour').innerHTML='<p class="err">'+(d.message||'Échec.')+'</p>'}
  }catch(e){b.disabled=false;b.textContent='Se connecter';
    $('retour').innerHTML='<p class="err">Pas de réseau.</p>'}
}
$('entrer').onclick=entrer;
$('mdp').addEventListener('keydown',e=>{if(e.key==='Enter')entrer()});`;

  return page('Connexion agent', corps, script);
}

/* ------------------------------------------------------------------ */
/* File de validation et examen des dossiers                           */
/* ------------------------------------------------------------------ */

export function pageAgent(): string {
  const corps = `
<div id="vueFile">
  <div class="carte">
    <h1>Dossiers à valider</h1>
    <p class="muet" id="sousTitre">Chargement…</p>
  </div>
  <div id="file"></div>
</div>

<div id="vueDossier" hidden>
  <div class="carte">
    <span class="lien" id="retourFile" style="text-align:left;margin:0 0 10px">← Retour à la file</span>
    <h1 id="dNom">—</h1>
    <p class="muet" id="dMeta">—</p>
  </div>

  <div class="carte">
    <h2>Pièces du dossier</h2>
    <p class="muet" style="margin-bottom:12px">Ouvrez chaque pièce, vérifiez
    qu'elle est lisible et correspond au chauffeur, puis rendez un verdict.</p>
    <div id="pieces"></div>
  </div>

  <div class="carte">
    <h2>Décision</h2>
    <div class="bilan" id="bilan">—</div>

    <label for="motif">Motif <span class="muet">(obligatoire pour un rejet)</span></label>
    <textarea id="motif" rows="2" placeholder="Ex. Permis expiré depuis mars 2026"></textarea>

    <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
      <input type="checkbox" id="plaque" style="width:auto" checked>
      <span>J'ai recoupé la plaque avec la carte grise</span>
    </label>

    <button id="valider" disabled>Valider et produire le code QR</button>
    <button id="rejeter" class="secondaire danger" style="color:#fff">Rejeter le dossier</button>
    <div id="retourDecision"></div>
  </div>
</div>`;

  const script = `
const $=(i)=>document.getElementById(i);
const T=localStorage.getItem('jeton-agent');
if(!T)location.href='/agent/connexion';
const AUTH={'Authorization':'Bearer '+T};
const AUTHJ={...AUTH,'Content-Type':'application/json'};

const LIBELLES={cni_recto:"Carte d'identité — recto",cni_verso:"Carte d'identité — verso",
permis:'Permis de conduire',carte_grise:'Carte grise',
licence_transport:'Licence de transport',assurance:'Assurance'};
// Ce que le serveur exige pour valider. L'écran affiche la même règle,
// mais c'est le serveur qui refuse.
const REQUIS=['cni_recto','cni_verso','permis','carte_grise'];
const VERDICTS=[['lisible','Lisible'],['illisible','Illisible'],
                ['expire','Expirée'],['non_conforme','Non conforme']];

let dossier=null, pieces=[];
// Les images chargées sont révoquées en quittant le dossier : une pièce
// d'identité n'a pas à rester en mémoire une fois l'examen terminé.
let blobs=[];

function deconnecte(r){
  if(r.status===401||r.status===403){
    localStorage.removeItem('jeton-agent');location.href='/agent/connexion';return true}
  return false;
}

/* ---------- La file ---------- */
async function chargerFile(){
  try{
    const r=await fetch('/api/chauffeurs/file-validation',{headers:AUTH});
    if(deconnecte(r))return;
    const d=await r.json();
    if(!Array.isArray(d)){$('sousTitre').textContent=d.message||'Indisponible.';return}
    $('sousTitre').textContent=d.length
      ? d.length+' dossier'+(d.length>1?'s':'')+' en attente dans votre commune.'
      : 'Aucun dossier en attente dans votre commune.';
    $('file').innerHTML=d.map(x=>{
      const total=REQUIS.length;
      return '<div class="dossier" data-id="'+x.chauffeur_id+'">'+
        '<div class="nom">'+esc(x.prenom)+' '+esc(x.nom)+'</div>'+
        '<div class="meta">'+esc(x.ville)+(x.plaque?' · '+esc(plaque(x.plaque)):'')+
          (x.marque?' · '+esc(x.marque)+' '+esc(x.modele||''):'')+'</div>'+
        '<div class="bas">'+
          '<span class="jauge">'+x.documents_valides+'/'+total+' lisibles'+
            (x.documents_problematiques>0?' · '+x.documents_problematiques+' à revoir':'')+
          '</span>'+
          (x.urgent?'<span class="urgent">EN ATTENTE &gt; 48 H</span>'
                   :'<span class="etiq">'+esc(ETATS[x.statut]||x.statut)+'</span>')+
        '</div></div>';
    }).join('');
    document.querySelectorAll('.dossier').forEach(e=>{
      e.onclick=()=>ouvrirDossier(e.dataset.id,
        e.querySelector('.nom').textContent,e.querySelector('.meta').textContent)});
  }catch(e){$('sousTitre').textContent='Pas de réseau.'}
}

function esc(v){const d=document.createElement('div');d.textContent=v??'';return d.innerHTML}

// Une plaque se lit par groupes, comme sur le véhicule : c'est ce que
// l'agent doit comparer à la carte grise.
function plaque(p){
  if(!p)return '';
  const m=String(p).toUpperCase().replace(/[^A-Z0-9]/g,'')
    .match(/^([A-Z]{2})(\\d{3})([A-Z]{2})$/);
  return m?m[1]+' '+m[2]+' '+m[3]:p;
}

const ETATS={declare:'Déclaré',en_examen:'En examen',verifie:'Vérifié',
certifie:'Certifié',suspendu:'Suspendu',rejete:'Rejeté'};

/* ---------- Un dossier ---------- */
async function ouvrirDossier(id,nom,meta){
  dossier={id,nom};
  $('dNom').textContent=nom;$('dMeta').textContent=meta;
  $('vueFile').hidden=true;$('vueDossier').hidden=false;
  $('motif').value='';$('retourDecision').innerHTML='';
  window.scrollTo(0,0);
  await chargerPieces();
}

async function chargerPieces(){
  $('pieces').innerHTML='<p class="muet">Chargement…</p>';
  try{
    const r=await fetch('/api/documents/chauffeur/'+dossier.id,{headers:AUTH});
    if(deconnecte(r))return;
    pieces=await r.json();
    if(!Array.isArray(pieces)){$('pieces').innerHTML=
      '<p class="err">'+(pieces.message||'Indisponible.')+'</p>';return}
    dessinerPieces();
    majBilan();
  }catch(e){$('pieces').innerHTML='<p class="err">Pas de réseau.</p>'}
}

function dessinerPieces(){
  $('pieces').innerHTML=pieces.map(p=>{
    const cl=p.verdict==='lisible'?'oui':p.verdict?'non':'';
    const sig=p.verdict==='lisible'?'✓':p.verdict?'✕':'○';
    return '<div class="piece" id="p-'+p.id+'">'+
      '<div class="tete" data-id="'+p.id+'">'+
        '<span class="marque '+cl+'" id="m-'+p.id+'">'+sig+'</span>'+
        '<span class="titre">'+esc(LIBELLES[p.type]||p.type)+'</span>'+
        '<span class="muet" id="e-'+p.id+'">'+
          (p.verdict?esc(p.verdict):'à examiner')+'</span>'+
      '</div>'+
      '<div class="corps">'+
        '<div class="apercu-cadre" id="a-'+p.id+'">'+
          '<span class="muet">Ouvrir pour afficher</span></div>'+
        (p.commentaire?'<p class="muet" style="margin-top:10px">Note : '+
          esc(p.commentaire)+'</p>':'')+
        '<div class="verdicts" id="v-'+p.id+'">'+
          VERDICTS.map(([k,l])=>'<button data-piece="'+p.id+'" data-v="'+k+'" '+
            'class="'+(p.verdict===k?'actif'+(k!=='lisible'?' refus':''):'')+'">'+
            l+'</button>').join('')+
        '</div>'+
        '<div id="r-'+p.id+'"></div>'+
      '</div></div>';
  }).join('');

  document.querySelectorAll('.piece .tete').forEach(t=>{
    t.onclick=()=>basculer(t.dataset.id)});
  document.querySelectorAll('.verdicts button').forEach(b=>{
    b.onclick=()=>rendreVerdict(b.dataset.piece,b.dataset.v)});
}

async function basculer(id){
  const bloc=$('p-'+id);
  const ouvre=!bloc.classList.contains('ouverte');
  bloc.classList.toggle('ouverte');
  if(ouvre)await afficherPiece(id);
}

/**
 * La pièce est récupérée par requête authentifiée, puis affichée depuis
 * la mémoire. Jamais par une adresse qu'on pourrait copier ailleurs.
 */
async function afficherPiece(id){
  const cadre=$('a-'+id);
  if(cadre.dataset.charge)return;
  cadre.innerHTML='<span class="muet">Chargement…</span>';
  try{
    const r=await fetch('/api/documents/'+id+'/fichier',{headers:AUTH});
    if(deconnecte(r))return;
    // Distinguer « le fichier manque » de « vous n'y avez pas droit » :
    // l'agent doit savoir s'il peut agir ou s'il doit alerter.
    if(!r.ok){cadre.innerHTML='<span class="err">'+(r.status===404
      ? 'Fichier introuvable sur le serveur. Demandez au chauffeur de redéposer cette pièce.'
      : 'Impossible d\\'afficher cette pièce (erreur '+r.status+').')+'</span>';return}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);blobs.push(url);
    cadre.dataset.charge='1';
    cadre.innerHTML = blob.type==='application/pdf'
      ? '<embed src="'+url+'" type="application/pdf" '+
        'style="width:100%;height:340px;border-radius:9px">'
      : '<img class="apercu" src="'+url+'" alt="Pièce justificative">';
  }catch(e){cadre.innerHTML='<span class="err">Pas de réseau.</span>'}
}

async function rendreVerdict(id,verdict){
  const zone=$('r-'+id);
  let commentaire='';
  if(verdict!=='lisible'){
    commentaire=(prompt('Motif — le chauffeur le verra et doit savoir quoi corriger :')||'').trim();
    if(!commentaire){zone.innerHTML=
      '<p class="err">Un motif est obligatoire pour refuser une pièce.</p>';return}
  }
  zone.innerHTML='<p class="muet">Enregistrement…</p>';
  try{
    const r=await fetch('/api/documents/'+id+'/examen',{method:'POST',
      headers:AUTHJ,body:JSON.stringify({verdict,commentaire:commentaire||undefined})});
    if(deconnecte(r))return;
    const d=await r.json();
    if(!r.ok){zone.innerHTML='<p class="err">'+(d.message||'Refusé.')+'</p>';return}
    zone.innerHTML='<p class="ok">Verdict enregistré.</p>';
    const p=pieces.find(x=>x.id===id);
    if(p){p.verdict=verdict;p.commentaire=commentaire||null}
    const m=$('m-'+id);
    m.className='marque '+(verdict==='lisible'?'oui':'non');
    m.textContent=verdict==='lisible'?'✓':'✕';
    $('e-'+id).textContent=verdict;
    $('v-'+id).querySelectorAll('button').forEach(b=>{
      b.className=b.dataset.v===verdict?('actif'+(verdict!=='lisible'?' refus':'')):''});
    majBilan();
  }catch(e){zone.innerHTML='<p class="err">Pas de réseau.</p>'}
}

/**
 * Le bilan dit pourquoi la validation est impossible, plutôt que de
 * laisser l'agent buter sur un refus du serveur sans explication.
 */
function majBilan(){
  const parType={};pieces.forEach(p=>{parType[p.type]=p.verdict});
  const manquantes=REQUIS.filter(t=>!(t in parType));
  const enAttente=REQUIS.filter(t=>t in parType&&parType[t]!=='lisible');
  const prets=REQUIS.filter(t=>parType[t]==='lisible').length;

  let html='<b>'+prets+' / '+REQUIS.length+'</b> pièces requises jugées lisibles.';
  if(manquantes.length)html+='<div class="bloque">Pièces non déposées : '+
    manquantes.map(t=>esc(LIBELLES[t]||t)).join(', ')+'</div>';
  if(enAttente.length)html+='<div class="bloque">En attente d\\'un verdict favorable : '+
    enAttente.map(t=>esc(LIBELLES[t]||t)).join(', ')+'</div>';
  if(!manquantes.length&&!enAttente.length)html+=
    '<div class="ok">Le dossier peut être validé.</div>';
  $('bilan').innerHTML=html;
  $('valider').disabled=manquantes.length>0||enAttente.length>0;
}

/* ---------- Décision ---------- */
async function decider(decision){
  const motif=$('motif').value.trim();
  if(decision==='rejete'&&!motif){$('retourDecision').innerHTML=
    '<p class="err">Un motif est obligatoire pour rejeter un dossier.</p>';return}
  const b=decision==='rejete'?$('rejeter'):$('valider');
  const texte=b.textContent;b.disabled=true;b.textContent='…';
  try{
    const corps={decision};
    if(decision==='rejete')corps.motif=motif;
    else corps.plaqueRecoupee=$('plaque').checked;
    const r=await fetch('/api/chauffeurs/'+dossier.id+'/validation',{method:'POST',
      headers:AUTHJ,body:JSON.stringify(corps)});
    if(deconnecte(r))return;
    const d=await r.json();
    if(!r.ok){b.disabled=false;b.textContent=texte;
      $('retourDecision').innerHTML='<p class="err">'+(d.message||'Refusé.')+
        (d.enAttente?' ('+d.enAttente.join(', ')+')':'')+
        (d.manquantes?' ('+d.manquantes.join(', ')+')':'')+'</p>';return}

    if(d.jetonQr){
      $('retourDecision').innerHTML=
        '<div class="qr"><div class="muet">Code QR produit — licence '+
        esc(d.referenceLicence)+'</div><div class="jeton">'+esc(d.jetonQr)+'</div>'+
        '<a class="lien" href="/s/'+encodeURIComponent(d.jetonQr)+
        '" target="_blank">Voir ce que verra le passager →</a></div>';
    }else{
      $('retourDecision').innerHTML='<p class="ok">Dossier rejeté. '+
        'Le chauffeur est informé du motif.</p>';
    }
    b.textContent=texte;
    setTimeout(()=>{revenir();chargerFile()},4000);
  }catch(e){b.disabled=false;b.textContent=texte;
    $('retourDecision').innerHTML='<p class="err">Pas de réseau.</p>'}
}

function revenir(){
  blobs.forEach(u=>URL.revokeObjectURL(u));blobs=[];
  $('vueDossier').hidden=true;$('vueFile').hidden=false;
  window.scrollTo(0,0);
}

$('retourFile').onclick=revenir;
$('valider').onclick=()=>decider('verifie');
$('rejeter').onclick=()=>decider('rejete');
chargerFile();`;

  return page('Dossiers à valider', corps, script);
}
