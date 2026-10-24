// Real production UI functions -> official RPC -> disposable PostgreSQL. No network/production data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,rpc,root}=require('./motor-precios-db.cjs');
const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));
const {JSDOM}=require(path.join(process.env.PGLITE_MODULE_DIR,'jsdom'));
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const phone='dddddddd-dddd-4ddd-8ddd-000000000002',legacy='dddddddd-dddd-4ddd-8ddd-000000000099';
(async()=>{const db=new PGlite();let dom;try{
 await setup(db);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022121122_cuotas_comerciales_multiplos_100.sql'),'utf8'));
 const role=async uid=>db.exec(`reset role;set role authenticated;set app.test_uid='${uid}'`);
 await role(admin);await rpc(db,'actualizar_dolar_rest',{p_valor:1550});await rpc(db,'guardar_costo_producto_rest',{p_producto:phone,p_costo:420});
 await db.exec(`reset role;insert into productos(id,nombre,categoria,precio_contado,activo,catalogo_publico) values('${legacy}','TEST Celular Legacy','celulares',140000,true,true); update vendedores set categoria_actual='experto';`);
 const history=(await db.query('select id,to_jsonb(v) snapshot from ventas v')).rows;
 const inputs=['qMode','qInstall','qAdvance','cn','cd','cp','cbirth','caddr','ccity','cref','notes','prod','amount','pay','down'];
 dom=new JSDOM(inputs.map(id=>`<input id="${id}">`).join('')+'<div id="qResult"></div><button id="qLoadSale"></button><div id="selectedProduct"></div><div id="sellerSale"></div><div id="smsg"></div><button id="saleBtn"></button>',{runScripts:'dangerously',url:'https://test.invalid'});
 const w=dom.window,d=w.document,calls=[];Object.defineProperty(w.crypto,'randomUUID',{value:()=>crypto.randomUUID()});
 w.sb={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});try{return {data:await rpc(db,name,Object.fromEntries(Object.entries(args).map(([k,v])=>[k,typeof v==='object'&&v!==null?JSON.stringify(v):v])))}}catch(error){return {error}}}};
 w.eval("var selectedCatalogProduct,currentQuote,activeInteresVentaId=null;function recruitmentIsDemo(){return false}function qerr(m){throw Error(m)}function esc(s){return String(s)}function money(n){return String(n)}function commissionPct(){return 5}function estimatedCommission(n){return Math.round(n*commissionPct()/100)}function showSellerTab(){} sellerSale.scrollIntoView=()=>{};");
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const name of ['qshow','loadQuoteIntoSale'])w.eval(html.split('\n').find(line=>line.startsWith('function '+name+'(')));
 w.eval(fs.readFileSync(path.join(root,'motor-precios.js'),'utf8'));
 for(const [id,engine,values] of [[phone,'NUEVO',[[6,277800,1666800],[9,237000,2133000]]],[legacy,'LEGACY',[[6,36700,220200],[9,31000,279000]]]])for(const [n,value,total] of values){
  await role(seller);w.eval(`selectedCatalogProduct={id:'${id}',nombre:'TEST ${engine}',categoria:'celulares'}`);d.getElementById('qMode').value='Crédito personal';d.getElementById('qInstall').value=n;await w.RESTPrecios.quote();
  const initial=engine==='NUEVO'?value:0; const quote=w.eval('currentQuote');assert.equal(quote.plan.value,value);assert.equal(quote.total,total);assert.equal(quote.total,value*n);assert.equal(quote.estimatedCommission,total*.05);assert.equal(quote.down,0);
  w.loadQuoteIntoSale();assert.equal(Number(d.getElementById('down').value),initial);assert(d.getElementById('down').readOnly);assert.equal(Number(d.getElementById('amount').value),total);
  const budget=(await rpc(db,'crear_presupuesto_vendedor',{p_producto_id:id,p_modalidad:'Crédito personal',p_cuotas:n,p_anticipo:quote.down})).presupuesto;
  assert.equal(Number(budget.valor_cuota_snapshot),value);assert.equal(Number(budget.total_snapshot),total);assert.equal(Number(budget.anticipo_snapshot),0);
  d.getElementById('cn').value='TEST Primera '+engine+n;await w.RESTPrecios.submit();assert.match(d.getElementById('smsg').textContent,/cargada como Pendiente/);
  const payload=calls.filter(c=>c.name==='registrar_venta_catalogo').at(-1).args;
  assert.equal(payload.p_datos.anticipo,0);assert.equal(payload.p_datos.valor_cuota,value);assert.equal(payload.p_datos.monto_total,total);
  await db.exec('reset role');const saved=(await db.query("select v.*,a.detalle from ventas v join private.motor_precios_auditoria a on a.entidad_id=v.id where a.detalle->>'clave_idempotencia'=$1",[payload.p_clave_idempotencia])).rows[0];
  assert.equal(Number(saved.anticipo_esperado),initial);assert.equal(Number(saved.monto_total),total);assert.equal(saved.detalle.seleccion.value,value);assert.equal(saved.detalle.seleccion.primera_cuota,engine==='NUEVO'?'al_inicio':null);
  // Direct seller sales do not create credit accounts: pre-existing workflow, preserved.
  assert.equal((await db.query('select count(*)::int n from cuentas_credito where venta_id=$1',[saved.id])).rows[0].n,0);
  await role(seller);await assert.rejects(rpc(db,'registrar_venta_catalogo',{p_clave_idempotencia:crypto.randomUUID(),p_datos:JSON.stringify({...payload.p_datos,valor_cuota:value+100})}),/importes no son oficiales/);
  await assert.rejects(rpc(db,'registrar_venta_catalogo',{p_clave_idempotencia:crypto.randomUUID(),p_datos:JSON.stringify({...payload.p_datos,anticipo:value})}),/importes no son oficiales/);
  await db.exec('reset role');await db.query("update ventas set estado='aprobada_entrega' where id=$1",[saved.id]);await db.query("update ventas set estado='entregada' where id=$1",[saved.id]);await db.query("update ventas set estado='en_cobranza' where id=$1",[saved.id]);
  const commissions=(await db.query('select * from comisiones where venta_id=$1',[saved.id])).rows;assert.equal(commissions.length,1);assert.equal(Number(commissions[0].porcentaje),5);assert.equal(Number(commissions[0].importe_original),total*.05);
  console.log(`PASS ${engine} ${n}: cuota=${value}, pago al inicio=${initial}, total=${total}, comisión=${total*.05}; UI, presupuesto, payload, backend, snapshot, rechazo manipulación, comisión única`);
 }
 for(const h of history)assert.deepEqual((await db.query('select to_jsonb(v) snapshot from ventas v where id=$1',[h.id])).rows[0].snapshot,h.snapshot);
 assert.equal(w.RESTPrecios.initialPayment({down:12000,plan:{value:3000}}),12000);
 assert.equal(w.RESTPrecios.initialPayment({down:12000,plan:{value:3000,primera_cuota:'al_mes'}}),12000);
 assert.equal(w.RESTPrecios.initialPayment({down:0,plan:{value:3000,primera_cuota:'al_inicio'}}),3000);
 console.log('PASS históricos intactos; anticipo separado/contado/plan sin primera al inicio conservados');
 }finally{dom?.window.close();await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
