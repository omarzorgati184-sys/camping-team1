// À personnaliser avant déploiement : URL du projet et clé anon uniquement.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

const errorBox = document.getElementById('app-error');
let supabaseClient = null;
let session = null;
let profile = null;
let camps = [];
let selectedCampId = null;
let realtimeChannel = null;

function showFatal(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

if (!window.supabase) {
  showFatal('Impossible de charger Supabase. Vérifiez la connexion Internet ou la version CDN.');
} else if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  showFatal('Supabase n’est pas configuré : renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans app.js.');
} else {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  init();
}

async function init() {
  document.getElementById('auth-form').addEventListener('submit', handleAuth);
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.getElementById('camp-select').addEventListener('change', e => { selectedCampId=e.target.value; loadCampData(); });
  document.getElementById('publication-form').addEventListener('submit', publish);
  document.getElementById('admin-camp-btn').addEventListener('click', openNewCamp);
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => openAdminModal(b.dataset.action)));
  document.getElementById('modal-cancel').addEventListener('click', () => document.getElementById('modal').close());
  document.getElementById('modal-form').addEventListener('submit', submitModal);

  supabaseClient.auth.onAuthStateChange((_event, newSession) => { session=newSession; session ? showApp() : showLogin(); });
  const { data } = await supabaseClient.auth.getSession();
  session=data.session;
  session ? showApp() : showLogin();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

function showLogin() {
  document.getElementById('auth-view').hidden=false;
  document.getElementById('app-view').hidden=true;
  document.getElementById('logout-btn').hidden=true;
}
async function showApp() {
  document.getElementById('auth-view').hidden=true;
  document.getElementById('app-view').hidden=false;
  document.getElementById('logout-btn').hidden=false;
  const { data, error } = await supabaseClient.from('profiles').select('id,nom,role,archive').eq('id',session.user.id).maybeSingle();
  if (error) return showFatal('Impossible de charger votre profil : '+error.message);
  profile=data;
  applyRoleUI();
  await loadCamps();
}
function applyRoleUI() {
  document.querySelectorAll('.admin-only').forEach(el => el.hidden=profile?.role !== 'admin');
}
async function handleAuth(event) {
  event.preventDefault();
  const action=event.submitter.value;
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const box=document.getElementById('auth-error'); box.textContent='';
  try {
    const result=action==='signup'
      ? await supabaseClient.auth.signUp({email,password})
      : await supabaseClient.auth.signInWithPassword({email,password});
    if (result.error) throw result.error;
  } catch(e) { box.textContent='Connexion impossible : '+(e.message || 'vérifiez vos informations.'); }
}
async function logout() { await supabaseClient.auth.signOut(); }

