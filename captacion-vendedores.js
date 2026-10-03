/* APP INTEGRAL REST · Captación de vendedores y presupuestos con imagen.
   Este archivo trabaja exclusivamente con Hogar y Celulares. */

const RECRUITMENT_DEFAULT_CONTENT={
  titulo:'¿Querés vender para REST y generar nuevos ingresos?',
  bajada:'Sumate como vendedor o vendedora freelance y ofrecé productos de Hogar y Celulares con el acompañamiento de REST.',
  presentacion:'REST acerca productos y alternativas comerciales a sus clientes. Como vendedor freelance podés desarrollar tu propia cartera usando tus contactos, recomendaciones y canales digitales.',
  como_funciona:'Elegís productos del catálogo vigente, preparás una cotización con las condiciones autorizadas y acompañás al cliente. Cuando existe intención de compra, la operación continúa por el circuito de revisión de REST.',
  herramientas:'Contás con catálogo, calculadora de planes, presupuestos comerciales y herramientas para compartir por WhatsApp y redes sociales.',
  modalidades:'Las modalidades disponibles se obtienen del catálogo y de las condiciones comerciales vigentes. Los precios y planes no se cargan manualmente.',
  comisiones:'Las comisiones dependen de la categoría y de las condiciones asignadas por Administración. Una cotización no genera comisión por sí sola.',
  pago_comisiones:'Una venta genera comisión cuando cumple las condiciones vigentes del sistema. Administración informa el importe, el estado y la modalidad de pago aplicable.',
  preguntas_frecuentes:[
    {pregunta:'¿La postulación me da acceso inmediato?',respuesta:'No. Administración debe revisar, aprobar y activar la solicitud.'},
    {pregunta:'¿Dónde puedo ofrecer los productos?',respuesta:'Podés trabajar con WhatsApp, estados, redes sociales, contactos personales, referidos y venta presencial.'}
  ]
};

const APPLICANT_STATUS_LABELS={pendiente:'PENDIENTE',contactado:'CONTACTADO',aprobado:'APROBADO',rechazado:'RECHAZADO',activo:'ACTIVO',suspendido:'SUSPENDIDO'};
const APPLICANT_CHANNEL_LABELS={whatsapp:'WhatsApp',estados_whatsapp:'Estados de WhatsApp',facebook:'Facebook',facebook_marketplace:'Facebook Marketplace',instagram:'Instagram',tiktok:'TikTok',contactos_personales:'Contactos personales',referidos:'Referidos',venta_presencial:'Venta presencial',otros:'Otros'};
const APPLICANT_AVAILABILITY_LABELS={horas_semana:'Algunas horas por semana','1_2_horas_dia':'1–2 horas por día','3_4_horas_dia':'3–4 horas por día',jornada_completa:'Jornada completa',otro:'Otro'};
const RECRUITMENT_DEMO_ROWS=[{
  id:'demo-postulante-1',nombre:'Postulante',apellido:'de prueba',dni:'30111222',fecha_nacimiento:'1990-05-12',telefono:'5493855550101',email:'postulante.demo@example.com',localidad:'Santiago del Estero',provincia:'Santiago del Estero',ocupacion_actual:'Comerciante',trabaja_actualmente:true,actividad_actual:'Atención al público',experiencia_ventas:true,descripcion_experiencia:'Experiencia de muestra para revisar el diseño.',motivacion:'Quiero ampliar mi actividad comercial con las herramientas de REST.',canales:['whatsapp','facebook_marketplace','contactos_personales'],canales_otros:null,disponibilidad:'1_2_horas_dia',disponibilidad_otro:null,estado:'pendiente',observaciones_internas:null,condiciones_comision:null,vendedor_id:null,creado_en:new Date().toISOString(),vendedores:null
}];
const RECRUITMENT_DEMO_IMAGE='https://gajlmcqaylezudttoaju.supabase.co/storage/v1/object/public/catalogo-productos/1789842808509-3b264070-7291-408b-91d5-9def89b79d36.jpg';

let adminApplicantCache=[];
let adminApplicantHistory=[];
let recruitmentSellerCache=[];
let adminBudgetCache=[];
let sellerBudgetCache=[];
let activeBudgetShare=null;

function recruitmentEscape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function recruitmentDemoMode(){return new URLSearchParams(location.search).get('demo')||''}
function recruitmentIsDemo(){return ['captacion','admin-captacion','presupuesto-captacion'].includes(recruitmentDemoMode())}
function nullableBoolean(value){return value==='true'?true:value==='false'?false:null}
function recruitmentDate(value){if(!value)return '—';const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));return match?`${match[3]}/${match[2]}/${match[1]}`:new Date(value).toLocaleDateString('es-AR')}
function recruitmentDateTime(value){if(!value)return '—';try{return new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(value))}catch{return '—'}}
function applicationStatusBadge(status){return `<span class="badge applicant-status-${recruitmentEscape(status)}">${recruitmentEscape(APPLICANT_STATUS_LABELS[status]||status)}</span>`}

function applyRecruitmentContent(content={}){
  const c={...RECRUITMENT_DEFAULT_CONTENT,...content};
  const map={recruitTitle:c.titulo,recruitLead:c.bajada,recruitPresentation:c.presentacion,recruitHow:c.como_funciona,recruitTools:c.herramientas,recruitModalities:c.modalidades,recruitCommissions:c.comisiones,recruitPayments:c.pago_comisiones};
  Object.entries(map).forEach(([id,value])=>{const node=document.getElementById(id);if(node)node.textContent=value||''});
  const faq=document.getElementById('recruitFaq');
  if(faq){const rows=Array.isArray(c.preguntas_frecuentes)?c.preguntas_frecuentes:[];faq.innerHTML=rows.map(row=>`<details><summary>${recruitmentEscape(row?.pregunta||'Pregunta')}</summary><p>${recruitmentEscape(row?.respuesta||'')}</p></details>`).join('')||'<p class="muted">Administración actualizará próximamente esta información.</p>'}
}

async function bootSellerRecruitment(){
  document.body.classList.add('recruitment-mode');
  ['loginScreen','appScreen','clientRoot','referralRoot'].forEach(id=>document.getElementById(id)?.classList.add('hide'));
  document.getElementById('recruitmentRoot')?.classList.remove('hide');
  applyRecruitmentContent(RECRUITMENT_DEFAULT_CONTENT);
  const notice=document.getElementById('recruitModeNotice');
  if(recruitmentIsDemo()){
    if(notice){notice.textContent='MODO DEMOSTRACIÓN · podés probar el formulario, pero no se guardarán datos.';notice.classList.remove('hide')}
    return;
  }
  try{
    const {data,error}=await sb.rpc('obtener_programa_vendedores_publico');
    if(error)throw error;
    if(data)applyRecruitmentContent(data);
  }catch(error){
    if(notice){notice.textContent='Vista preliminar: el contenido definitivo se habilitará al instalar la migración en el entorno de prueba.';notice.classList.remove('hide')}
  }
}

