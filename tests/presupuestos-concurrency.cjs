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

const fs=require('node:fs'),path=require('node:path');
const HOME='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const call=(c,name,args)=>rpc(c,name,Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v])));
const items=[{producto_id:PHONE,cantidad:2}];
const options=[{modalidad:'Contado',cuotas:0},{modalidad:'Crédito personal',cuotas:6},{modalidad:'Crédito personal',cuotas:9}];
const emit=(c,key=randomUUID())=>call(c,'crear_presupuesto_multiple',{p_items:items,p_opciones:options,p_clave:key,p_nombre:'TEST synthetic',p_vigencia:7});
const quote=c=>call(c,'cotizar_presupuesto_multiple',{p_items:items,p_opciones:options});
async function args(c,r){const clients=await call(c,'clientes_presupuesto_multiple',{});return {p_presupuesto:r.id,p_opcion:'Crédito personal:9',p_cliente_id:clients[0].id};}
async function state(o){const s={};for(const t of ['presupuestos','ventas','cuentas_credito','cuotas_credito','comisiones','private.motor_precios_auditoria'])s[t]=(await o.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) d from ${t} t`)).rows[0].d;return s;}
async function snapshot(o,id){return (await o.query('select condiciones_snapshot from presupuestos where id=$1',[id])).rows[0].condiciones_snapshot;}
const cases=[
 ['simultaneous conversion: same sale, one audit, no financial duplication',async(o,a,b)=>{
  const r=await emit(a),v=await args(a,r),before=await state(o);await a.query('begin');const first=await call(a,'convertir_presupuesto_multiple',v);
  const waiting=pending(call(b,'convertir_presupuesto_multiple',v));await blocked(o,b,a);
  assert.equal((await o.query('select count(*)::int n from ventas where id=$1',[first.id])).rows[0].n,0);
  await a.query('commit');const second=await unwrap(waiting);assert.equal(second.id,first.id);assert(second.duplicado);
  const after=await state(o);assert.equal(after.ventas.length,before.ventas.length+1);
  for(const t of ['cuentas_credito','cuotas_credito','comisiones'])assert.deepEqual(after[t],before[t]);
  assert.equal(after['private.motor_precios_auditoria'].filter(x=>x.tipo==='venta_presupuesto_multiple'&&x.entidad_id===first.id).length,1);
  assert.deepEqual(await snapshot(o,r.id),r.condiciones_snapshot);
  const sale=after.ventas.find(x=>x.id===first.id),q=r.condiciones_snapshot.opciones[2];
  assert.equal(Number(sale.monto_total),q.total);assert.equal(Number(sale.anticipo_esperado),q.value);
 }],
 ['cost update waits; immutable snapshot and future new price',async(o,a,b)=>{
  await a.query('begin');const r=await emit(a);const waiting=pending(call(b,'guardar_costo_producto_rest',{p_producto:PHONE,p_costo:430}));
  await blocked(o,b,a);await a.query('commit');await unwrap(waiting);
  assert.deepEqual(await snapshot(o,r.id),r.condiciones_snapshot);assert.notEqual((await quote(a)).opciones[2].total,r.condiciones_snapshot.opciones[2].total);
  const audit=(await o.query("select detalle from private.motor_precios_auditoria where tipo='presupuesto_multiple' and entidad_id=$1",[r.id])).rows[0].detalle;
  assert.match(JSON.stringify(audit),/"costo_proveedor_usd":420/);
 }],
 ['FX writer and reader interleavings keep one coherent version',async(o,a,b)=>{
  await a.query('begin');const r=await emit(a);const waiting=pending(call(b,'actualizar_dolar_rest',{p_valor:1600}));
  await blocked(o,b,a);await a.query('commit');await unwrap(waiting);assert.deepEqual(await snapshot(o,r.id),r.condiciones_snapshot);
  assert.equal((await quote(a)).contado,2*430*1600*1.4);
  await b.query('begin');await call(b,'actualizar_dolar_rest',{p_valor:1650});
  const read=pending(emit(a));await blocked(o,a,b);await b.query('commit');const next=await unwrap(read);
  assert.equal(next.condiciones_snapshot.contado,2*430*1650*1.4);assert.deepEqual(await snapshot(o,r.id),r.condiciones_snapshot);
 }],
 ['late failure rolls back sale, audit and budget status',async(o,a)=>{
  const r=await emit(a),v=await args(a,r);const before=await state(o);
  await o.query("create function public.test_fail_multi() returns trigger language plpgsql as $$begin if new.tipo='venta_presupuesto_multiple' then if not exists(select 1 from ventas where id=new.entidad_id) then raise exception 'TEST_SETUP';end if;raise exception 'TEST_LATE_FAILURE';end if;return new;end$$;create trigger test_fail_multi before insert on private.motor_precios_auditoria for each row execute function public.test_fail_multi()");
  await assert.rejects(call(a,'convertir_presupuesto_multiple',v),/TEST_LATE_FAILURE/);assert.deepEqual(await state(o),before);
 }],
 ['backend rejects injected amounts and direct snapshot tampering',async(o,a)=>{
  const before=await state(o);
  for(const bad of [{p_items:[{...items[0],precio:1}],p_opciones:options},{p_items:items,p_opciones:[{...options[1],value:1}]}])await assert.rejects(call(a,'cotizar_presupuesto_multiple',bad));
  const r=await emit(a),v=await args(a,r);
  await assert.rejects(a.query("update presupuestos set condiciones_snapshot='{}' where id=$1",[r.id]),/permission denied/);
  await assert.rejects(call(a,'convertir_presupuesto_multiple',{...v,p_total:1}),/does not exist/);
  const sale=await call(a,'convertir_presupuesto_multiple',v),after=await state(o);
  assert.equal(after.ventas.length,before.ventas.length+1);assert.equal(Number(after.ventas.find(x=>x.id===sale.id).monto_total),r.condiciones_snapshot.opciones[2].total);
 }],
 ['simultaneous same-key emission returns one budget and audit',async(o,a,b)=>{
  const key=randomUUID();await a.query('begin');const first=await emit(a,key);const waiting=pending(emit(b,key));await blocked(o,b,a);
  await a.query('commit');const second=await unwrap(waiting);assert.equal(first.id,second.id);
  assert.equal((await o.query("select count(*)::int n from private.motor_precios_auditoria where tipo='presupuesto_multiple' and entidad_id=$1",[first.id])).rows[0].n,1);
 }],
 ['legacy price writer blocked until budget emission commits',async(o,a,b)=>{
  const its=[{producto_id:HOME,cantidad:2}];await a.query('begin');
  const r=await call(a,'crear_presupuesto_multiple',{p_items:its,p_opciones:options,p_clave:randomUUID()});
  const waiting=pending(o.query('update productos set precio_contado=precio_contado+10000 where id=$1',[HOME]));
  await blocked(b,o,a);await a.query('commit');await unwrap(waiting);
  assert.deepEqual(await snapshot(o,r.id),r.condiciones_snapshot);
  const next=await call(a,'cotizar_presupuesto_multiple',{p_items:its,p_opciones:options});assert.equal(next.contado,r.condiciones_snapshot.contado+20000);
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
    for(const file of ['20261022121122_cuotas_comerciales_multiplos_100.sql','20261025033232_presupuestos_multiproducto_multiopcion.sql'])await o.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
    await o.query(`set app.test_uid='${ADMIN}'`);await rpc(o,'guardar_costo_producto_rest',{p_producto:PHONE,p_costo:420});await rpc(o,'actualizar_dolar_rest',{p_valor:1550});
    const a=await connect(database,SELLER),b=await connect(database,i===0||i===5?SELLER:ADMIN);clients.push(a,b);
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
  console.log('CONCURRENCY '+(failed?'FAILED':'APPROVED')+'; cases passed '+(cases.length-failed)+'/'+cases.length+'; TEST databases removed');if(failed)process.exitCode=1;
 }finally{await root.end()}
})().catch(e=>{console.error('HARNESS FAILURE: '+e.message);process.exitCode=1});
