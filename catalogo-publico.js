/* APP INTEGRAL REST · Catálogo público personalizado y solicitudes de compra */
'use strict';

const REST_CATALOG_PUBLIC_ORIGIN='https://rest-vendedores.vercel.app/';
const CATALOG_REQUEST_STATE_LABELS={
  nueva:'Nueva',en_revision:'En revisión',contactado:'Contactado',aprobada:'Aprobada',
  rechazada:'Rechazada',convertida_en_venta:'Convertida en venta'
};
const CATALOG_MODE_LABELS={contado:'Contado',credito_6:'6 cuotas',credito_9:'9 cuotas'};

let catalogPublicState={token:'',seller:null,products:[],category:'',search:'',product:null,modality:'',customer:null,step:1,idempotency:'',demo:false};
let adminCatalogRequests=[];
let adminCatalogSellers=[];
let adminCatalogSelectedId=null;
let adminCatalogDemo=false;
let sellerCatalogDemo=false;
let catalogPurchaseUiReady=false;

function catalogEl(id){return typeof document==='undefined'?null:document.getElementById(id)}
function catalogEscape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function catalogMoney(value){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value)||0)}
function catalogDateTime(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})}
function catalogDigits(value){return String(value||'').replace(/\D/g,'')}
function catalogRound(value){return Math.round((Number(value)+Number.EPSILON)*100)/100}
function catalogPublicUrl(token,origin=REST_CATALOG_PUBLIC_ORIGIN){const url=new URL(origin);url.search='';url.hash='';url.searchParams.set('catalogo',String(token||''));return url.toString()}
function catalogModalityLabel(code){return CATALOG_MODE_LABELS[code]||String(code||'')}
function catalogRequestStateLabel(code){return CATALOG_REQUEST_STATE_LABELS[code]||String(code||'')}

function catalogDemoOptions(price){
  const cash=catalogRound(price);
  const total6=catalogRound(cash*(1+0.095*6));
  const total9=catalogRound(cash*(1+0.11*9));
  return {
    contado:{codigo:'contado',titulo:'Contado',total:cash,anticipo:cash,cantidad_cuotas:0,valor_cuota:0,frecuencia:'unico'},
    credito_6:{codigo:'credito_6',titulo:'Crédito personal · 6 cuotas',total:total6,anticipo:0,cantidad_cuotas:6,valor_cuota:catalogRound(total6/6),frecuencia:'mensual',regla:{tipo:'interes_simple_mensual',tasa_mensual:0.095}},
    credito_9:{codigo:'credito_9',titulo:'Crédito personal · 9 cuotas',total:total9,anticipo:0,cantidad_cuotas:9,valor_cuota:catalogRound(total9/9),frecuencia:'mensual',regla:{tipo:'interes_simple_mensual',tasa_mensual:0.11}}
  };
}

function catalogDemoProducts(){
  const rows=[
    {id:'7abfd694-bb76-49e3-9699-69a188003aa7',nombre:'Alacena 120 cm',categoria:'hogar',subcategoria:'Muebles',precio_contado:141100,imagen_url:'https://gajlmcqaylezudttoaju.supabase.co/storage/v1/object/public/catalogo-productos/1791240655606-87c96c9d-7931-416a-913b-8be021cd8a17.jpg'},
    {id:'e9e6a84c-8827-42aa-913f-382aa689f5c1',nombre:'Armario multiuso Acapulco',categoria:'hogar',subcategoria:'Muebles',precio_contado:188700,imagen_url:'https://gajlmcqaylezudttoaju.supabase.co/storage/v1/object/public/catalogo-productos/1789842808509-3b264070-7291-408b-91d5-9def89b79d36.jpg'},
    {id:'c1ceeb23-83ba-4950-95a5-829e4189f61f',nombre:'iPhone 11 Pro 256GB 100% Gris',categoria:'celulares',subcategoria:null,precio_contado:561275,imagen_url:'https://gajlmcqaylezudttoaju.supabase.co/storage/v1/object/public/catalogo-productos/1791254058658-f9aff943-7a88-4900-9b41-387734265681.webp'},
    {id:'f72c4185-e531-443a-be38-2d9c2bb11a9c',nombre:'iPhone 12 128GB Negro',categoria:'celulares',subcategoria:null,precio_contado:1066422,imagen_url:'https://gajlmcqaylezudttoaju.supabase.co/storage/v1/object/public/catalogo-productos/1791254147382-0ba294bd-699f-483c-82d2-69c99a784bb9.webp'}
  ];
  return rows.map(row=>({...row,opciones:catalogDemoOptions(row.precio_contado)}));
}

function catalogNormalizeClient(input){
  return {
    nombre:String(input?.nombre||'').trim().replace(/\s+/g,' '),
    apellido:String(input?.apellido||'').trim().replace(/\s+/g,' '),
    dni:catalogDigits(input?.dni),
    telefono:catalogDigits(input?.telefono),
    localidad:String(input?.localidad||'').trim().replace(/\s+/g,' '),
    domicilio:String(input?.domicilio||'').trim().replace(/\s+/g,' '),
    observaciones:String(input?.observaciones||'').trim()
  };
}

function catalogValidateClient(input){
  const value=catalogNormalizeClient(input),errors={};
  if(value.nombre.length<2||value.nombre.length>80)errors.nombre='Ingresá tu nombre.';
  if(value.apellido.length<2||value.apellido.length>80)errors.apellido='Ingresá tu apellido.';
  if(value.dni.length<6||value.dni.length>9)errors.dni='Ingresá un DNI válido.';
  if(value.telefono.length<8||value.telefono.length>15)errors.telefono='Ingresá un WhatsApp válido.';
  if(value.localidad.length<2||value.localidad.length>120)errors.localidad='Ingresá tu localidad.';
  if(value.domicilio.length<4||value.domicilio.length>240)errors.domicilio='Ingresá tu domicilio.';
  if(value.observaciones.length>1000)errors.observaciones='Máximo 1000 caracteres.';
  return {ok:Object.keys(errors).length===0,value,errors};
}

