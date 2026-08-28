/**
 * Les pages que voient réellement les gens.
 *
 * Elles sont servies par les routes que le QR imprimé et le SMS de
 * partage encodent : /s/:jeton pour le passager qui scanne, /t/:jeton
 * pour le proche qui suit. Ces deux URL sont le produit — tout le reste
 * de l'API est ce qu'il y a derrière.
 *
 * Le HTML est inclus dans le binaire plutôt que lu sur le disque : ces
 * pages doivent s'afficher même si rien d'autre ne fonctionne, et un
 * fichier manquant en production n'est pas un risque acceptable pour
 * l'écran qu'ouvre quelqu'un en montant dans un taxi la nuit.
 */

/** Échappe ce qui est inséré dans le HTML. */
function h(valeur: unknown): string {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Styles communs aux deux pages. Pensés pour un téléphone, de nuit. */
const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --vert:#0E3B2E;--vert-vif:#1E7A4C;--sable:#E7E3DA;--papier:#F5F3EE;
  --encre:#14261F;--or:#C9A227;--rouge:#B3261E;--gris:#6B6459;
}
body{
  background:var(--sable);color:var(--encre);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5;
  padding:0 0 40px;min-height:100vh;
}
.haut{background:var(--vert);color:#fff;padding:16px 20px;
      display:flex;align-items:center;gap:10px}
