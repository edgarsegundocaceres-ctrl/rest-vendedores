/* Analítica opcional: no recibe nombres, DNI, teléfonos, emails ni texto libre. */
(function(root){
 'use strict';
 const TTL=30*60*1000,MAX=24*60*60*1000;
 let context=null,queue=Promise.resolve(),sent=new Set();
 const memory=new Map();
 const storage={get(k){try{return localStorage.getItem(k)}catch{return memory.get(k)}},set(k,v){memory.set(k,v);try{localStorage.setItem(k,v)}catch{}}};
 const uuid=()=>root.crypto.randomUUID();
 function session(){
  const now=Date.now(),key='rest.catalog.session.'+context.token;
  let data;try{data=JSON.parse(storage.get(key))}catch{}
  if(!data||now-data.last>=TTL||now-data.created>=MAX){data={id:uuid(),created:now,last:now};sent=new Set()}
  storage.set(key,JSON.stringify(data));return data.id;
 }
 function demoRows(){try{return JSON.parse(storage.get('rest.catalog.demo.events')||'[]')}catch{return []}}
 function track(type,product=null,requestId=null){
  try{
   if(!context||(!product&&type!=='CATALOGO_VISITA'))return;
   const sid=session(),key=[sid,type,product,requestId].join(':');if(sent.has(key))return;sent.add(key);
   const saved=JSON.parse(storage.get('rest.catalog.session.'+context.token));saved.last=Date.now();storage.set('rest.catalog.session.'+context.token,JSON.stringify(saved));
   const ctx={...context};
   queue=queue.catch(()=>{}).then(async()=>{
    if(ctx.demo){const rows=demoRows();if(!rows.some(r=>r.key===key)){rows.push({key,type,product,name:ctx.products?.find(p=>p.id===product)?.nombre||product,sid,visitor:ctx.visitor,at:new Date().toISOString()});storage.set('rest.catalog.demo.events',JSON.stringify(rows.slice(-2000)))}return}
    // La llamada es secundaria: jamás se espera desde el catálogo ni el formulario.
    const base={p_token:ctx.token,p_visitante:ctx.visitor,p_sesion:sid};
    if(type!=='CATALOGO_VISITA')await sb.rpc('registrar_evento_catalogo',{...base,p_tipo:'CATALOGO_VISITA',p_producto:null});
    const result=await sb.rpc('registrar_evento_catalogo',{...base,p_tipo:type,p_producto:product});
    if(result.error||!result.data)sent.delete(key);
   }).catch(()=>{sent.delete(key)});
  }catch{/* Navegadores sin almacenamiento/crypto siguen comprando normalmente. */}
 }
 function start(token,demo,products=[]){try{
  let visitor=storage.get('rest.catalog.visitor');if(!/^[0-9a-f-]{36}$/i.test(visitor||'')){visitor=uuid();storage.set('rest.catalog.visitor',visitor)}
  context={token:demo?'demo':token,demo,visitor,products};track('CATALOGO_VISITA');
 }catch{context=null}}
 function demoRequest(id,product){if(context?.demo)track('SOLICITUD_ENVIADA',product,id)}
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rate=(a,b)=>b?new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(100*a/b)+' %':'—';
 function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Cordoba'}).format(new Date())}
 function period(code){const end=today(),d=new Date(end+'T12:00:00Z');if(code==='mes')d.setUTCDate(1);else d.setUTCDate(d.getUTCDate()-(code==='hoy'?0:Number(code)-1));return [d.toISOString().slice(0,10),end]}
 function demoMetrics(from,to){
  const rows=demoRows().filter(r=>{const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Cordoba'}).format(new Date(r.at));return day>=from&&day<=to});
  const count=t=>rows.filter(r=>r.type===t).length;
  const totals={visitas:count('CATALOGO_VISITA'),visitantes:new Set(rows.map(r=>r.visitor)).size,vistas:count('PRODUCTO_VISTA'),intereses:count('INTERES_CLICK'),formularios:count('SOLICITUD_INICIADA'),solicitudes:count('SOLICITUD_ENVIADA'),aprobadas:0,ventas:0};
  const products=[...new Set(rows.map(r=>r.product).filter(Boolean))].map(id=>{const items=rows.filter(r=>r.product===id);return {id,nombre:items[0].name||id,vistas:items.filter(r=>r.type==='PRODUCTO_VISTA').length,intereses:items.filter(r=>r.type==='INTERES_CLICK').length,solicitudes:items.filter(r=>r.type==='SOLICITUD_ENVIADA').length,ventas:0}});
  return {...totals,vendedores:rows.length?[{...totals,id:'demo',nombre:'Sofía · TEST'}]:[],productos:products};
 }
 function table(rows,kind){
  const seller=kind==='vendedores';
  return `<div class="catalog-analytics-table"><table><thead><tr><th>${seller?'Vendedor':'Producto'}</th>${seller?'<th>Visitas</th><th>Visitantes aprox.</th>':''}<th>Vistas</th><th>Interés</th><th>Solicitudes</th><th>Ventas</th><th>Solicitud → venta</th>${seller?'<th>Venta / visita*</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.nombre)}</td>${seller?`<td>${r.visitas}</td><td>${r.visitantes}</td>`:''}<td>${r.vistas}</td><td>${r.intereses}</td><td>${r.solicitudes}</td><td>${r.ventas}</td><td>${rate(r.ventas,r.solicitudes)}</td>${seller?`<td>${rate(r.ventas,r.visitas)}</td>`:''}</tr>`).join('')||'<tr><td colspan="9">Sin actividad registrada en este período.</td></tr>'}</tbody></table></div>`;
 }
 function render(data){
  return `<div class="catalog-analytics-grid">${[['Visitas','visitas'],['Visitantes aprox.','visitantes'],['Vistas de producto','vistas'],['Intereses','intereses'],['Formularios iniciados','formularios'],['Solicitudes','solicitudes'],['Aprobadas','aprobadas'],['Ventas convertidas','ventas']].map(([l,k])=>`<article>${l}<strong>${Number(data[k]||0)}</strong></article>`).join('')}<article>Solicitud → venta<strong>${rate(data.ventas,data.solicitudes)}</strong></article></div>
  <h3>Embudo comercial</h3><div class="catalog-funnel"><div>Visitas: ${data.visitas}</div><div>Intereses: ${data.intereses} · ${rate(data.intereses,data.visitas)} por visita*</div><div>Solicitudes: ${data.solicitudes} · ${rate(data.solicitudes,data.intereses)} por interés*</div><div>Ventas: ${data.ventas} · ${rate(data.ventas,data.solicitudes)} de las solicitudes</div></div>
  <p class="muted">* Comparación de volúmenes, no seguimiento individual ni tasa de personas: una visita puede interesarse en varios productos. Solicitudes creadas en el período; ventas y aprobaciones corresponden al estado actual de esas solicitudes. El tráfico bloqueado o anterior a la instalación no se registra; los cocientes pueden superar 100 %. Visitantes aproximados por navegador, no personas identificadas.</p>
  <h3>Vendedores</h3>${table(data.vendedores||[],'vendedores')}<h3>Productos</h3><label>Ordenar por <select id="analyticsProductSort"><option value="vistas">Más vistos</option><option value="intereses">Más interés</option><option value="solicitudes">Más solicitudes</option><option value="ventas">Más ventas convertidas</option></select></label><div id="analyticsProducts">${table(data.productos||[],'productos')}</div>`;
 }
 async function admin({demo=false}={}){
  if(!demo&&(typeof profile==='undefined'||profile?.rol!=='admin'||!profile.activo))return;
  const panel=document.getElementById('catalogAnalyticsPanel');if(!panel)return;
  const [from,to]=period('30');
  panel.innerHTML=`${demo?'<p class="catalog-legal">TEST aislado: se muestran únicamente tus interacciones en el catálogo demo de este navegador. No escribe en Supabase. Aprobaciones y ventas no se simulan aquí.</p><a href="/?demo=catalogo-publico" target="_blank" rel="noopener">Abrir catálogo TEST</a>':''}<div class="catalog-period"><select id="analyticsPeriod"><option value="hoy">Hoy</option><option value="7">7 días</option><option value="30" selected>30 días</option><option value="mes">Mes actual</option><option value="rango">Rango</option></select><label>Desde <input type="date" id="analyticsFrom" value="${from}"></label><label>Hasta <input type="date" id="analyticsTo" value="${to}"></label><button id="analyticsRefresh" class="btn">Actualizar</button></div><div id="analyticsResults" role="status"></div>`;
  let version=0;
  async function refresh(){const v=++version,el=document.getElementById('analyticsResults');el.textContent='Cargando métricas…';try{
   const a=document.getElementById('analyticsFrom').value,b=document.getElementById('analyticsTo').value;
   if(!a||!b||a>b)throw Error('Revisá el rango de fechas.');
   let data;if(demo)data=demoMetrics(a,b);else{const res=await sb.rpc('analitica_catalogo',{p_desde:a,p_hasta:b});if(res.error)throw res.error;data=res.data}
   if(v!==version)return;el.innerHTML=render(data);
   document.getElementById('analyticsProductSort').onchange=e=>{document.getElementById('analyticsProducts').innerHTML=table([...(data.productos||[])].sort((a,b)=>b[e.target.value]-a[e.target.value]),'productos')};
  }catch(e){if(v===version)el.textContent='No se pudieron cargar las métricas. '+(e.message||'Intentá nuevamente.')}}
  document.getElementById('analyticsPeriod').onchange=e=>{if(e.target.value!=='rango'){const [a,b]=period(e.target.value);document.getElementById('analyticsFrom').value=a;document.getElementById('analyticsTo').value=b;refresh()}};
  document.getElementById('analyticsRefresh').onclick=refresh;await refresh();
 }
 root.RESTCatalogAnalytics={start,track,admin,demoRequest};
 if(typeof module!=='undefined')module.exports={rate,period,render};
})(globalThis);
