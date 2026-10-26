const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,rpc,root}=require('./motor-precios-db.cjs');
const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));
const {JSDOM}=require(path.join(process.env.PGLITE_MODULE_DIR,'jsdom'));
(async()=>{const db=new PGlite();let dom;try{
 await setup(db);for(const f of ['20261022121122_cuotas_comerciales_multiplos_100.sql','20261025033232_presupuestos_multiproducto_multiopcion.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 await db.exec("reset role;set role authenticated;set app.test_uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
 dom=new JSDOM('<section><div id="budgetList"></div></section>',{runScripts:'dangerously',url:'https://test.invalid'});const w=dom.window,d=w.document;w.HTMLElement.prototype.scrollIntoView=()=>{};w.alert=m=>{throw Error(m)};Object.defineProperty(w.crypto,'randomUUID',{value:()=>crypto.randomUUID()});
 let saved;w.sb={rpc:async(name,args={})=>{try{const data=await rpc(db,name,Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v])));if(name==='crear_presupuesto_multiple')saved=data;return {data}}catch(error){return {error}}}};
 w.eval(fs.readFileSync(path.join(root,'presupuestos-multiple.js'),'utf8'));
 const p={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',nombre:'TEST Sommier',categoria:'hogar'};w.RESTPresupuestos.add(p);w.RESTPresupuestos.add(p);assert.equal(d.querySelector('[data-qty]').value,'2');w.RESTPresupuestos.change(p.id,3);assert.equal(d.querySelector('[data-qty]').value,'3');
 await w.RESTPresupuestos.open();assert.equal(d.querySelectorAll('input[type=checkbox]').length,22);d.getElementById('multiOpt1').checked=true;d.getElementById('multiOpt2').checked=true;
 await d.getElementById('multiCalculate').onclick();assert.equal(d.querySelectorAll('.multi-summary').length,3);
 await d.getElementById('multiSave').onclick();assert.equal(saved.condiciones_snapshot.items[0].cantidad,3);assert.equal(saved.condiciones_snapshot.opciones.length,3);assert(w.RESTPresupuestos.text(saved).includes('3 ×'));assert(w.RESTPresupuestos.text(saved).includes('6 cuotas'));assert(w.RESTPresupuestos.text(saved).includes('9 cuotas'));assert(!w.RESTPresupuestos.text(saved).includes('costo'));
 await d.querySelector('[data-action=sale]').onclick();const selects=d.querySelectorAll('.multi-convert select');assert.equal(selects[0].value,'');assert(d.querySelector('.multi-convert button').disabled);selects[0].value='Crédito personal:9';selects[0].onchange();assert(d.querySelector('.multi-convert button').disabled);selects[1].selectedIndex=1;selects[1].onchange();assert(!d.querySelector('.multi-convert button').disabled);await d.querySelector('.multi-convert button').onclick();assert.match(d.querySelector('.multi-convert [role=status]').textContent,/Venta pendiente/);
 assert.equal((await db.query('select venta_id from presupuestos where id=$1',[saved.id])).rows[0].venta_id!=null,true);
 w.RESTPresupuestos.remove(p.id);assert.match(d.getElementById('budgetList').textContent,/No agregaste/);console.log('PASS UI real → RPC → PostgreSQL: agregar/cantidades, 22 opciones, seleccionar 3, emitir, compartir texto, selección obligatoria, conversión única, quitar');
 }finally{dom?.window.close();await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