function recruitmentDemoProduct(){
  const cash=188700,total6=296259,total9=375513;
  return {id:'demo-producto-hogar',nombre:'Armario multiuso Acapulco',categoria:'hogar',subcategoria:'Muebles',precio_contado:cash,imagen_url:RECRUITMENT_DEMO_IMAGE,activo:true,_quote:{credito_personal:[{cuotas:6,total:total6,cuota:total6/6},{cuotas:9,total:total9,cuota:total9/9}]}};
}

function recruitmentDemoBudgetRecord(prospectName='Cliente de muestra'){
  const product=recruitmentDemoProduct(),created=new Date(),valid=new Date(created);valid.setDate(valid.getDate()+7);
  return {id:`demo-presupuesto-${Date.now()}`,codigo:'REST-DEMO-001',estado:'vigente',creado_en:created.toISOString(),vigente_hasta:valid.toISOString().slice(0,10),producto_id:product.id,producto_nombre_snapshot:product.nombre,producto_categoria_snapshot:product.categoria,producto_imagen_url_snapshot:product.imagen_url,precio_contado_snapshot:product.precio_contado,modalidad_snapshot:'Crédito personal',cantidad_cuotas_snapshot:6,valor_cuota_snapshot:49376.5,anticipo_snapshot:0,frecuencia_snapshot:'mensual',total_snapshot:296259,prospecto_nombre:prospectName,prospecto_telefono:'5493855550101',prospecto_email:null,condiciones_snapshot:{title:'Crédito personal · 6 cuotas',total:296259,count:6,value:49376.5,down:0,frequency:'mensual'},vendedores:{nombre:'Vendedor demostración'},clientes:null};
}

function bootRecruitmentAdminDemo(){
  document.body.classList.add('recruitment-admin-demo');
  ['loginScreen','recruitmentRoot','clientRoot','referralRoot','sellerRoot','courierRoot'].forEach(id=>document.getElementById(id)?.classList.add('hide'));
  document.getElementById('appScreen')?.classList.remove('hide');document.getElementById('adminRoot')?.classList.remove('hide');
  if(typeof profile!=='undefined')profile={id:'demo-admin',nombre:'Administración demo',rol:'admin',activo:true};
  const hello=document.getElementById('helloTxt'),role=document.getElementById('roleTxt');if(hello)hello.textContent='Administración · Demostración';if(role)role.textContent='Datos ficticios · no se guarda ningún cambio';
  document.querySelectorAll('#adminRoot .panel').forEach(panel=>panel.classList.add('hide'));document.getElementById('vendedores')?.classList.remove('hide');
  const active=document.getElementById('sellerAdminActive');if(active)active.innerHTML='<div class="card demo-safety"><b>Modo demostración aislado</b><p>Usá las pestañas Postulantes, Presupuestos y Contenido público. Ninguna acción crea usuarios ni modifica la base real.</p><div class="applicant-actions"><a class="btn btn2" href="?postularme=1&demo=captacion">VER LANDING</a><a class="btn" href="?demo=presupuesto-captacion">VER PRESUPUESTO</a></div></div>';
  showSellerAdminView('applicants');loadAdminRecruitment();
}

function bootRecruitmentBudgetDemo(){
  document.body.classList.add('seller-mode','recruitment-budget-demo');
  ['loginScreen','recruitmentRoot','clientRoot','referralRoot','adminRoot','courierRoot'].forEach(id=>document.getElementById(id)?.classList.add('hide'));
  document.getElementById('appScreen')?.classList.remove('hide');document.getElementById('sellerRoot')?.classList.remove('hide');
  if(typeof profile!=='undefined')profile={id:'demo-profile',nombre:'Vendedor demo',rol:'vendedor',activo:true};
  if(typeof seller!=='undefined')seller={id:'demo-seller',nombre:'Vendedor demostración',categoria_actual:'junior',activo:true};
  const greeting=document.getElementById('sellerGreeting');if(greeting)greeting.textContent='Presupuesto · Demostración';
  document.querySelectorAll('.spanel').forEach(panel=>panel.classList.add('hide'));document.getElementById('sellerCatalog')?.classList.remove('hide');
  const heading=document.querySelector('#sellerCatalog .seller-catalog-head');if(heading)heading.insertAdjacentHTML('afterend','<div class="demo-safety"><b>Modo demostración aislado</b><p>El producto y los importes son de muestra. No se consulta ni modifica información operativa.</p><div class="applicant-actions"><a class="btn btn2" href="?postularme=1&demo=captacion">LANDING</a><a class="btn btn2" href="?demo=admin-captacion">ADMINISTRACIÓN</a></div></div>');
  if(typeof allCatalog!=='undefined')allCatalog=[recruitmentDemoProduct()];
  if(typeof refreshSubcategories==='function')refreshSubcategories();if(typeof renderCatalog==='function')renderCatalog();
}

function scrollToSellerApplication(){document.getElementById('sellerApplicationCard')?.scrollIntoView({behavior:'smooth',block:'start'})}

function sellerApplicationPayload(){
  const channels=[...document.querySelectorAll('#appChannels input:checked')].map(input=>input.value);
  return {
    p_nombre:document.getElementById('appFirstName')?.value.trim()||'',
    p_apellido:document.getElementById('appLastName')?.value.trim()||'',
    p_dni:document.getElementById('appDni')?.value.trim()||'',
    p_fecha_nacimiento:document.getElementById('appBirthDate')?.value||null,
    p_telefono:document.getElementById('appPhone')?.value.trim()||'',
    p_email:document.getElementById('appEmail')?.value.trim().toLowerCase()||'',
    p_localidad:document.getElementById('appCity')?.value.trim()||'',
    p_provincia:document.getElementById('appProvince')?.value.trim()||'',
    p_ocupacion_actual:document.getElementById('appOccupation')?.value.trim()||null,
    p_trabaja_actualmente:nullableBoolean(document.getElementById('appWorks')?.value),
    p_actividad_actual:document.getElementById('appCurrentActivity')?.value.trim()||null,
    p_experiencia_ventas:nullableBoolean(document.getElementById('appSalesExperience')?.value),
    p_descripcion_experiencia:document.getElementById('appExperienceDetail')?.value.trim()||null,
    p_motivacion:document.getElementById('appMotivation')?.value.trim()||'',
    p_canales:channels,
    p_canales_otros:document.getElementById('appOtherChannels')?.value.trim()||null,
    p_disponibilidad:document.getElementById('appAvailability')?.value||'',
    p_disponibilidad_otro:document.getElementById('appOtherAvailability')?.value.trim()||null,
    p_sitio_web:document.getElementById('appWebsite')?.value||null
  };
}

