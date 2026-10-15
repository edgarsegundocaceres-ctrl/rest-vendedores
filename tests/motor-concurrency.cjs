// Disposable localhost PostgreSQL only. Never reads application env files or supplier manifests.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Client} = require('pg');
const {setup, rpc} = require('./motor-precios-db.cjs');
const ADMIN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SELLER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHONE='dddddddd-dddd-4ddd-8ddd-000000000002';
const config={host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-test-only',database:'postgres'};
// Explicit connection settings ignore PGHOST/DATABASE_URL and cannot target Supabase.
async function connect(database,uid){
 const c=new Client({...config,database});await c.connect();c.exec=sql=>c.query(sql);
 await c.query("set statement_timeout='15s';set lock_timeout='10s'");
 if(uid)await c.query(`set role authenticated;set app.test_uid='${uid}'`);
 return c;
}
async function blocked(observer,waiter,holder){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const {rows}=await observer.query('select $1::int=any(pg_blocking_pids($2::int)) blocked',[holder.processID,waiter.processID]);
  if(rows[0].blocked)return;
  await new Promise(r=>setTimeout(r,25));
 }
 throw Error('Expected independently observed PostgreSQL lock was not reached');
}
function pending(p){return p.then(value=>({value}),error=>({error}));}
async function unwrap(p){const r=await p;if(r.error)throw r.error;return r.value;}
async function quote(c){return rpc(c,'calcular_presupuesto_rest',{p_producto_id:PHONE,p_modalidad:'Crédito personal',p_cuotas:6});}
async function saleArgs(c){const q=await quote(c);return {p_clave_idempotencia:randomUUID(),p_datos:JSON.stringify({producto_id:PHONE,modalidad:'Crédito personal',cliente_nombre:'TEST concurrency synthetic',cliente_dni:'39999881',monto_total:q.total,anticipo:0,cantidad_cuotas:6,valor_cuota:q.value,frecuencia:'mensual'})};}
async function snapshot(o,id){return (await o.query("select detalle from private.motor_precios_auditoria where tipo='venta_portal' and entidad_id=$1",[id])).rows[0].detalle;}
async function state(o){
 const tables=['clientes','ventas','solicitudes_venta','cuentas_credito','cuotas_credito','comisiones','solicitudes_compra_historial','private.motor_precios_auditoria'];
 const result={};for(const table of tables)result[table]=(await o.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) d from ${table} t`)).rows[0].d;
 return result;
}
async function request(o,a){
 const token=(await o.query('select catalogo_token from vendedores limit 1')).rows[0].catalogo_token;
 const cat=await rpc(a,'obtener_catalogo_publico',{p_token:token});const p=cat.productos.find(x=>x.id===PHONE),key=randomUUID();
 const r=await rpc(a,'crear_solicitud_compra_publica',{p_token:token,p_producto_id:PHONE,p_modalidad:'credito_9',p_cliente:JSON.stringify({nombre:'TEST',apellido:'Concurrent synthetic',dni:'39999001',telefono:'5493855550111',localidad:'TEST',domicilio:'TEST 100'}),p_clave_idempotencia:key,p_version_cotizacion:p.version_cotizacion});assert(r.ok);
 const id=(await o.query('select id from solicitudes_venta where clave_idempotencia=$1',[key])).rows[0].id;
 await rpc(a,'actualizar_estado_solicitud_compra',{p_solicitud_id:id,p_estado:'aprobada'});return id;
}
const cases=[
 ['1 simultaneous same-key sales',async(o,a,b)=>{
  const args=await saleArgs(a);await a.query('begin');const first=await rpc(a,'registrar_venta_catalogo',args);
  const waiting=pending(rpc(b,'registrar_venta_catalogo',args));await blocked(o,b,a);
  assert.equal((await o.query('select count(*)::int n from ventas where id=$1',[first.id])).rows[0].n,0,'uncommitted sale visible');
  await a.query('commit');const second=await unwrap(waiting);assert.equal(second.id,first.id);assert(second.duplicado);
  assert.equal((await o.query("select count(*)::int n from private.motor_precios_auditoria where tipo='venta_portal' and detalle->>'clave_idempotencia'=$1",[args.p_clave_idempotencia])).rows[0].n,1);
  assert.equal((await o.query('select count(*)::int n from ventas where id=$1',[first.id])).rows[0].n,1);
 }],
 ['2 cost change during operation',async(o,a,b)=>{
  const args=await saleArgs(a);await a.query('begin');const sale=await rpc(a,'registrar_venta_catalogo',args);
  const waiting=pending(rpc(b,'guardar_costo_producto_rest',{p_producto:PHONE,p_costo:430}));await blocked(o,b,a);await a.query('commit');await unwrap(waiting);
  const snap=await snapshot(o,sale.id);assert.equal(snap.costo_proveedor_usd,420);assert.equal(snap.dolar_rest,1550);assert.equal(snap.costo_base_ars,666500);
  assert.equal((await quote(a)).total,1705000);const historical=await state(o);
  await rpc(b,'guardar_costo_producto_rest',{p_producto:PHONE,p_costo:440});assert.deepEqual(await snapshot(o,sale.id),snap);
  const after=await state(o);for(const t of Object.keys(historical).filter(x=>!x.startsWith('private.')))assert.deepEqual(after[t],historical[t]);
 }],
 ['3 FX change during operation',async(o,a,b)=>{
  const args=await saleArgs(a);await a.query('begin');const sale=await rpc(a,'registrar_venta_catalogo',args);
  const waiting=pending(rpc(b,'actualizar_dolar_rest',{p_valor:1600}));await blocked(o,b,a);await a.query('commit');await unwrap(waiting);
  const snap=await snapshot(o,sale.id);assert.equal(snap.dolar_rest,1550);assert.equal(snap.costo_base_ars,666500);assert.equal((await quote(a)).total,1720000);
  // Also exercise the opposite interleaving: quote starts while writer holds exclusive lock.
  await b.query('begin');await rpc(b,'actualizar_dolar_rest',{p_valor:1650});const reading=pending(quote(a));await blocked(o,a,b);await b.query('commit');assert.equal((await unwrap(reading)).total,1773750);assert.deepEqual(await snapshot(o,sale.id),snap);
 }],
 ['4 concurrent conversion of same request',async(o,a,b)=>{
  const id=await request(o,a);const before=await state(o);await a.query('begin');const first=await rpc(a,'convertir_solicitud_compra',{p_solicitud_id:id});assert(first.ok);
  const waiting=pending(rpc(b,'convertir_solicitud_compra',{p_solicitud_id:id}));await blocked(o,b,a);await a.query('commit');const second=await unwrap(waiting);assert(second.ok);assert(second.duplicado);assert.equal(second.venta_id,first.venta_id);
  const after=await state(o);assert.equal(after.ventas.length-before.ventas.length,1);assert.equal(after.cuentas_credito.length-before.cuentas_credito.length,1);assert.equal(after.cuotas_credito.length-before.cuotas_credito.length,9);
  assert.equal(after.comisiones.length-before.comisiones.length,1);
  const account=after.cuentas_credito.find(x=>x.solicitud_id===id),quotas=after.cuotas_credito.filter(x=>x.cuenta_id===account.id);
  assert.equal(quotas.reduce((sum,q)=>sum+Math.round(Number(q.importe)*100),0),213280000);
  assert.equal(after['private.motor_precios_auditoria'].filter(x=>x.tipo==='venta'&&x.entidad_id===first.venta_id).length,1);
  assert.equal(after.solicitudes_compra_historial.filter(x=>x.solicitud_id===id&&x.tipo==='convertida_en_venta').length,1);
 }],
 ['5 injected late failure rolls back all effects',async(o,a)=>{
  const id=await request(o,a);const before=await state(o);
  // TEST-only late trigger: conversion already made a sale, account, quotas and snapshot.
  await o.query(`create function public.test_fail_late() returns trigger language plpgsql as $$ begin
   if new.tipo='convertida_en_venta' then
    if not exists(select 1 from cuentas_credito c join cuotas_credito q on q.cuenta_id=c.id join private.motor_precios_auditoria m on m.entidad_id=c.venta_id and m.tipo='venta' where c.solicitud_id=new.solicitud_id) then raise exception 'TEST_SETUP missing earlier effects'; end if;
    raise exception 'TEST_INJECTED_AFTER_FINANCIAL_EFFECTS';
   end if;return new;end $$;
   create trigger test_fail_late before insert on solicitudes_compra_historial for each row execute function public.test_fail_late()`);
  await assert.rejects(rpc(a,'convertir_solicitud_compra',{p_solicitud_id:id}),/TEST_INJECTED_AFTER_FINANCIAL_EFFECTS/);
  assert.deepEqual(await state(o),before);
 }],
 ['6 backend rejects manipulated client amounts',async(o,a)=>{
  const args=await saleArgs(a);const before=await state(o),data=JSON.parse(args.p_datos);
  for(const change of [{monto_total:1},{valor_cuota:1},{cantidad_cuotas:7},{anticipo:1}]){
   await assert.rejects(rpc(a,'registrar_venta_catalogo',{...args,p_clave_idempotencia:randomUUID(),p_datos:JSON.stringify({...data,...change})}),/cotización cambió|cuotas|modalidad|anticipo/i);
   assert.deepEqual(await state(o),before);
  }
  const sale=await rpc(a,'registrar_venta_catalogo',args);const snap=await snapshot(o,sale.id);assert.equal(snap.costo_base_ars,666500);assert.equal(snap.contado,933100);
 }]
];
(async()=>{
 const root=await connect('postgres');let failed=0;
 try{
  const version=(await root.query('show server_version')).rows[0].server_version;assert.match(version,/^17\./);console.log('PostgreSQL '+version+'; native independent sessions; synthetic fixtures only');
  for(let i=0;i<cases.length;i++){
   const [name,test]=cases[i],database='rest_concurrency_test_'+(i+1),clients=[];
   try{
    await root.query(`create database ${database}`);const o=await connect(database);clients.push(o);await setup(o);
    await o.query(`set app.test_uid='${ADMIN}'`);await rpc(o,'guardar_costo_producto_rest',{p_producto:PHONE,p_costo:420});await rpc(o,'actualizar_dolar_rest',{p_valor:1550});
    const a=await connect(database,i===3||i===4?ADMIN:SELLER),b=await connect(database,i===0?SELLER:ADMIN);clients.push(a,b);
    assert.equal(new Set([o.processID,a.processID,b.processID]).size,3);console.log('CASE '+(i+1)+' independent backend PIDs: '+[o.processID,a.processID,b.processID].join(','));
    await test(o,a,b);console.log('PASS '+name);
   }catch(e){failed++;console.error('FAIL '+name+': '+e.message);}
   finally{
    await Promise.allSettled(clients.map(async c=>{await c.query('rollback');await c.end()}));
    await root.query(`drop database if exists ${database} with (force)`);
    // Fixture roles are cluster-global, unlike the disposable database.
    await root.query('drop role if exists anon, authenticated, service_role');
    console.log('CLEAN database and fixture roles '+(i+1));
   }
  }
  assert.equal((await root.query("select count(*)::int n from pg_database where datname like 'rest_concurrency_test_%'")).rows[0].n,0);
  console.log('CONCURRENCY '+(failed?'FAILED':'APPROVED')+'; cases passed '+(cases.length-failed)+'/6; TEST databases removed');if(failed)process.exitCode=1;
 }finally{await root.end()}
})().catch(e=>{console.error('HARNESS FAILURE: '+e.message);process.exitCode=1});