function catalogProductImage(product,detail=false){
  if(product?.imagen_url)return `<img class="catalog-product-image" src="${catalogEscape(product.imagen_url)}" alt="${catalogEscape(product.nombre)}" loading="${detail?'eager':'lazy'}">`;
  return '<div class="catalog-product-image-placeholder">Imagen no disponible</div>';
}

function catalogPlanLine(plan){
  if(!plan)return 'No disponible';
  if(Number(plan.cantidad_cuotas)>0)return `${Number(plan.cantidad_cuotas)} × ${catalogMoney(plan.valor_cuota)}`;
  return catalogMoney(plan.total);
}

function catalogSetPublicSection(id){
  ['catalogPublicLoading','catalogPublicError','catalogPublicView','catalogProductView','catalogCheckoutView','catalogSuccessView'].forEach(name=>catalogEl(name)?.classList.toggle('hide',name!==id));
  window.scrollTo({top:0,behavior:'smooth'});
}

function catalogHideOtherRoots(){
  ['loginScreen','clientRoot','referralRoot','recruitmentRoot','appScreen'].forEach(id=>catalogEl(id)?.classList.add('hide'));
  document.body.classList.remove('seller-mode','client-mode','recruitment-public-mode');
  document.body.classList.add('catalog-public-mode');
  catalogEl('catalogPublicRoot')?.classList.remove('hide');
}

async function bootCatalogPublic(token,{demo=false,start='catalog'}={}){
  initCatalogPurchaseUi();
  catalogHideOtherRoots();
  catalogSetPublicSection('catalogPublicLoading');
  catalogPublicState={token:String(token||''),seller:null,products:[],category:'',search:'',product:null,modality:'',customer:null,step:1,idempotency:'',demo};
  catalogEl('catalogPreviewFlag')?.classList.toggle('hide',!demo);

  let payload;
  if(demo){
    payload={disponible:true,vendedor:{nombre:'Sofía · Vendedora REST'},productos:catalogDemoProducts()};
  }else{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(token||''))){
      catalogShowPublicError('El enlace no es válido. Pedile a tu vendedor REST que vuelva a compartirlo.');return;
    }
    const {data,error}=await sb.rpc('obtener_catalogo_publico',{p_token:String(token)});
    if(error){catalogShowPublicError('No pudimos abrir el catálogo en este momento. Intentá nuevamente más tarde.');return}
    payload=data;
  }

  if(!payload?.disponible){catalogShowPublicError(payload?.mensaje||'Este catálogo no está disponible.');return}
  catalogPublicState.seller=payload.vendedor||null;
  catalogPublicState.products=Array.isArray(payload.productos)?payload.productos:[];
  if(catalogEl('catalogPublicSeller'))catalogEl('catalogPublicSeller').innerHTML=`Te acompaña <b>${catalogEscape(payload.vendedor?.nombre||'Equipo REST')}</b>`;
  catalogRenderProducts();
  catalogSetPublicSection('catalogPublicView');

  if(start==='product'&&catalogPublicState.products[0])catalogOpenProduct(catalogPublicState.products[0].id);
  if(start==='form'&&catalogPublicState.products[0]){
    catalogOpenProduct(catalogPublicState.products[0].id);catalogBeginPurchase();catalogSelectModality('credito_6');catalogGoToStep(2);
  }
  if(start==='success'&&catalogPublicState.products[0]){
    catalogPublicState.product=catalogPublicState.products[0];catalogPublicState.modality='credito_6';catalogShowSuccess({codigo:'SC-DEMO-001'});
  }
}

function catalogShowPublicError(message){if(catalogEl('catalogPublicErrorText'))catalogEl('catalogPublicErrorText').textContent=message;catalogSetPublicSection('catalogPublicError')}

function catalogRenderProducts(){
  const query=catalogPublicState.search.toLowerCase();
  const products=catalogPublicState.products.filter(product=>(!catalogPublicState.category||product.categoria===catalogPublicState.category)&&(!query||`${product.nombre} ${product.subcategoria||''} ${product.categoria}`.toLowerCase().includes(query)));
  if(catalogEl('catalogPublicCount'))catalogEl('catalogPublicCount').textContent=`${products.length} producto${products.length===1?'':'s'} disponible${products.length===1?'':'s'}`;
  if(!catalogEl('catalogPublicProducts'))return;
  catalogEl('catalogPublicProducts').innerHTML=products.map(product=>{
    const six=product.opciones?.credito_6,nine=product.opciones?.credito_9;
    return `<article class="catalog-product-card">${catalogProductImage(product)}<div class="catalog-product-body"><div class="catalog-product-category">${catalogEscape(product.categoria)}</div><h2>${catalogEscape(product.nombre)}</h2><div class="catalog-product-description">${catalogEscape(product.subcategoria||'')}</div><div><div class="catalog-cash-label">Precio contado</div><div class="catalog-cash-price">${catalogMoney(product.opciones?.contado?.total??product.precio_contado)}</div></div><div class="catalog-installments">${six?`<div class="catalog-installment">6 cuotas<b>${catalogMoney(six.valor_cuota)}</b></div>`:''}${nine?`<div class="catalog-installment">9 cuotas<b>${catalogMoney(nine.valor_cuota)}</b></div>`:''}</div><button class="catalog-primary" type="button" onclick="catalogOpenProduct('${catalogEscape(product.id)}')">VER PRODUCTO</button></div></article>`;
  }).join('')||'<div class="catalog-state-card"><h2>Sin resultados</h2><p>Probá con otra búsqueda o categoría.</p></div>';
}

