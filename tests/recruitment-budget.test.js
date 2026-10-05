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
const conversionMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261004143339_fix_postulante_vendedor_conversion.sql'),'utf8');
const createSellerFunction=fs.readFileSync(path.join(root,'supabase/functions/crear-vendedor/index.ts'),'utf8');
const serviceWorker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const recruitmentStyles=fs.readFileSync(path.join(root,'captacion-vendedores.css'),'utf8');

function loadHelpers(){
  const sandbox={console,crypto:webcrypto,Intl,Date,URL,URLSearchParams,location:{search:''},navigator:{},setTimeout,clearTimeout};
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__helpers={validateSellerApplication,budgetPaymentLabel,budgetShareText,secureTemporaryPassword,sellerRecruitmentPublicUrl};`,sandbox);
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
  assert.match(html,/else if\(sellerApplicationRoute\)bootSellerRecruitment\(\);else if\(portalToken\)/);
  assert.match(html,/La solicitud no crea un usuario ni otorga acceso al sistema/);
});

test('las demos de administración y presupuesto no usan el arranque autenticado',()=>{
  assert.match(html,/recruitmentDemoRoute==='admin-captacion'\)bootRecruitmentAdminDemo\(\)/);
  assert.match(html,/recruitmentDemoRoute==='presupuesto-captacion'\)bootRecruitmentBudgetDemo\(\)/);
  assert.match(script,/Modo demostración aislado/);
  assert.match(script,/if\(recruitmentIsDemo\(\)\)\{[\s\S]*data=\{presupuesto:record,cotizacion:record\.condiciones_snapshot\}/);
});

test('administración copia el enlace público canónico sin navegar',()=>{
  const {sellerRecruitmentPublicUrl}=loadHelpers();
  assert.equal(sellerRecruitmentPublicUrl('https://rest-vendedores.vercel.app/'),'https://rest-vendedores.vercel.app/?postularme=1');
  assert.match(html,/id="copyPublicRecruitmentLinkBtn"[^>]*>COPIAR LINK PÚBLICO<\/button>/);
  assert.match(html,/id="copyPublicRecruitmentLinkStatus"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html,/ABRIR LINK PÚBLICO/);
  const copyFlow=script.slice(script.indexOf('async function copyTextWithFallback'),script.indexOf('function initRecruitmentUi'));
  assert.match(copyFlow,/navigator\.clipboard\?\.writeText/);
  assert.match(copyFlow,/document\.execCommand\('copy'\)/);
  assert.match(copyFlow,/Link copiado/);
  assert.doesNotMatch(copyFlow,/window\.open|location\.(href|assign|replace)/);
});

test('la cabecera y pestañas de Vendedores se adaptan sin scroll horizontal',()=>{
  assert.match(html,/class="card seller-admin-card"/);
  assert.match(recruitmentStyles,/\.seller-admin-header\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(recruitmentStyles,/\.seller-admin-tabs\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(recruitmentStyles,/@media\(max-width:760px\)[\s\S]*\.seller-admin-tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(recruitmentStyles,/\.seller-admin-tabs\{[^}]*overflow\s*:\s*auto/);
});

test('aprobar crea o vincula el vendedor y refresca el listado administrativo',()=>{
  assert.match(script,/sb\.rpc\('aprobar_postulante_vendedor'/);
  assert.match(script,/APROBAR Y PREPARAR VENDEDOR/);
  assert.match(script,/if\(typeof loadAdmin==='function'\)await loadAdmin\(\)/);
  assert.match(script,/sb\.functions\.invoke\('crear-vendedor'/);
  assert.match(script,/sb\.rpc\('vincular_postulante_vendedor'/);
  assert.doesNotMatch(migration,/password\s+text/i);
  assert.doesNotMatch(conversionMigration,/password\s+text/i);
});

test('la aprobación es idempotente, bloquea la postulación y prepara un vendedor sin acceso',()=>{
  const approve=conversionMigration.slice(conversionMigration.indexOf('create or replace function public.aprobar_postulante_vendedor'),conversionMigration.indexOf('create or replace function public.activar_postulante_vendedor'));
  assert.match(approve,/for update/);
  assert.match(approve,/if v_postulante\.vendedor_id is not null/);
  assert.match(approve,/insert into public\.vendedores/);
  assert.match(approve,/'junior',[\s\S]*false,[\s\S]*false/);
  assert.match(approve,/v_estado_anterior = 'aprobado' and v_vendedor_anterior is null/);
  assert.match(approve,/'reparacion', true/);
  assert.doesNotMatch(approve,/telefono_normalizado\s*=/);
});

test('la activación reutiliza el vendedor preparado y asigna el rol VENDEDOR atómicamente',()=>{
  const activate=conversionMigration.slice(conversionMigration.indexOf('create or replace function public.activar_postulante_vendedor'),conversionMigration.indexOf('create or replace function public.vincular_postulante_vendedor'));
  assert.match(activate,/insert into public\.perfiles/);
  assert.match(activate,/'vendedor'/);
  assert.match(activate,/update public\.vendedores[\s\S]*set user_id = p_usuario_id/);
  assert.match(activate,/update public\.postulantes_vendedores[\s\S]*set estado = v_estado_final/);
  assert.match(activate,/v_postulante\.estado in \('activo', 'suspendido'\)/);
  assert.match(conversionMigration,/revoke all on function public\.activar_postulante_vendedor[\s\S]*from public, anon, authenticated/);
  assert.match(conversionMigration,/grant execute on function public\.activar_postulante_vendedor[\s\S]*to authenticated/);
});

test('crear-vendedor conserva el alta manual y para postulantes no inserta otro vendedor',()=>{
  assert.match(createSellerFunction,/if \(applicantId\)/);
  const applicantPath=createSellerFunction.slice(createSellerFunction.indexOf('if (applicantId)'),createSellerFunction.indexOf('// Alta manual histórica'));
  assert.match(applicantPath,/rpc\('activar_postulante_vendedor'/);
  assert.match(applicantPath,/auth\.admin\.deleteUser\(userId\)/);
  assert.doesNotMatch(applicantPath,/from\('vendedores'\)\s*\.insert/);
  const manualPath=createSellerFunction.slice(createSellerFunction.indexOf('// Alta manual histórica'));
  assert.match(manualPath,/from\('vendedores'\)\s*\.insert/);
});

test('el equipo distingue un vendedor aprobado pendiente de acceso',()=>{
  assert.match(html,/function sellerAccessLabel\(x\)\{return !x\.user_id\?'Pendiente de acceso'/);
  assert.match(script,/El vendedor ya figura en el equipo como Pendiente de acceso/);
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
  assert.match(serviceWorker,/rest-shell-v1\.4\.4/);
  assert.match(serviceWorker,/captacion-vendedores\.css/);
  assert.match(serviceWorker,/captacion-vendedores\.js/);
});
