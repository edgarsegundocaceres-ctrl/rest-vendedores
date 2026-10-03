const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'captacion-vendedores.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261003175908_captacion_vendedores_presupuestos.sql'),'utf8');
const serviceWorker=fs.readFileSync(path.join(root,'sw.js'),'utf8');

function loadHelpers(){
  const sandbox={console,crypto:webcrypto,Intl,Date,URLSearchParams,location:{search:''},navigator:{},setTimeout,clearTimeout};
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__helpers={validateSellerApplication,budgetPaymentLabel,budgetShareText,secureTemporaryPassword};`,sandbox);
  return sandbox.__helpers;
}

const validApplication={
  p_nombre:'Ana',p_apellido:'Pérez',p_dni:'30.111.222',p_fecha_nacimiento:'1990-05-12',
  p_telefono:'+54 9 385 555-0101',p_email:'ana@example.com',p_localidad:'La Banda',
  p_provincia:'Santiago del Estero',p_motivacion:'Quiero desarrollar nuevos clientes con REST.',
  p_canales:['whatsapp','contactos_personales'],p_disponibilidad:'1_2_horas_dia'
};

test('el formulario acepta una postulación válida sin exigir datos opcionales',()=>{
  const {validateSellerApplication}=loadHelpers();
  const result=validateSellerApplication(validApplication);
  assert.equal(result.ok,true);
  assert.deepEqual([...result.errors],[]);
});

test('el formulario rechaza DNI, teléfono, email, motivación y canales inválidos',()=>{
  const {validateSellerApplication}=loadHelpers();
  const result=validateSellerApplication({...validApplication,p_dni:'12',p_telefono:'123',p_email:'sin-arroba',p_motivacion:'corto',p_canales:[]});
  assert.equal(result.ok,false);
  assert.ok(result.errors.length>=5);
});

test('la contraseña provisoria se genera con Web Crypto y longitud segura',()=>{
  const {secureTemporaryPassword}=loadHelpers();
  const first=secureTemporaryPassword(),second=secureTemporaryPassword();
  assert.equal(first.length,16);
  assert.equal(second.length,16);
  assert.notEqual(first,second);
});

test('el texto compartible usa los valores congelados del presupuesto',()=>{
  const {budgetPaymentLabel,budgetShareText}=loadHelpers();
  const record={codigo:'REST-20261003-ABC123',producto_nombre_snapshot:'Heladera X',modalidad_snapshot:'Anticipo + cuotas mensuales',anticipo_snapshot:100000,cantidad_cuotas_snapshot:6,valor_cuota_snapshot:85000,frecuencia_snapshot:'mensual',total_snapshot:610000,vigente_hasta:'2026-10-10',prospecto_nombre:'Cliente Demo'};
  assert.match(budgetPaymentLabel(record),/6 cuotas mensuales/);
  const text=budgetShareText(record,{total:610000});
  assert.match(text,/REST-20261003-ABC123/);
  assert.match(text,/Heladera X/);
  assert.match(text,/Cliente Demo/);
});

test('la ruta pública se evalúa antes que el inicio autenticado',()=>{
  assert.match(html,/sellerApplicationRoute=qs\.get\('postularme'\)==='1'/);
  assert.match(html,/if\(sellerApplicationRoute\)bootSellerRecruitment\(\);else if\(portalToken\)/);
  assert.match(html,/La solicitud no crea un usuario ni otorga acceso al sistema/);
});

test('la UI reutiliza el alta segura existente para convertir al postulante',()=>{
  assert.match(script,/sb\.functions\.invoke\('crear-vendedor'/);
  assert.match(script,/sb\.rpc\('vincular_postulante_vendedor'/);
  assert.doesNotMatch(migration,/password\s+text/i);
});

test('la migración limita el flujo nuevo a Hogar y Celulares',()=>{
  assert.match(migration,/producto_categoria_snapshot in \('hogar','celulares'\)/);
  assert.match(migration,/categoria in \('hogar','celulares'\)/g);
  const calculator=migration.slice(migration.indexOf('create or replace function public.calcular_presupuesto_rest'),migration.indexOf('create or replace function public.crear_presupuesto_vendedor'));
  assert.doesNotMatch(calculator,/entrega_pactada|cuota 3|chasis|motor|patentamiento/i);
});

test('el precio del presupuesto se recalcula en servidor y no se toma del frontend',()=>{
  assert.match(migration,/v_quote := public\.cotizar_producto\(p_producto_id\)/);
  assert.match(migration,/v_quote := public\.calcular_presupuesto_rest\(p_producto_id,p_modalidad,p_cuotas,p_anticipo\)/);
  assert.doesNotMatch(migration,/p_total|p_precio_contado/);
});

test('las tablas nuevas tienen RLS y no conceden lectura anónima',()=>{
  for(const table of ['programa_vendedores_config','postulantes_vendedores','postulantes_vendedores_historial','presupuestos']){
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration,new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(migration,/grant\s+select\s+on\s+table\s+public\.[^;]+\s+to\s+anon/i);
  assert.match(migration,/grant execute on function public\.enviar_postulacion_vendedor[\s\S]+to anon, authenticated/);
  assert.match(migration,/postulantes_vendedores_admin_select/);
  assert.match(migration,/presupuestos_select_propios_o_admin/);
});

test('la postulación pública solo inserta postulación e historial',()=>{
  const publicFunction=migration.slice(migration.indexOf('create or replace function public.enviar_postulacion_vendedor'),migration.indexOf('create or replace function public.actualizar_programa_vendedores'));
  assert.match(publicFunction,/insert into public\.postulantes_vendedores/);
  assert.match(publicFunction,/insert into public\.postulantes_vendedores_historial/);
  assert.doesNotMatch(publicFunction,/insert into public\.(vendedores|perfiles|ventas)/);
});

test('el presupuesto conserva snapshot, vendedor y conversión posterior',()=>{
  for(const token of ['vendedor_id','producto_nombre_snapshot','precio_contado_snapshot','condiciones_snapshot','vigente_hasta','venta_id'])assert.match(migration,new RegExp(token));
  assert.match(migration,/create or replace function public\.vincular_presupuesto_venta/);
  assert.match(html,/GENERAR PRESUPUESTO \+ IMAGEN/);
});

test('el service worker incluye los recursos nuevos y cambia la versión de caché',()=>{
  assert.match(serviceWorker,/rest-shell-v1\.4\.0/);
  assert.match(serviceWorker,/captacion-vendedores\.css/);
  assert.match(serviceWorker,/captacion-vendedores\.js/);
});