.haut b{font-size:15px;font-weight:800;letter-spacing:-.2px}
.haut span{font-size:12px;color:#8FB3A5;margin-left:auto}
main{max-width:520px;margin:0 auto;padding:16px}

.bandeau{padding:22px 20px;color:#fff;text-align:center;border-radius:14px 14px 0 0}
.bandeau .marque{font-size:40px;line-height:1;margin-bottom:6px}
.bandeau .titre{font-size:22px;font-weight:800;letter-spacing:.5px}
.bandeau.oui{background:var(--vert-vif)}
.bandeau.non{background:var(--or);color:#3D2E00}
.bandeau.mauvais{background:var(--rouge)}

.carte{background:#fff;border-radius:0 0 14px 14px;padding:20px;
       box-shadow:0 2px 14px rgba(0,0,0,.08)}
.carte.seule{border-radius:14px;margin-top:14px}
.nom{font-size:25px;font-weight:800;letter-spacing:-.4px}
/* Le portrait : c'est ce que le passager compare au visage qu'il a
   devant lui. Assez grand pour être reconnaissable d'un coup d'œil. */
.tete{display:flex;gap:15px;align-items:center}
.tete .nom{min-width:0;overflow-wrap:anywhere}
.portrait{width:78px;height:78px;flex:0 0 auto;border-radius:50%;
  object-fit:cover;background:var(--sable);border:2px solid var(--sable)}
.portrait.absent{display:flex;align-items:center;justify-content:center;
  font-size:31px;color:var(--gris)}
.plaque{display:inline-block;font-family:ui-monospace,SFMono-Regular,monospace;
        font-size:21px;font-weight:700;background:var(--sable);
        padding:9px 15px;border-radius:8px;margin:12px 0 6px;letter-spacing:1px}
.ligne{display:flex;justify-content:space-between;gap:14px;
       padding:11px 0;border-top:1px solid #EDE9E0;font-size:14.5px}
.ligne dt{color:var(--gris);flex:0 0 auto}
/* Les valeurs longues — « Toyota · Corolla · Jaune », un nom d'autorité —
   doivent revenir à la ligne plutôt que déborder sur un petit écran. */
.ligne dd{font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere}
.note{background:#FFF6E0;border-left:3px solid var(--or);padding:14px 16px;
      border-radius:0 8px 8px 0;margin-top:16px;font-size:14px}
.note.grave{background:#FDECEA;border-color:var(--rouge)}

button,.bouton{display:block;width:100%;padding:17px;margin-top:12px;
  font-size:16px;font-weight:700;font-family:inherit;border:0;border-radius:10px;
  background:var(--vert);color:#fff;cursor:pointer;text-align:center;
  text-decoration:none;-webkit-tap-highlight-color:transparent}
button:active,.bouton:active{transform:scale(.99)}
button[disabled]{opacity:.5}
.b2{background:#fff;color:var(--vert);border:1.5px solid var(--vert)}
.urgence{background:var(--rouge);font-size:19px;padding:26px;letter-spacing:.6px;
         box-shadow:0 3px 12px rgba(179,38,30,.3)}
.discret{background:none;color:var(--gris);font-size:14px;
         text-decoration:underline;padding:12px;font-weight:600}

.alerte-active{background:var(--rouge);color:#fff;padding:18px;border-radius:12px;
  margin-top:14px;font-size:15px;font-weight:600;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.86}}
.champ{margin-top:14px}
label{display:block;font-size:12px;font-weight:700;color:var(--gris);
      text-transform:uppercase;letter-spacing:.9px;margin-bottom:6px}
input{width:100%;padding:14px;font-size:16px;font-family:inherit;
      border:1.5px solid #C4BDB0;border-radius:9px;background:#fff;color:var(--encre)}
input:focus{outline:none;border-color:var(--vert)}
.muet{color:var(--gris);font-size:14px}
.pied{text-align:center;font-size:12.5px;color:var(--gris);margin-top:22px;
      padding:0 10px;line-height:1.6}
.pastilles{display:flex;gap:8px;margin-top:14px;font-size:12.5px;color:var(--gris)}
.pastilles div{flex:1;background:var(--papier);padding:9px;border-radius:8px;
               text-align:center}
.pastilles b{display:block;font-size:17px;color:var(--encre);margin-bottom:1px}
`;

const ENTETE = `<div class="haut"><b>Sécurité Taxi</b><span>Cameroun</span></div>`;

function page(titre: string, corps: string, script = ''): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E3B2E">
<title>${h(titre)}</title><style>${STYLE}</style></head>
<body>${ENTETE}<main>${corps}</main>${script ? `<script>${script}</script>` : ''}
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Page du scan : ce que voit le passager en montant dans le taxi.     */
/* ------------------------------------------------------------------ */

export function pageScan(d: any, jeton: string): string {
  const s = d.statut ?? {};
  const c = d.chauffeur ?? {};
  const v = d.vehicule ?? {};
  const classe = s.verifie ? 'oui' : (s.code === 'suspendu' || s.code === 'rejete') ? 'mauvais' : 'non';
  const marque = s.verifie ? '✓' : (s.code === 'suspendu' || s.code === 'rejete') ? '✕' : '!';

  const corps = `
<div class="bandeau ${classe}">
  <div class="marque">${marque}</div>
  <div class="titre">${h(s.libelle)}</div>
</div>
<div class="carte">
  <div class="tete">
    ${c.photoUrl
      ? `<img class="portrait" src="${h(c.photoUrl)}" alt="Portrait du chauffeur">`
      : '<div class="portrait absent">👤</div>'}
    <div class="nom">${h((c.prenom ?? '') + ' ' + (c.nom ?? ''))}</div>
  </div>
  <div class="plaque">${h(v.plaque)}</div>
  <dl>
    <div class="ligne"><dt>Véhicule</dt><dd>${h(v.description)}</dd></div>
    ${c.referenceLicence ? `<div class="ligne"><dt>Licence</dt><dd>${h(c.referenceLicence)}</dd></div>` : ''}
    ${s.autorite ? `<div class="ligne"><dt>Validé par</dt><dd>${h(s.autorite)}</dd></div>` : ''}
    ${s.verifieLe ? `<div class="ligne"><dt>Depuis le</dt><dd>${h(s.verifieLe)}</dd></div>` : ''}
    ${d.ville ? `<div class="ligne"><dt>Ville</dt><dd>${h(d.ville)}</dd></div>` : ''}
  </dl>
  ${s.avertissement
    ? `<div class="note ${classe === 'mauvais' ? 'grave' : ''}">${h(s.avertissement)}</div>`
    : ''}
  <button id="demarrer">Démarrer le trajet</button>
  <p class="muet" style="text-align:center;margin-top:10px">
    Vos proches pourront suivre votre course.</p>
</div>
<p class="pied">Comparez la plaque affichée ci-dessus avec celle du véhicule.<br>
Si elles diffèrent, ne montez pas.</p>`;

  const script = `
const JETON=${JSON.stringify(jeton)};
let s=localStorage.getItem('sp');
if(!s){s='p'+crypto.randomUUID().replaceAll('-','');localStorage.setItem('sp',s)}
const b=document.getElementById('demarrer');
b.onclick=async()=>{
  b.disabled=true;b.textContent='Démarrage…';
  const envoi={jetonQr:JETON};
  try{
    // La position rend l'alerte utile ; on n'attend pas indéfiniment.
    const p=await new Promise(r=>{
      if(!navigator.geolocation)return r(null);
      navigator.geolocation.getCurrentPosition(x=>r(x),()=>r(null),{timeout:4000});
    });
    if(p){envoi.latitude=p.coords.latitude;envoi.longitude=p.coords.longitude}
  }catch(e){}
  try{
    const r=await fetch('/api/trajets',{method:'POST',
      headers:{'Content-Type':'application/json','x-session-passager':s},
      body:JSON.stringify(envoi)});
    const d=await r.json();
    if(r.ok){location.href='/t/'+d.jetonSuivi}
    else if(r.status===409&&d.jetonSuivi){location.href='/t/'+d.jetonSuivi}
    else{b.disabled=false;b.textContent='Démarrer le trajet';alert(d.message||'Impossible de démarrer.')}
  }catch(e){b.disabled=false;b.textContent='Démarrer le trajet';alert('Pas de réseau.')}
};`;

  return page(`${s.libelle} — ${(c.prenom ?? '') + ' ' + (c.nom ?? '')}`, corps, script);
}

/** QR inconnu, périmé ou révoqué : le cas qui doit alarmer. */
export function pageScanRefuse(message: string): string {
  return page('Code non reconnu', `
<div class="bandeau mauvais">
  <div class="marque">✕</div>
  <div class="titre">CODE NON RECONNU</div>
</div>
<div class="carte">
  <div class="note grave">${h(message)}</div>
</div>
<p class="pied">En cas de danger immédiat, appelez le 117.</p>`);
}

/* ------------------------------------------------------------------ */
/* Page du trajet : suivi, partage et bouton d'alerte.                 */
/* ------------------------------------------------------------------ */

/**
 * Page de suivi, servie à la même adresse pour le passager et pour le
 * proche. Le serveur ne peut pas les distinguer — un lien ouvert depuis
 * un SMS n'envoie pas d'en-tête de session. Les commandes sont donc
 * rendues masquées, et le script ne les révèle qu'après avoir vérifié
 * auprès de l'API que cette session possède bien ce trajet.
 */
export function pageTrajet(d: any, jetonSuivi: string, _proprietaire = false): string {
  const c = d.chauffeur ?? {};
  const v = d.vehicule ?? {};
  // Un trajet sous alerte est toujours en cours — c'est même le moment
  // où les commandes comptent le plus. Seuls 'termine' et 'abandonne'
  // ferment la page.
  const fini = d.etat === 'termine' || d.etat === 'abandonne';
  const sousAlerte = d.etat === 'alerte';

  const corps = `
<div class="carte seule">
  <div class="tete">
    ${c.photoUrl
      ? `<img class="portrait" src="${h(c.photoUrl)}" alt="Portrait du chauffeur">`
      : '<div class="portrait absent">👤</div>'}
    <div class="nom">${h((c.prenom ?? '') + ' ' + (c.nom ?? ''))}</div>
  </div>
  <div class="plaque">${h(v.plaque)}</div>
  <dl>
    <div class="ligne"><dt>Véhicule</dt><dd>${h(v.description)}</dd></div>
    <div class="ligne"><dt>État</dt><dd id="etat">${
      fini ? 'Trajet terminé' : sousAlerte ? 'Alerte en cours' : 'En cours'}</dd></div>
    <div class="ligne"><dt>Départ</dt><dd>${
      d.demarreLe ? h(new Date(d.demarreLe).toLocaleTimeString('fr-FR').slice(0, 5)) : '—'}</dd></div>
    <div class="ligne"><dt>Dernière position</dt><dd id="pos">${
      d.position ? 'il y a peu' : 'en attente'}</dd></div>
  </dl>
</div>

<div class="carte seule" id="blocParcours" hidden>
  <div style="display:flex;justify-content:space-between;align-items:baseline;
              margin-bottom:10px">
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.8px;
               color:var(--gris);margin:0">Votre itinéraire</h3>
    <span class="muet" id="distance"></span>
  </div>
  <svg id="trace" viewBox="0 0 300 190" style="width:100%;height:auto;
       background:#FAF8F3;border-radius:10px" aria-label="Tracé du trajet"></svg>
  <p class="muet" id="legendeParcours" style="margin-top:8px"></p>
</div>

${!fini ? `
<div id="commandes" hidden>
  <div id="zoneAlerte"></div>
  <button class="urgence" id="alerte">🚨 ALERTE D'URGENCE</button>
  <p class="muet" id="soustitreAlerte" style="text-align:center;margin-top:8px">
    Prévient vos proches et l'autorité, avec votre position.</p>

  <div class="carte seule">
    <label for="nom">Prévenir un proche</label>
    <input id="nom" placeholder="Nom (ex. Maman)" autocomplete="name">
    <div class="champ">
      <input id="tel" placeholder="Téléphone (ex. 699452108)"
             inputmode="tel" autocomplete="tel">
    </div>
    <button class="b2" id="partager">Envoyer le lien de suivi</button>
    <p class="muet" id="retourPartage" style="margin-top:10px"></p>
  </div>

  <button class="b2" id="terminer">Terminer le trajet</button>
</div>

<div class="carte seule" id="motProche">
  <p class="muet">Vous suivez ce trajet à la demande du passager.
  Cette page se met à jour toute seule.</p>
</div>` : ''}

${fini ? `
<div class="carte seule" id="zoneFin">
  <p class="muet">Ce trajet est terminé.</p>
  <div id="oubli" hidden>
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.8px;
               color:var(--gris);margin:16px 0 8px">Un oubli dans le taxi ?</h3>
    <button class="b2" id="voirContact">Joindre le chauffeur via le call center</button>
    <div id="contact"></div>

    <div style="margin-top:18px;padding-top:16px;border-top:1px solid #EDE9E0">
      <label for="objet">Ou décrire l'objet oublié</label>
      <input id="objet" placeholder="Sac à dos noir, ordinateur portable">
      <button class="b2" id="declarer">Prévenir le chauffeur par SMS</button>
      <p class="muet" id="retourObjet" style="margin-top:10px"></p>
    </div>
  </div>
</div>` : ''}

<p class="pied">En cas de danger immédiat, appelez le 117.</p>`;

  const script = `
const J=${JSON.stringify(jetonSuivi)};
const FINI=${fini ? 'true' : 'false'};
// Rendu côté serveur : le tracé s'affiche à l'ouverture, sans attendre
// un aller-retour réseau — et il reste visible sur un trajet terminé,
// où le rafraîchissement ne tourne plus.
const PARCOURS=${JSON.stringify(d.parcours ?? [])};
const DISTANCE=${JSON.stringify(d.distanceKm ?? 0)};
const SOUS_ALERTE=${sousAlerte ? 'true' : 'false'};
const s=localStorage.getItem('sp')||'';
const $=(i)=>document.getElementById(i);
const entetes={'Content-Type':'application/json','x-session-passager':s};
let MIEN=false;

function ecrans(actif,destinataires){
  const z=$('zoneAlerte');if(!z)return;
  const qui=(destinataires===0||destinataires==='—')
    ?'Vos proches et l\\'autorité reçoivent votre position.'
    :destinataires+' personne(s) prévenue(s). Vos proches et l\\'autorité '+
     'reçoivent votre position.';
  z.innerHTML=actif?'<div class="alerte-active">🚨 Alerte en cours — '+qui+'</div>'+
    '<button class="b2" id="annuler">Annuler l\\'alerte</button>':'';
  const a=$('alerte');if(a)a.style.display=actif?'none':'block';
  // Le sous-titre décrit le bouton d'alerte : sans lui, il n'a plus de sens.
  const st=$('soustitreAlerte');if(st)st.style.display=actif?'none':'block';
  const e=$('etat');
  if(e)e.textContent=actif?'⚠ Alerte en cours':'En cours';
  const an=$('annuler');
  if(an)an.onclick=async()=>{
    an.disabled=true;
    const r=await fetch('/api/trajets/'+J+'/alerte/annulation',{method:'POST',
      headers:entetes,body:JSON.stringify({motif:'Fausse manœuvre'})});
    if(r.ok)ecrans(false,0);else an.disabled=false;
  };
}

function activerCommandes(){
  $('commandes').hidden=false;
  $('motProche').hidden=true;
  // Page rechargée alors qu'une alerte court : elle doit se voir tout de
  // suite, sans nouvel appui.
  if(SOUS_ALERTE)ecrans(true,'—');

  $('alerte').onclick=async()=>{
    const b=$('alerte');b.disabled=true;b.textContent='Envoi…';
    const envoi={};
    try{
      const p=await new Promise(r=>{
        if(!navigator.geolocation)return r(null);
        navigator.geolocation.getCurrentPosition(x=>r(x),()=>r(null),{timeout:4000});
      });
      if(p){envoi.latitude=p.coords.latitude;envoi.longitude=p.coords.longitude}
    }catch(e){}
    const r=await fetch('/api/trajets/'+J+'/alerte',{method:'POST',
      headers:entetes,body:JSON.stringify(envoi)});
    const d=await r.json();
    b.textContent='🚨 ALERTE D\\'URGENCE';b.disabled=false;
    if(r.ok)ecrans(true,d.destinatairesPrevenus??0);
    else alert(d.message||'Envoi impossible.');
  };

  $('partager').onclick=async()=>{
    const nom=$('nom').value.trim(),tel=$('tel').value.trim();
    if(!nom||!tel){$('retourPartage').textContent='Indiquez un nom et un numéro.';return}
    const b=$('partager');b.disabled=true;b.textContent='Envoi…';
    const r=await fetch('/api/trajets/'+J+'/partage',{method:'POST',headers:entetes,
      body:JSON.stringify({contacts:[{nom,telephone:tel}],memoriser:true})});
    const d=await r.json();
    b.disabled=false;b.textContent='Envoyer le lien de suivi';
    if(r.ok){$('retourPartage').textContent='✓ '+nom+' a reçu le lien par SMS.';
             $('nom').value='';$('tel').value=''}
    else $('retourPartage').textContent=d.message||'Envoi impossible.';
  };

  $('terminer').onclick=async()=>{
    if(!confirm('Terminer ce trajet ?'))return;
    const envoi={};
    try{
      const p=await new Promise(r=>{
        if(!navigator.geolocation)return r(null);
        navigator.geolocation.getCurrentPosition(x=>r(x),()=>r(null),{timeout:4000});
      });
      if(p){envoi.latitude=p.coords.latitude;envoi.longitude=p.coords.longitude}
    }catch(e){}
    const r=await fetch('/api/trajets/'+J+'/fin',{method:'POST',
      headers:entetes,body:JSON.stringify(envoi)});
    const d=await r.json();
    if(r.ok)location.reload();else alert(d.message||'Impossible de terminer.');
  };

  // Le trajet n'a d'intérêt que si la position suit : on l'envoie
  // régulièrement tant que la page reste ouverte.
  function envoyerPosition(){
    if(!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(async(p)=>{
      await fetch('/api/trajets/'+J+'/positions',{method:'POST',headers:entetes,
        body:JSON.stringify({positions:[{latitude:p.coords.latitude,
          longitude:p.coords.longitude,
          precisionM:Math.min(9999,Math.round(p.coords.accuracy||0)),
          mesureLe:new Date().toISOString()}]})}).catch(()=>{});
    },()=>{},{timeout:8000,maximumAge:10000});
  }
  envoyerPosition();
  setInterval(envoyerPosition,60000);
}

/**
 * Qui regarde cette page ? Le serveur ne peut pas le dire : un lien
 * ouvert depuis un SMS n'envoie pas d'en-tête de session. On demande
 * donc à l'API quel trajet appartient à cette session, et on ne montre
 * les commandes que si c'est celui-ci.
 */
/**
 * Mise en relation par le call center. Le numéro du chauffeur n'arrive
 * jamais jusqu'ici : le serveur renvoie le numéro du call center et une
 * référence de dossier. Le serveur revérifie la session et l'état du
 * trajet ; cet affichage n'est qu'une commodité, jamais le contrôle
 * d'accès.
 */
function activerOubli(){
  const z=$('oubli');if(!z)return;
  z.hidden=false;
  const LIB_CONTACT='Joindre le chauffeur via le call center';
  $('voirContact').onclick=async()=>{
    const b=$('voirContact');b.disabled=true;b.textContent='…';
    try{
      const r=await fetch('/api/trajets/'+J+'/contact-chauffeur',{headers:entetes});
      const d=await r.json();
      if(r.ok){
        b.style.display='none';
        $('contact').innerHTML=
          '<div class="ligne"><dt>Call center</dt><dd><a href="tel:'+
          String(d.callCenter).replace(/\\s/g,'')+'" style="color:var(--vert)">'+
          d.callCenter+'</a></dd></div>'+
          '<div class="ligne"><dt>Votre référence</dt><dd>'+d.reference+'</dd></div>'+
          '<div class="ligne"><dt>Horaires</dt><dd>'+d.horaires+'</dd></div>'+
          '<p class="muet" style="margin-top:10px">'+d.message+'</p>';
      }else{b.disabled=false;b.textContent=LIB_CONTACT;
        $('contact').innerHTML='<p class="muet" style="margin-top:10px">'+
          (d.message||'Indisponible.')+'</p>'}
    }catch(e){b.disabled=false;b.textContent=LIB_CONTACT}
  };

  // Déclarer l'objet plutôt qu'appeler : le chauffeur reçoit la
  // description par SMS et peut répondre, ce qui laisse une trace.
  $('declarer').onclick=async()=>{
    const description=$('objet').value.trim();
    if(!description){$('retourObjet').textContent=
      'Décrivez brièvement ce que vous avez oublié.';return}
    const b=$('declarer');b.disabled=true;b.textContent='Envoi…';
    try{
      const r=await fetch('/api/objets-perdus/trajet/'+J,{method:'POST',
        headers:entetes,body:JSON.stringify({description})});
      const d=await r.json();
      b.disabled=false;b.textContent='Prévenir le chauffeur par SMS';
      if(r.ok){$('retourObjet').textContent='✓ '+d.message;$('objet').value=''}
      else $('retourObjet').textContent=d.message||'Envoi impossible.';
    }catch(e){b.disabled=false;b.textContent='Prévenir le chauffeur par SMS';
      $('retourObjet').textContent='Pas de réseau.'}
  };
}

async function determinerRole(){
  // Trajet terminé : on propose le contact dès qu'une session existe.
  // C'est le serveur qui vérifie qu'elle est bien la bonne — un proche
  // qui cliquerait obtiendrait un 403, pas un numéro.
  if(FINI){
    if(s)activerOubli();
    return;
  }
  if(!s)return demarrerSuiviProche();
  try{
    const r=await fetch('/api/trajets/courant',{headers:{'x-session-passager':s}});
    const t=await r.text();
    const d=t?JSON.parse(t):null;
    MIEN=!!(d&&d.jetonSuivi===J);
  }catch(e){MIEN=false}
  if(MIEN)activerCommandes();
  else demarrerSuiviProche();
}

/**
 * Trace le parcours en SVG, sans fond de carte ni service externe.
 *
 * Le choix est contraint : une carte à tuiles chargerait une
 * bibliothèque et des dizaines d'images au moment où la page doit
 * rester légère sur un réseau 2G. Le tracé ne donne pas les noms de
 * rues, mais il montre la forme du trajet — assez pour reconnaître un
 * itinéraire habituel, et surtout pour voir qu'il s'en écarte.
 *
 * Les coordonnées sont projetées en corrigeant la longitude par le
 * cosinus de la latitude : sans cela, un trajet est-ouest paraîtrait
 * plus long qu'il ne l'est.
 */
function tracerParcours(pts, distanceKm){
  const bloc=$('blocParcours'); if(!bloc) return;
  if(!pts||pts.length<2){bloc.hidden=true;return}
  bloc.hidden=false;

  const L=300,H=190,M=18;
  const latM=pts.reduce((s,p)=>s+p.latitude,0)/pts.length;
  const k=Math.cos(latM*Math.PI/180);
  const xs=pts.map(p=>p.longitude*k), ys=pts.map(p=>p.latitude);
  const x0=Math.min(...xs),x1=Math.max(...xs);
  const y0=Math.min(...ys),y1=Math.max(...ys);

  // Un trajet quasi immobile ne doit pas être étiré au point de
  // ressembler à une grande course.
  const ech=Math.max((x1-x0),(y1-y0))||1e-6;
  const cx=(x0+x1)/2, cy=(y0+y1)/2;
  const proj=(p)=>[
    L/2+((p.longitude*k-cx)/ech)*(L-2*M),
    H/2-((p.latitude-cy)/ech)*(H-2*M)
  ];

  const d=pts.map((p,i)=>{const[x,y]=proj(p);
    return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ');
  const[xd,yd]=proj(pts[0]);
  const[xf,yf]=proj(pts[pts.length-1]);
  const enCours=!FINI;

  $('trace').innerHTML=
    '<path d="'+d+'" fill="none" stroke="#1F6B45" stroke-width="3" '+
      'stroke-linecap="round" stroke-linejoin="round"/>'+
    '<circle cx="'+xd.toFixed(1)+'" cy="'+yd.toFixed(1)+'" r="5" '+
      'fill="#fff" stroke="#5E5C55" stroke-width="2"/>'+
    '<circle cx="'+xf.toFixed(1)+'" cy="'+yf.toFixed(1)+'" r="6" fill="'+
      (enCours?'#1F6B45':'#A8342A')+'"/>'+
    (enCours?'<circle cx="'+xf.toFixed(1)+'" cy="'+yf.toFixed(1)+'" r="6" '+
      'fill="none" stroke="#1F6B45" stroke-width="2" opacity=".45">'+
      '<animate attributeName="r" values="6;13;6" dur="2s" '+
      'repeatCount="indefinite"/><animate attributeName="opacity" '+
      'values=".45;0;.45" dur="2s" repeatCount="indefinite"/></circle>':'');

  $('distance').textContent=(distanceKm||0).toFixed(1).replace('.',',')+' km';
  $('legendeParcours').textContent=enCours
    ?'Départ en clair, position actuelle en vert.'
    :'Départ en clair, arrivée en rouge.';
}

// Le proche voit la page se rafraîchir sans rien faire.
function demarrerSuiviProche(){
  if(FINI)return;
  setInterval(async()=>{
    try{
      const r=await fetch('/api/suivi/'+J);
      if(!r.ok)return;
      const d=await r.json();
      $('etat').textContent=d.etat==='alerte'?'⚠ Alerte en cours'
        :d.etat==='en_cours'?'En cours':'Trajet terminé';
      if(d.position)$('pos').textContent='à l\\'instant';
      tracerParcours(d.parcours,d.distanceKm);
      // Le proche doit voir l'alerte sans avoir à recharger : c'est la
      // raison d'être du lien qu'il a reçu.
      if(d.etat==='alerte'&&!document.querySelector('.alerte-active')){
        const z=document.createElement('div');
        z.className='alerte-active';
        z.textContent='🚨 Le passager a déclenché une alerte. '+
          'Les autorités ont été prévenues.';
        $('motProche').before(z);
      }
      if(d.etat==='termine'||d.etat==='abandonne')location.reload();
    }catch(e){}
  },20000);
}

tracerParcours(PARCOURS,DISTANCE);
determinerRole();`;

  return page('Trajet en cours', corps, script);
}

/** Lien de suivi invalide. */
export function pageSuiviRefuse(): string {
  return page('Lien invalide', `
<div class="carte seule">
  <div class="nom" style="font-size:20px">Lien de suivi invalide</div>
  <p class="muet" style="margin-top:10px">
    Ce lien n'existe pas ou a expiré. Demandez à la personne qui vous l'a
    envoyé de le partager à nouveau.</p>
</div>`);
}