function validateSellerApplication(payload){
  const errors=[];
  const digits=value=>String(value||'').replace(/\D/g,'');
  if(String(payload.p_nombre||'').trim().length<2)errors.push('Ingresá tu nombre.');
  if(String(payload.p_apellido||'').trim().length<2)errors.push('Ingresá tu apellido.');
  if(!/^\d{6,9}$/.test(digits(payload.p_dni)))errors.push('Ingresá un DNI válido.');
  if(digits(payload.p_telefono).length<10||digits(payload.p_telefono).length>15)errors.push('Ingresá un WhatsApp válido con código de área.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(payload.p_email||'')))errors.push('Ingresá un email válido.');
  if(String(payload.p_localidad||'').trim().length<2)errors.push('Ingresá tu localidad.');
  if(String(payload.p_provincia||'').trim().length<2)errors.push('Ingresá tu provincia.');
  if(payload.p_fecha_nacimiento&&payload.p_fecha_nacimiento>new Date().toISOString().slice(0,10))errors.push('Revisá la fecha de nacimiento.');
  if(String(payload.p_motivacion||'').trim().length<10)errors.push('Contanos brevemente por qué te interesa vender para REST.');
  if(!Array.isArray(payload.p_canales)||!payload.p_canales.length)errors.push('Elegí al menos un canal de venta.');
  if(!Object.prototype.hasOwnProperty.call(APPLICANT_AVAILABILITY_LABELS,payload.p_disponibilidad))errors.push('Elegí cuánto tiempo pensás dedicar.');
  return {ok:errors.length===0,errors};
}

async function submitSellerApplication(event){
  event?.preventDefault();
  const payload=sellerApplicationPayload(),validation=validateSellerApplication(payload),status=document.getElementById('sellerApplicationStatus'),button=document.getElementById('sellerApplicationSubmit');
  if(!status||!button)return;
  status.classList.remove('hide','ok','error');
  if(!validation.ok){status.classList.add('error');status.innerHTML=validation.errors.map(error=>`<div>• ${recruitmentEscape(error)}</div>`).join('');return}
  button.disabled=true;status.classList.add('ok');status.textContent='Enviando tu solicitud...';
  try{
    if(!recruitmentIsDemo()){
      const {data,error}=await sb.rpc('enviar_postulacion_vendedor',payload);
      if(error)throw error;
      if(!data?.ok)throw new Error('No se pudo registrar la solicitud.');
    }
    document.getElementById('sellerApplicationFormWrap')?.classList.add('hide');
    document.getElementById('sellerApplicationSuccess')?.classList.remove('hide');
    window.scrollTo({top:document.getElementById('sellerApplicationCard')?.offsetTop||0,behavior:'smooth'});
  }catch(error){status.classList.remove('ok');status.classList.add('error');status.textContent=error?.message||'No se pudo enviar. Intentá nuevamente.';button.disabled=false}
}

function initRecruitmentUi(){
  document.getElementById('sellerApplicationForm')?.addEventListener('submit',submitSellerApplication);
  document.querySelectorAll('[data-seller-admin-view]').forEach(button=>button.addEventListener('click',()=>showSellerAdminView(button.dataset.sellerAdminView)));
  document.getElementById('applicantSearch')?.addEventListener('input',renderAdminApplicants);
  document.getElementById('applicantStatusFilter')?.addEventListener('change',renderAdminApplicants);
}

function showSellerAdminView(view){
  document.querySelectorAll('.seller-admin-view').forEach(section=>section.classList.add('hide'));
  document.querySelectorAll('[data-seller-admin-view]').forEach(button=>button.classList.toggle('btn2',button.dataset.sellerAdminView!==view));
  const target={active:'sellerAdminActive',applicants:'sellerAdminApplicants',budgets:'sellerAdminBudgets',content:'sellerAdminContent'}[view]||'sellerAdminActive';
  document.getElementById(target)?.classList.remove('hide');
  if(view==='applicants'||view==='content')loadAdminRecruitment();
  if(view==='budgets')loadAdminBudgets();
}

function recruitmentSchemaMissing(error){return /does not exist|schema cache|Could not find|PGRST/i.test(String(error?.message||''))}
async function loadAdminRecruitment(){
  if(typeof profile!=='undefined'&&profile?.rol!=='admin')return;
  const list=document.getElementById('applicantList');if(list)list.innerHTML='<p class="muted">Cargando postulantes...</p>';
  if(recruitmentIsDemo()){
    adminApplicantCache=RECRUITMENT_DEMO_ROWS.map(row=>({...row}));recruitmentSellerCache=[];renderAdminApplicants();fillRecruitmentContentEditor(RECRUITMENT_DEFAULT_CONTENT);return;
  }
  const [applicants,content,sellers]=await Promise.all([
    sb.from('postulantes_vendedores').select('*,vendedores(id,nombre,activo,user_id)').order('creado_en',{ascending:false}),
    sb.from('programa_vendedores_config').select('*').eq('id','principal').maybeSingle(),
    sb.from('vendedores').select('id,nombre,dni,telefono,activo,user_id').order('nombre')
  ]);
  if(applicants.error){
    if(list)list.innerHTML=`<p class="muted">${recruitmentSchemaMissing(applicants.error)?'La migración de captación todavía no está instalada en este entorno de prueba.':'No pude cargar postulantes: '+recruitmentEscape(applicants.error.message)}</p>`;
    return;
  }
  adminApplicantCache=applicants.data||[];recruitmentSellerCache=sellers.data||[];renderAdminApplicants();
  if(content.data)fillRecruitmentContentEditor(content.data);
}

function renderAdminApplicants(){
  const list=document.getElementById('applicantList');if(!list)return;
  const query=String(document.getElementById('applicantSearch')?.value||'').trim().toLowerCase(),status=document.getElementById('applicantStatusFilter')?.value||'';
  const rows=adminApplicantCache.filter(row=>(!status||row.estado===status)&&(!query||`${row.nombre} ${row.apellido} ${row.dni} ${row.email} ${row.telefono} ${row.localidad}`.toLowerCase().includes(query)));
  const pending=adminApplicantCache.filter(row=>row.estado==='pendiente').length;
  if(document.getElementById('applicantPendingBadge'))document.getElementById('applicantPendingBadge').textContent=pending;
  if(document.getElementById('applicantCount'))document.getElementById('applicantCount').textContent=`${rows.length} postulante${rows.length===1?'':'s'}`;
  list.innerHTML=rows.map(row=>`<article class="applicant-card"><div class="applicant-head"><div><h4>${recruitmentEscape(row.nombre)} ${recruitmentEscape(row.apellido)}</h4><div class="muted">${recruitmentEscape(row.localidad)}, ${recruitmentEscape(row.provincia)} · ${recruitmentDateTime(row.creado_en)}</div></div>${applicationStatusBadge(row.estado)}</div><div class="applicant-meta"><div><b>WhatsApp</b>${recruitmentEscape(row.telefono)}</div><div><b>Email</b>${recruitmentEscape(row.email)}</div><div><b>Canales</b>${(row.canales||[]).map(value=>recruitmentEscape(APPLICANT_CHANNEL_LABELS[value]||value)).join(', ')||'—'}</div></div><div class="applicant-actions"><button class="btn btn2" type="button" onclick="openAdminApplicant('${row.id}')">VER FICHA</button>${row.telefono?`<button class="btn good" type="button" onclick="openApplicantWhatsApp('${row.id}')">WHATSAPP</button>`:''}</div></article>`).join('')||'<p class="muted">No hay postulantes con ese filtro.</p>';
}

async function openAdminApplicant(id){
  const row=adminApplicantCache.find(item=>item.id===id),detail=document.getElementById('applicantDetail');if(!row||!detail)return;
  detail.classList.remove('hide');detail.innerHTML='<p class="muted">Cargando ficha...</p>';detail.scrollIntoView({behavior:'smooth',block:'start'});
  if(recruitmentIsDemo())adminApplicantHistory=[{id:1,estado_anterior:null,estado_nuevo:'pendiente',creado_en:row.creado_en,detalle:{origen:'demostracion'}}];
  else{const {data,error}=await sb.from('postulantes_vendedores_historial').select('*').eq('postulante_id',id).order('creado_en',{ascending:false});adminApplicantHistory=error?[]:(data||[])}
  const actions=[];
  if(row.estado==='pendiente')actions.push(`<button class="btn btn2" onclick="adminUpdateApplicantState('${id}','contactado')">MARCAR CONTACTADO</button>`);
  if(['pendiente','contactado'].includes(row.estado))actions.push(`<button class="btn good" onclick="adminUpdateApplicantState('${id}','aprobado')">APROBAR</button><button class="btn danger" onclick="adminUpdateApplicantState('${id}','rechazado')">RECHAZAR</button>`);
  if(row.estado==='activo')actions.push(`<button class="btn warn" onclick="changeApplicantAccess('${id}','suspendido')">SUSPENDER ACCESO</button>`);
  if(row.estado==='suspendido')actions.push(`<button class="btn good" onclick="changeApplicantAccess('${id}','activo')">REACTIVAR ACCESO</button>`);
  const bool=value=>value===true?'Sí':value===false?'No':'No informado';
  const linkedSellerIds=new Set(adminApplicantCache.map(item=>item.vendedor_id).filter(Boolean));
  const existingOptions=recruitmentSellerCache.filter(sellerRow=>sellerRow.user_id&&!linkedSellerIds.has(sellerRow.id)).map(sellerRow=>`<option value="${sellerRow.id}">${recruitmentEscape(sellerRow.nombre)}${sellerRow.dni?' · DNI '+recruitmentEscape(sellerRow.dni):''}</option>`).join('');
  const activation=row.estado==='aprobado'?`<div class="card"><h3>Activar como vendedor</h3><p class="muted">Se reutiliza el alta segura existente. La contraseña se envía a Supabase Auth y no se guarda en tablas ni en la postulación.</p><input id="activateEmail_${id}" class="input" type="email" value="${recruitmentEscape(row.email)}" placeholder="Email de acceso"><div class="row stack"><input id="activatePassword_${id}" class="input" type="password" autocomplete="new-password" placeholder="Contraseña provisoria segura"><button class="btn btn2" type="button" onclick="generateApplicantPassword('${id}')">GENERAR</button></div><select id="activateCategory_${id}" class="input"><option value="junior">Junior</option><option value="pro">Pro</option><option value="experto">Experto</option><option value="master">Master</option></select><textarea id="activateConditions_${id}" class="input" maxlength="2000" placeholder="Condiciones de comisión aplicables">${recruitmentEscape(row.condiciones_comision||'')}</textarea><label><input id="activateEnabled_${id}" type="checkbox" checked> Dejar acceso activo</label><button class="btn good full" type="button" onclick="activateApplicantSeller('${id}')">CREAR ACCESO Y VINCULAR</button>${existingOptions?`<hr style="border:0;border-top:1px solid #e1e7ef;margin:17px 0"><p class="muted">Si el vendedor ya existe, vinculalo sin crear otro usuario.</p><select id="existingSeller_${id}" class="input"><option value="">Elegir vendedor existente</option>${existingOptions}</select><button class="btn btn2 full" type="button" onclick="linkExistingApplicantSeller('${id}')">VINCULAR EXISTENTE</button>`:''}<p id="activateStatus_${id}" class="muted"></p></div>`:'';
  detail.innerHTML=`<div class="applicant-head"><div><h3 style="margin:0">${recruitmentEscape(row.nombre)} ${recruitmentEscape(row.apellido)}</h3><div class="muted">Postulación ${recruitmentDateTime(row.creado_en)}</div></div><div>${applicationStatusBadge(row.estado)} <button class="btn btn2" type="button" onclick="closeAdminApplicant()">CERRAR</button></div></div><div class="applicant-detail-grid"><div><b>DNI</b>${recruitmentEscape(row.dni)}</div><div><b>Nacimiento</b>${recruitmentDate(row.fecha_nacimiento)}</div><div><b>WhatsApp</b>${recruitmentEscape(row.telefono)}</div><div><b>Email</b>${recruitmentEscape(row.email)}</div><div><b>Localidad</b>${recruitmentEscape(row.localidad)}</div><div><b>Provincia</b>${recruitmentEscape(row.provincia)}</div><div><b>Ocupación</b>${recruitmentEscape(row.ocupacion_actual||'—')}</div><div><b>Trabaja actualmente</b>${bool(row.trabaja_actualmente)}</div><div><b>Actividad</b>${recruitmentEscape(row.actividad_actual||'—')}</div><div><b>Experiencia en ventas</b>${bool(row.experiencia_ventas)}</div><div><b>Disponibilidad</b>${recruitmentEscape(APPLICANT_AVAILABILITY_LABELS[row.disponibilidad]||row.disponibilidad||'—')}</div><div><b>Canales</b>${(row.canales||[]).map(value=>recruitmentEscape(APPLICANT_CHANNEL_LABELS[value]||value)).join(', ')||'—'}</div></div><div class="card"><b>Experiencia</b><p>${recruitmentEscape(row.descripcion_experiencia||'No informada')}</p><b>Motivación</b><p>${recruitmentEscape(row.motivacion||'—')}</p></div><div class="card"><label for="applicantNotes_${id}"><b>Observaciones internas</b></label><textarea id="applicantNotes_${id}" class="input" maxlength="4000" rows="4">${recruitmentEscape(row.observaciones_internas||'')}</textarea><label for="applicantConditions_${id}"><b>Condiciones de comisión</b></label><textarea id="applicantConditions_${id}" class="input" maxlength="2000" rows="3">${recruitmentEscape(row.condiciones_comision||'')}</textarea><button class="btn btn2" type="button" onclick="saveApplicantNotes('${id}')">GUARDAR NOTAS</button><div class="applicant-actions" style="margin-top:9px">${actions.join('')}</div><p id="applicantActionStatus_${id}" class="muted"></p></div>${activation}<div class="card"><h3>Trazabilidad</h3><div class="applicant-timeline">${adminApplicantHistory.map(event=>`<div><b>${recruitmentEscape(APPLICANT_STATUS_LABELS[event.estado_nuevo]||event.estado_nuevo)}</b><br><span class="muted">${recruitmentDateTime(event.creado_en)} · ${recruitmentEscape(event.detalle?.origen||'Administración')}</span></div>`).join('')||'<p class="muted">Sin cambios registrados.</p>'}</div></div>`;
}

function closeAdminApplicant(){const detail=document.getElementById('applicantDetail');if(detail){detail.classList.add('hide');detail.innerHTML=''}}
function openApplicantWhatsApp(id){const row=adminApplicantCache.find(item=>item.id===id);if(!row)return;const phone=String(row.telefono||'').replace(/\D/g,'');if(phone.length<10)return alert('El número no es válido.');window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${row.nombre}, te contactamos de REST por tu postulación como vendedor/a freelance.`)}`,'_blank','noopener')}

