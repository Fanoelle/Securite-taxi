/**
 * Les écrans du chauffeur.
 *
 * Le chauffeur, lui, a un compte : il dépose des pièces d'identité et
 * reçoit un code QR qui l'engage. Le parcours est donc l'inverse de
 * celui du passager — inscription, attente, examen, puis un QR à
 * imprimer et coller dans le véhicule.
 *
 * Ces pages partagent la charte du parcours passager (voir page.ts)
 * mais s'en distinguent : ici on remplit des formulaires, on attend une
 * décision, on revient plusieurs fois.
 */

function h(valeur: unknown): string {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --vert:#0E3B2E;--vert-vif:#1E7A4C;--sable:#E7E3DA;--papier:#F5F3EE;
  --encre:#14261F;--or:#C9A227;--rouge:#B3261E;--gris:#6B6459;
}
body{background:var(--sable);color:var(--encre);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5;padding-bottom:40px}
.haut{background:var(--vert);color:#fff;padding:16px 20px;
      display:flex;align-items:center;gap:10px}
.haut b{font-size:15px;font-weight:800}
.haut a{margin-left:auto;color:#8FB3A5;font-size:12.5px;text-decoration:none}
main{max-width:560px;margin:0 auto;padding:16px}

.carte{background:#fff;border-radius:14px;padding:20px;margin-top:14px;
       box-shadow:0 2px 14px rgba(0,0,0,.08)}
h1{font-size:21px;font-weight:800;letter-spacing:-.3px}
h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;
   color:var(--gris);margin-bottom:12px}
p.intro{color:var(--gris);font-size:14.5px;margin-top:6px}

label{display:block;font-size:12px;font-weight:700;color:var(--gris);
      text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px}
