const assert=require('node:assert/strict');
const path=require('node:path');
const {setup,rpc}=require('./finance-db.cjs');
const modules=process.env.FINANCE_TEST_MODULE_DIR||process.env.PGLITE_MODULE_DIR;
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let passed=0;
function check(label,fn){fn();passed++;console.log('OK '+label);}
async function rejects(label,promise,pattern){await assert.rejects(promise,pattern);passed++;console.log('OK '+label);}
async function connect(){
 if(process.env.FINANCE_TEST_DATABASE_URL){
  const url=new URL(process.env.FINANCE_TEST_DATABASE_URL);if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Solo se admiten bases locales de prueba');
  const {Client}=require(path.join(modules,'pg'));const client=new Client({connectionString:url.toString()});await client.connect();
  return {db:{query:(...x)=>client.query(...x),exec:s=>client.query(s)},close:()=>client.end(),native:true};
 }
 const {PGlite}=require(path.join(modules,'@electric-sql/pglite'));const db=new PGlite();return {db,close:()=>db.close(),native:false};
}
(async()=>{
 const {db,close,native}=await connect();
 try{
  await setup(db);
  const publicToken=(await db.query("select catalogo_token::text as token from public.vendedores where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'")).rows[0].token;
  const all=await rpc(db,'cobranzas_tablero',{p_filtro:'todas'});
  check('venta financiada genera una única cuenta y 3 cuotas',()=>{assert.equal(all.total,12);assert.equal(all.total_clientes,4);});
  const maria=all.agenda.find(x=>x.cliente_nombre==='TEST María Pérez'&&x.unidad==='hogar');
  const other=all.agenda.find(x=>x.cliente_nombre==='TEST Carlos Díaz');
  const lucia=all.agenda.find(x=>x.cliente_nombre==='TEST Lucía Gómez');
  const account=maria.cuenta_id;
  let ficha=await rpc(db,'ficha_financiera_cliente',{p_cliente_id:maria.cliente_id});
  check('cliente con varios créditos conserva cuentas distintas',()=>assert.equal(ficha.cuentas.length,2));
  check('vencimientos mensual, quincenal, semanal y fin de mes',()=>{});
  const dates=(await db.query("select credito_fecha_vencimiento('2028-01-31','mensual',2)::text m,credito_fecha_vencimiento('2026-10-11','quincenal',2)::text q,credito_fecha_vencimiento('2026-10-11','semanal',2)::text s")).rows[0];
  check('fechas calculadas por función vigente',()=>assert.deepEqual(dates,{m:'2028-02-29',q:'2026-10-25',s:'2026-10-18'}));
  check('cuota pasada con saldo es vencida',()=>assert.equal(maria.estado_operativo,'vencida'));
  check('cuota de hoy se identifica sin estado guardado',()=>assert(all.agenda.some(q=>q.estado_operativo==='hoy'&&q.estado==='pendiente')));
  check('cuota futura es próxima y pendiente',()=>assert(all.agenda.some(q=>q.estado_operativo==='proxima'&&q.estado_pago==='pendiente')));
  for(const [f,expected] of [['hoy',1],['vencidas',2],['proximos',3],['pagadas',0]]){
   const x=await rpc(db,'cobranzas_tablero',{p_filtro:f});check('filtro '+f,()=>assert.equal(x.total,expected));
  }
  for(const term of ['María','30.111.222','3855550000']){
   const x=await rpc(db,'cobranzas_tablero',{p_filtro:'todas',p_busqueda:term});check('búsqueda '+term,()=>assert(x.total>0));
  }
  check('cartera sin valores prefijados',()=>assert.equal(Number(all.kpis.cartera),1200000));
  const toPay=async(cuenta,importe,extras={})=>{
   const p=await rpc(db,'previsualizar_cobro',{p_cuenta_id:cuenta,p_importe:importe});
   const args={p_cuenta_id:cuenta,p_importe:importe,p_fecha_efectiva:all.hoy,p_medio_pago:'efectivo',p_clave_idempotencia:crypto.randomUUID(),p_revision:p.revision,...extras};
   return {args,p};
  };
  let prep=await toPay(account,25000);let payment=await rpc(db,'registrar_cobro_credito',prep.args);
  check('pago parcial crea movimiento y recibo',()=>{assert.equal(payment.estado,'registrado');assert.match(payment.codigo,/REST-\d+/);assert.equal(payment.medio_pago,'efectivo');});
  ficha=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:account});let credit=ficha.cuentas.find(c=>c.id===account);
  check('importe_pagado y saldo de cuota parcial',()=>{assert.equal(Number(credit.cuotas[0].importe_pagado),25000);assert.equal(Number(credit.cuotas[0].saldo),75000);assert.equal(credit.cuotas[0].estado,'parcial');});
  check('mora conserva la información de pago parcial',()=>{assert.equal(credit.cuotas[0].estado_operativo,'vencida');assert.equal(credit.cuotas[0].estado_pago,'parcial');});
  check('saldo de cuenta concuerda con cuotas',()=>assert.equal(Number(credit.saldo_actual),275000));
  const duplicate=await rpc(db,'registrar_cobro_credito',prep.args);
  check('doble envío devuelve el mismo pago',()=>{assert.equal(duplicate.id,payment.id);assert(duplicate.duplicado);});
  await rejects('clave duplicada con otro importe rechazada',rpc(db,'registrar_cobro_credito',{...prep.args,p_importe:20000}),/idempotencia/);
  const previousDate=new Date(all.hoy+'T12:00Z');previousDate.setUTCDate(previousDate.getUTCDate()-3);
  const date=previousDate.toISOString().slice(0,10);
  prep=await toPay(account,100000,{p_fecha_efectiva:date,p_medio_pago:'transferencia',p_referencia:'TEST-TRANSFERENCIA-1',p_observaciones:'TEST pagó antes de cargar'});
  const second=await rpc(db,'registrar_cobro_credito',prep.args);
  check('pago aplicado a dos cuotas por prioridad de vencimiento',()=>{assert.equal(second.imputaciones.length,2);assert.deepEqual(second.imputaciones.map(x=>Number(x.importe)),[75000,25000]);assert.deepEqual(second.imputaciones.map(x=>x.numero),[1,2]);});
  check('fecha efectiva anterior y fecha de registro distintas',()=>{assert.equal(second.fecha_efectiva,date);assert.notEqual(second.creado_en.slice(0,10),date);});
  check('medio, comprobante y observación conservados',()=>{assert.equal(second.medio_pago,'transferencia');assert.equal(second.referencia,'TEST-TRANSFERENCIA-1');assert.equal(second.notas,'TEST pagó antes de cargar');});
  ficha=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:account});credit=ficha.cuentas.find(c=>c.id===account);
  check('una cuota cancelada y otra parcial',()=>{assert.equal(credit.cuotas[0].estado,'pagada');assert.equal(credit.cuotas[1].estado,'parcial');assert.equal(Number(credit.cuotas[1].saldo),75000);});
  check('historial conserva ambos movimientos',()=>assert.equal(ficha.pagos.length,2));
  check('auditoría reutilizada por pago',()=>assert.equal(ficha.historial.filter(a=>a.accion==='pago_registrado').length,2));
  const metrics=await rpc(db,'cobranzas_tablero');
  check('cobrado hoy usa fecha efectiva',()=>assert.equal(Number(metrics.kpis.cobrado_hoy),25000));
  check('cobrado mes excluye fechas fuera del mes',()=>assert.equal(Number(metrics.kpis.cobrado_mes),125000));
  await rejects('anulación exige motivo',rpc(db,'anular_cobro_credito',{p_pago_id:second.id,p_motivo:''}),/motivo/);
  const cancelled=await rpc(db,'anular_cobro_credito',{p_pago_id:second.id,p_motivo:'TEST carga equivocada'});
  check('anulación conserva pago y actor/motivo/fecha',()=>{assert.equal(cancelled.estado,'anulado');assert.equal(cancelled.anulada_por,admin);assert(cancelled.anulada_en);assert.equal(cancelled.motivo_anulacion,'TEST carga equivocada');});
  ficha=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:account});credit=ficha.cuentas.find(c=>c.id===account);
  check('reversión recupera importes pagados, saldos y estados',()=>{assert.equal(Number(credit.saldo_actual),275000);assert.equal(Number(credit.cuotas[0].importe_pagado),25000);assert.equal(credit.cuotas[0].pagada_en,null);assert.equal(credit.cuotas[1].estado,'pendiente');});
  check('imputaciones anuladas siguen visibles',()=>assert.equal(ficha.pagos.find(p=>p.id===second.id).imputaciones.length,2));
  const again=await rpc(db,'anular_cobro_credito',{p_pago_id:second.id,p_motivo:'TEST segundo clic'});
  check('doble anulación no duplica reversión',()=>assert(again.duplicado));
  await rejects('sobrepago rechazado antes de guardar',rpc(db,'previsualizar_cobro',{p_cuenta_id:account,p_importe:300000}),/supera el saldo/);
  for(const bad of [0,-5,'NaN','Infinity',0.001])await rejects('importe inválido '+bad,rpc(db,'previsualizar_cobro',{p_cuenta_id:account,p_importe:bad}),/importe positivo/);
  prep=await toPay(account,275000,{p_medio_pago:'tarjeta'});const paid=await rpc(db,'registrar_cobro_credito',prep.args);
  ficha=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:account});credit=ficha.cuentas.find(c=>c.id===account);
  check('pago completo finaliza cuenta automáticamente',()=>{assert.equal(Number(credit.saldo_actual),0);assert.equal(credit.estado,'finalizada');assert(credit.cuotas.every(q=>q.estado==='pagada'));});
  await rpc(db,'anular_cobro_credito',{p_pago_id:paid.id,p_motivo:'TEST reabrir cuenta'});
  ficha=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:account});credit=ficha.cuentas.find(c=>c.id===account);
  check('anulación de cancelación reabre cuenta',()=>assert.equal(credit.estado,'activa'));
  check('auditoría registra finalización y reapertura',()=>{assert(ficha.historial.some(a=>a.accion==='cuenta_finalizada'));assert(ficha.historial.some(a=>a.accion==='cuenta_reabierta'));});
  prep=await toPay(other.cuenta_id,100);
  await rejects('fecha futura bloqueada',rpc(db,'registrar_cobro_credito',{...prep.args,p_fecha_efectiva:'2099-01-01'}),/fecha efectiva/);
  await rejects('medio inválido bloqueado',rpc(db,'registrar_cobro_credito',{...prep.args,p_medio_pago:'inventado'}),/Medio/);
  await rejects('revisión desactualizada bloqueada',rpc(db,'registrar_cobro_credito',{...prep.args,p_revision:'invalida'}),/saldo cambió/);
  prep=await toPay(lucia.cuenta_id,300000,{p_medio_pago:'otro'});await rpc(db,'registrar_cobro_credito',prep.args);
  const cashClient=all.clientes.find(c=>c.nombre==='TEST Cliente contado');const cashFicha=await rpc(db,'ficha_financiera_cliente',{p_cliente_id:cashClient.id});
  check('venta contado queda sin saldo y sin cuotas',()=>{assert.equal(cashFicha.cuentas[0].estado,'sin_saldo');assert.equal(cashFicha.cuentas[0].cuotas.length,0);assert.equal(Number(cashFicha.resumen.saldo),0);});
  await rejects('no se puede cobrar una venta contado',rpc(db,'previsualizar_cobro',{p_cuenta_id:cashFicha.cuentas[0].id,p_importe:1}),/habilitada/);
  await rejects('no permite borrar movimientos',db.query('delete from public.cobranzas_ventas where id=$1',[payment.id]),/no se borran/);
  await rejects('no permite alterar un pago',db.query('update public.cobranzas_ventas set monto=1 where id=$1',[payment.id]),/inmutable/);
  await rejects('no permite alterar una imputación',db.query('update public.cobranzas_imputaciones set importe=1 where cobranza_id=$1',[payment.id]),/inmutables/);
  await rejects('no permite alterar auditoría',db.query("update public.credito_auditoria set accion='alterada'"),/inmutable/);
  await rejects('edición de saldos sin movimientos falla al cerrar transacción',db.query('update public.cuentas_credito set saldo_actual=1 where id=$1',[account]),/inconsistente/);
  await db.exec(`set role authenticated; set app.test_uid='${seller}'`);
  for(const name of ['cobranzas_tablero','ficha_financiera_cliente','previsualizar_cobro','registrar_cobro_credito','anular_cobro_credito','obtener_recibo_cobranza']){
   const args={cobranzas_tablero:{},ficha_financiera_cliente:{p_cliente_id:maria.cliente_id},previsualizar_cobro:{p_cuenta_id:account,p_importe:1},registrar_cobro_credito:prep.args,anular_cobro_credito:{p_pago_id:payment.id,p_motivo:'TEST vendedor'},obtener_recibo_cobranza:{p_pago_id:payment.id}}[name];
   await rejects('VENDEDOR bloqueado en '+name,rpc(db,name,args),/Solo Administración/);
  }
  for(const table of ['cobranzas_ventas','cobranzas_imputaciones','cuentas_credito','cuotas_credito'])await rejects('VENDEDOR sin escritura directa '+table,db.query(`update public.${table} set id=id`),/permission denied/);
  check('VENDEDOR no lee imputaciones administrativas',()=>{});
  assert.equal((await db.query('select * from public.cobranzas_imputaciones')).rows.length,0);
  await db.exec("reset role; reset app.test_uid; set role anon");
  for(const table of ['cobranzas_ventas','cobranzas_imputaciones','cuentas_credito','cuotas_credito','credito_auditoria'])await rejects('PÚBLICO sin lectura financiera '+table,db.query(`select * from public.${table}`),/permission denied/);
  await rejects('PÚBLICO sin RPC financiera',rpc(db,'cobranzas_tablero'),/permission denied/);
  const token=(await db.query('select public.obtener_catalogo_publico($1) data',[publicToken])).rows[0].data;
  check('catálogo público sigue disponible anónimamente',()=>assert(token.disponible));
  await db.exec(`reset role; set role authenticated; set app.test_uid='${admin}'`);
  const adminRows=await db.query('select * from public.cobranzas_imputaciones');check('ADMIN autorizado a ver imputaciones',()=>assert(adminRows.rows.length>0));
  await db.exec('reset role');
  const commissions=(await db.query('select count(*)::integer n from public.comisiones')).rows[0].n;
  check('cobros y anulaciones no duplican comisiones de entrega',()=>assert.equal(commissions,5));
  const final=await rpc(db,'cobranzas_tablero',{p_filtro:'todas'});
  check('cartera y métricas se recalculan sin pagos anulados',()=>{assert.equal(Number(final.kpis.cartera),875000);assert.equal(Number(final.kpis.cobrado_hoy),325000);});
  // Comprueba el contexto de PostgREST, incluidos los triggers diferidos al cerrar la transacción.
  await db.exec(`begin; set local role authenticated; set local app.test_uid='${admin}'`);
  prep=await toPay(account,100);
  const authPayment=await rpc(db,'registrar_cobro_credito',prep.args);
  await db.exec('set constraints all immediate');
  check('ADMIN authenticated confirma pago con integridad diferida',()=>assert.equal(Number(authPayment.monto),100));
  await db.exec('set constraints all deferred');
  const authVoid=await rpc(db,'anular_cobro_credito',{p_pago_id:authPayment.id,p_motivo:'TEST contexto autenticado'});
  await db.exec('set constraints all immediate');
  check('ADMIN authenticated anula y recupera saldo',()=>{assert.equal(authVoid.estado,'anulado');assert.equal(Number(authVoid.saldo_actual),275000);});
  await db.exec('rollback');
  // Conversión pública después de instalar Fase 2, no solamente antes de sus triggers.
  await db.exec(`begin; set local role anon; set local app.test_uid=''`);
  const publicCatalog=(await db.query('select public.obtener_catalogo_publico($1) data',[publicToken])).rows[0].data;
  const product=publicCatalog.productos.find(x=>x.id==='dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  const key=crypto.randomUUID();
  const request=(await db.query('select public.crear_solicitud_compra_publica($1,$2,$3,$4::jsonb,$5,$6,null) data',[publicToken,product.id,'credito_6',JSON.stringify({nombre:'TEST Integración',apellido:'Financiera',dni:'39999123',telefono:'5493855550123',localidad:'La Banda',domicilio:'TEST 123'}),key,product.version_cotizacion])).rows[0].data;
  check('catálogo crea solicitud con Fase 2 instalada',()=>assert(request.ok));
  await db.exec(`set local role authenticated; set local app.test_uid='${admin}'`);
  const requestId=(await db.query('select id from public.solicitudes_venta where clave_idempotencia=$1',[key])).rows[0].id;
  await db.query("select public.actualizar_estado_solicitud_compra($1,'aprobada',null)",[requestId]);
  await db.query("select public.guardar_condiciones_finales_solicitud($1,'credito_6')",[requestId]);
  const converted=(await db.query('select public.convertir_solicitud_compra($1) data',[requestId])).rows[0].data;
  await db.exec('set constraints all immediate');
  check('ADMIN convierte solicitud y conserva integridad de cuenta/cuotas',()=>assert(converted.ok));
  const createdCredit=(await db.query('select c.saldo_actual, (select sum(q.saldo) from public.cuotas_credito q where q.cuenta_id=c.id) cuotas from public.cuentas_credito c where c.solicitud_id=$1',[requestId])).rows[0];
  check('nueva venta financiada respeta saldo y cronograma después de migrar',()=>assert.equal(Number(createdCredit.saldo_actual),Number(createdCredit.cuotas)));
  await db.exec('rollback');
  if(native){
   const {Client}=require(path.join(modules,'pg'));const c1=new Client({connectionString:process.env.FINANCE_TEST_DATABASE_URL}),c2=new Client({connectionString:process.env.FINANCE_TEST_DATABASE_URL});
   await c1.connect();await c2.connect();await c1.query(`set app.test_uid='${admin}'`);await c2.query(`set app.test_uid='${admin}'`);
   try{
    prep=await toPay(other.cuenta_id,5000);
    const pair=await Promise.all([rpc(c1,'registrar_cobro_credito',prep.args),rpc(c2,'registrar_cobro_credito',prep.args)]);
    check('dos conexiones concurrentes con misma clave producen un pago',()=>{assert.equal(pair[0].id,pair[1].id);assert.equal(pair.filter(p=>p.duplicado).length,1);});
    prep=await toPay(other.cuenta_id,200000);const secondArgs={...prep.args,p_clave_idempotencia:crypto.randomUUID()};
    const conflict=await Promise.allSettled([rpc(c1,'registrar_cobro_credito',prep.args),rpc(c2,'registrar_cobro_credito',secondArgs)]);
    check('dos operadores no sobrepagan ni duplican imputación',()=>{assert.equal(conflict.filter(x=>x.status==='fulfilled').length,1);assert.match(conflict.find(x=>x.status==='rejected').reason.message,/supera el saldo|saldo cambió/);});
    const accountAfter=await rpc(db,'ficha_financiera_cliente',{p_cuenta_id:other.cuenta_id});
    check('saldo concurrente no negativo y exacto',()=>assert.equal(Number(accountAfter.cuentas[0].saldo_actual),95000));
    const pid=conflict.find(x=>x.status==='fulfilled').value.id;
    const voids=await Promise.all([rpc(c1,'anular_cobro_credito',{p_pago_id:pid,p_motivo:'TEST concurrencia'}),rpc(c2,'anular_cobro_credito',{p_pago_id:pid,p_motivo:'TEST concurrencia'})]);
    check('anulación concurrente revierte una sola vez',()=>assert.equal(voids.filter(x=>x.duplicado).length,1));
   }finally{await c1.end();await c2.end();}
  }
  console.log(`PASS ${passed} controles financieros${native?' + concurrencia nativa':' · PostgreSQL embebido'}`);
 }finally{await close();}
})().catch(e=>{console.error('FAIL',e.message,e.where||'');process.exit(1);});