async function adminUpdateApplicantState(id,state){
  const row=adminApplicantCache.find(item=>item.id===id);if(!row)return;
  if(state==='rechazado'&&!confirm('¿Rechazar esta postulación? El postulante no recibirá acceso.'))return;
  const observations=document.getElementById(`applicantNotes_${id}`)?.value||null,conditions=document.getElementById(`applicantConditions_${id}`)?.value||null,status=document.getElementById(`applicantActionStatus_${id}`);
  if(recruitmentIsDemo()){if(state)row.estado=state;row.observaciones_internas=observations;row.condiciones_comision=conditions;renderAdminApplicants();await openAdminApplicant(id);return}
  if(status)status.textContent='Guardando...';
  const {error}=await sb.rpc('actualizar_postulante_vendedor',{p_postulante_id:id,p_estado:state,p_observaciones:observations,p_condiciones_comision:conditions});
  if(error){if(status)status.textContent=error.message;return}
  await loadAdminRecruitment();await openAdminApplicant(id);
}

async function saveApplicantNotes(id){await adminUpdateApplicantState(id,null)}
function secureTemporaryPassword(length=16){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';const bytes=new Uint32Array(length);crypto.getRandomValues(bytes);return [...bytes].map(value=>chars[value%chars.length]).join('')}
function generateApplicantPassword(id){const input=document.getElementById(`activatePassword_${id}`);if(input){input.type='text';input.value=secureTemporaryPassword();input.focus();input.select()}}

async function activateApplicantSeller(id){
  const row=adminApplicantCache.find(item=>item.id===id),status=document.getElementById(`activateStatus_${id}`);if(!row||!status)return;
  const email=document.getElementById(`activateEmail_${id}`)?.value.trim().toLowerCase(),password=document.getElementById(`activatePassword_${id}`)?.value||'',category=document.getElementById(`activateCategory_${id}`)?.value||'junior',conditions=document.getElementById(`activateConditions_${id}`)?.value.trim()||null,enabled=document.getElementById(`activateEnabled_${id}`)?.checked!==false;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email||''))return status.textContent='Ingresá un email válido.';
  if(password.length<10)return status.textContent='Usá una contraseña provisoria de al menos 10 caracteres.';
  if(recruitmentIsDemo())return status.textContent='Modo demostración: no se crean usuarios reales.';
  status.textContent='Creando acceso seguro...';
  const created=await sb.functions.invoke('crear-vendedor',{body:{nombre:`${row.nombre} ${row.apellido}`.trim(),email,password,dni:row.dni,telefono:row.telefono,categoria_inicial:category}});
  if(created.error||created.data?.error){status.textContent=created.data?.error||created.error.message;return}
  const sellerRow=created.data?.vendedor;if(!sellerRow?.id){status.textContent='El acceso se creó, pero no pude identificar el vendedor. Revisá el equipo antes de reintentar.';return}
  const linked=await sb.rpc('vincular_postulante_vendedor',{p_postulante_id:id,p_vendedor_id:sellerRow.id,p_condiciones_comision:conditions});
  if(linked.error){status.textContent='El vendedor fue creado, pero falta vincularlo: '+linked.error.message;return}
  document.getElementById(`activatePassword_${id}`).value='';
  if(!enabled){
    const suspended=await sb.functions.invoke('gestionar-vendedor',{body:{vendedor_id:sellerRow.id,accion:'suspender'}});
    if(suspended.error||suspended.data?.error){status.textContent='Se vinculó activo, pero no se pudo suspender: '+(suspended.data?.error||suspended.error.message);return}
    const marked=await sb.rpc('actualizar_postulante_vendedor',{p_postulante_id:id,p_estado:'suspendido',p_observaciones:null,p_condiciones_comision:conditions});
    if(marked.error){status.textContent='El acceso está suspendido, pero falta actualizar la ficha: '+marked.error.message;return}
  }
  status.textContent='Vendedor vinculado correctamente.';await loadAdmin();await loadAdminRecruitment();await openAdminApplicant(id);
}