function catalogOpenProduct(id){
  const product=catalogPublicState.products.find(item=>item.id===id);if(!product)return;
  catalogPublicState.product=product;catalogPublicState.modality='';catalogPublicState.customer=null;
  const plans=['credito_6','credito_9'].map(code=>product.opciones?.[code]).filter(Boolean);
  catalogEl('catalogProductDetail').innerHTML=`<div class="catalog-detail-grid"><div class="catalog-detail-media">${catalogProductImage(product,true)}</div><div class="catalog-detail-copy"><div class="catalog-public-eyebrow" style="color:#145bb4">${catalogEscape(product.categoria)}${product.subcategoria?' · '+catalogEscape(product.subcategoria):''}</div><h1>${catalogEscape(product.nombre)}</h1><p>Consultá las alternativas comerciales vigentes para este producto.</p><div class="catalog-detail-price"><span class="muted">Precio contado</span><strong>${catalogMoney(product.opciones?.contado?.total??product.precio_contado)}</strong></div><div class="catalog-plan-list">${plans.map(plan=>`<div class="catalog-plan-row"><div><b>${catalogEscape(plan.titulo)}</b><span>Total ${catalogMoney(plan.total)}</span></div><strong>${catalogPlanLine(plan)}</strong></div>`).join('')}</div><button class="catalog-primary full" type="button" onclick="catalogBeginPurchase()">QUIERO COMPRAR</button><p class="catalog-legal">La solicitud será evaluada por Administración. No confirma una compra ni una aprobación de crédito.</p></div></div>`;
  catalogSetPublicSection('catalogProductView');
}

function catalogBackToList(){catalogSetPublicSection('catalogPublicView')}
function catalogBeginPurchase(){if(!catalogPublicState.product)return;catalogPublicState.modality='';catalogPublicState.step=1;catalogRenderCheckoutProduct();catalogRenderPlanChoices();catalogGoToStep(1);catalogSetPublicSection('catalogCheckoutView')}

function catalogRenderCheckoutProduct(){
  const product=catalogPublicState.product;if(!product||!catalogEl('catalogCheckoutProduct'))return;
  const thumb=product.imagen_url?`<img src="${catalogEscape(product.imagen_url)}" alt="">`:'<div class="catalog-thumb-placeholder">Sin foto</div>';
  catalogEl('catalogCheckoutProduct').innerHTML=`${thumb}<div><b>${catalogEscape(product.nombre)}</b><span>${catalogEscape(product.subcategoria||product.categoria)}</span></div>`;
}

function catalogRenderPlanChoices(){
  const product=catalogPublicState.product;if(!product||!catalogEl('catalogPlanChoices'))return;
  catalogEl('catalogPlanChoices').innerHTML=['contado','credito_6','credito_9'].filter(code=>product.opciones?.[code]).map(code=>{
    const plan=product.opciones[code],detail=Number(plan.cantidad_cuotas)>0?`${plan.cantidad_cuotas} pagos mensuales · total ${catalogMoney(plan.total)}`:'Pago único';
    return `<button type="button" class="catalog-choice ${catalogPublicState.modality===code?'active':''}" onclick="catalogSelectModality('${code}')"><span><b>${catalogEscape(catalogModalityLabel(code))}</b><small>${catalogEscape(detail)}</small></span><span class="catalog-choice-price">${Number(plan.cantidad_cuotas)>0?catalogPlanLine(plan):catalogMoney(plan.total)}</span></button>`;
  }).join('');
  if(catalogEl('catalogPlanContinue'))catalogEl('catalogPlanContinue').disabled=!catalogPublicState.modality;
}

function catalogSelectModality(code){if(!catalogPublicState.product?.opciones?.[code])return;catalogPublicState.modality=code;catalogRenderPlanChoices()}

function catalogCheckoutBack(){
  if(catalogPublicState.step===3){catalogGoToStep(2);return}
  if(catalogPublicState.step===2){catalogGoToStep(1);return}
  catalogSetPublicSection('catalogProductView');
}

function catalogGoToStep(step){
  catalogPublicState.step=step;
  catalogEl('catalogPlanStep')?.classList.toggle('hide',step!==1);
  catalogEl('catalogCustomerForm')?.classList.toggle('hide',step!==2);
  catalogEl('catalogReviewStep')?.classList.toggle('hide',step!==3);
  [1,2,3].forEach(number=>catalogEl(`catalogStepBar${number}`)?.classList.toggle('active',number<=step));
  const titles={1:['Elegí cómo pagar','Seleccioná una de las opciones disponibles.'],2:['Completá tus datos','Solo pedimos lo necesario para poder contactarte.'],3:['Revisá tu solicitud','Confirmá producto, modalidad y datos antes de enviar.']};
  if(catalogEl('catalogCheckoutTitle'))catalogEl('catalogCheckoutTitle').textContent=titles[step][0];
  if(catalogEl('catalogCheckoutLead'))catalogEl('catalogCheckoutLead').textContent=titles[step][1];
  if(step===3)catalogRenderReview();
  window.scrollTo({top:0,behavior:'smooth'});
}

function catalogReadCustomerForm(){return {nombre:catalogEl('catalogFirstName')?.value,apellido:catalogEl('catalogLastName')?.value,dni:catalogEl('catalogDni')?.value,telefono:catalogEl('catalogPhone')?.value,localidad:catalogEl('catalogCity')?.value,domicilio:catalogEl('catalogAddress')?.value,observaciones:catalogEl('catalogNotes')?.value}}
function catalogClearFormErrors(){['FirstName','LastName','Dni','Phone','City','Address','Notes'].forEach(name=>{const el=catalogEl(`catalog${name}Error`);if(el)el.textContent=''})}
function catalogShowFormErrors(errors){const ids={nombre:'FirstName',apellido:'LastName',dni:'Dni',telefono:'Phone',localidad:'City',domicilio:'Address',observaciones:'Notes'};catalogClearFormErrors();Object.entries(errors).forEach(([key,message])=>{const el=catalogEl(`catalog${ids[key]}Error`);if(el)el.textContent=message})}

function catalogHandleCustomerSubmit(event){
  event.preventDefault();const result=catalogValidateClient(catalogReadCustomerForm());catalogShowFormErrors(result.errors);
  if(!result.ok){catalogEl(`catalog${({nombre:'FirstName',apellido:'LastName',dni:'Dni',telefono:'Phone',localidad:'City',domicilio:'Address',observaciones:'Notes'})[Object.keys(result.errors)[0]]}`)?.focus();return}
  catalogPublicState.customer=result.value;catalogGoToStep(3);
}

