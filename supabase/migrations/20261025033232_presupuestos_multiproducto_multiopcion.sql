-- REST exclusivamente. Sin UPDATE de históricos ni configuración productiva.
create or replace function private.plan_cuotas_comerciales(p_total numeric,p_cuotas integer,p_al_inicio boolean)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('cuotas',p_cuotas,'total',q*p_cuotas,'total_sin_redondear',p_total,
 'cuota',q,'ultima_cuota',q,'politica_redondeo','arriba_100_v1',
 'primera_cuota',case when p_al_inicio then 'al_inicio' end))
 from (select private.cuota_comercial_100(p_total,p_cuotas) q) t
$$;

create function private.coeficientes_sol_rest() returns jsonb language sql immutable set search_path='' as $$ select '{"2":1.0819,"3":1.1232,"4":1.1658,"5":1.2098,"6":1.2552,"7":1.4161,"8":1.4854,"9":1.5577,"10":1.6331,"11":1.7935,"12":1.7935,"18":2.3629,"24":3.0948}'::jsonb $$;
revoke all on function private.coeficientes_sol_rest() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.calcular_presupuesto_rest(p_producto_id uuid, p_modalidad text, p_cuotas integer DEFAULT 0, p_anticipo numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_producto public.productos%rowtype;
  v_quote jsonb;
  v_option jsonb;
  v_cfg jsonb;
  v_coefficients constant jsonb := private.coeficientes_sol_rest();
  v_coef numeric;
  v_cash numeric;
  v_total numeric;
  v_value numeric;
  v_balance numeric;
  v_rate numeric;
  v_min numeric;
  v_frequency text;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if public.mi_vendedor_id() is null and not public.es_admin() then raise exception 'Vendedor no habilitado'; end if;

  select * into v_producto from public.productos
  where id = p_producto_id and activo = true and categoria in ('hogar','celulares');
  if not found then raise exception 'Producto REST no disponible para presupuestar'; end if;
  v_quote := public.cotizar_producto(p_producto_id);
  v_cash := (v_quote->>'contado')::numeric;
  if v_cash <= 0 then raise exception 'El producto no tiene un precio válido'; end if;

  if p_modalidad = 'Contado' then
    return jsonb_build_object(
      'title','Contado','total',round(v_cash,2),'down',0,'count',0,'value',0,
      'frequency','unico','paymentText','Contado'
    );
  elsif p_modalidad = 'Crédito personal' then
    select value into v_option
    from jsonb_array_elements(v_quote->'credito_personal')
    where (value->>'cuotas')::integer = p_cuotas;
    if v_option is null then raise exception 'Ese plan de crédito ya no está disponible'; end if;
    return jsonb_build_object(
      'title',format('Crédito personal · %s cuotas',p_cuotas),
      'total',(v_option->>'total')::numeric,'down',0,'count',p_cuotas,
      'value',(v_option->>'cuota')::numeric,'frequency','mensual','primera_cuota',v_option->'primera_cuota','ultima_cuota',v_option->'ultima_cuota','motor_version',v_quote->'motor_version','politica_redondeo',v_option->'politica_redondeo',
      'paymentText',format('Crédito personal · %s cuotas de %s',p_cuotas,(v_option->>'cuota')::numeric)
    );
  elsif p_modalidad in ('Anticipo + cuotas mensuales','Anticipo + cuotas semanales') then
    v_cfg := case when p_modalidad like '%semanales' then v_quote->'semanal' else v_quote->'mensual' end;
    if v_cfg is null or not exists (
      select 1 from jsonb_array_elements_text(v_cfg->'cuotas') q where q::integer = p_cuotas
    ) then raise exception 'Ese plan ya no está disponible'; end if;
    v_min := (v_cfg->>'anticipo_min')::numeric;
    v_rate := (v_cfg->>'tasa')::numeric;
    if coalesce(p_anticipo,0) < v_min then raise exception 'El anticipo mínimo es %', v_min; end if;
    if p_anticipo >= v_cash then raise exception 'El anticipo debe ser menor al contado'; end if;
    v_balance := v_cash - p_anticipo;
    v_value := private.cuota_comercial_100(v_balance * (1 + v_rate * p_cuotas),p_cuotas);
    v_total := round(p_anticipo,2) + v_value*p_cuotas;
    v_frequency := case when p_modalidad like '%semanales' then 'semanal' else 'mensual' end;
    return jsonb_build_object(
      'title',format('Anticipo + %s cuotas %s',p_cuotas,v_frequency),
      'total',v_total,'down',round(p_anticipo,2),'count',p_cuotas,'value',v_value,
      'frequency',v_frequency,'ultima_cuota',v_value,'politica_redondeo','arriba_100_v1',
      'paymentText',format('Anticipo %s + %s cuotas %s de %s',round(p_anticipo,2),p_cuotas,v_frequency,v_value)
    );
  elsif p_modalidad = 'Tarjeta Sol' then
    v_coef := (v_coefficients->>p_cuotas::text)::numeric;
    if v_coef is null then raise exception 'No hay coeficiente vigente para esa cantidad de cuotas'; end if;
    v_value := private.cuota_comercial_100(v_cash * v_coef,p_cuotas);
    v_total := v_value*p_cuotas;
    return jsonb_build_object(
      'title',format('Tarjeta Sol · %s cuotas',p_cuotas),
      'total',v_total,'down',0,'count',p_cuotas,'value',v_value,
      'frequency','mensual','ultima_cuota',v_value,'politica_redondeo','arriba_100_v1',
      'paymentText',format('Tarjeta Sol · %s cuotas de %s',p_cuotas,v_value)
    );
  end if;

  raise exception 'Modalidad no habilitada para presupuestos REST';
end;
$function$
;



-- The existing public snapshot holds commercial data only; private audit holds economic inputs.
alter table public.presupuestos add column solicitud_emision_id uuid;
create unique index presupuesto_emision_idempotente on public.presupuestos(vendedor_id,solicitud_emision_id) where solicitud_emision_id is not null;

create function private.cotizar_conjunto_rest(p_items jsonb,p_opciones jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 item jsonb; opt jsonb; b jsonb; q jsonb; plan jsonb; cfg jsonb; rowp public.productos;
 items jsonb:='[]'; bases jsonb:='[]'; opciones jsonb:='[]'; economic jsonb:='[]';
 qty integer; pid uuid; ids uuid[]:='{}'; key text; keys text[]:='{}'; mode text; n integer; down numeric;
 cash numeric:=0; raw numeric; amount numeric; rate numeric; min_down numeric; ref_rate numeric;
 motor integer; ref_motor integer; mixed boolean:=false; initial boolean; ref_initial boolean;
 freq text; total numeric; title text;
begin
 if auth.uid() is null or (public.mi_vendedor_id() is null and not public.es_admin()) then raise exception 'No autorizado'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Seleccioná de 1 a 30 productos'; end if;
 if jsonb_typeof(p_opciones) is distinct from 'array' or jsonb_array_length(p_opciones) not between 1 and 24 then raise exception 'Seleccioná de 1 a 24 alternativas'; end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(731906);
 -- Lock all selected product rows in stable order against concurrent legacy price edits.
 perform 1 from public.productos where id in (select (value->>'producto_id')::uuid from jsonb_array_elements(p_items)) order by id for share;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or item - array['producto_id','cantidad'] <> '{}'::jsonb then raise exception 'Solo producto y cantidad; importes no admitidos'; end if;
  pid:=(item->>'producto_id')::uuid;
  if pid=any(ids) then raise exception 'Producto repetido: usá cantidad'; end if; ids:=array_append(ids,pid);
  if coalesce(item->>'cantidad','') !~ '^[1-9][0-9]{0,2}$' then raise exception 'Cantidad entera de 1 a 999'; end if; qty:=(item->>'cantidad')::integer;
  select * into rowp from public.productos where id=pid and activo and categoria in ('hogar','celulares');
  if not found then raise exception 'Producto REST no disponible'; end if;
  b:=private.base_comercial_producto(pid);q:=private.calcular_cotizacion_producto(pid);
  if not ((q->>'contado')::numeric>0) then raise exception 'Precio no disponible'; end if;
  cash:=cash+(q->>'contado')::numeric*qty;motor:=(b->>'motor_version')::integer;
  if ref_motor is not null and ref_motor<>motor then mixed:=true; end if;ref_motor:=motor;
  items:=items||jsonb_build_array(jsonb_build_object('producto_id',pid,'nombre',rowp.nombre,'categoria',rowp.categoria,'cantidad',qty,'precio_contado',(q->>'contado')::numeric,'subtotal_contado',(q->>'contado')::numeric*qty,'imagen_url',rowp.imagen_url));
  bases:=bases||jsonb_build_array(jsonb_build_object('cantidad',qty,'base',b,'quote',q));
  economic:=economic||jsonb_build_array(jsonb_build_object('producto_id',pid,'cantidad',qty,'base',b));
 end loop;
 for opt in select value from jsonb_array_elements(p_opciones) loop
  if jsonb_typeof(opt) is distinct from 'object' or opt - array['modalidad','cuotas','anticipo'] <> '{}'::jsonb then raise exception 'Importes oficiales: enviá solamente modalidad, cuotas y anticipo adicional'; end if;
  mode:=opt->>'modalidad';n:=coalesce((opt->>'cuotas')::integer,0);down:=coalesce((opt->>'anticipo')::numeric,0);
  if down::text in ('NaN','Infinity','-Infinity') or down<0 or round(down,2)<>down then raise exception 'Anticipo inválido'; end if;
  key:=mode||':'||n::text;
  if key=any(keys) then raise exception 'Alternativa repetida'; end if;keys:=array_append(keys,key);
  raw:=0;initial:=false;ref_initial:=null;freq:='mensual';min_down:=0;ref_rate:=null;
  if mode='Contado' then
   if n<>0 or down<>0 then raise exception 'Contado no admite cuotas ni anticipo adicional'; end if;
   amount:=0;total:=cash;freq:='unico';title:='Contado';
  else
   if n<=0 then raise exception 'Cantidad de cuotas inválida'; end if;
   if mode='Crédito personal' then
    if down<>0 then raise exception 'La primera cuota no es un anticipo adicional'; end if;
    for b in select value from jsonb_array_elements(bases) loop
     select value into plan from jsonb_array_elements(b->'base'->'credito_personal') where (value->>'cuotas')::integer=n;
     if plan is null or plan->>'total_sin_redondear' is null then raise exception 'Plan no disponible'; end if;
     raw:=raw+(plan->>'total_sin_redondear')::numeric*(b->>'cantidad')::integer;
     -- Approved mixed calendar: one complete installment at inception if any plan requires it.
     initial:=initial or coalesce(plan->>'primera_cuota'='al_inicio',false);
    end loop;
    title:=format('Crédito personal · %s cuotas',n);
   elsif mode in ('Anticipo + cuotas mensuales','Anticipo + cuotas semanales') then
    freq:=case when mode like '%semanales' then 'semanal' else 'mensual' end;
    for b in select value from jsonb_array_elements(bases) loop
     cfg:=b->'quote'->case when freq='semanal' then 'semanal' else 'mensual' end;
     if cfg is null or not exists(select 1 from jsonb_array_elements_text(cfg->'cuotas') x where x::integer=n) then raise exception 'Plan no habilitado para todos los productos'; end if;
     rate:=(cfg->>'tasa')::numeric;
     if ref_rate is not null and ref_rate<>rate then raise exception 'Tasas distintas: requiere definición comercial'; end if;ref_rate:=rate;
     min_down:=min_down+(cfg->>'anticipo_min')::numeric*(b->>'cantidad')::integer;
    end loop;
    if down<min_down or down>=cash then raise exception 'Anticipo adicional debe ser al menos % y menor al contado %',min_down,cash; end if;
    raw:=(cash-down)*(1+ref_rate*n);title:=format('Anticipo + %s cuotas %s',n,freq);
   elsif mode='Tarjeta Sol' then
    if down<>0 then raise exception 'Tarjeta Sol no admite anticipo adicional'; end if;
    rate:=(private.coeficientes_sol_rest()->>n::text)::numeric;
    if rate is null then raise exception 'Plan Tarjeta Sol no habilitado'; end if;raw:=cash*rate;title:=format('Tarjeta Sol · %s cuotas',n);
   else raise exception 'Modalidad no habilitada'; end if;
   amount:=private.cuota_comercial_100(raw,n);total:=down+amount*n;
  end if;
  if total>=1000000000000 then raise exception 'Importe fuera de rango'; end if;
  opciones:=opciones||jsonb_build_array(jsonb_build_object('id',key,'modalidad',mode,'title',title,'count',n,'value',amount,'total',total,'down',down,'frequency',freq,'primera_cuota',case when initial then 'al_inicio' end,'pago_inicial',case when initial then amount else down end,'ultima_cuota',amount,'politica_redondeo','arriba_100_v1','paymentText',case when n=0 then 'Contado' else title||format(' de %s',amount) end));
 end loop;
 return jsonb_build_object('version',2,'items',items,'opciones',opciones,'contado',cash,'economia_privada',economic);
end $$;
revoke all on function private.cotizar_conjunto_rest(jsonb,jsonb) from public,anon,authenticated;
create function public.cotizar_presupuesto_multiple(p_items jsonb,p_opciones jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.cotizar_conjunto_rest(p_items,p_opciones)-'economia_privada' $$;
revoke all on function public.cotizar_presupuesto_multiple(jsonb,jsonb) from public,anon;
grant execute on function public.cotizar_presupuesto_multiple(jsonb,jsonb) to authenticated;

create function public.crear_presupuesto_multiple(p_items jsonb,p_opciones jsonb,p_clave uuid,p_nombre text default null,p_vigencia integer default 7) returns jsonb
language plpgsql security definer set search_path='' as $$
declare vid uuid:=public.mi_vendedor_id(); q jsonb; econ jsonb; first_item jsonb; first_option jsonb; r public.presupuestos; request jsonb; previous jsonb; seller_name text;
begin
 if auth.uid() is null or vid is null then raise exception 'Vendedor no habilitado'; end if;
 if p_clave is null then raise exception 'Clave de emisión obligatoria'; end if;
 if p_vigencia is null or p_vigencia not between 1 and 30 then raise exception 'Vigencia de 1 a 30 días'; end if;
 if length(coalesce(p_nombre,''))>160 then raise exception 'Nombre demasiado largo'; end if;
 request:=jsonb_build_object('items',p_items,'opciones',p_opciones,'nombre',p_nombre,'vigencia',p_vigencia);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(vid::text||p_clave::text,731908));
 select * into r from public.presupuestos where vendedor_id=vid and solicitud_emision_id=p_clave;
 if found then
  select detalle->'request' into previous from private.motor_precios_auditoria where tipo='presupuesto_multiple' and entidad_id=r.id order by id desc limit 1;
  if request is distinct from previous then raise exception 'Clave reutilizada con otro contenido'; end if;
  return to_jsonb(r);
 end if;
 q:=private.cotizar_conjunto_rest(p_items,p_opciones);econ:=q->'economia_privada';q:=q-'economia_privada';
 select nombre into seller_name from public.vendedores where id=vid;
 q:=q||jsonb_build_object('vendedor',jsonb_build_object('id',vid,'nombre',seller_name));
 first_item:=q->'items'->0;first_option:=q->'opciones'->0;
 -- Scalar fields are compatibility projections; version 2 readers use every item/option.
 insert into public.presupuestos(vendedor_id,producto_id,prospecto_nombre,producto_nombre_snapshot,producto_categoria_snapshot,precio_contado_snapshot,modalidad_snapshot,anticipo_snapshot,cantidad_cuotas_snapshot,valor_cuota_snapshot,frecuencia_snapshot,total_snapshot,condiciones_snapshot,vigencia_dias,vigente_hasta,solicitud_emision_id)
 values(vid,(first_item->>'producto_id')::uuid,nullif(btrim(p_nombre),''),(select string_agg((x->>'cantidad')||' × '||(x->>'nombre'),' + ') from jsonb_array_elements(q->'items') x),first_item->>'categoria',(q->>'contado')::numeric,case when jsonb_array_length(q->'opciones')>1 then 'Varias alternativas' else first_option->>'modalidad' end,(first_option->>'down')::numeric,(first_option->>'count')::integer,(first_option->>'value')::numeric,first_option->>'frequency',(first_option->>'total')::numeric,q,p_vigencia,(now() at time zone 'America/Argentina/Cordoba')::date+p_vigencia,p_clave) returning * into r;
 insert into private.motor_precios_auditoria(tipo,entidad_id,detalle) values('presupuesto_multiple',r.id,jsonb_build_object('productos',econ,'request',request,'seleccion',q));
 return to_jsonb(r);
end $$;
revoke all on function public.crear_presupuesto_multiple(jsonb,jsonb,uuid,text,integer) from public,anon;
grant execute on function public.crear_presupuesto_multiple(jsonb,jsonb,uuid,text,integer) to authenticated;

-- Conversion chooses one immutable alternative, never re-quotes an issued budget.
create function public.convertir_presupuesto_multiple(p_presupuesto uuid,p_opcion text,p_cliente_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare vid uuid:=public.mi_vendedor_id(); r public.presupuestos; q jsonb; sale uuid; saved jsonb;
begin
 if auth.uid() is null or vid is null then raise exception 'Vendedor no habilitado'; end if;
 select * into r from public.presupuestos where id=p_presupuesto and vendedor_id=vid for update;
 if not found or r.condiciones_snapshot->>'version' is distinct from '2' then raise exception 'Presupuesto no disponible'; end if;
 select value into q from jsonb_array_elements(r.condiciones_snapshot->'opciones') where value->>'id'=p_opcion;
 if q is null then raise exception 'Seleccioná una alternativa ofrecida'; end if;
 if r.estado='convertido' then
  select detalle into saved from private.motor_precios_auditoria where tipo='venta_presupuesto_multiple' and entidad_id=r.venta_id order by id desc limit 1;
  if saved->>'opcion_id' is distinct from p_opcion or saved->>'cliente_id' is distinct from p_cliente_id::text then raise exception 'Presupuesto ya convertido con otra opción o cliente'; end if;
  return jsonb_build_object('id',r.venta_id,'duplicado',true,'seleccion',q);
 end if;
 if r.estado<>'vigente' or r.vigente_hasta<(now() at time zone 'America/Argentina/Cordoba')::date then raise exception 'Presupuesto vencido o anulado'; end if;
 if not exists(select 1 from public.clientes c where c.id=p_cliente_id and (c.creado_por_vendedor_id=vid or exists(select 1 from public.ventas v where v.cliente_id=c.id and v.vendedor_id=vid))) then raise exception 'Cliente no disponible para este vendedor'; end if;
 insert into public.ventas(vendedor_id,cliente_id,producto,monto_total,forma_pago,anticipo_esperado,notas,estado)
 values(vid,p_cliente_id,r.producto_nombre_snapshot,(q->>'total')::numeric,q->>'paymentText',(q->>'pago_inicial')::numeric,'Presupuesto '||r.codigo||' · alternativa '||p_opcion,'pendiente') returning id into sale;
 insert into private.motor_precios_auditoria(tipo,entidad_id,detalle) values('venta_presupuesto_multiple',sale,jsonb_build_object('presupuesto_id',r.id,'cliente_id',p_cliente_id,'opcion_id',p_opcion,'items',r.condiciones_snapshot->'items','seleccion',q));
 update public.presupuestos set estado='convertido',venta_id=sale,convertido_en=now() where id=r.id;
 return jsonb_build_object('id',sale,'estado','pendiente','seleccion',q,'duplicado',false);
end $$;
revoke all on function public.convertir_presupuesto_multiple(uuid,text,uuid) from public,anon;
grant execute on function public.convertir_presupuesto_multiple(uuid,text,uuid) to authenticated;

create function public.opciones_presupuesto_multiple(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare seed jsonb; item jsonb; q jsonb; firstq jsonb; options jsonb:='[]'; n integer; min_m numeric:=0; min_s numeric:=0; engine text; mixed boolean:=false;
begin
 seed:=private.cotizar_conjunto_rest(p_items,'[{"modalidad":"Contado","cuotas":0}]');
 for item in select value from jsonb_array_elements(p_items) loop
  q:=private.calcular_cotizacion_producto((item->>'producto_id')::uuid);
  if firstq is null then firstq:=q;engine:=q->>'motor_version'; elsif engine is distinct from q->>'motor_version' then mixed:=true;end if;
  -- These modalities currently share exactly the same rates/counts; fail closed if changed.
  if firstq->'mensual'->'tasa' is distinct from q->'mensual'->'tasa' or firstq->'mensual'->'cuotas' is distinct from q->'mensual'->'cuotas' or firstq->'semanal'->'tasa' is distinct from q->'semanal'->'tasa' or firstq->'semanal'->'cuotas' is distinct from q->'semanal'->'cuotas' then raise exception 'Condiciones incompatibles; presupuestá por separado'; end if;
  min_m:=min_m+(q->'mensual'->>'anticipo_min')::numeric*(item->>'cantidad')::integer;
  min_s:=min_s+(q->'semanal'->>'anticipo_min')::numeric*(item->>'cantidad')::integer;
 end loop;
 options:=jsonb_build_array(jsonb_build_object('modalidad','Contado','cuotas',0,'label','Contado'));
 for n in select (x->>'cuotas')::integer from jsonb_array_elements(firstq->'credito_personal') x loop
   options:=options||jsonb_build_array(jsonb_build_object('modalidad','Crédito personal','cuotas',n,'label',n||' cuotas'));
 end loop;
 for n in select value::integer from jsonb_array_elements_text(firstq->'mensual'->'cuotas') loop
  options:=options||jsonb_build_array(jsonb_build_object('modalidad','Anticipo + cuotas mensuales','cuotas',n,'label','Anticipo + '||n||' cuotas mensuales','anticipo_min',min_m));
 end loop;
 for n in select value::integer from jsonb_array_elements_text(firstq->'semanal'->'cuotas') loop
  options:=options||jsonb_build_array(jsonb_build_object('modalidad','Anticipo + cuotas semanales','cuotas',n,'label','Anticipo + '||n||' cuotas semanales','anticipo_min',min_s));
 end loop;
 for n in select key::integer from jsonb_each(private.coeficientes_sol_rest()) order by key::integer loop
  options:=options||jsonb_build_array(jsonb_build_object('modalidad','Tarjeta Sol','cuotas',n,'label','Tarjeta Sol · '||n||' cuotas'));
 end loop;
 return jsonb_build_object('opciones',options,'mixto',mixed,'contado',seed->'contado');
end $$;
revoke all on function public.opciones_presupuesto_multiple(jsonb) from public,anon;
grant execute on function public.opciones_presupuesto_multiple(jsonb) to authenticated;

create function public.clientes_presupuesto_multiple() returns jsonb language plpgsql security definer set search_path='' as $$
declare vid uuid:=public.mi_vendedor_id();
begin
 if auth.uid() is null or vid is null then raise exception 'Vendedor no habilitado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre) order by c.nombre) from public.clientes c where c.creado_por_vendedor_id=vid or exists(select 1 from public.ventas v where v.cliente_id=c.id and v.vendedor_id=vid)),'[]');
end $$;
revoke all on function public.clientes_presupuesto_multiple() from public,anon;
grant execute on function public.clientes_presupuesto_multiple() to authenticated;

-- Prevent the old administrative link from bypassing the required alternative selection.
create or replace function public.vincular_presupuesto_venta(
  p_presupuesto_id uuid,
  p_venta_id uuid
)
returns public.presupuestos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.presupuestos;
begin
  if not public.es_admin() then raise exception 'Solo Administración'; end if;
  select p.* into v_row
  from public.presupuestos p
  join public.ventas v on v.id = p_venta_id and v.vendedor_id = p.vendedor_id
  where p.id = p_presupuesto_id and p.estado = 'vigente'
  for update of p;
  if not found then raise exception 'Presupuesto o venta incompatibles'; end if;
  if v_row.condiciones_snapshot->>'version'='2' then raise exception 'Elegí una alternativa mediante convertir_presupuesto_multiple'; end if;
  update public.presupuestos set estado='convertido', venta_id=p_venta_id, convertido_en=now()
  where id=p_presupuesto_id returning * into v_row;
  return v_row;
end;
$$;