async function linkExistingApplicantSeller(id){
  const sellerId=document.getElementById(`existingSeller_${id}`)?.value,status=document.getElementById(`activateStatus_${id}`),conditions=document.getElementById(`activateConditions_${id}`)?.value.trim()||null;
  if(!sellerId)return status.textContent='Elegí un vendedor existente.';
  if(recruitmentIsDemo())return status.textContent='Modo demostración: no se modifica ningún vendedor.';
  const {error}=await sb.rpc('vincular_postulante_vendedor',{p_postulante_id:id,p_vendedor_id:sellerId,p_condiciones_comision:conditions});
  if(error){status.textContent=error.message;return}await loadAdminRecruitment();await openAdminApplicant(id);
}

async function changeApplicantAccess(id,state){
  const row=adminApplicantCache.find(item=>item.id===id);if(!row?.vendedor_id)return alert('La postulación no está vinculada a un vendedor.');
  if(!confirm(`¿${state==='suspendido'?'Suspender':'Reactivar'} el acceso de ${row.nombre}?`))return;
  if(recruitmentIsDemo()){row.estado=state;renderAdminApplicants();return openAdminApplicant(id)}
  const action=state==='suspendido'?'suspender':'reactivar',managed=await sb.functions.invoke('gestionar-vendedor',{body:{vendedor_id:row.vendedor_id,accion:action}});
  if(managed.error||managed.data?.error)return alert(managed.data?.error||managed.error.message);
  const {error}=await sb.rpc('actualizar_postulante_vendedor',{p_postulante_id:id,p_estado:state,p_observaciones:null,p_condiciones_comision:null});
  if(error)return alert('El acceso cambió, pero la ficha no pudo actualizarse: '+error.message);
  await loadAdmin();await loadAdminRecruitment();await openAdminApplicant(id);
}