function catalogRenderReview(){
  const product=catalogPublicState.product,plan=product?.opciones?.[catalogPublicState.modality],client=catalogPublicState.customer;if(!product||!plan||!client)return;
  catalogEl('catalogReviewSummary').innerHTML=`<div class="catalog-review-section"><h3>Producto y modalidad</h3><div class="catalog-review-row"><span>Producto</span><strong>${catalogEscape(product.nombre)}</strong></div><div class="catalog-review-row"><span>Modalidad</span><strong>${catalogEscape(catalogModalityLabel(catalogPublicState.modality))}</strong></div><div class="catalog-review-row"><span>${Number(plan.cantidad_cuotas)>0?'Cuota':'Precio'}</span><strong>${Number(plan.cantidad_cuotas)>0?catalogPlanLine(plan):catalogMoney(plan.total)}</strong></div>${Number(plan.cantidad_cuotas)>0?`<div class="catalog-review-row"><span>Total financiado</span><strong>${catalogMoney(plan.total)}</strong></div>`:''}</div><div class="catalog-review-section"><h3>Tus datos</h3><div class="catalog-review-row"><span>Nombre</span><strong>${catalogEscape(client.nombre+' '+client.apellido)}</strong></div><div class="catalog-review-row"><span>DNI</span><strong>${catalogEscape(client.dni)}</strong></div><div class="catalog-review-row"><span>WhatsApp</span><strong>${catalogEscape(client.telefono)}</strong></div><div class="catalog-review-row"><span>Domicilio</span><strong>${catalogEscape(client.domicilio+', '+client.localidad)}</strong></div>${client.observaciones?`<div class="catalog-review-row"><span>Observaciones</span><strong>${catalogEscape(client.observaciones)}</strong></div>`:''}</div>`;
}

async function catalogSubmitRequest(){
  const button=catalogEl('catalogSubmitRequest'),status=catalogEl('catalogSubmitStatus');if(!catalogPublicState.product||!catalogPublicState.modality||!catalogPublicState.customer||!button)return;
  button.disabled=true;button.textContent='ENVIANDO...';status?.classList.add('hide');
  catalogPublicState.idempotency=catalogPublicState.idempotency||(globalThis.crypto?.randomUUID?.()||'00000000-0000-4000-8000-'+String(Date.now()).padStart(12,'0').slice(-12));
  let result,error;
  if(catalogPublicState.demo){result={ok:true,codigo:'SC-DEMO-'+catalogPublicState.idempotency.slice(0,8).toUpperCase()}}
  else{
    const response=await sb.rpc('crear_solicitud_compra_publica',{p_token:catalogPublicState.token,p_producto_id:catalogPublicState.product.id,p_modalidad:catalogPublicState.modality,p_cliente:catalogPublicState.customer,p_clave_idempotencia:catalogPublicState.idempotency,p_sitio_web:catalogEl('catalogWebsite')?.value||null});
    result=response.data;error=response.error;
  }
  button.disabled=false;button.textContent='ENVIAR SOLICITUD';
  if(error||!result?.ok){if(status){status.textContent=error?.message||'No pudimos enviar la solicitud. Revisá los datos e intentá nuevamente.';status.classList.remove('hide')}return}
  catalogShowSuccess(result);
}

function catalogShowSuccess(result){
  const product=catalogPublicState.product,plan=product?.opciones?.[catalogPublicState.modality];
  if(catalogEl('catalogSuccessSummary'))catalogEl('catalogSuccessSummary').innerHTML=`<div class="catalog-review-row"><span>Producto</span><strong>${catalogEscape(product?.nombre||result?.producto||'')}</strong></div><div class="catalog-review-row"><span>Modalidad</span><strong>${catalogEscape(catalogModalityLabel(catalogPublicState.modality)||result?.modalidad||'')}</strong></div>${plan?`<div class="catalog-review-row"><span>${Number(plan.cantidad_cuotas)>0?'Cuota':'Precio'}</span><strong>${Number(plan.cantidad_cuotas)>0?catalogPlanLine(plan):catalogMoney(plan.total)}</strong></div>`:''}`;
  if(catalogEl('catalogSuccessCode'))catalogEl('catalogSuccessCode').textContent=result?.codigo?`Código de seguimiento: ${result.codigo}`:'';
  catalogSetPublicSection('catalogSuccessView');
}

function catalogStartAgain(){catalogPublicState.product=null;catalogPublicState.modality='';catalogPublicState.customer=null;catalogPublicState.idempotency='';catalogClearFormErrors();catalogEl('catalogCustomerForm')?.reset();catalogSetPublicSection('catalogPublicView')}

function initCatalogPurchaseUi(){
  if(catalogPurchaseUiReady||typeof document==='undefined')return;catalogPurchaseUiReady=true;
  catalogEl('catalogPublicSearch')?.addEventListener('input',event=>{catalogPublicState.search=event.target.value||'';catalogRenderProducts()});
  catalogEl('catalogPublicChips')?.addEventListener('click',event=>{const button=event.target.closest('[data-public-category]');if(!button)return;catalogPublicState.category=button.dataset.publicCategory||'';catalogEl('catalogPublicChips').querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));catalogRenderProducts()});
  catalogEl('catalogPlanContinue')?.addEventListener('click',()=>{if(catalogPublicState.modality)catalogGoToStep(2)});
  catalogEl('catalogCustomerForm')?.addEventListener('submit',catalogHandleCustomerSubmit);
  catalogEl('catalogSubmitRequest')?.addEventListener('click',catalogSubmitRequest);
  ['catalogRequestStateFilter','catalogRequestSellerFilter','catalogRequestModeFilter','catalogRequestDateFrom','catalogRequestDateTo'].forEach(id=>catalogEl(id)?.addEventListener('change',renderAdminCatalogRequests));
}