async function loadCamps() {
  const {data,error}=await supabaseClient.from('camps').select('*').eq('archive',false).order('cree_le',{ascending:false});
  if(error) return showFatal(error.message);
  camps=data||[];
  const select=document.getElementById('camp-select');
  select.innerHTML=camps.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.nom)}</option>`).join('');
  if(!selectedCampId || !camps.some(c=>c.id===selectedCampId)) selectedCampId=camps[0]?.id||null;
  if(selectedCampId) select.value=selectedCampId;
  await loadCampData();
}
async function loadCampData() {
  if(!selectedCampId) {
    document.getElementById('camp-details').textContent='Aucun camp disponible.';
    document.getElementById('task-groups').textContent='';
    document.getElementById('activities-list').textContent='';
    return;
  }
  const camp=camps.find(c=>c.id===selectedCampId);
  document.getElementById('camp-details').textContent=`${camp.lieu||''} · ${formatDate(camp.date_debut)} — ${formatDate(camp.date_fin)} · Responsable : ${await responsibleName(camp.responsable)}`;
  await Promise.all([loadTasks(),loadActivities(),loadFeed()]);
  subscribeRealtime();
}
async function responsibleName(id) {
  if(!id)return 'non renseigné';
  const {data}=await supabaseClient.from('profiles').select('nom').eq('id',id).maybeSingle();
  return data?.nom||'non renseigné';
}

async function loadTasks() {
  const {data:tasks,error}=await supabaseClient.from('taches_fani').select('*,animateurs(id,nom,user_id),activites(id,nom)').eq('archive',false).order('description');
  if(error){document.getElementById('fani-error').textContent=error.message;return;}
  const campTasks=(tasks||[]).filter(t=>t.activites?.camp_id===selectedCampId || t.camp_id===selectedCampId);
  // Tasks are loaded with assigned camp information through the activity or animator/camp context.
  const ids = campTasks.map(t=>t.id);
  const {data:taskRows}=await supabaseClient.from('taches_fani').select('id,animateurs!inner(camp_id)').in('id',ids.length?ids:['00000000-0000-0000-0000-000000000000]);
  const allowedIds=new Set((taskRows||[]).filter(r=>r.animateurs?.camp_id===selectedCampId).map(r=>r.id));
  const finalTasks=campTasks.filter(t=>allowedIds.has(t.id));
  renderTasks(finalTasks);
}
async function loadActivities() {
  const {data,error}=await supabaseClient.from('activites').select('*').eq('camp_id',selectedCampId).eq('archive',false).order('date_activite',{ascending:true});
  if(error)return;
  document.getElementById('activities-list').innerHTML=(data||[]).map(a=>`<article class="card"><h3>${escapeHTML(a.nom)}</h3><div class="task-meta">${formatDateTime(a.date_activite)}</div><p>${escapeHTML(a.description||'')}</p>${profile?.role==='admin'?`<button class="button archive-btn" onclick="archiveRow('activites','${a.id}')">Archiver</button>`:''}</article>`).join('')||( '<p>Aucune activité.</p>' );
}
function renderTasks(tasks) {
  const done=tasks.filter(t=>t.statut==='fait').length;
  document.getElementById('progress-label').textContent=`${done} / ${tasks.length} tâches faites`;
  document.getElementById('progress-segments').innerHTML=(tasks.length?tasks:[{}]).map(t=>`<span class="progress-segment ${t.statut==='fait'?'done':''}"></span>`).join('');
  const groups=new Map();
  tasks.forEach(t=>{const key=t.animateurs?.id||'sans'; if(!groups.has(key))groups.set(key,{name:t.animateurs?.nom||'Animateur inconnu',tasks:[]});groups.get(key).tasks.push(t);});
  document.getElementById('task-groups').innerHTML=[...groups.values()].map(g=>{
    const doneCount=g.tasks.filter(t=>t.statut==='fait').length;
    return `<section class="task-group"><header class="task-group-header"><strong>${escapeHTML(g.name)}</strong><span>${doneCount} / ${g.tasks.length} faites</span></header>${g.tasks.map(t=>taskHTML(t)).join('')}</section>`;
  }).join('')||'<p>Aucune tâche.</p>';
}
function taskHTML(t) {
  const owns=t.animateurs?.user_id===session.user.id;
  const canEdit=profile?.role==='admin'||owns;
  const title=canEdit?'': 'Réservée à son animateur';
  return `<div class="task-row"><input type="checkbox" ${t.statut==='fait'?'checked':''} ${canEdit?'':'disabled'} title="${title}" onchange="toggleTask('${t.id}',this.checked)"><div><strong>${escapeHTML(t.description)}</strong><div class="task-meta">Activité : ${escapeHTML(t.activites?.nom||'Non liée')} · ${t.date_fait?formatDateTime(t.date_fait):'Pas encore faite'}</div></div><div>${profile?.role==='admin'?`<button class="button archive-btn" onclick="archiveRow('taches_fani','${t.id}')">Archiver</button>`:''}</div></div>`;
}
async function toggleTask(id,checked) {
  const {error}=await supabaseClient.from('taches_fani').update({statut:checked?'fait':'a_faire'}).eq('id',id);
  if(error)alert('Modification impossible : '+error.message);
  await loadTasks();
}

function subscribeRealtime() {
  if(realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel('publications-'+selectedCampId)
    .on('postgres_changes',{event:'*',schema:'public',table:'publications',filter:`camp_id=eq.${selectedCampId}`},()=>loadFeed())
    .subscribe();
}
async function loadFeed() {
  if(!selectedCampId)return;
  const {data,error}=await supabaseClient.from('publications').select('*').eq('camp_id',selectedCampId).eq('archive',false).order('cree_le',{ascending:false});
  if(error){document.getElementById('feed').innerHTML=`<p class="error">Chargement impossible : ${escapeHTML(error.message)}</p>`;return;}
  const posts=data||[];
  const signedByPath={};
  const paths=[...new Set(posts.filter(p=>p.fichier_path).map(p=>p.fichier_path))];
  if(paths.length){const {data:signed}=await supabaseClient.storage.from('publications').createSignedUrls(paths,3600);(signed||[]).forEach(s=>{if(s.path)signedByPath[s.path]=s.signedUrl;});}
  document.getElementById('feed').innerHTML=posts.map(p=>`<article class="post"><div class="post-meta"><strong>${escapeHTML(p.auteur_nom)}</strong> · ${formatDateTime(p.cree_le)}</div>${p.texte?`<p class="post-text">${escapeHTML(p.texte)}</p>`:''}${p.fichier_path?`<a href="${escapeHTML(signedByPath[p.fichier_path]||'#')}" target="_blank" rel="noopener">Ouvrir : ${escapeHTML(p.fichier_nom)}</a>`:''}${profile?.role==='admin'?`<br><button class="button archive-btn" onclick="archivePublication('${p.id}')">Archiver</button>`:''}</article>`).join('')||'<p>Aucune publication.</p>';
}
async function publish(event) {
  event.preventDefault();
  const box=document.getElementId('publication-error');
}