input,select{width:100%;padding:13px;font-size:16px;font-family:inherit;
  border:1.5px solid #C4BDB0;border-radius:9px;background:#fff;color:var(--encre)}
input:focus,select:focus{outline:none;border-color:var(--vert)}
.duo{display:flex;gap:10px}.duo>*{flex:1;min-width:0}

button{display:block;width:100%;padding:16px;margin-top:18px;font-size:16px;
  font-weight:700;font-family:inherit;border:0;border-radius:10px;
  background:var(--vert);color:#fff;cursor:pointer}
button[disabled]{opacity:.5}
.b2{background:#fff;color:var(--vert);border:1.5px solid var(--vert)}
.lien{display:block;text-align:center;margin-top:14px;color:var(--vert);
      font-size:14.5px;font-weight:600}

.etat{display:flex;align-items:center;gap:12px;padding:16px;border-radius:12px;
      font-weight:700;font-size:15px}
.etat.attente{background:#FFF6E0;color:#5C4708;border-left:4px solid var(--or)}
.etat.ok{background:#E6F4EC;color:#0B5133;border-left:4px solid var(--vert-vif)}
.etat.ko{background:#FDECEA;color:#7A1912;border-left:4px solid var(--rouge)}
.etat .rond{font-size:24px;line-height:1}

/* La ligne d'une pièce : marque, libellé, bouton. Alignés en haut pour
   qu'un motif de rejet s'étende sous le libellé sans décaler le reste. */
.piece{display:flex;align-items:flex-start;gap:12px;padding:13px 0;
       border-top:1px solid #EDE9E0}
.piece .choisir{margin-top:1px}
.piece:first-of-type{border-top:0}
.piece .nom{flex:1;min-width:0;font-weight:600;font-size:14.5px}
.piece .nom small{display:block;font-weight:400;color:var(--gris);font-size:12.5px}
.marque{font-size:19px;width:26px;text-align:center;flex:0 0 auto;margin-top:1px}
/* Le champ de fichier natif est illisible sur mobile : on le masque et
   on habille son label, qui déclenche le même comportement. */
input[type=file]{display:none}
.choisir{flex:0 0 auto;font-size:13px;font-weight:700;color:var(--vert);
  border:1.5px solid var(--vert);border-radius:8px;padding:8px 13px;cursor:pointer;
  background:#fff;text-transform:none;letter-spacing:0;margin:0}
.piece.faite .choisir{color:var(--gris);border-color:#C4BDB0}

/* Le portrait, tel que le passager le verra. */
.tete{display:flex;gap:15px;align-items:center}
.portrait{width:78px;height:78px;flex:0 0 auto;border-radius:50%;
  object-fit:cover;background:var(--sable);border:2px solid var(--sable)}
.portrait.absent{display:flex;align-items:center;justify-content:center;
  font-size:31px;color:var(--gris)}

.avis{background:#FDECEA;border-left:3px solid var(--rouge);padding:11px 14px;
      border-radius:0 8px 8px 0;font-size:13.5px;margin-top:8px}
.muet{color:var(--gris);font-size:13.5px}
.err{color:var(--rouge);font-size:14px;font-weight:600;margin-top:12px}
.ok{color:var(--vert-vif);font-size:14px;font-weight:600;margin-top:12px}
.qr{background:#fff;padding:22px;border-radius:12px;text-align:center;
    margin-top:14px}
.qr svg{width:100%;height:auto;max-width:280px}
.ref{font-family:ui-monospace,monospace;font-size:20px;font-weight:700;
     letter-spacing:1px;margin-top:12px}
@media print{
  .haut,.noimp{display:none!important}
  body{background:#fff}.qr{box-shadow:none}
}
`;

function page(titre: string, corps: string, script = ''): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E3B2E">
<title>${h(titre)}</title><style>${STYLE}</style></head><body>
<div class="haut"><b>Sécurité Taxi</b><a href="/chauffeur">Espace chauffeur</a></div>
<main>${corps}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

/** Libellés des pièces, tels qu'un chauffeur les nomme. */
const PIECES: Record<string, { titre: string; aide: string; peremption?: boolean }> = {
  cni_recto: { titre: 'Carte d\'identité — recto', aide: 'La face avec votre photo' },
  cni_verso: { titre: 'Carte d\'identité — verso', aide: 'La face arrière' },
  permis: { titre: 'Permis de conduire', aide: 'Recto lisible', peremption: true },
  carte_grise: { titre: 'Carte grise', aide: 'Du véhicule que vous conduisez' },
  licence_transport: { titre: 'Licence de transport', aide: 'Si vous en avez une' },
  assurance: { titre: 'Assurance', aide: 'Attestation en cours', peremption: true },
};

/* ------------------------------------------------------------------ */
/* Inscription                                                         */
/* ------------------------------------------------------------------ */

export function pageInscription(villes: Array<{ id: string; nom: string; region: string }>): string {
  const options = villes
    .map((v) => `<option value="${h(v.id)}">${h(v.nom)} — ${h(v.region)}</option>`)
    .join('');

  const corps = `
<div class="carte">
  <h1>Devenir chauffeur vérifié</h1>
  <p class="intro">Inscrivez-vous, déposez vos pièces, et recevez un code QR
  à coller dans votre véhicule. Les passagers pourront vérifier votre
  identité avant de monter.</p>

  <label for="nom">Nom</label>
  <input id="nom" placeholder="NGONO" autocomplete="family-name">

  <label for="prenom">Prénom</label>
  <input id="prenom" placeholder="Paul Bertrand" autocomplete="given-name">

  <label for="telephone">Téléphone</label>
  <input id="telephone" placeholder="699452108" inputmode="tel" autocomplete="tel">

  <label for="ville">Ville où vous travaillez</label>
  <select id="ville"><option value="">Choisir…</option>${options}</select>

  <label for="plaque">Plaque du véhicule</label>
  <input id="plaque" placeholder="LT 452 AB" autocapitalize="characters">

  <div class="duo">
    <div><label for="marque">Marque</label>
      <input id="marque" placeholder="Toyota"></div>
    <div><label for="modele">Modèle</label>
      <input id="modele" placeholder="Corolla"></div>
  </div>

  <label for="couleur">Couleur</label>
  <input id="couleur" placeholder="Jaune">

  <label for="mdp">Mot de passe</label>
  <input id="mdp" type="password" placeholder="8 caractères minimum"
         autocomplete="new-password">

  <button id="envoyer">Créer mon compte</button>
  <div id="retour"></div>
  <a class="lien" href="/chauffeur/connexion">J'ai déjà un compte</a>
</div>`;

  const script = `
const $=(i)=>document.getElementById(i);
$('envoyer').onclick=async()=>{
  const d={
    nom:$('nom').value.trim(),prenom:$('prenom').value.trim(),
    telephone:$('telephone').value.trim(),villeId:$('ville').value,
    plaque:$('plaque').value.trim(),motDePasse:$('mdp').value,
  };
  for(const [c,m] of [['marque','marque'],['modele','modele'],['couleur','couleur']]){
    const v=$(c).value.trim();if(v)d[m]=v;
  }
  const manque=['nom','prenom','telephone','villeId','plaque','motDePasse']
    .filter(k=>!d[k]);
  if(manque.length){$('retour').innerHTML=
    '<p class="err">Remplissez tous les champs obligatoires.</p>';return}
  if(d.motDePasse.length<8){$('retour').innerHTML=
    '<p class="err">Le mot de passe doit faire au moins 8 caractères.</p>';return}

  const b=$('envoyer');b.disabled=true;b.textContent='Création…';
  try{
    const r=await fetch('/api/chauffeurs/inscription',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    const rep=await r.json();
    if(r.ok){
      // L'inscription ne renvoie pas de jeton : on enchaîne la connexion
      // pour que le chauffeur ne saisisse pas deux fois la même chose.
      const c=await fetch('/api/auth/connexion',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({telephone:d.telephone,motDePasse:d.motDePasse})});
      const cj=await c.json();
      if(c.ok&&cj.jeton){localStorage.setItem('jeton-chauffeur',cj.jeton);
        location.href='/chauffeur';return}
      location.href='/chauffeur/connexion';
    }else{
      b.disabled=false;b.textContent='Créer mon compte';
      $('retour').innerHTML='<p class="err">'+
        (Array.isArray(rep.message)?rep.message.join(' '):rep.message||'Échec.')+'</p>';
    }
  }catch(e){b.disabled=false;b.textContent='Créer mon compte';
    $('retour').innerHTML='<p class="err">Pas de réseau.</p>'}
};`;

  return page('Inscription chauffeur', corps, script);
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

export function pageConnexion(): string {
  const corps = `
<div class="carte">
  <h1>Connexion</h1>
  <p class="intro">Accédez à votre dossier et à votre code QR.</p>

  <label for="telephone">Téléphone</label>
  <input id="telephone" placeholder="699452108" inputmode="tel" autocomplete="tel">

  <label for="mdp">Mot de passe</label>
  <input id="mdp" type="password" autocomplete="current-password">

  <button id="entrer">Se connecter</button>
  <div id="retour"></div>
  <a class="lien" href="/chauffeur/inscription">Créer un compte</a>
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
    if(r.ok&&d.jeton){localStorage.setItem('jeton-chauffeur',d.jeton);
      location.href='/chauffeur'}
    else{b.disabled=false;b.textContent='Se connecter';
      $('retour').innerHTML='<p class="err">'+(d.message||'Échec.')+'</p>'}
  }catch(e){b.disabled=false;b.textContent='Se connecter';
    $('retour').innerHTML='<p class="err">Pas de réseau.</p>'}
}
$('entrer').onclick=entrer;
$('mdp').addEventListener('keydown',e=>{if(e.key==='Enter')entrer()});`;

  return page('Connexion chauffeur', corps, script);
}

/* ------------------------------------------------------------------ */
/* Mon dossier — l'écran de retour                                     */
/* ------------------------------------------------------------------ */

export function pageDossier(): string {
  const lignes = Object.entries(PIECES).map(([cle, p]) => `
<div class="piece" id="piece-${cle}">
  <span class="marque" id="marque-${cle}">○</span>
  <div class="nom">${h(p.titre)}<small>${h(p.aide)}</small>
    <div id="avis-${cle}"></div></div>
  <label class="choisir">
    <input type="file" accept="image/jpeg,image/png,application/pdf"
           data-type="${cle}" data-peremption="${p.peremption ? '1' : ''}">
    Choisir</label>
</div>`).join('');

  const corps = `
<div id="zoneEtat"></div>

<div class="carte">
  <h2>Ma photo</h2>
  <p class="muet" style="margin-bottom:14px">C'est ce que verra le passager
  pour vous reconnaître. Un portrait net, visage dégagé.</p>
  <div class="tete">
    <div id="portrait" class="portrait absent">👤</div>
    <div style="flex:1;min-width:0">
      <label class="choisir" style="display:inline-block">
        <input type="file" id="fichierPhoto" accept="image/jpeg,image/png">
        Choisir une photo</label>
      <div id="retourPhoto" style="margin-top:8px"></div>
    </div>
  </div>
</div>

<div class="carte">
  <h2>Mes pièces</h2>
  <p class="muet" style="margin-bottom:14px">Photo nette ou PDF, 8 Mo maximum.
  Les quatre premières sont obligatoires.</p>
  ${lignes}
  <div id="retour"></div>
</div>

<div class="carte" id="zoneQr" hidden>
  <h2>Mon code QR</h2>
  <p class="muet">Imprimez-le et collez-le à l'arrière du siège passager.</p>
  <div class="qr" id="qr"></div>
  <button class="b2 noimp" onclick="print()">Imprimer</button>
</div>

<button class="b2 noimp" id="sortir">Se déconnecter</button>`;

  const script = `
const $=(i)=>document.getElementById(i);
const jeton=localStorage.getItem('jeton-chauffeur');
if(!jeton)location.href='/chauffeur/connexion';
const auth={'Authorization':'Bearer '+jeton};

const ETATS={
  declare:['attente','⏳','Dossier en attente',
    'Déposez vos quatre pièces obligatoires pour que votre dossier soit examiné.'],
  // Une fois les pièces déposées, l'attente change de nature : elle ne
  // dépend plus du chauffeur. Le lui dire évite qu'il redépose en boucle.
  declare_complet:['attente','⏳','Dossier déposé',
    'Vos pièces sont complètes et attendent l\\'examen d\\'un agent. '+
    'Vous recevrez un SMS dès la décision.'],
  en_examen:['attente','⏳','Dossier en cours d\\'examen',
    'Un agent examine vos pièces. Vous recevrez un SMS dès la décision.'],
  verifie:['ok','✓','Vous êtes vérifié',
    'Votre code QR est actif. Collez-le dans votre véhicule.'],
  certifie:['ok','★','Vous êtes certifié',
    'Votre code QR est actif. Collez-le dans votre véhicule.'],
  rejete:['ko','✕','Dossier rejeté',
    'Corrigez les pièces signalées ci-dessous et redéposez-les.'],
  suspendu:['ko','⛔','Compte suspendu',
    'Votre code QR a été révoqué. Rapprochez-vous de l\\'autorité qui vous a validé.'],
};

const VERDICTS={illisible:'Pièce illisible',expire:'Pièce expirée',
                non_conforme:'Pièce non conforme'};

async function charger(){
  const r=await fetch('/api/documents/mon-dossier',{headers:auth});
  if(r.status===401){localStorage.removeItem('jeton-chauffeur');
    location.href='/chauffeur/connexion';return}
  const d=await r.json();

  // « declare » recouvre deux situations très différentes pour celui qui
  // attend : il lui manque des pièces, ou il a tout déposé.
  const cle=(d.statut==='declare'&&d.examinable)?'declare_complet':d.statut;
  const [cl,rond,titre,texte]=ETATS[cle]||['attente','·',d.statut,''];
  $('zoneEtat').innerHTML='<div class="carte"><div class="etat '+cl+'">'+
    '<span class="rond">'+rond+'</span><div>'+titre+
    '<div style="font-weight:400;font-size:13.5px;margin-top:3px">'+texte+
    '</div></div></div>'+
    (d.complet?'':'<p class="muet" style="margin-top:12px">Il vous manque '+
      d.manquants.length+' pièce(s) obligatoire(s).</p>')+'</div>';

  // Chaque pièce porte son état : déposée, à refaire, ou attendue.
  for(const cle of Object.keys(${JSON.stringify(PIECES)})){
    const el=$('piece-'+cle),m=$('marque-'+cle),a=$('avis-'+cle);
    if(!el)continue;
    const depose=d.deposes.includes(cle);
    const refaire=(d.motifs||[]).find(x=>x.type===cle);
    const expire=(d.expires||[]).includes(cle);
    el.classList.toggle('faite',depose&&!refaire&&!expire);
    m.textContent=refaire||expire?'⚠':depose?'✓':'○';
    m.style.color=refaire||expire?'#B3261E':depose?'#1E7A4C':'#C4BDB0';
    a.innerHTML=refaire
      ?'<div class="avis"><b>'+(VERDICTS[refaire.verdict]||'À refaire')+'</b>'+
        (refaire.commentaire?' — '+refaire.commentaire:'')+'</div>'
      :expire?'<div class="avis"><b>Pièce expirée</b> — déposez une version à jour.</div>':'';
  }

  // Le QR n'existe qu'après validation : c'est l'invariant du produit.
  if(d.statut==='verifie'||d.statut==='certifie')await chargerQr();
  else $('zoneQr').hidden=true;
}

function montrerPhoto(url){
  const p=$('portrait');
  if(!url){p.className='portrait absent';p.textContent='👤';return}
  const img=new Image();
  img.className='portrait';img.alt='Ma photo';img.src=url;
  p.replaceWith(img);img.id='portrait';
}

async function chargerPhoto(){
  const r=await fetch('/api/auth/moi',{headers:auth});
  if(!r.ok)return;
  const moi=await r.json();
  montrerPhoto((moi.chauffeur||{}).photoUrl||null);
}

$('fichierPhoto').onchange=async()=>{
  const f=$('fichierPhoto').files[0];if(!f)return;
  const corps=new FormData();corps.append('fichier',f);
  $('retourPhoto').innerHTML='<p class="muet">Envoi…</p>';
  try{
    const r=await fetch('/api/chauffeurs/ma-photo',{method:'POST',headers:auth,body:corps});
    const d=await r.json();
    if(r.ok){
      // Horodatage : sans lui, le navigateur réafficherait l'ancienne
      // image depuis son cache.
      montrerPhoto(d.photoUrl+'?v='+Date.now());
      $('retourPhoto').innerHTML='<p class="ok">✓ Photo enregistrée.</p>';
    }else $('retourPhoto').innerHTML='<p class="err">'+
      (Array.isArray(d.message)?d.message.join(' '):d.message||'Refusée.')+'</p>';
  }catch(e){$('retourPhoto').innerHTML='<p class="err">Envoi impossible.</p>'}
  $('fichierPhoto').value='';
};

async function chargerQr(){
  const m=await fetch('/api/auth/moi',{headers:auth});
  if(!m.ok)return;
  const moi=await m.json();
  const id=moi.chauffeurId||moi.chauffeur_id||(moi.chauffeur||{}).id;
  if(!id)return;
  const r=await fetch('/api/qr/'+id+'.svg',{headers:auth});
  if(!r.ok)return;
  $('qr').innerHTML=await r.text();
  $('zoneQr').hidden=false;
}

// Téléversement : le champ de fichier est masqué derrière un bouton lisible.
document.querySelectorAll('input[type=file]').forEach(ch=>{
  ch.onchange=async()=>{
    const f=ch.files[0];if(!f)return;
    const type=ch.dataset.type;
    const corps=new FormData();
    corps.append('type',type);
    corps.append('fichier',f);
    if(ch.dataset.peremption){
      const d=prompt('Date d\\'expiration de cette pièce (AAAA-MM-JJ) :');
      if(!d){ch.value='';return}
      corps.append('dateExpiration',d);
    }
    $('retour').innerHTML='<p class="muet">Envoi de la pièce…</p>';
    try{
      const r=await fetch('/api/documents',{method:'POST',headers:auth,body:corps});
      const rep=await r.json();
      if(r.ok){$('retour').innerHTML='<p class="ok">✓ Pièce enregistrée.</p>';
        await charger()}
      else $('retour').innerHTML='<p class="err">'+
        (Array.isArray(rep.message)?rep.message.join(' '):rep.message||'Refusé.')+'</p>';
    }catch(e){$('retour').innerHTML='<p class="err">Envoi impossible.</p>'}
    ch.value='';
  };
});

$('sortir').onclick=()=>{localStorage.removeItem('jeton-chauffeur');
  location.href='/chauffeur/connexion'};

charger();
chargerPhoto();`;

  return page('Mon dossier', corps, script);
}
