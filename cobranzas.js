(function(global){
 'use strict';
 const ZONE='America/Argentina/Cordoba';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cash=x=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(Number(x||0));
 const date=x=>x?String(x).slice(0,10).split('-').reverse().join('/'):'—';
 const stamp=x=>x?new Intl.DateTimeFormat('es-AR',{timeZone:ZONE,dateStyle:'short',timeStyle:'short'}).format(new Date(x)):'—';
 const labels={hoy:'Vence hoy',vencida:'Vencida',proxima:'Próxima',pagada:'Pagada',anulada:'Anulada',parcial:'Parcial',pendiente:'Pendiente',activa:'Activo',finalizada:'Finalizado',sin_saldo:'Sin deuda'};
 function amount(value){
   let s=String(value??'').trim().replace(/^\$\s*/,'');
   if(/^[1-9]\d{0,2}(\.\d{3})+(,\d{1,2})?$/.test(s))s=s.replaceAll('.','').replace(',','.');
   else s=s.replace(',','.');
   if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Ingresá un importe positivo con hasta dos decimales.');
   const [whole,frac='']=s.split('.'); const cents=Number(whole)*100+Number(frac.padEnd(2,'0'));
   if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Ingresá un importe positivo válido.');
   return cents/100;
 }
 function phone(raw){
   let n=String(raw||'').replace(/\D/g,'');
   if(n.startsWith('00'))n=n.slice(2);
   if(n.startsWith('549'))n=n.slice(3);
   else if(n.startsWith('54'))n=n.slice(2);
   if(n.startsWith('0'))n=n.slice(1);
   if(n.length===12)n=n.replace(/^(\d{2,4})15(\d{6,8})$/,'$1$2');
   return /^\d{10}$/.test(n)?'549'+n:null;
 }
 function whatsapp(q){
   const n=phone(q.telefono);if(!n)return null;
   let text=q.estado_operativo==='vencida'
    ?`Hola ${q.cliente_nombre}, te escribimos de REST.\n\nRegistramos pendiente la cuota de tu ${q.producto}, con vencimiento ${date(q.vencimiento)}, por ${cash(q.saldo)}.\n\nSi ya realizaste el pago podés enviarnos el comprobante por este medio.\n\nGracias.`
    :`Hola ${q.cliente_nombre}, te recordamos que ${q.estado_operativo==='hoy'?'tu cuota de REST vence hoy':'tu próxima cuota de REST vence el '+date(q.vencimiento)} por ${cash(q.saldo)}, correspondiente a tu ${q.producto}.\n\nGracias.`;
   return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
 }
 const badge=q=>`<span class="fc-status fc-${esc(q.estado_operativo)}">${labels[q.estado_operativo]||esc(q.estado_operativo)}${q.estado_pago==='parcial'?' · pago parcial':''}</span>`;
 let cfg,root,data,detail,view='agenda',filter='hoy',search='',offset=0,requestNumber=0,busy=false,draft=null,plan=null,payment=null,lastFocus=null;
 const $=id=>global.document.getElementById(id);
 const btn=(action,id,text,extra='')=>`<button type="button" class="fc-btn ${extra}" data-fc="${action}" data-id="${esc(id)}">${text}</button>`;
 function shell(){
  root.innerHTML=`<header class="fc-head"><div><p class="fc-eyebrow">ADMINISTRACIÓN REST</p><h2>Cobranzas</h2><p>Tu agenda financiera, al día.</p></div><div class="fc-head-tools"><span id="fcToday"></span>${btn('refresh','','Actualizar')}</div></header>
   <div id="fcNotice" role="status" aria-live="polite"></div><div id="fcKpis" class="fc-kpis"></div>
   <section class="fc-workspace"><div class="fc-toolbar"><div class="fc-switch" role="group" aria-label="Vista de cobranzas">${btn('agenda','','Agenda','active')}${btn('clients','','Clientes y estado de cuenta')}</div><label class="fc-search">Buscar cliente<input id="fcSearch" placeholder="Nombre, DNI o teléfono" autocomplete="off" maxlength="120" type="search"></label></div>
   <div id="fcFilters" class="fc-filters" role="group" aria-label="Filtrar vencimientos">${[['hoy','Hoy'],['vencidas','Vencidas'],['proximos','Próximos 7 días'],['mes','Este mes'],['pagadas','Pagadas'],['todas','Todas']].map(([id,text])=>btn('filter',id,text)).join('')}</div>
   <div id="fcResults" aria-live="polite"></div><div id="fcPagination" class="fc-pagination"></div></section>
   <section id="fcDetail" class="fc-detail" aria-live="polite"></section>
   <dialog id="fcDialog" class="fc-dialog" aria-labelledby="fcDialogTitle"><div id="fcDialogBody"></div></dialog>`;
  root.addEventListener('click',click);
  let timer; $('fcSearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{search=$('fcSearch').value;offset=0;load();},180);});
  root.addEventListener('submit',submit);
  root.addEventListener('change',e=>{if(e.target.closest('#fcPayForm')){plan=null;if(draft)draft={...draft,key:global.crypto.randomUUID()};}});
  $('fcDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 }
 async function api(name,args){
  if(!cfg.isAdmin())throw Error('Solo Administración puede gestionar cobranzas.');
  const r=await cfg.rpc(name,args);if(r.error)throw Error(r.error.message||String(r.error));return r.data;
 }
 function notice(text,error=false){$('fcNotice').className=text?`fc-notice ${error?'fc-error':'fc-success'}`:'';$('fcNotice').textContent=text||'';}
 async function load(){
  if(!root)return;const seq=++requestNumber;
  $('fcResults').innerHTML='<p class="fc-empty">Cargando agenda…</p>';
  try{
   const r=await api('cobranzas_tablero',{p_filtro:filter,p_busqueda:search,p_limite:60,p_offset:offset});
   if(seq!==requestNumber)return;data=r;render();
  }catch(e){if(seq!==requestNumber)return;data=null;$('fcKpis').innerHTML='';$('fcResults').innerHTML=`<p class="fc-empty">No se pudo cargar la agenda. ${esc(e.message)}</p>`;$('fcPagination').innerHTML='';notice(e.message,true);}
 }
 function render(){
  $('fcToday').textContent=date(data.hoy)+' · Argentina';
  const k=data.kpis;
  const cards=[['Cobrar hoy',k.hoy.importe,`${k.hoy.cantidad} cuotas`,'hoy'],['Vencidas',k.vencidas.importe,`${k.vencidas.cantidad} cuotas · ${k.vencidas.clientes} clientes`,'vencidas'],['Próximos 7 días',k.proximos.importe,`${k.proximos.cantidad} cuotas`,'proximos'],['Cobrado hoy',k.cobrado_hoy,'Por fecha efectiva',''],['Cobrado este mes',k.cobrado_mes,'Pagos válidos',''],['Cartera pendiente',k.cartera,'Cuentas activas','']];
  $('fcKpis').innerHTML=cards.map(([name,value,n,f])=>`<article class="fc-kpi ${f}"><span>${name}</span><strong>${cash(value)}</strong><small>${esc(n)}</small>${f?`<button type="button" data-fc="filter" data-id="${f}" aria-label="Ver ${name}"></button>`:''}</article>`).join('');
  root.querySelectorAll('[data-fc=filter]').forEach(b=>b.classList.toggle('active',b.dataset.id===filter));
  root.querySelectorAll('.fc-switch button').forEach(b=>b.classList.toggle('active',b.dataset.fc===(view==='agenda'?'agenda':'clients')));
  $('fcFilters').hidden=view!=='agenda';
  const rows=view==='agenda'?data.agenda:data.clientes;
  $('fcResults').innerHTML=rows.length?(view==='agenda'?`<p class="fc-count">${data.total} cuotas encontradas</p><div class="fc-agenda">${rows.map(agendaRow).join('')}</div>`:`<p class="fc-count">${data.total_clientes} clientes con cuenta propia</p><div class="fc-clients">${rows.map(c=>`<article class="fc-client"><div><h3>${esc(c.nombre)}</h3><p>DNI ${esc(c.dni||'—')} · ${esc(c.telefono||'Sin teléfono')}</p><small>${c.cuentas} cuentas</small></div><div><strong>${cash(c.saldo)}</strong>${btn('client',c.id,'Ficha financiera')}</div></article>`).join('')}</div>`):'<div class="fc-empty"><strong>No hay resultados.</strong><p>Probá otro filtro o buscá un cliente.</p></div>';
  const total=view==='agenda'?data.total:data.total_clientes;
  $('fcPagination').innerHTML=total>60?`${btn('prev','','Anterior',offset===0?'disabled':'')}<span>${offset+1}–${Math.min(offset+60,total)} de ${total}</span>${btn('next','','Siguiente',offset+60>=total?'disabled':'')}`:'';
  $('fcPagination').querySelectorAll('.disabled').forEach(x=>x.disabled=true);
 }
 function agendaRow(q){
  const wa=whatsapp(q);const payable=Number(q.saldo)>0&&q.cuenta_estado==='activa'&&!['cancelada','caida','rechazada'].includes(q.venta_estado);
  return `<article class="fc-agenda-row ${q.estado_operativo}"><div class="fc-row-client"><h3>${esc(q.cliente_nombre)}</h3><p>${esc(q.producto)}</p><small>DNI ${esc(q.dni||'—')} · ${esc(q.telefono||'Sin teléfono')}</small></div><div class="fc-row-due"><strong>Cuota ${q.numero}</strong><span>${date(q.vencimiento)}</span>${badge(q)}</div><div class="fc-row-money"><small>Importe ${cash(q.importe)} · Pagado ${cash(q.importe_pagado)}</small><span>Saldo</span><strong>${cash(q.saldo)}</strong></div><div class="fc-row-actions">${btn('client',q.cliente_id,'Ver cliente')}${payable?btn('pay',q.cuenta_id,'Registrar cobro','primary'):''}${Number(q.saldo)>0&&wa?`<a class="fc-btn fc-wa" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}${!payable&&Number(q.saldo)>0?'<small>Revisar estado de la venta</small>':''}</div></article>`;
 }
 async function openClient(id,args){
  try{detail=await api('ficha_financiera_cliente',args||{p_cliente_id:id});renderDetail();$('fcDetail').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){notice(e.message,true);}
 }
 function renderDetail(){
  const f=detail,c=f.cliente,r=f.resumen;
  $('fcDetail').innerHTML=`<header class="fc-detail-head"><div><p class="fc-eyebrow">ESTADO DE CUENTA</p><h2>${esc(c.nombre)}</h2><p>DNI ${esc(c.dni||'—')} · ${esc(c.telefono||'Sin teléfono')}</p><small>${esc([c.direccion,c.ciudad].filter(Boolean).join(' · '))}</small></div>${btn('close-detail','','Cerrar ficha')}</header>
   <div class="fc-summary">${[['Total original',cash(r.original)],['Pagos registrados',cash(r.pagado)],['Saldo actual',cash(r.saldo)],['Vencido',cash(r.vencido)],['Próximo vencimiento',date(r.proximo_vencimiento)]].map(([name,val])=>`<div><small>${name}</small><strong>${val}</strong></div>`).join('')}</div>
   <p class="fc-help">Los pagos registrados corresponden a cuotas cobradas en REST. Anticipos pactados y operaciones al contado se detallan por separado.</p>
   <h3>Créditos activos</h3>${f.cuentas.filter(x=>x.estado==='activa').map(accountCard).join('')||'<p class="fc-empty">Sin créditos activos.</p>'}
   <h3>Créditos finalizados y operaciones sin deuda</h3>${f.cuentas.filter(x=>x.estado!=='activa').map(accountCard).join('')||'<p class="fc-empty">Sin operaciones finalizadas.</p>'}
   <h3>Historial de pagos</h3><div class="fc-payment-list">${f.pagos.map(p=>`<article class="fc-payment ${p.estado==='anulado'?'void':''}"><div><strong>${esc(p.codigo)} · ${cash(p.monto)}</strong><span class="fc-status fc-${p.estado==='anulado'?'anulada':'pagada'}">${p.estado==='anulado'?'Pago anulado':'Pago registrado'}</span><p>Fecha efectiva ${date(p.fecha_efectiva)} · ${esc(p.medio_pago)}</p><small>Registrado ${stamp(p.creado_en)} por ${esc(p.snapshot.registrador_nombre)}</small>${p.referencia?`<p>Referencia: ${esc(p.referencia)}</p>`:''}${p.notas?`<p>${esc(p.notas)}</p>`:''}${p.estado==='anulado'?`<p>Motivo: ${esc(p.motivo_anulacion)} · ${esc(p.anulador_nombre)} · ${stamp(p.anulada_en)}</p>`:''}</div><div>${btn('receipt',p.id,'Ver recibo')}${p.estado==='registrado'?btn('void',p.id,'Anular pago','danger'):''}</div></article>`).join('')||'<p class="fc-empty">Todavía no hay pagos.</p>'}</div>
   <h3>Historial de la cuenta</h3><ol class="fc-timeline">${f.historial.map(a=>`<li><strong>${esc(({cuenta_creada:'Apertura de cuenta',cuenta_finalizada:'Cuenta finalizada',cuenta_reabierta:'Cuenta reabierta',pago_registrado:'Cobro registrado',pago_anulado:'Cobro anulado'})[a.accion]||a.accion)}</strong><span>${stamp(a.creada_en)} · ${esc(a.usuario_nombre)}</span>${a.detalle.importe?`<span>${cash(a.detalle.importe)}${a.detalle.fecha_efectiva?' · efectiva '+date(a.detalle.fecha_efectiva):''}</span>`:''}${a.detalle.motivo?`<span>${esc(a.detalle.motivo)}</span>`:''}</li>`).join('')}</ol>`;
 }
 function accountCard(c){
  return `<details class="fc-account" ${c.estado==='activa'?'open':''}><summary><span><strong>${esc(c.producto)}</strong><small>${esc(c.forma_pago)} · ${date(c.creada_en)}</small></span><span class="fc-account-total"><strong>${cash(c.saldo_actual)}</strong><span class="fc-status fc-${c.estado==='activa'?'proxima':'pagada'}">${labels[c.estado]||esc(c.estado)}</span></span></summary><div class="fc-account-body"><div class="fc-account-info"><span>Venta ${esc(c.venta_id.slice(0,8))}</span><span>Original ${cash(c.monto_total)}</span><span>Anticipo pactado ${cash(c.anticipo)}</span><span>Financiado ${cash(c.monto_financiado)}</span></div>${c.estado==='activa'?btn('pay',c.id,'Registrar cobro','primary'):''}
    <div class="fc-schedule">${c.cuotas.map(q=>`<div><strong>${q.numero}/${c.cuotas.length}</strong><span>${date(q.vencimiento)}</span><span>Importe ${cash(q.importe)}<small>Pagado ${cash(q.importe_pagado)}</small></span><strong>Saldo ${cash(q.saldo)}</strong>${badge(q)}${btn('quota-payments',q.id,'Ver pagos')}</div>`).join('')||'<p>Sin cuotas pendientes.</p>'}</div></div></details>`;
 }
 function modal(html){lastFocus=global.document.activeElement;$('fcDialogBody').innerHTML=html;$('fcDialog').showModal();}
 function close(){if(busy)return;$('fcDialog').close();lastFocus?.focus();}
 function dialogHead(title){return `<header><h2 id="fcDialogTitle">${title}</h2>${btn('close','','Cerrar')}</header>`;}
 async function pay(id){
  try{
   const f=await api('ficha_financiera_cliente',{p_cuenta_id:id});const c=f.cuentas.find(x=>x.id===id);const due=c.cuotas.filter(q=>Number(q.saldo)>0);const oldest=due.slice().sort((a,b)=>a.vencimiento.localeCompare(b.vencimiento)||a.numero-b.numero)[0];
   const overdue=due.filter(q=>q.vencimiento<f.hoy);draft={cuenta:id,key:global.crypto.randomUUID(),cliente:f.cliente.nombre,producto:c.producto};plan=null;
   modal(`${dialogHead('Registrar cobro')}<p class="fc-dialog-client">${esc(f.cliente.nombre)}<small>${esc(c.producto)}</small></p><div class="fc-summary"><div><small>Saldo total</small><strong>${cash(c.saldo_actual)}</strong></div><div><small>Cuotas vencidas</small><strong>${overdue.length} · ${cash(overdue.reduce((s,q)=>s+Number(q.saldo),0))}</strong></div><div><small>Primera cuota pendiente</small><strong>${oldest?'N.º '+oldest.numero+' · '+date(oldest.vencimiento):'—'}</strong><small>Saldo ${cash(oldest?.saldo)}</small></div></div>
    <form id="fcPayForm"><label>Importe recibido<input name="importe" inputmode="decimal" autocomplete="off" value="${oldest?Number(oldest.saldo).toFixed(2):''}" required></label><label>Fecha efectiva del pago<input name="fecha" type="date" value="${f.hoy}" max="${f.hoy}" required></label><p class="fc-help">El día en que el cliente pagó. La fecha de carga se registra automáticamente.</p><label>Medio de pago<select name="medio">${data.medios_pago.map(m=>`<option value="${m}">${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}</select></label><label>Referencia / comprobante (opcional)<input name="referencia" maxlength="240"></label><label>Observación (opcional)<textarea name="observacion" maxlength="4000" rows="2"></textarea></label><p id="fcPayError" class="fc-form-error" role="alert"></p><button class="fc-btn primary full" type="submit">Revisar aplicación</button></form>`);
  }catch(e){notice(e.message,true);}
 }
 async function review(form){
  try{
   if(!form.reportValidity())return;
   const fd=new global.FormData(form),value=amount(fd.get('importe'));
   draft={...draft,key:draft?.key||global.crypto.randomUUID(),importe:value.toFixed(2),fecha:fd.get('fecha'),medio:fd.get('medio'),referencia:fd.get('referencia'),observacion:fd.get('observacion')};
   if(!draft.fecha||draft.fecha>data.hoy)throw Error('La fecha efectiva no puede ser futura.');
   plan=await api('previsualizar_cobro',{p_cuenta_id:draft.cuenta,p_importe:draft.importe});
   $('fcDialogBody').innerHTML=`${dialogHead('Confirmar cobro')}<p class="fc-dialog-client">${esc(draft.cliente)}<small>${esc(draft.producto)}</small></p><div class="fc-confirm-amount">${cash(draft.importe)}</div><p>Fecha efectiva <strong>${date(draft.fecha)}</strong> · ${esc(draft.medio)}</p><h3>Aplicación del pago</h3><ul class="fc-allocation">${plan.imputaciones.map(q=>`<li><span>Cuota ${q.numero}<small>${date(q.vencimiento)}</small></span><strong>${cash(q.importe)}</strong></li>`).join('')}</ul><p>Saldo restante: <strong>${cash(plan.saldo_despues)}</strong></p><p id="fcConfirmError" class="fc-form-error" role="alert"></p>${btn('confirm','','Confirmar cobro','primary full')}${btn('edit-payment','','Volver a revisar','full')}`;
  }catch(e){$('fcPayError').textContent=e.message;}
 }
 async function confirmPayment(){
  if(busy||!draft||!plan)return;busy=true;const b=root.querySelector('[data-fc=confirm]');b.disabled=true;b.textContent='Registrando…';
  try{
   const r=await api('registrar_cobro_credito',{p_cuenta_id:draft.cuenta,p_importe:draft.importe,p_fecha_efectiva:draft.fecha,p_medio_pago:draft.medio,p_clave_idempotencia:draft.key,p_revision:plan.revision,p_referencia:draft.referencia||null,p_observaciones:draft.observacion||null});
   payment=r;draft=null;plan=null;await refreshAfter();receipt(r,true);notice('Cobro registrado. Agenda y saldos actualizados.');
  }catch(e){$('fcConfirmError').textContent=e.message;b.disabled=false;b.textContent='Confirmar cobro';}
  finally{busy=false;}
 }
 async function refreshAfter(){await load();if(detail){detail=await api('ficha_financiera_cliente',{p_cliente_id:detail.cliente.id});renderDetail();}}
 function receipt(p,success=false){
  payment=p;const s=p.snapshot;
  $('fcDialogBody').innerHTML=`${dialogHead(success?'Cobro registrado':'Comprobante interno')}<section class="fc-receipt" id="fcReceipt"><header><strong>REST</strong><div>${esc(p.codigo)}<small>Comprobante interno de cobranza · no fiscal</small></div></header>${p.estado==='anulado'?'<p class="fc-void-mark">PAGO ANULADO</p>':''}<h3>${esc(s.cliente?.nombre||'Cobranza histórica')}</h3><p>DNI ${esc(s.cliente?.dni||'—')}</p><p>${esc(s.producto||'')}</p><div class="fc-confirm-amount">${cash(p.monto)}</div><dl><div><dt>Fecha efectiva</dt><dd>${date(p.fecha_efectiva)}</dd></div><div><dt>Registrado</dt><dd>${stamp(p.creado_en)}</dd></div><div><dt>Medio de pago</dt><dd>${esc(p.medio_pago)}</dd></div><div><dt>Cuenta / venta</dt><dd>${esc((p.cuenta_credito_id||'').slice(0,8))} / ${esc(p.venta_id.slice(0,8))}</dd></div><div><dt>Registró</dt><dd>${esc(s.registrador_nombre)}</dd></div>${p.referencia?`<div><dt>Referencia</dt><dd>${esc(p.referencia)}</dd></div>`:''}</dl><h4>Imputación</h4><ul class="fc-allocation">${p.imputaciones.map(q=>`<li><span>Cuota ${q.numero} · ${date(q.vencimiento)}</span><strong>${cash(q.importe)}</strong></li>`).join('')}</ul><p>Saldo al cobrar: <strong>${cash(s.saldo_despues)}</strong></p><p>Saldo actual: <strong>${cash(p.saldo_actual)}</strong></p>${p.notas?`<p>${esc(p.notas)}</p>`:''}${p.estado==='anulado'?`<p>Anulado ${stamp(p.anulada_en)} por ${esc(p.anulador_nombre)}<br>Motivo: ${esc(p.motivo_anulacion)}</p>`:''}${cfg.demo?'<p class="fc-void-mark">DATOS DE PRUEBA · SIN VALIDEZ</p>':''}</section>${btn('print','','Imprimir comprobante','primary full')}${btn('close','','Cerrar','full')}`;
  if(!$('fcDialog').open)$('fcDialog').showModal();
 }
 async function voidDialog(id){
  const p=await api('obtener_recibo_cobranza',{p_pago_id:id});payment=p;
  modal(`${dialogHead('Anular pago')}<p>${esc(p.codigo)} · <strong>${cash(p.monto)}</strong></p><p>Las imputaciones se revertirán. El pago y el motivo quedarán en el historial.</p><form id="fcVoidForm"><label>Motivo obligatorio<textarea name="motivo" minlength="3" maxlength="2000" required rows="3"></textarea></label><p id="fcVoidError" role="alert" class="fc-form-error"></p><button class="fc-btn danger full" type="submit">Confirmar anulación</button></form>`);
 }
 async function voidPayment(form){
  if(busy||!form.reportValidity())return;busy=true;const b=form.querySelector('button');b.disabled=true;
  try{const reason=new global.FormData(form).get('motivo').trim();if(reason.length<3)throw Error('El motivo debe tener al menos 3 caracteres.');const p=await api('anular_cobro_credito',{p_pago_id:payment.id,p_motivo:reason});await refreshAfter();receipt(p);notice('Pago anulado. Saldos e imputaciones revertidos.');}catch(e){$('fcVoidError').textContent=e.message;b.disabled=false;}finally{busy=false;}
 }
 async function click(e){
  const b=e.target.closest('[data-fc]');if(!b||b.disabled)return;const a=b.dataset.fc,id=b.dataset.id;
  try{
   if(a==='refresh'){notice('');await load();}
   else if(a==='filter'){filter=id;view='agenda';offset=0;await load();}
   else if(a==='agenda'||a==='clients'){view=a;offset=0;render();}
   else if(a==='next'||a==='prev'){offset+=a==='next'?60:-60;await load();}
   else if(a==='client')await openClient(id);
   else if(a==='pay')await pay(id);
   else if(a==='close-detail'){detail=null;$('fcDetail').innerHTML='';}
   else if(a==='close')close();
   else if(a==='confirm')await confirmPayment();
   else if(a==='edit-payment'){const previous={...draft};await pay(previous.cuenta);const form=$('fcPayForm');for(const [name,key] of [['importe','importe'],['fecha','fecha'],['medio','medio'],['referencia','referencia'],['observacion','observacion']])form.elements[name].value=previous[key]||'';}
   else if(a==='receipt')receipt(await api('obtener_recibo_cobranza',{p_pago_id:id}));
   else if(a==='void')await voidDialog(id);
   else if(a==='print'){global.document.body.classList.add('fc-printing');global.print();global.document.body.classList.remove('fc-printing');}
   else if(a==='quota-payments'){
    const rows=(detail?.pagos||[]).filter(p=>p.imputaciones.some(i=>i.cuota_id===id));
    modal(`${dialogHead('Pagos de esta cuota')}<div>${rows.map(p=>`<article class="fc-payment"><div><strong>${esc(p.codigo)}</strong><p>${cash(p.imputaciones.find(i=>i.cuota_id===id).importe)} · ${date(p.fecha_efectiva)} · ${p.estado==='anulado'?'Anulado':'Válido'}</p></div>${btn('receipt',p.id,'Ver recibo')}</article>`).join('')||'<p>Esta cuota todavía no recibió pagos.</p>'}</div>`);
   }
  }catch(err){notice(err.message,true);}
 }
 function submit(e){if(e.target.id==='fcPayForm'){e.preventDefault();review(e.target);}if(e.target.id==='fcVoidForm'){e.preventDefault();voidPayment(e.target);}}
 function init(options){cfg=options;root=$(options.rootId||'cobranzasRoot');if(!root)return;shell();}
 async function openSale(id){await load();await openClient(null,{p_venta_id:id});}
 async function showClients(){view='clients';offset=0;await load();}
 const apiExport={init,load,openClient,openSale,showClients,amount,phone,whatsapp,esc,cash,date,stamp};
 if(typeof module!=='undefined'&&module.exports)module.exports=apiExport;else global.RESTCobranza=apiExport;
})(typeof window!=='undefined'?window:globalThis);
