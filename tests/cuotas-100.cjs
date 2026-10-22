const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,rpc,root}=require('./motor-precios-db.cjs');
const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));
const {JSDOM}=require(path.join(process.env.PGLITE_MODULE_DIR,'jsdom'));
const migration='supabase/migrations/20261022121122_cuotas_comerciales_multiplos_100.sql';
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const phone='dddddddd-dddd-4ddd-8ddd-000000000002',home='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
(async()=>{const db=new PGlite();let checks=0;const ok=(label,f)=>{f();checks++;console.log('OK '+label)};
const role=async(id,r='authenticated')=>db.exec(`reset role;set role ${r};set app.test_uid='${id}'`);
const history=async()=>{await db.exec('reset role');return(await db.query("select jsonb_build_object('ventas',(select jsonb_agg(to_jsonb(t)) from ventas t),'presupuestos',(select jsonb_agg(to_jsonb(t)) from presupuestos t),'solicitudes',(select jsonb_agg(to_jsonb(t)) from solicitudes_venta t),'cuentas',(select jsonb_agg(to_jsonb(t)) from cuentas_credito t),'cuotas',(select jsonb_agg(to_jsonb(t)) from cuotas_credito t),'pagos',(select jsonb_agg(to_jsonb(t)) from cobranzas_ventas t),'imputaciones',(select jsonb_agg(to_jsonb(t)) from cobranzas_imputaciones t),'auditoria',(select jsonb_agg(to_jsonb(t)) from private.motor_precios_auditoria t),'productos',(select jsonb_agg(to_jsonb(t)) from productos t),'costos',(select jsonb_agg(to_jsonb(t)) from productos_costos t),'dolar',(select jsonb_agg(to_jsonb(t)) from private.dolar_rest_celulares t)) d")).rows[0].d};
try{await setup(db);await rpc(db,'guardar_costo_producto_rest',{p_producto:phone,p_costo:420});await rpc(db,'actualizar_dolar_rest',{p_valor:1550});
const token=(await db.query('select catalogo_token from vendedores limit 1')).rows[0].catalogo_token;
await role(seller);const oldBudget=(await rpc(db,'crear_presupuesto_vendedor',{p_producto_id:phone,p_modalidad:'Crédito personal',p_cuotas:9,p_prospecto_nombre:'TEST histórico redondeo'})).presupuesto;
let dni=39991000;
async function request(pid,n){await role('','anon');const cat=await rpc(db,'obtener_catalogo_publico',{p_token:token}),p=cat.productos.find(x=>x.id===pid),key=crypto.randomUUID();const result=await rpc(db,'crear_solicitud_compra_publica',{p_token:token,p_producto_id:pid,p_modalidad:'credito_'+n,p_cliente:JSON.stringify({nombre:'TEST',apellido:'Redondeo',dni:String(dni++),telefono:'5493855550111',localidad:'TEST',domicilio:'TEST 1'}),p_clave_idempotencia:key,p_version_cotizacion:p.version_cotizacion});assert(result.ok);await db.exec('reset role');return(await db.query('select * from solicitudes_venta where clave_idempotencia=$1',[key])).rows[0];}
const oldReq=await request(phone,9),before=await history();
await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));
ok('Migración no altera operaciones/snapshots/finanzas/costos/dólar',()=>{});assert.deepEqual(await history(),before);
for(const [value,expected] of [[111324.44,111400],[236977.78,237000],[265000,265000],[180001,180100],[100.00001,200]]){const v=(await db.query('select private.cuota_comercial_100($1,1) v',[value])).rows[0].v;ok(value+' → '+expected,()=>assert.equal(Number(v),expected));}
for(const [id,name,cash,values] of [[phone,'NUEVO MOTOR',933100,[[6,277800,1666800],[9,237000,2133000]]],[home,'HOGAR LEGACY',100000,[[6,26200,157200],[9,22200,199800]]]]){
 await role(admin);const q=await rpc(db,'cotizar_producto',{p_producto_id:id});assert.equal(q.contado,cash);
 for(const [n,value,total] of values){const plan=q.credito_personal.find(p=>p.cuotas===n);ok(name+' '+n+' cuotas iguales, total y contado',()=>{assert.equal(plan.cuota,value);assert.equal(plan.ultima_cuota,value);assert.equal(plan.total,total);assert.equal(plan.cuota%100,0)});
 await role(seller);const budget=(await rpc(db,'crear_presupuesto_vendedor',{p_producto_id:id,p_modalidad:'Crédito personal',p_cuotas:n})).presupuesto;ok('Presupuesto usa total/cuota oficial',()=>{assert.equal(Number(budget.total_snapshot),total);assert.equal(Number(budget.valor_cuota_snapshot),value)});
 const req=await request(id,n);assert.equal(Number(req.snapshot_solicitado.seleccion.total),total);
 await role(admin);await rpc(db,'actualizar_estado_solicitud_compra',{p_solicitud_id:req.id,p_estado:'aprobada'});const sale=await rpc(db,'convertir_solicitud_compra',{p_solicitud_id:req.id});assert(sale.ok);await db.exec('reset role');
 const quotas=(await db.query('select q.*,q.vencimiento::text as fecha from cuotas_credito q join cuentas_credito c on c.id=q.cuenta_id where c.solicitud_id=$1 order by q.numero',[req.id])).rows;
 ok('Solicitud → venta → '+n+' cuotas iguales '+name,()=>{assert.equal(quotas.length,n);assert(quotas.every(q=>Number(q.importe)===value));assert.equal(quotas.reduce((s,q)=>s+Number(q.importe),0),total)});
 if(id===phone){const today=(await db.query("select (now() at time zone 'America/Argentina/Cordoba')::date::text d")).rows[0].d;ok('Primera cuota al inicio con mismo importe',()=>assert.equal(quotas[0].fecha,today));}
 }
}
// Un celular sin costo conserva su base económica; solo se redondea la cuota.
await db.exec("insert into productos(id,nombre,categoria,precio_contado,activo,catalogo_publico) values('dddddddd-dddd-4ddd-8ddd-000000000099','TEST Celular Legacy','celulares',140000,true,true)");await role(admin);
const legacy=await rpc(db,'cotizar_producto',{p_producto_id:'dddddddd-dddd-4ddd-8ddd-000000000099'});ok('CELULAR LEGACY mantiene contado, 1.57/1.99 y motor_version=1',()=>{assert.equal(legacy.contado,140000);assert.equal(legacy.motor_version,1);assert.equal(legacy.credito_personal[0].total,36700*6);assert.equal(legacy.credito_personal[1].total,31000*9)});
await role(seller);
for(const [mode,n,advance] of [['Anticipo + cuotas mensuales',6,400000],['Anticipo + cuotas semanales',12,400000],['Tarjeta Sol',9,0]]){const q=await rpc(db,'calcular_presupuesto_rest',{p_producto_id:phone,p_modalidad:mode,p_cuotas:n,p_anticipo:advance});ok(mode+' total = anticipo + cuotas comerciales',()=>{assert.equal(q.value%100,0);assert.equal(q.ultima_cuota,q.value);assert.equal(q.total,q.down+n*q.value)});}
const quote=await rpc(db,'calcular_presupuesto_rest',{p_producto_id:phone,p_modalidad:'Crédito personal',p_cuotas:6});
const data={modalidad:'Crédito personal',producto_id:phone,cliente_nombre:'TEST Venta Redondeo',monto_total:quote.total,anticipo:quote.down,cantidad_cuotas:quote.count,valor_cuota:quote.value,frecuencia:quote.frequency};
await assert.rejects(rpc(db,'registrar_venta_catalogo',{p_datos:JSON.stringify({...data,valor_cuota:277708.33}),p_clave_idempotencia:crypto.randomUUID()}),/importes no son oficiales/);checks++;
const sale=await rpc(db,'registrar_venta_catalogo',{p_datos:JSON.stringify(data),p_clave_idempotencia:crypto.randomUUID()});await db.exec('reset role');const row=(await db.query('select * from ventas where id=$1',[sale.id])).rows[0];ok('Venta pendiente backend/primera cuota comercial',()=>{assert.equal(Number(row.monto_total),1666800);assert.equal(Number(row.anticipo_esperado),277800)});
await role(admin);await rpc(db,'actualizar_estado_solicitud_compra',{p_solicitud_id:oldReq.id,p_estado:'aprobada'});await rpc(db,'convertir_solicitud_compra',{p_solicitud_id:oldReq.id});await db.exec('reset role');
const historical=(await db.query('select q.*,q.vencimiento::text as fecha from cuotas_credito q join cuentas_credito c on c.id=q.cuenta_id where c.solicitud_id=$1 order by numero',[oldReq.id])).rows;
ok('Solicitud anterior conserva cuota/última antigua al convertir',()=>{assert.equal(Number(historical[0].importe),236977.78);assert.equal(Number(historical[8].importe),236977.76)});
const saved=(await db.query('select to_jsonb(p) as data from presupuestos p where id=$1',[oldBudget.id])).rows[0].data;ok('Presupuesto emitido conserva snapshot exacto',()=>assert.deepEqual(saved,oldBudget));
// Frontend real contra RPC TEST; no fórmula comercial en navegador.
await role(admin);const dom=new JSDOM('<div id="motorPreciosAdmin"></div><input id="qMode"><input id="qInstall"><input id="qAdvance">',{runScripts:'dangerously',url:'https://test.invalid'}),w=dom.window;
w.sb={rpc:async(name,args)=>{try{return{data:await rpc(db,name,args)}}catch(error){return{error}}}};
w.eval(`var profile={rol:'admin'},selectedCatalogProduct={id:'${phone}',categoria:'celulares'},currentQuote;function recruitmentIsDemo(){return false}function qerr(m){throw Error(m)}function qshow(title,lines,total,installment,down,paymentText,plan){currentQuote={lines,total,installment,plan}}`);
w.eval(fs.readFileSync(path.join(root,'motor-precios.js'),'utf8'));w.document.getElementById('qMode').value='Crédito personal';w.document.getElementById('qInstall').value='9';await w.RESTPrecios.quote();const ui=w.eval('currentQuote');ok('Portal: 9 cuotas enteras sin aviso de última cuota',()=>{assert.equal(ui.total,2133000);assert.match(ui.installment,/237.000/);assert(!/última|,00/.test(JSON.stringify(ui)))});
await w.RESTPrecios.cost(phone,'celulares');const summary=w.document.getElementById('motorCostSummary').textContent;ok('ADMIN: cuotas enteras sin última diferente',()=>{assert.match(summary,/277.800/);assert(!/Última|,00/.test(summary))});
w.eval(fs.readFileSync(path.join(root,'captacion-vendedores.js'),'utf8'));ok('Presupuesto nuevo simple e histórico conserva última',()=>{assert.equal(w.budgetPaymentLabel({}, {count:9,value:237000,ultima_cuota:237000,primera_cuota:'al_inicio'}),'9 cuotas de $ 237.000 · Primera al inicio');assert.match(w.budgetPaymentLabel({}, {count:9,value:236977.78,ultima_cuota:236977.76,primera_cuota:'al_inicio'}),/última/)});w.document.body.insertAdjacentHTML('beforeend','<div id="catalogProductDetail"></div>');w.scrollTo=()=>{};
await role('','anon');const publicCat=await rpc(db,'obtener_catalogo_publico',{p_token:token});w.publicFixture=publicCat.productos.find(p=>p.id===phone);
w.eval(fs.readFileSync(path.join(root,'catalogo-publico.js'),'utf8')+';catalogPublicState.products=[publicFixture];catalogOpenProduct(publicFixture.id);');
const publicText=w.document.getElementById('catalogProductDetail').textContent;
ok('Catálogo renderiza planes del backend sin centavos ni última ajustada',()=>{assert.match(publicText,/9 cuotas de .*237.000/);assert.match(publicText,/2.133.000/);assert(!/última|,00|dolar_rest|costo_proveedor/i.test(publicText))});
dom.window.close();
console.log('PASS '+checks+' controles de redondeo e integración');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