function catalogSnapshotMode(request){return request?.snapshot_solicitado?.seleccion?.codigo||(/6/.test(request?.forma_pago||'')?'credito_6':/9/.test(request?.forma_pago||'')?'credito_9':'contado')}
function catalogDemoAdminRequests(){
  const products=catalogDemoProducts(),now=new Date();
  const make=(index,state,days,name,seller)=>{const product=products[index],mode=index%2?'credito_9':'credito_6',plan={...product.opciones[mode],primer_vencimiento:'2026-11-07'};const created=new Date(now.getTime()-days*86400000).toISOString();return {id:`10000000-0000-4000-8000-00000000000${index+1}`,codigo:`SC-2026100${8-days}-DEMO${index+1}`,canal_origen:'catalogo_publico_vendedor',estado_comercial:state,creado_en:created,cliente_nombre:name,cliente_dni:index?'32456789':'30123456',cliente_telefono:index?'5493855550188':'5493855550123',cliente_direccion:index?'Av. Belgrano 820':'San Martín 145',cliente_ciudad:'Santiago del Estero',notas:index?'Prefiere contacto por la tarde':null,producto_id:product.id,producto_nombre:product.nombre,producto_precio_contado:product.precio_contado,forma_pago:plan.titulo,monto_total:plan.total,cantidad_cuotas:plan.cantidad_cuotas,valor_cuota:plan.valor_cuota,vendedor_id:`20000000-0000-4000-8000-00000000000${index+1}`,vendedores:{nombre:seller,activo:true},snapshot_solicitado:{version:1,capturado_en:created,producto:product,opciones:product.opciones,seleccion:plan,vendedor_origen:{nombre:seller}},snapshot_final:null,venta_id:null,cuenta_credito_id:null,_history:[{id:1,tipo:'creada',estado_nuevo:'nueva',actor_tipo:'publico',creado_en:created}],_notes:[]}};
  return [make(0,'nueva',0,'Lucía Fernández','Sofía Gómez'),make(2,'aprobada',1,'Martín Díaz','Marcos Paz'),make(1,'contactado',2,'Carla López','Sofía Gómez')];
}

async function refreshCatalogRequestBadge(){
  if(profile?.rol!=='admin'||adminCatalogDemo)return;
  const badge=catalogEl('catalogAdminNewBadge');if(!badge)return;
  const {count,error}=await sb.from('solicitudes_venta').select('id',{count:'exact',head:true}).in('canal_origen',['catalogo_publico_vendedor','catalogo_publico_directo']).eq('estado_comercial','nueva');
  if(error)return;badge.textContent=String(count||0);badge.classList.toggle('hide',!count);
}

async function loadAdminCatalogRequests(){
  if(profile?.rol!=='admin'&&!adminCatalogDemo)return;
  const list=catalogEl('catalogRequestList');if(list)list.innerHTML='<p class="muted">Cargando solicitudes...</p>';
  if(adminCatalogDemo){adminCatalogRequests=adminCatalogRequests.length?adminCatalogRequests:catalogDemoAdminRequests();adminCatalogSellers=[{id:'20000000-0000-4000-8000-000000000001',nombre:'Sofía Gómez'},{id:'20000000-0000-4000-8000-000000000002',nombre:'Marcos Paz'}]}
  else{
    const [requests,sellers]=await Promise.all([
      sb.from('solicitudes_venta').select('*,vendedores(nombre,activo)').in('canal_origen',['catalogo_publico_vendedor','catalogo_publico_directo']).order('creado_en',{ascending:false}),
      sb.from('vendedores').select('id,nombre,activo').order('nombre')
    ]);
    if(requests.error){if(list)list.innerHTML=`<p class="muted">No pude cargar las solicitudes: ${catalogEscape(requests.error.message)}</p>`;return}
    adminCatalogRequests=requests.data||[];adminCatalogSellers=sellers.data||[];
  }
  if(catalogEl('catalogRequestSellerFilter')){const current=catalogEl('catalogRequestSellerFilter').value;catalogEl('catalogRequestSellerFilter').innerHTML='<option value="">Todos los vendedores</option>'+adminCatalogSellers.map(item=>`<option value="${catalogEscape(item.id)}">${catalogEscape(item.nombre)}${item.activo===false?' · inactivo':''}</option>`).join('');catalogEl('catalogRequestSellerFilter').value=current}
  renderAdminCatalogRequests();
}

function renderAdminCatalogRequests(){
  const state=catalogEl('catalogRequestStateFilter')?.value||'',sellerId=catalogEl('catalogRequestSellerFilter')?.value||'',mode=catalogEl('catalogRequestModeFilter')?.value||'',from=catalogEl('catalogRequestDateFrom')?.value||'',to=catalogEl('catalogRequestDateTo')?.value||'';
  const rows=adminCatalogRequests.filter(request=>{const date=String(request.creado_en||'').slice(0,10);return (!state||request.estado_comercial===state)&&(!sellerId||request.vendedor_id===sellerId)&&(!mode||catalogSnapshotMode(request)===mode)&&(!from||date>=from)&&(!to||date<=to)});
  const total=adminCatalogRequests.length,newCount=adminCatalogRequests.filter(item=>item.estado_comercial==='nueva').length,open=adminCatalogRequests.filter(item=>['en_revision','contactado','aprobada'].includes(item.estado_comercial)).length,converted=adminCatalogRequests.filter(item=>item.estado_comercial==='convertida_en_venta').length;
  [['catalogRequestKpiTotal',total],['catalogRequestKpiNew',newCount],['catalogRequestKpiOpen',open],['catalogRequestKpiConverted',converted]].forEach(([id,value])=>{if(catalogEl(id))catalogEl(id).textContent=value});
  const badge=catalogEl('catalogAdminNewBadge');if(badge){badge.textContent=newCount;badge.classList.toggle('hide',!newCount)}
  if(catalogEl('catalogRequestCount'))catalogEl('catalogRequestCount').textContent=`${rows.length} solicitud${rows.length===1?'':'es'}`;
  if(catalogEl('catalogRequestList'))catalogEl('catalogRequestList').innerHTML=rows.map(request=>`<article class="catalog-request-card ${request.id===adminCatalogSelectedId?'active':''}" onclick="openAdminCatalogRequest('${catalogEscape(request.id)}')"><div class="catalog-request-card-head"><div><h4>${catalogEscape(request.cliente_nombre)}</h4><div class="catalog-request-meta"><b>${catalogEscape(request.producto_nombre)}</b><br>${catalogEscape(catalogModalityLabel(catalogSnapshotMode(request)))} · ${catalogEscape(request.vendedores?.nombre||'REST directo')}<br>${catalogEscape(request.codigo||'')} · ${catalogEscape(catalogDateTime(request.creado_en))}</div></div><span class="catalog-status-pill ${catalogEscape(request.estado_comercial)}">${catalogEscape(catalogRequestStateLabel(request.estado_comercial))}</span></div></article>`).join('')||'<p class="muted">No hay solicitudes con esos filtros.</p>';
}