function fillRecruitmentContentEditor(content){
  const fields={programTitle:content.titulo,programLead:content.bajada,programPresentation:content.presentacion,programHow:content.como_funciona,programTools:content.herramientas,programModalities:content.modalidades,programCommissions:content.comisiones,programPayments:content.pago_comisiones,programFaq:JSON.stringify(content.preguntas_frecuentes||[],null,2)};
  Object.entries(fields).forEach(([id,value])=>{const input=document.getElementById(id);if(input)input.value=value||''});
}

async function saveRecruitmentContent(){
  const status=document.getElementById('programContentStatus');let faq;
  try{faq=JSON.parse(document.getElementById('programFaq')?.value||'[]');if(!Array.isArray(faq))throw new Error()}catch{return status.textContent='Las preguntas frecuentes deben ser una lista JSON válida.'}
  const content={titulo:document.getElementById('programTitle')?.value.trim(),bajada:document.getElementById('programLead')?.value.trim(),presentacion:document.getElementById('programPresentation')?.value.trim(),como_funciona:document.getElementById('programHow')?.value.trim(),herramientas:document.getElementById('programTools')?.value.trim(),modalidades:document.getElementById('programModalities')?.value.trim(),comisiones:document.getElementById('programCommissions')?.value.trim(),pago_comisiones:document.getElementById('programPayments')?.value.trim(),preguntas_frecuentes:faq};
  if(recruitmentIsDemo())return status.textContent='Modo demostración: los cambios no se guardan.';
  status.textContent='Guardando...';const {error}=await sb.rpc('actualizar_programa_vendedores',{p_contenido:content});status.textContent=error?error.message:'Contenido actualizado.';
}

function budgetCurrency(value){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value)||0)}
function budgetStatus(record){if(record.estado==='convertido')return {key:'converted',label:'Convertido en venta'};if(record.estado==='anulado')return {key:'expired',label:'Anulado'};const today=typeof financeTodayArgentina==='function'?financeTodayArgentina():new Date().toISOString().slice(0,10);return record.vigente_hasta<today?{key:'expired',label:'Vencido'}:{key:'current',label:'Vigente'}}
function budgetPaymentLabel(record,quote={}){const count=Number(record.cantidad_cuotas_snapshot??quote.count??0),value=Number(record.valor_cuota_snapshot??quote.value??0),down=Number(record.anticipo_snapshot??quote.down??0),frequency=(record.frecuencia_snapshot||quote.frequency)==='semanal'?'semanales':'mensuales';if(!count)return 'Pago de contado';if(down>0)return `Anticipo ${budgetCurrency(down)} + ${count} cuotas ${frequency} de ${budgetCurrency(value)}`;return `${record.modalidad_snapshot||quote.title||'Financiación'} · ${count} cuotas de ${budgetCurrency(value)}`}
function budgetShareText(record,quote){const client=record.prospecto_nombre?`Para: ${record.prospecto_nombre}\n`:'';return `REST · Presupuesto ${record.codigo}\n${client}${record.producto_nombre_snapshot}\n${budgetPaymentLabel(record,quote)}\nTotal: ${budgetCurrency(quote.total||record.total_snapshot)}\nVigente hasta: ${recruitmentDate(record.vigente_hasta)}\nVendedor: ${typeof seller!=='undefined'&&seller?.nombre?seller.nombre:'REST'}`}

function openQuoteBudgetComposer(){
  if(typeof seller==='undefined'||!seller?.id)return alert('Ingresá como vendedor para generar un presupuesto.');
  if(typeof selectedCatalogProduct==='undefined'||!selectedCatalogProduct||typeof currentQuote==='undefined'||!currentQuote)return alert('Primero calculá una cotización.');
  if(!['hogar','celulares'].includes(selectedCatalogProduct.categoria))return alert('El presupuesto con imagen de APP INTEGRAL REST está habilitado únicamente para Hogar y Celulares.');
  document.getElementById('budgetComposer')?.remove();
  const node=document.createElement('section');node.id='budgetComposer';node.className='budget-composer';node.innerHTML=`<h3>Generar presupuesto</h3><p class="muted">Se guardará una copia histórica del producto, precio y plan calculado.</p><div class="budget-form-grid"><div class="wide"><label for="budgetProspectName">Cliente o prospecto</label><input id="budgetProspectName" class="input" maxlength="160" placeholder="Nombre y apellido (opcional)"></div><div><label for="budgetProspectPhone">WhatsApp</label><input id="budgetProspectPhone" class="input" maxlength="40" inputmode="tel" placeholder="Opcional"></div><div><label for="budgetProspectEmail">Email</label><input id="budgetProspectEmail" class="input" maxlength="254" type="email" placeholder="Opcional"></div><div><label for="budgetValidity">Vigencia</label><select id="budgetValidity" class="input"><option value="3">3 días</option><option value="7" selected>7 días</option><option value="15">15 días</option><option value="30">30 días</option></select></div></div><div class="budget-preview-card"><small>REST · ${recruitmentEscape(currentQuote.title)}</small><h3>${recruitmentEscape(selectedCatalogProduct.nombre)}</h3><div class="quote-main">${recruitmentEscape(currentQuote.paymentText)}</div><div>Total: <b>${budgetCurrency(currentQuote.total)}</b></div></div><button id="createBudgetBtn" class="btn good full" type="button" onclick="createTraceableBudget()">GUARDAR Y PREPARAR IMAGEN</button><button class="btn btn2 full" type="button" onclick="document.getElementById('budgetComposer')?.remove()">CANCELAR</button><p id="budgetComposerStatus" class="muted"></p>`;
  document.getElementById('qResult')?.insertAdjacentElement('afterend',node);node.scrollIntoView({behavior:'smooth',block:'start'});
}

