(function(root){
 const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(n||0));
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let key=null,busy=false,quoteSequence=0;
 async function load(){
  const el=document.getElementById('motorPreciosAdmin');if(!el||profile?.rol!=='admin')return;
  el.innerHTML='<p>Cargando Dólar REST…</p>';
  const {data,error}=await sb.rpc('obtener_dolar_rest');if(error){el.textContent=error.message;return}
  el.innerHTML=`<h3>Dólar REST · Celulares</h3><p>Valor vigente: <b>${data.valor?money(data.valor):'Sin configurar'}</b></p><p class="muted">${data.actualizado_en?'Actualizado '+new Date(data.actualizado_en).toLocaleString('es-AR',{timeZone:'America/Argentina/Cordoba'})+' · '+esc(data.administrador||'Administración'):'Ingresá la cotización que REST decide utilizar. No se consulta internet.'}</p><label for="motorDolar">Pesos por dólar</label><input id="motorDolar" class="input" type="number" min="0.0001" step="0.0001" value="${esc(data.valor||'')}"><button id="motorDolarSave" class="btn">ACTUALIZAR DÓLAR REST</button><p class="muted">Aplica a nuevas cotizaciones. Presupuestos, solicitudes y ventas guardadas conservan sus condiciones.</p><p id="motorDolarStatus" role="status"></p>`;
  document.getElementById('motorDolarSave').onclick=async()=>{const b=document.getElementById('motorDolarSave');b.disabled=true;try{const r=await sb.rpc('actualizar_dolar_rest',{p_valor:Number(document.getElementById('motorDolar').value)});if(r.error)throw r.error;await load();await loadAdminProducts()}catch(e){document.getElementById('motorDolarStatus').textContent=e.message}finally{b.disabled=false}};
 }
 async function cost(id,category){
  if(profile?.rol!=='admin')return;
  if(category!=='celulares')return alert('Hogar conserva sus condiciones actuales.');
  const field='costo_proveedor_usd';
  const read=await sb.from('productos_costos').select(field).eq('producto_id',id).maybeSingle();if(read.error)return alert(read.error.message);
  const value=prompt(category==='celulares'?'Costo proveedor USD (sin sumar los USD 10):':'Costo del producto en ARS:',read.data?.[field]??'');if(value===null)return;
  const result=await sb.rpc('guardar_costo_producto_rest',{p_producto:id,p_costo:Number(value)});if(result.error)return alert(result.error.message);await loadAdminProducts();
 }
 async function quote(){
  const p=selectedCatalogProduct;if(!p)return;
  if(!['hogar','celulares'].includes(p.categoria)||recruitmentIsDemo())return false;
  const sequence=++quoteSequence,mode=qMode.value,count=qInstall.value,advance=qAdvance.value;
  const {data,error}=await sb.rpc('calcular_presupuesto_rest',{p_producto_id:p.id,p_modalidad:qMode.value,p_cuotas:Number(qInstall.value||0),p_anticipo:Number(qAdvance.value||0)});
  if(sequence!==quoteSequence||p!==selectedCatalogProduct||mode!==qMode.value||count!==qInstall.value||advance!==qAdvance.value)return true;
  if(error){qerr(error.message);return true}
  const plan={formaPago:qMode.value,count:data.count,value:data.value,frequency:data.frequency,primera_cuota:data.primera_cuota};
  const lines=[['Total',money(data.total)]];if(data.primera_cuota)lines.push(['Primera cuota','Al inicio']);if(data.ultima_cuota!==undefined)lines.push(['Última cuota ajustada',money(data.ultima_cuota)]);
  qshow(data.title,lines,data.total,data.count?`${data.count} cuotas · ${money(data.value)} (ver última cuota)`:null,data.down,data.paymentText,plan);return true;
 }
 async function submit(){
  if(busy)return;const p=selectedCatalogProduct,q=currentQuote;
  if(!p||!q||!['hogar','celulares'].includes(p.categoria)){smsg.textContent='Elegí un producto de Hogar o Celulares y calculá su cotización antes de enviar.';return}
  busy=true;saleBtn.disabled=true;key=key||crypto.randomUUID();smsg.textContent='Enviando venta…';
  try{const r=await sb.rpc('registrar_venta_catalogo',{p_clave_idempotencia:key,p_datos:{unidad:p.categoria,modalidad:q.plan.formaPago,producto_id:p.id,interes_cliente_id:activeInteresVentaId||null,cliente_nombre:cn.value.trim(),cliente_dni:cd.value,cliente_telefono:cp.value,cliente_fecha_nacimiento:cbirth.value||null,cliente_direccion:caddr.value,cliente_ciudad:ccity.value,cliente_telefono_referencia:cref.value,forma_pago:q.paymentText,monto_total:q.total,anticipo:q.down||0,cantidad_cuotas:q.plan.count,valor_cuota:q.plan.value,frecuencia:q.plan.frequency,primer_vencimiento:new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Cordoba'}).format(new Date()),notas:notes.value}});
   if(r.error)throw r.error;smsg.textContent='Venta '+r.data.id+' cargada como Pendiente.';key=null;currentQuote=null;activeInteresVentaId=null;if(typeof loadSeller==='function')await loadSeller();
  }catch(e){smsg.textContent=e.message}finally{busy=false;saleBtn.disabled=false}
 }
 function init(){const cat=document.getElementById('pcat'),input=document.getElementById('pprice');const change=()=>{input.placeholder=cat.value==='celulares'?'Costo proveedor USD (sin adicional)':'Precio contado';input.step='0.0001'};cat?.addEventListener('change',change);if(cat&&input)change();}
 root.RESTPrecios={load,cost,quote,submit,init,money};
})(globalThis);