async function openAdminCatalogRequest(id){
  const request=adminCatalogRequests.find(item=>item.id===id);if(!request)return;adminCatalogSelectedId=id;renderAdminCatalogRequests();
  let history=request._history||[],notes=request._notes||[];
  if(!adminCatalogDemo){const [historyResult,notesResult]=await Promise.all([sb.from('solicitudes_compra_historial').select('*').eq('solicitud_id',id).order('creado_en',{ascending:true}),sb.from('solicitudes_compra_notas').select('*').eq('solicitud_id',id).order('creado_en',{ascending:false})]);history=historyResult.data||[];notes=notesResult.data||[]}
  renderAdminCatalogRequestDetail(request,history,notes);
}

function catalogConditionsHtml(snapshot,title){
  if(!snapshot||!snapshot.seleccion)return `<div class="catalog-admin-block"><h4>${catalogEscape(title)}</h4><p class="muted">Sin condiciones registradas.</p></div>`;
  const selected=snapshot.seleccion,options=snapshot.opciones||{};
  return `<div class="catalog-admin-block"><h4>${catalogEscape(title)}</h4><p><b>Producto:</b> ${catalogEscape(snapshot.producto?.nombre||'—')}</p><p><b>Contado:</b> ${catalogMoney(options.contado?.total??snapshot.producto?.precio_contado)}</p><p><b>6 cuotas:</b> ${options.credito_6?catalogPlanLine(options.credito_6)+' · total '+catalogMoney(options.credito_6.total):'No disponible'}</p><p><b>9 cuotas:</b> ${options.credito_9?catalogPlanLine(options.credito_9)+' · total '+catalogMoney(options.credito_9.total):'No disponible'}</p><p><b>Elegida:</b> ${catalogEscape(catalogModalityLabel(selected.codigo))} · ${Number(selected.cantidad_cuotas)>0?catalogPlanLine(selected):catalogMoney(selected.total)}</p><p class="muted">Capturada ${catalogEscape(catalogDateTime(snapshot.capturado_en||snapshot.definido_en))}</p></div>`;
}

function renderAdminCatalogRequestDetail(request,history,notes){
  const detail=catalogEl('catalogRequestDetail');if(!detail)return;
  const closed=['rechazada','convertida_en_venta'].includes(request.estado_comercial),approved=request.estado_comercial==='aprobada';
  const phone=encodeURIComponent(catalogDigits(request.cliente_telefono));
  const actions=[];
  if(!closed&&request.cliente_telefono)actions.push(`<button class="btn good" type="button" onclick="adminCatalogContact('${request.id}')">CONTACTAR POR WHATSAPP</button>`);
  if(request.estado_comercial==='nueva')actions.push(`<button class="btn btn2" type="button" onclick="adminCatalogSetState('${request.id}','en_revision')">MARCAR EN REVISIÓN</button>`);
  if(['nueva','en_revision'].includes(request.estado_comercial))actions.push(`<button class="btn btn2" type="button" onclick="adminCatalogSetState('${request.id}','contactado')">MARCAR CONTACTADO</button>`);
  if(['nueva','en_revision','contactado'].includes(request.estado_comercial))actions.push(`<button class="btn good" type="button" onclick="adminCatalogSetState('${request.id}','aprobada')">APROBAR</button><button class="btn danger" type="button" onclick="adminCatalogSetState('${request.id}','rechazada')">RECHAZAR</button>`);
  const finalControls=approved?`<div class="catalog-admin-block"><h4>Condiciones finales autorizadas</h4><p class="muted">Se recalculan con las reglas vigentes y se guardan sin sobrescribir lo solicitado.</p><select id="adminCatalogFinalMode" class="input"><option value="contado">Contado</option><option value="credito_6">6 cuotas</option><option value="credito_9">9 cuotas</option></select><div class="catalog-admin-actions"><button class="btn btn2" type="button" onclick="adminCatalogSaveFinal('${request.id}')">GUARDAR CONDICIONES FINALES</button><button class="btn good" type="button" onclick="adminCatalogConvert('${request.id}')">CONVERTIR EN VENTA</button></div></div>`:'';
  detail.innerHTML=`<div class="catalog-request-card-head"><div><h3>${catalogEscape(request.codigo||'Solicitud')}</h3><div class="muted">${catalogEscape(catalogDateTime(request.creado_en))}</div></div><span class="catalog-status-pill ${catalogEscape(request.estado_comercial)}">${catalogEscape(catalogRequestStateLabel(request.estado_comercial))}</span></div><div class="catalog-admin-detail-grid"><div class="catalog-admin-block"><h4>Datos del cliente</h4><p><b>${catalogEscape(request.cliente_nombre)}</b></p><p>DNI ${catalogEscape(request.cliente_dni||'—')}</p><p>WhatsApp ${catalogEscape(request.cliente_telefono||'—')}</p><p>${catalogEscape(request.cliente_direccion||'—')} · ${catalogEscape(request.cliente_ciudad||'—')}</p>${request.notas?`<p><b>Observaciones:</b> ${catalogEscape(request.notas)}</p>`:''}</div><div class="catalog-admin-block"><h4>Origen comercial</h4><p><b>Vendedor:</b> ${catalogEscape(request.snapshot_solicitado?.vendedor_origen?.nombre||request.vendedores?.nombre||'REST directo')}</p><p><b>Canal:</b> ${catalogEscape(request.canal_origen==='catalogo_publico_directo'?'Catálogo general REST':'Catálogo personal')}</p><p><b>Producto:</b> ${catalogEscape(request.producto_nombre)}</p>${request.venta_id?`<p><b>Venta:</b> ${catalogEscape(request.venta_id)}</p>`:''}</div>${catalogConditionsHtml(request.snapshot_solicitado,'Condiciones que vio el cliente')}${catalogConditionsHtml(request.snapshot_final,'Condiciones finales de la venta')}</div><div class="catalog-admin-actions">${actions.join('')}</div>${finalControls}<div class="catalog-admin-block"><h4>Notas internas</h4><div class="catalog-note-compose"><textarea id="adminCatalogNote" class="input" maxlength="2000" placeholder="Agregar una nota visible solo para Administración"></textarea><button class="btn btn2" type="button" onclick="adminCatalogAddNote('${request.id}')">AGREGAR NOTA</button></div><div style="margin-top:8px">${notes.map(note=>`<div class="item">${catalogEscape(note.nota)}<br><span class="muted">${catalogEscape(catalogDateTime(note.creado_en))}</span></div>`).join('')||'<p class="muted">Sin notas internas.</p>'}</div></div><div class="catalog-admin-block"><h4>Historial</h4><div class="catalog-history">${history.map(entry=>`<div class="catalog-history-entry"><b>${catalogEscape(entry.tipo.replaceAll('_',' '))}</b>${entry.estado_nuevo?` · ${catalogEscape(catalogRequestStateLabel(entry.estado_nuevo))}`:''}<time>${catalogEscape(catalogDateTime(entry.creado_en))}</time></div>`).join('')||'<p class="muted">Sin movimientos.</p>'}</div></div>`;
  detail.classList.remove('hide');
  if(request.snapshot_final?.seleccion?.codigo&&catalogEl('adminCatalogFinalMode'))catalogEl('adminCatalogFinalMode').value=request.snapshot_final.seleccion.codigo;
  detail.scrollIntoView({behavior:'smooth',block:'start'});
}