async function createTraceableBudget(){
  const status=document.getElementById('budgetComposerStatus'),button=document.getElementById('createBudgetBtn');if(!status||!button||!selectedCatalogProduct||!currentQuote)return;
  const prospectName=document.getElementById('budgetProspectName')?.value.trim()||null,prospectPhone=document.getElementById('budgetProspectPhone')?.value.trim()||null,prospectEmail=document.getElementById('budgetProspectEmail')?.value.trim().toLowerCase()||null;
  if(prospectEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(prospectEmail))return status.textContent='Revisá el email del prospecto.';
  if(prospectPhone){const digits=prospectPhone.replace(/\D/g,'');if(digits.length<8||digits.length>15)return status.textContent='Revisá el WhatsApp del prospecto.'}
  button.disabled=true;status.textContent='Validando precio y plan en REST...';
  const params={p_producto_id:selectedCatalogProduct.id,p_modalidad:document.getElementById('qMode')?.value||currentQuote.plan?.formaPago,p_cuotas:Number(document.getElementById('qInstall')?.value||currentQuote.plan?.count||0),p_anticipo:Number(currentQuote.down||0),p_prospecto_nombre:prospectName,p_prospecto_telefono:prospectPhone,p_prospecto_email:prospectEmail,p_vigencia_dias:Number(document.getElementById('budgetValidity')?.value||7),p_cliente_id:null};
  let data,error;
  if(recruitmentIsDemo()){
    const valid=new Date();valid.setDate(valid.getDate()+params.p_vigencia_dias);
    const record={...recruitmentDemoBudgetRecord(prospectName||'Cliente de muestra'),id:`demo-presupuesto-${Date.now()}`,codigo:`REST-DEMO-${String(sellerBudgetCache.length+1).padStart(3,'0')}`,vigente_hasta:valid.toISOString().slice(0,10),producto_nombre_snapshot:selectedCatalogProduct.nombre,producto_categoria_snapshot:selectedCatalogProduct.categoria,producto_imagen_url_snapshot:selectedCatalogProduct.imagen_url,precio_contado_snapshot:Number(selectedCatalogProduct.precio_contado||0),modalidad_snapshot:params.p_modalidad,cantidad_cuotas_snapshot:Number(params.p_cuotas||0),valor_cuota_snapshot:Number(currentQuote.plan?.value||0),anticipo_snapshot:Number(currentQuote.down||0),frecuencia_snapshot:currentQuote.plan?.frequency||'mensual',total_snapshot:Number(currentQuote.total||0),prospecto_nombre:prospectName,prospecto_telefono:prospectPhone,prospecto_email:prospectEmail,condiciones_snapshot:{...currentQuote,...currentQuote.plan,title:currentQuote.title,total:Number(currentQuote.total||0),down:Number(currentQuote.down||0)}};
    data={presupuesto:record,cotizacion:record.condiciones_snapshot};sellerBudgetCache.unshift(record);
  }else({data,error}=await sb.rpc('crear_presupuesto_vendedor',params));
  if(error){status.textContent=recruitmentSchemaMissing(error)?'La migración de presupuestos todavía no está instalada en este entorno de prueba.':error.message;button.disabled=false;return}
  const record=data?.presupuesto,quote=data?.cotizacion;if(!record||!quote){status.textContent='REST no devolvió el presupuesto completo.';button.disabled=false;return}
  activeBudgetShare={record,quote,blob:null,previewUrl:null};status.className='recruit-status ok';status.innerHTML=`<b>✓ Presupuesto ${recruitmentEscape(record.codigo)} guardado.</b><br>El precio quedó congelado en este documento.<div id="budgetImagePreview" class="budget-image-preview"><span>Preparando vista previa...</span></div><div class="budget-share-actions" style="margin-top:10px"><button class="btn" type="button" onclick="shareActiveBudgetImage()">COMPARTIR IMAGEN</button><button class="btn btn2" type="button" onclick="downloadActiveBudgetImage()">DESCARGAR IMAGEN</button><button class="btn good" type="button" onclick="shareActiveBudgetWhatsApp()">WHATSAPP</button><button class="btn btn2" type="button" onclick="copyActiveBudgetText()">COPIAR TEXTO</button></div><p style="font-size:12px;margin:9px 0 0">WhatsApp no permite adjuntar un archivo automáticamente desde el navegador. “Compartir imagen” abre el menú nativo para elegir WhatsApp cuando el dispositivo lo admite.</p>`;await loadSellerBudgets();await previewActiveBudgetImage();
}

function canvasRoundedRect(ctx,x,y,width,height,radius){const r=Math.min(radius,width/2,height/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath()}
function canvasWrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){const words=String(text||'').split(/\s+/);let line='',lines=[];for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word}else line=test}if(line)lines.push(line);lines=lines.slice(0,maxLines);lines.forEach((value,index)=>ctx.fillText(value,x,y+index*lineHeight));return y+lines.length*lineHeight}
function loadCanvasImage(url){return new Promise((resolve,reject)=>{if(!url)return reject(new Error('Sin imagen'));const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=reject;image.src=url})}
async function createBudgetImageBlob(record,quote){
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,1080,1350);gradient.addColorStop(0,'#062d6d');gradient.addColorStop(.62,'#0b62bf');gradient.addColorStop(1,'#18a5ad');ctx.fillStyle=gradient;ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle='#ffffff';ctx.font='900 58px Arial';ctx.fillText('REST',70,102);ctx.font='700 25px Arial';ctx.fillStyle='#d9ebff';ctx.fillText('PRESUPUESTO COMERCIAL',70,143);
  ctx.fillStyle='#ffffff';canvasRoundedRect(ctx,55,190,970,1090,34);ctx.fill();
  ctx.fillStyle='#f3f7fc';canvasRoundedRect(ctx,95,230,890,475,24);ctx.fill();
  try{const image=await loadCanvasImage(record.producto_imagen_url_snapshot);const scale=Math.min(780/image.width,405/image.height),w=image.width*scale,h=image.height*scale;ctx.drawImage(image,540-w/2,265+(405-h)/2,w,h)}catch{ctx.fillStyle='#91a3ba';ctx.font='700 28px Arial';ctx.textAlign='center';ctx.fillText('Imagen del catálogo no disponible',540,470);ctx.textAlign='left'}
  ctx.fillStyle='#0b4fa8';ctx.font='800 24px Arial';ctx.fillText(record.producto_categoria_snapshot==='hogar'?'HOGAR':'CELULARES',95,765);
  ctx.fillStyle='#13213d';ctx.font='900 48px Arial';let y=canvasWrapText(ctx,record.producto_nombre_snapshot,95,830,890,57,3);
  ctx.fillStyle='#5d6d84';ctx.font='700 25px Arial';ctx.fillText(quote.title||record.modalidad_snapshot,95,y+18);y+=72;
  ctx.fillStyle='#0b4fa8';ctx.font='900 43px Arial';y=canvasWrapText(ctx,budgetPaymentLabel(record,quote),95,y,890,52,3)+14;
  ctx.fillStyle='#13213d';ctx.font='900 37px Arial';ctx.fillText(`Total ${budgetCurrency(quote.total||record.total_snapshot)}`,95,y);y+=55;
  if(record.prospecto_nombre){ctx.fillStyle='#5d6d84';ctx.font='700 23px Arial';ctx.fillText(`Preparado para ${record.prospecto_nombre}`,95,y);y+=38}
  ctx.strokeStyle='#dce5f0';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(95,1160);ctx.lineTo(985,1160);ctx.stroke();
  ctx.fillStyle='#5d6d84';ctx.font='700 21px Arial';ctx.fillText(`${record.codigo} · Vigente hasta ${recruitmentDate(record.vigente_hasta)}`,95,1205);ctx.fillText(`Vendedor: ${typeof seller!=='undefined'&&seller?.nombre?seller.nombre:'REST'}`,95,1240);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo generar la imagen.')),'image/png',1));
}

