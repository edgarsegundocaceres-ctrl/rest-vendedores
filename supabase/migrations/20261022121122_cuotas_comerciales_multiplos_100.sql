-- APP INTEGRAL REST. Solo cotizaciones futuras de Hogar/Celulares.
-- No UPDATE de datos, costos, dólar, snapshots ni cuentas/cuotas existentes.
-- Se conserva la base económica legacy y se agrega únicamente el redondeo autorizado.
create function private.cuota_comercial_100(p_total numeric,p_cuotas integer)
returns numeric language plpgsql immutable set search_path='' as $$
begin
 if p_total is null or p_total<=0 or p_total::text in ('NaN','Infinity','-Infinity') or p_cuotas is null or p_cuotas<=0 then
  raise exception 'Total o cantidad de cuotas inválidos';
 end if;
 return ceil(p_total/p_cuotas/100)*100;
end $$;
create function private.plan_cuotas_comerciales(p_total numeric,p_cuotas integer,p_al_inicio boolean)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('cuotas',p_cuotas,'total',q*p_cuotas,
 'cuota',q,'ultima_cuota',q,'politica_redondeo','arriba_100_v1',
 'primera_cuota',case when p_al_inicio then 'al_inicio' end))
 from (select private.cuota_comercial_100(p_total,p_cuotas) q) t
$$;
revoke all on function private.cuota_comercial_100(numeric,integer),private.plan_cuotas_comerciales(numeric,integer,boolean) from public,anon,authenticated;

create or replace function private.base_comercial_producto(p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare c text; ars numeric; usd numeric; dolar numeric; base numeric; contado numeric; precio_anterior numeric;
begin
 perform pg_catalog.pg_advisory_xact_lock_shared(731906);
 select p.categoria,pc.costo,pc.costo_proveedor_usd,p.precio_contado into c,ars,usd,precio_anterior from public.productos p left join public.productos_costos pc on pc.producto_id=p.id where p.id=p_id;
 -- TRANSICIÓN HÍBRIDA: Hogar no se activa; Celulares sin USD conserva regla vigente.
 -- No deducir costos ni marcar como motor nuevo estas cotizaciones.
 if c='hogar' or (c='celulares' and usd is null) then
  return jsonb_build_object('motor_version',1,'compatibilidad_transitoria',true,'categoria',c,'contado',precio_anterior,
   'credito_personal',jsonb_build_array(
    private.plan_cuotas_comerciales(precio_anterior*1.57,6,false),
    private.plan_cuotas_comerciales(precio_anterior*1.99,9,false)));
 end if;
 if c='hogar' then
  if ars is null or not (ars>0 and ars<1000000000000) then raise exception 'Costo ARS pendiente de configuración'; end if;
  base:=ars;contado:=round(base*1.60,2);
 elsif c='celulares' then
  select valor into dolar from private.dolar_rest_celulares where id;
  if usd is null or dolar is null then raise exception 'Costo USD o Dólar REST pendiente de configuración'; end if;
  base:=(usd+10)*dolar;contado:=round(base*1.40,2);
 else raise exception 'Categoría fuera del motor Hogar/Celulares'; end if;
 return jsonb_strip_nulls(jsonb_build_object('motor_version',2,'categoria',c,'costo_ars',case when c='hogar' then ars end,
 'costo_proveedor_usd',case when c='celulares' then usd end,'adicional_usd',case when c='celulares' then 10 end,'dolar_rest',dolar,'costo_base_ars',base,'contado',contado,
 'credito_personal',jsonb_build_array(
 private.plan_cuotas_comerciales(base*2.50,6,true),
 private.plan_cuotas_comerciales(base*3.20,9,true))));
end $$;

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
  v_coefficients constant jsonb := '{"2":1.0819,"3":1.1232,"4":1.1658,"5":1.2098,"6":1.2552,"7":1.4161,"8":1.4854,"9":1.5577,"10":1.6331,"11":1.7935,"12":1.7935,"18":2.3629,"24":3.0948}'::jsonb;
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


create or replace function private.opciones_catalogo_producto(p_producto_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_producto public.productos%rowtype;
  v_cotizacion jsonb;
  v_seis jsonb;
  v_nueve jsonb;
begin
  select p.* into v_producto
  from public.productos p
  where p.id = p_producto_id
    and p.activo = true
    and p.catalogo_publico = true
    and p.categoria in ('hogar','celulares')
    and private.precio_motor_disponible(p.id);
  if not found then raise exception 'Producto REST no disponible'; end if;

  v_cotizacion := private.calcular_cotizacion_producto(p_producto_id);
  v_producto.precio_contado:=(v_cotizacion->>'contado')::numeric;
  select value into v_seis
  from jsonb_array_elements(v_cotizacion->'credito_personal')
  where (value->>'cuotas')::integer = 6;
  select value into v_nueve
  from jsonb_array_elements(v_cotizacion->'credito_personal')
  where (value->>'cuotas')::integer = 9;

  return jsonb_strip_nulls(jsonb_build_object(
    'contado', jsonb_build_object(
      'codigo','contado','titulo','Contado','total',round(v_producto.precio_contado,2),
      'anticipo',round(v_producto.precio_contado,2),'cantidad_cuotas',0,
      'valor_cuota',0,'frecuencia','unico'
    ),
    'credito_6', case when v_seis is not null then jsonb_build_object(
      'codigo','credito_6','titulo','Crédito personal · 6 cuotas',
      'total',(v_seis->>'total')::numeric,'anticipo',0,'cantidad_cuotas',6,
      'valor_cuota',(v_seis->>'cuota')::numeric,'frecuencia','mensual',
      'motor_version',v_cotizacion->'motor_version','primera_cuota',v_seis->'primera_cuota','ultima_cuota',v_seis->'ultima_cuota','politica_redondeo',v_seis->'politica_redondeo'
    ) end,
    'credito_9', case when v_nueve is not null then jsonb_build_object(
      'codigo','credito_9','titulo','Crédito personal · 9 cuotas',
      'total',(v_nueve->>'total')::numeric,'anticipo',0,'cantidad_cuotas',9,
      'valor_cuota',(v_nueve->>'cuota')::numeric,'frecuencia','mensual',
      'motor_version',v_cotizacion->'motor_version','primera_cuota',v_nueve->'primera_cuota','ultima_cuota',v_nueve->'ultima_cuota','politica_redondeo',v_nueve->'politica_redondeo'
    ) end
  ));
end;
$$;