function adminCatalogContact(id){const request=adminCatalogRequests.find(item=>item.id===id);if(!request)return;const phone=catalogDigits(request.cliente_telefono),firstName=String(request.cliente_nombre||'').split(' ')[0];if(!phone)return alert('La solicitud no tiene un teléfono válido.');const message=`Hola ${firstName}, te contactamos de REST por tu solicitud del ${request.producto_nombre}.`;window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener')}

async function adminCatalogSetState(id,state){
  const request=adminCatalogRequests.find(item=>item.id===id);if(!request)return;let note=null;
  if(state==='rechazada'){note=prompt('Motivo del rechazo:');if(note===null)return;if(!note.trim())return alert('Indicá el motivo del rechazo.')}
  if(state==='aprobada'&&!confirm('¿Aprobar comercialmente esta solicitud? Todavía no se creará la venta.'))return;
  if(adminCatalogDemo){const previous=request.estado_comercial;request.estado_comercial=state;request._history.push({id:Date.now(),tipo:'estado_actualizado',estado_anterior:previous,estado_nuevo:state,creado_en:new Date().toISOString()});if(note)request._notes.unshift({id:String(Date.now()),nota:note,creado_en:new Date().toISOString()});renderAdminCatalogRequests();await openAdminCatalogRequest(id);return}
  const {error}=await sb.rpc('actualizar_estado_solicitud_compra',{p_solicitud_id:id,p_estado:state,p_nota:note});if(error)return alert(error.message);await loadAdminCatalogRequests();await openAdminCatalogRequest(id);
}

async function adminCatalogSaveFinal(id){
  const request=adminCatalogRequests.find(item=>item.id===id),mode=catalogEl('adminCatalogFinalMode')?.value;if(!request||!mode)return;
  if(adminCatalogDemo){const original=request.snapshot_solicitado,selection=original.opciones[mode];request.snapshot_final={version:1,definido_en:new Date().toISOString(),producto:original.producto,opciones:original.opciones,seleccion:selection};request._history.push({id:Date.now(),tipo:'condiciones_finales',estado_nuevo:request.estado_comercial,creado_en:new Date().toISOString()});await openAdminCatalogRequest(id);return}
  const {error}=await sb.rpc('guardar_condiciones_finales_solicitud',{p_solicitud_id:id,p_modalidad:mode});if(error)return alert(error.message);await loadAdminCatalogRequests();await openAdminCatalogRequest(id);
}

async function adminCatalogConvert(id){
  const request=adminCatalogRequests.find(item=>item.id===id);if(!request||!confirm('¿Convertir esta solicitud en una venta REST? Se reutilizará el cliente por DNI y no podrá convertirse dos veces.'))return;
  if(adminCatalogDemo){request.estado_comercial='convertida_en_venta';request.venta_id='30000000-0000-4000-8000-000000000001';request.cuenta_credito_id='40000000-0000-4000-8000-000000000001';request._history.push({id:Date.now(),tipo:'convertida_en_venta',estado_anterior:'aprobada',estado_nuevo:'convertida_en_venta',creado_en:new Date().toISOString()});renderAdminCatalogRequests();await openAdminCatalogRequest(id);alert('Vista previa: solicitud convertida sin crear datos reales.');return}
  const {data,error}=await sb.rpc('convertir_solicitud_compra',{p_solicitud_id:id});if(error)return alert(error.message);alert(data?.duplicado?'La solicitud ya estaba convertida; no se duplicó la venta.':'Solicitud convertida correctamente en venta.');await loadAdminCatalogRequests();await openAdminCatalogRequest(id);
}

async function adminCatalogAddNote(id){
  const text=String(catalogEl('adminCatalogNote')?.value||'').trim();if(!text)return alert('Escribí una nota.');
  const request=adminCatalogRequests.find(item=>item.id===id);if(adminCatalogDemo){request._notes.unshift({id:String(Date.now()),nota:text,creado_en:new Date().toISOString()});await openAdminCatalogRequest(id);return}
  const {error}=await sb.rpc('agregar_nota_solicitud_compra',{p_solicitud_id:id,p_nota:text});if(error)return alert(error.message);await openAdminCatalogRequest(id);
}

function sellerCatalogRequestDemoRows(){return [{codigo:'SC-20261008-DEMO1',producto_nombre:'Alacena 120 cm',estado_comercial:'nueva',creado_en:new Date().toISOString()},{codigo:'SC-20261007-DEMO2',producto_nombre:'iPhone 11 Pro 256GB 100% Gris',estado_comercial:'en_revision',creado_en:new Date(Date.now()-86400000).toISOString()},{codigo:'SC-20261005-DEMO3',producto_nombre:'Armario multiuso Acapulco',estado_comercial:'convertida_en_venta',creado_en:new Date(Date.now()-3*86400000).toISOString()}]}

async function refreshSellerCatalogTools(){
  if(!seller?.id&&!sellerCatalogDemo)return;
  const token=seller?.catalogo_token;
  if(catalogEl('sellerCatalogLink'))catalogEl('sellerCatalogLink').value=token?catalogPublicUrl(token):'';
  if(!token){if(catalogEl('sellerCatalogLinkStatus'))catalogEl('sellerCatalogLinkStatus').textContent='El enlace se habilitará al aplicar la migración de catálogo.';return}
  if(catalogEl('sellerCatalogLinkStatus'))catalogEl('sellerCatalogLinkStatus').textContent='Listo para compartir. El token solo atribuye solicitudes; no permite ingresar al portal.';
  let rows=[];
  if(sellerCatalogDemo)rows=sellerCatalogRequestDemoRows();
  else{
    const {data,error}=await sb.from('solicitudes_venta').select('codigo,producto_nombre,estado_comercial,creado_en').eq('vendedor_id',seller.id).in('canal_origen',['catalogo_publico_vendedor','catalogo_publico_directo']).order('creado_en',{ascending:false}).limit(20);
    if(error){if(catalogEl('sellerCatalogRequestPreview'))catalogEl('sellerCatalogRequestPreview').textContent='No pude cargar las solicitudes originadas.';return}rows=data||[];
  }
  const values=[rows.filter(item=>item.estado_comercial==='nueva').length,rows.filter(item=>['en_revision','contactado'].includes(item.estado_comercial)).length,rows.filter(item=>item.estado_comercial==='aprobada').length,rows.filter(item=>item.estado_comercial==='convertida_en_venta').length];
  if(catalogEl('sellerCatalogRequestStats'))catalogEl('sellerCatalogRequestStats').innerHTML=[['Nuevas',values[0]],['En revisión',values[1]],['Aprobadas',values[2]],['Convertidas',values[3]]].map(([label,value])=>`<div class="seller-catalog-stat"><b>${value}</b><span>${label}</span></div>`).join('');
  if(catalogEl('sellerCatalogRequestPreview'))catalogEl('sellerCatalogRequestPreview').innerHTML=rows.slice(0,3).map(item=>`<div class="seller-catalog-request"><b>${catalogEscape(item.producto_nombre)}</b> · ${catalogEscape(catalogRequestStateLabel(item.estado_comercial))}<br><span>${catalogEscape(item.codigo||'')} · ${catalogEscape(catalogDateTime(item.creado_en))}</span></div>`).join('')||'Todavía no hay solicitudes generadas.';
}

async function catalogCopyText(text){if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return}const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}
async function copySellerCatalogLink(){const link=catalogEl('sellerCatalogLink')?.value;if(!link)return alert('Tu enlace todavía no está disponible.');try{await catalogCopyText(link);if(catalogEl('sellerCatalogLinkStatus'))catalogEl('sellerCatalogLinkStatus').textContent='✓ Link copiado. Ya podés pegarlo donde quieras.'}catch(_error){alert('No pude copiar el enlace. Mantenelo presionado para copiarlo.') }}
function shareSellerCatalogWhatsApp(){const link=catalogEl('sellerCatalogLink')?.value;if(!link)return alert('Tu enlace todavía no está disponible.');const text=`Mirá el catálogo REST y enviame tu solicitud desde acá: ${link}`;window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank','noopener')}

function bootCatalogAdminDemo(){
  initCatalogPurchaseUi();adminCatalogDemo=true;adminCatalogRequests=[];profile={id:'demo-admin',nombre:'Administración REST',rol:'admin'};
  ['loginScreen','clientRoot','referralRoot','recruitmentRoot','catalogPublicRoot'].forEach(id=>catalogEl(id)?.classList.add('hide'));catalogEl('appScreen')?.classList.remove('hide');catalogEl('adminRoot')?.classList.remove('hide');catalogEl('sellerRoot')?.classList.add('hide');document.body.classList.remove('seller-mode','catalog-public-mode');
  if(catalogEl('helloTxt'))catalogEl('helloTxt').textContent='Vista previa · Administración';if(catalogEl('roleTxt'))catalogEl('roleTxt').textContent='Solicitudes de compra';document.querySelectorAll('#adminRoot .panel').forEach(panel=>panel.classList.toggle('hide',panel.id!=='solicitudesCompraAdmin'));loadAdminCatalogRequests();
}

function bootSellerCatalogDemo(){
  initCatalogPurchaseUi();sellerCatalogDemo=true;profile={id:'demo-seller',nombre:'Sofía',rol:'vendedor'};seller={id:'demo-seller-record',nombre:'Sofía Gómez',activo:true,catalogo_token:'8d7e0f6a-506a-4c0b-b9fd-13aa93d60723',categoria_actual:'pro'};
  ['loginScreen','clientRoot','referralRoot','recruitmentRoot','catalogPublicRoot'].forEach(id=>catalogEl(id)?.classList.add('hide'));catalogEl('appScreen')?.classList.remove('hide');catalogEl('adminRoot')?.classList.add('hide');catalogEl('sellerRoot')?.classList.remove('hide');document.body.classList.remove('catalog-public-mode');document.body.classList.add('seller-mode');document.querySelectorAll('.spanel').forEach(panel=>panel.classList.toggle('hide',panel.id!=='sellerHome'));if(catalogEl('sellerGreeting'))catalogEl('sellerGreeting').textContent='Hola, Sofía 👋';refreshSellerCatalogTools();
}
