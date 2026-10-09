const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const moduleRoot=process.env.JSDOM_MODULE_DIR;
if(!moduleRoot)throw new Error('Definí JSDOM_MODULE_DIR con el directorio node_modules que contiene jsdom.');
const {JSDOM}=require(path.join(moduleRoot,'jsdom'));
const root=path.resolve(__dirname,'..');
const catalogScript=fs.readFileSync(path.join(root,'catalogo-publico.js'),'utf8');
const recruitmentScript=fs.readFileSync(path.join(root,'captacion-vendedores.js'),'utf8');
const sourceHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');

function preparedHtml(){
  return sourceHtml
    .replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',`<script>window.supabase={createClient:()=>({})};window.scrollTo=()=>{};window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>{};</script>`)
    .replace('<script src="/captacion-vendedores.js"></script>',`<script>${recruitmentScript}</script>`)
    .replace('<script src="/catalogo-publico.js"></script>',`<script>${catalogScript}</script>`);
}

async function render(route){
  const errors=[];
  const dom=new JSDOM(preparedHtml(),{
    url:`https://preview.example/?demo=${route}`,
    runScripts:'dangerously',
    pretendToBeVisual:true,
    beforeParse(window){
      window.addEventListener('error',event=>errors.push(event.error||event.message));
      window.HTMLElement.prototype.scrollIntoView=()=>{};
      Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async()=>{}},configurable:true});
    }
  });
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(errors.map(String),[]);
  return dom;
}

(async()=>{
  const publicDom=await render('catalogo-publico');
  const w=publicDom.window,d=w.document;
  assert.equal(d.getElementById('catalogPublicRoot').classList.contains('hide'),false);
  assert.equal(d.getElementById('catalogPublicView').classList.contains('hide'),false);
  assert.equal(d.querySelectorAll('.catalog-product-card').length,4);
  assert.throws(()=>w.eval("sb.from('clientes')"),/únicamente datos demostrativos/);
  w.catalogOpenProduct('7abfd694-bb76-49e3-9699-69a188003aa7');
  assert.match(d.getElementById('catalogProductDetail').textContent,/Alacena 120 cm/);
  w.catalogBeginPurchase();w.catalogSelectModality('credito_6');w.catalogGoToStep(2);
  const values={catalogFirstName:'Lucía',catalogLastName:'Fernández',catalogDni:'30.111.222',catalogPhone:'5493855550101',catalogCity:'Santiago del Estero',catalogAddress:'San Martín 145',catalogNotes:'Por la tarde'};
  for(const [id,value] of Object.entries(values))d.getElementById(id).value=value;
  d.getElementById('catalogCustomerForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(d.getElementById('catalogReviewStep').classList.contains('hide'),false);
  assert.match(d.getElementById('catalogReviewSummary').textContent,/6 ×/);
  // El cliente debe confirmar otra vez si cambiaron las condiciones en servidor.
  w.eval(`catalogPublicState.demo=false;sb.rpc=async()=>({data:{ok:false,condiciones_actualizadas:true,mensaje:'Las condiciones cambiaron. Revisá los importes.',producto_actualizado:{...catalogPublicState.product,version_cotizacion:'actualizada',precio_contado:150000,opciones:catalogDemoOptions(150000)}}})`);
  await w.catalogSubmitRequest();
  assert.equal(d.getElementById('catalogReviewStep').classList.contains('hide'),false);
  assert.match(d.getElementById('catalogSubmitStatus').textContent,/condiciones cambiaron/);
  assert.match(d.getElementById('catalogReviewSummary').textContent,/235\.500/);
  w.eval("sb.rpc=async()=>({data:{ok:true,codigo:'SC-DEMO-001'}})");
  await w.catalogSubmitRequest();
  assert.equal(d.getElementById('catalogSuccessView').classList.contains('hide'),false);
  assert.match(d.getElementById('catalogSuccessView').textContent,/Solicitud recibida/);
  publicDom.window.close();

  const adminDom=await render('solicitudes-admin');
  const adminDoc=adminDom.window.document;
  assert.equal(adminDoc.getElementById('solicitudesCompraAdmin').classList.contains('hide'),false);
  assert.equal(adminDoc.querySelectorAll('.catalog-request-card').length,3);
  await adminDom.window.openAdminCatalogRequest('10000000-0000-4000-8000-000000000003');
  assert.match(adminDoc.getElementById('catalogRequestDetail').textContent,/Condiciones que vio el cliente/);
  assert.match(adminDoc.getElementById('catalogRequestDetail').textContent,/CONVERTIR EN VENTA/);
  assert.equal(adminDoc.getElementById('adminCatalogFinalMode').value,'credito_6');
  assert.equal(adminDoc.querySelector('[data-tab="catalogoAdmin"]').disabled,true);
  assert.throws(()=>adminDom.window.eval("sb.rpc('convertir_solicitud_compra')"),/únicamente datos demostrativos/);
  adminDoc.getElementById('adminCatalogFinalMode').value='credito_9';
  await adminDom.window.adminCatalogSaveFinal('10000000-0000-4000-8000-000000000003');
  assert.equal(adminDom.window.eval('adminCatalogRequests.find(r=>r.id.endsWith("0003")).snapshot_solicitado.seleccion.codigo'),'credito_6');
  assert.equal(adminDoc.getElementById('adminCatalogFinalMode').value,'credito_9');
  await adminDom.window.adminCatalogConvert('10000000-0000-4000-8000-000000000003');
  assert.match(adminDoc.getElementById('catalogRequestDetail').textContent,/Convertida en venta/);
  adminDom.window.close();

  const sellerDom=await render('mi-catalogo');
  const sellerDoc=sellerDom.window.document;
  assert.equal(sellerDoc.getElementById('sellerRoot').classList.contains('hide'),false);
  assert.match(sellerDoc.getElementById('sellerCatalogLink').value,/\?catalogo=8d7e0f6a/);
  assert.match(sellerDoc.getElementById('sellerCatalogLink').value,/demo=catalogo-publico/);
  sellerDom.window.showSellerTab('sellerSale');
  assert.equal(sellerDoc.getElementById('sellerSale').classList.contains('hide'),true);
  assert.match(sellerDoc.getElementById('sellerCatalogRequestPreview').textContent,/Alacena 120 cm/);
  sellerDom.window.close();

  console.log('DOM smoke: catálogo, ficha, formulario, confirmación, Administración y vendedor OK');
})().catch(error=>{console.error(error);process.exitCode=1});