async function ensureActiveBudgetBlob(){if(!activeBudgetShare)throw new Error('Elegí un presupuesto.');if(!activeBudgetShare.blob)activeBudgetShare.blob=await createBudgetImageBlob(activeBudgetShare.record,activeBudgetShare.quote);return activeBudgetShare.blob}
async function previewActiveBudgetImage(){const target=document.getElementById('budgetImagePreview');if(!target||!activeBudgetShare)return;try{const blob=await ensureActiveBudgetBlob();if(activeBudgetShare.previewUrl)URL.revokeObjectURL(activeBudgetShare.previewUrl);activeBudgetShare.previewUrl=URL.createObjectURL(blob);target.innerHTML=`<img src="${activeBudgetShare.previewUrl}" alt="Vista previa del presupuesto ${recruitmentEscape(activeBudgetShare.record.codigo)}"><a class="btn btn2" href="${activeBudgetShare.previewUrl}" download="${recruitmentEscape(activeBudgetShare.record.codigo)}.png">DESCARGAR ESTA IMAGEN</a>`}catch(error){target.innerHTML=`<span>No se pudo preparar la vista previa: ${recruitmentEscape(error.message)}</span>`}}
async function downloadActiveBudgetImage(){try{const blob=await ensureActiveBudgetBlob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${activeBudgetShare.record.codigo}.png`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}catch(error){alert(error.message)}}
async function shareActiveBudgetImage(){try{const blob=await ensureActiveBudgetBlob(),file=new File([blob],`${activeBudgetShare.record.codigo}.png`,{type:'image/png'}),data={title:'Presupuesto REST',text:budgetShareText(activeBudgetShare.record,activeBudgetShare.quote),files:[file]};if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share(data)}else{await downloadActiveBudgetImage();alert('La imagen se descargó. Podés adjuntarla desde WhatsApp, Estados, Facebook o Marketplace.')}}catch(error){if(error?.name!=='AbortError')alert(error.message)}}
function shareActiveBudgetWhatsApp(){if(!activeBudgetShare)return;window.open(`https://wa.me/?text=${encodeURIComponent(budgetShareText(activeBudgetShare.record,activeBudgetShare.quote))}`,'_blank','noopener')}
async function copyActiveBudgetText(){if(!activeBudgetShare)return;const text=budgetShareText(activeBudgetShare.record,activeBudgetShare.quote);try{await navigator.clipboard.writeText(text);alert('Texto del presupuesto copiado.')}catch{prompt('Copiá el texto:',text)}}

async function loadSellerBudgets(){
  const list=document.getElementById('sellerBudgetList');if(!list||typeof seller==='undefined'||!seller?.id)return;
  if(recruitmentIsDemo()){renderSellerBudgetHistory(list);return}
  const {data,error}=await sb.from('presupuestos').select('*').order('creado_en',{ascending:false}).limit(50);
  if(error){list.innerHTML=`<p class="muted">${recruitmentSchemaMissing(error)?'El historial se habilitará al instalar la migración de presupuestos.':recruitmentEscape(error.message)}</p>`;return}
  sellerBudgetCache=data||[];renderSellerBudgetHistory(list);
}

function renderSellerBudgetHistory(list){list.innerHTML=sellerBudgetCache.map(record=>{const state=budgetStatus(record);return `<article class="budget-history-card"><h4>${recruitmentEscape(record.producto_nombre_snapshot)}</h4><div class="muted">${recruitmentEscape(record.codigo)} · ${recruitmentDateTime(record.creado_en)}</div><div class="budget-history-meta"><span class="badge ${state.key!=='current'?'budget-state-'+state.key:''}">${recruitmentEscape(state.label)}</span><span class="badge">${recruitmentEscape(record.modalidad_snapshot)}</span><span class="badge">${budgetCurrency(record.total_snapshot)}</span></div><div class="applicant-actions"><button class="btn btn2" type="button" onclick="useSavedBudget('${record.id}','share')">COMPARTIR IMAGEN</button><button class="btn btn2" type="button" onclick="useSavedBudget('${record.id}','download')">DESCARGAR</button><button class="btn good" type="button" onclick="useSavedBudget('${record.id}','whatsapp')">WHATSAPP</button></div></article>`}).join('')||'<p class="muted">Todavía no generaste presupuestos.</p>'}

async function useSavedBudget(id,action){const record=sellerBudgetCache.find(item=>item.id===id);if(!record)return;activeBudgetShare={record,quote:record.condiciones_snapshot||{},blob:null};if(action==='share')return shareActiveBudgetImage();if(action==='download')return downloadActiveBudgetImage();return shareActiveBudgetWhatsApp()}

async function loadAdminBudgets(){
  const list=document.getElementById('adminBudgetList');if(!list)return;list.innerHTML='<p class="muted">Cargando presupuestos...</p>';
  if(recruitmentIsDemo()){adminBudgetCache=[recruitmentDemoBudgetRecord()];renderAdminBudgetHistory(list);return}
  const {data,error}=await sb.from('presupuestos').select('*,vendedores(nombre),clientes(nombre)').order('creado_en',{ascending:false}).limit(200);
  if(error){list.innerHTML=`<p class="muted">${recruitmentSchemaMissing(error)?'La migración de presupuestos todavía no está instalada en este entorno de prueba.':recruitmentEscape(error.message)}</p>`;return}
  adminBudgetCache=data||[];renderAdminBudgetHistory(list);
}

function renderAdminBudgetHistory(list){list.innerHTML=adminBudgetCache.map(record=>{const state=budgetStatus(record);return `<article class="budget-history-card"><div class="applicant-head"><div><h4>${recruitmentEscape(record.producto_nombre_snapshot)}</h4><div class="muted">${recruitmentEscape(record.codigo)} · ${recruitmentDateTime(record.creado_en)}</div></div><span class="badge ${state.key!=='current'?'budget-state-'+state.key:''}">${recruitmentEscape(state.label)}</span></div><div class="applicant-meta"><div><b>Vendedor</b>${recruitmentEscape(record.vendedores?.nombre||'—')}</div><div><b>Prospecto / cliente</b>${recruitmentEscape(record.clientes?.nombre||record.prospecto_nombre||'No informado')}</div><div><b>Condición</b>${recruitmentEscape(record.modalidad_snapshot)} · ${budgetCurrency(record.total_snapshot)}</div></div></article>`}).join('')||'<p class="muted">Todavía no hay presupuestos guardados.</p>'}
