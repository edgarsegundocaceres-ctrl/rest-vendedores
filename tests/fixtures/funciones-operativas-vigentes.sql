-- Definiciones verificadas en gajlmcqaylezudttoaju el 8/10/2026.
-- Solo para pruebas locales; nunca aplicar este fixture como migración.
-- al_cambiar_estado_venta
CREATE OR REPLACE FUNCTION public.al_cambiar_estado_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mes date;
begin
  if new.fecha_entrega is not null then
    v_mes := date_trunc('month', new.fecha_entrega)::date;
    perform public.recalcular_mes_vendedor(new.vendedor_id, v_mes);
  end if;
  return new;
end;
$function$;

-- al_entregar_venta
CREATE OR REPLACE FUNCTION public.al_entregar_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pct numeric(5,2);
  v_importe numeric(14,2);
  v_comision_id uuid;
  v_cat text;
begin
  if new.estado in ('entregada','en_cobranza','consolidada') and old.estado not in ('entregada','en_cobranza','consolidada') then
    if new.fecha_entrega is null then new.fecha_entrega := now(); end if;
    select categoria_actual into v_cat from public.vendedores where id = new.vendedor_id;
    v_pct := case when v_cat = 'junior' then 3 else 5 end;
    v_importe := round(new.monto_total * v_pct / 100, 2);

    insert into public.comisiones(venta_id, vendedor_id, porcentaje, importe_original, importe_vigente)
    values (new.id, new.vendedor_id, v_pct, v_importe, v_importe)
    on conflict (venta_id) do nothing
    returning id into v_comision_id;

    if v_comision_id is not null then
      insert into public.movimientos_vendedor(vendedor_id, tipo, importe, venta_id, comision_id, descripcion, registrado_por)
      values (new.vendedor_id, 'comision', v_importe, new.id, v_comision_id, 'Comisión generada por venta entregada', new.aprobada_por);
    end if;
  end if;
  return new;
end;
$function$;

-- aprobar_solicitud_venta
CREATE OR REPLACE FUNCTION public.aprobar_solicitud_venta(p_solicitud_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_solicitud public.solicitudes_venta%rowtype;
  v_producto public.productos%rowtype;
  v_interes public.intereses_clientes%rowtype;
  v_cliente_id uuid;
  v_clientes_dni integer;
  v_venta_id uuid;
  v_cuenta_id uuid;
  v_es_financiada boolean;
  v_mes date := date_trunc('month', current_date)::date;
  v_cupo numeric := 0;
  v_usado numeric := 0;
  v_saldo numeric;
  v_importe numeric;
  v_numero integer;
  v_resultado jsonb;
begin
  if v_usuario_id is null or not public.es_admin() then
    raise exception 'Solo Administración puede aprobar solicitudes';
  end if;
  if p_solicitud_id is null then
    raise exception 'Solicitud inválida';
  end if;

  select s.*
    into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
  for update;

  if not found then
    raise exception 'La solicitud no existe';
  end if;
  if v_solicitud.estado = 'aprobada' then
    return to_jsonb(v_solicitud);
  end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'La solicitud no está pendiente de aprobación';
  end if;

  select p.*
    into v_producto
  from public.productos p
  where p.id = v_solicitud.producto_id
    and p.activo = true
  for share;

  if not found or v_producto.categoria <> v_solicitud.unidad
     or v_producto.categoria not in ('hogar', 'celulares') then
    raise exception 'El producto dejó de estar disponible para esta unidad';
  end if;

  if v_solicitud.interes_cliente_id is not null then
    select i.*
      into v_interes
    from public.intereses_clientes i
    where i.id = v_solicitud.interes_cliente_id
    for update;

    if not found then
      raise exception 'La oportunidad vinculada ya no existe';
    end if;
    if v_interes.vendedor_id is distinct from v_solicitud.vendedor_id
       or v_interes.estado not in ('asignado', 'en_gestion')
       or v_interes.venta_id is not null then
      raise exception 'La oportunidad vinculada cambió o ya fue cerrada';
    end if;
    if v_interes.producto_id is not null
       and v_interes.producto_id <> v_solicitud.producto_id then
      raise exception 'La oportunidad vinculada corresponde a otro producto';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('rest-cliente-dni:' || v_solicitud.cliente_dni, 0)
  );

  select count(*)::integer,
         (array_agg(c.id order by c.creado_en, c.id))[1]
    into v_clientes_dni, v_cliente_id
  from public.clientes c
  where regexp_replace(coalesce(c.dni, ''), '[^0-9]', '', 'g') = v_solicitud.cliente_dni;

  if v_clientes_dni > 1 then
    raise exception 'El DNI % aparece en más de un cliente histórico. Unificá el cliente antes de aprobar.',
      v_solicitud.cliente_dni;
  elsif v_clientes_dni = 0 then
    insert into public.clientes (
      nombre, dni, telefono, fecha_nacimiento, direccion, ciudad,
      telefono_referencia, creado_por_vendedor_id
    ) values (
      v_solicitud.cliente_nombre,
      v_solicitud.cliente_dni,
      v_solicitud.cliente_telefono,
      v_solicitud.cliente_fecha_nacimiento,
      v_solicitud.cliente_direccion,
      v_solicitud.cliente_ciudad,
      v_solicitud.cliente_telefono_referencia,
      v_solicitud.vendedor_id
    ) returning id into v_cliente_id;
  else
    update public.clientes
    set telefono = coalesce(nullif(telefono, ''), v_solicitud.cliente_telefono),
        fecha_nacimiento = coalesce(fecha_nacimiento, v_solicitud.cliente_fecha_nacimiento),
        direccion = coalesce(nullif(direccion, ''), v_solicitud.cliente_direccion),
        ciudad = coalesce(nullif(ciudad, ''), v_solicitud.cliente_ciudad),
        telefono_referencia = coalesce(nullif(telefono_referencia, ''), v_solicitud.cliente_telefono_referencia),
        actualizado_en = now()
    where id = v_cliente_id;
  end if;

  v_es_financiada := public.es_venta_financiada(v_solicitud.forma_pago);

  if v_es_financiada then
    perform pg_advisory_xact_lock(hashtextextended('rest-cupo:' || v_mes::text, 0));

    select c.monto_cupo
      into v_cupo
    from public.cupos_financiacion_mensual c
    where c.mes = v_mes
    for update;

    v_cupo := coalesce(v_cupo, 0);

    select coalesce(sum(v.monto_total), 0)
      into v_usado
    from public.ventas v
    where date_trunc('month', coalesce(v.fecha_entrega, v.fecha_venta))::date = v_mes
      and v.estado in ('aprobada_entrega', 'entregada', 'en_cobranza', 'consolidada')
      and public.es_venta_financiada(v.forma_pago);

    if v_usado + v_solicitud.monto_total > v_cupo then
      raise exception 'Cupo de financiación insuficiente. Disponible: %',
        greatest(v_cupo - v_usado, 0);
    end if;
  end if;

  insert into public.ventas (
    vendedor_id, cliente_id, producto, monto_total, forma_pago,
    anticipo_esperado, notas, estado, aprobada_por, interes_cliente_id
  ) values (
    v_solicitud.vendedor_id,
    v_cliente_id,
    v_solicitud.producto_nombre,
    v_solicitud.monto_total,
    v_solicitud.forma_pago,
    v_solicitud.anticipo,
    v_solicitud.notas,
    'aprobada_entrega',
    v_usuario_id,
    v_solicitud.interes_cliente_id
  ) returning id into v_venta_id;

  if v_solicitud.interes_cliente_id is not null then
    update public.intereses_clientes
    set venta_id = v_venta_id,
        estado = 'venta_realizada',
        convertido_en = now(),
        actualizado_en = now()
    where id = v_solicitud.interes_cliente_id;
  end if;

  v_saldo := case when v_es_financiada then v_solicitud.monto_financiado else 0 end;

  insert into public.cuentas_credito (
    solicitud_id, venta_id, cliente_id, vendedor_id, unidad, forma_pago,
    monto_total, anticipo, monto_financiado, saldo_actual, estado, creada_por
  ) values (
    v_solicitud.id,
    v_venta_id,
    v_cliente_id,
    v_solicitud.vendedor_id,
    v_solicitud.unidad,
    v_solicitud.forma_pago,
    v_solicitud.monto_total,
    v_solicitud.anticipo,
    v_saldo,
    v_saldo,
    case when v_saldo = 0 then 'sin_saldo' else 'activa' end,
    v_usuario_id
  ) returning id into v_cuenta_id;

  if v_es_financiada then
    for v_numero in 1..v_solicitud.cantidad_cuotas loop
      v_importe := case
        when v_numero < v_solicitud.cantidad_cuotas then v_solicitud.valor_cuota
        else v_solicitud.monto_financiado
          - ((v_solicitud.cantidad_cuotas - 1) * v_solicitud.valor_cuota)
      end;

      insert into public.cuotas_credito (
        cuenta_id, numero, vencimiento, importe
      ) values (
        v_cuenta_id,
        v_numero,
        public.credito_fecha_vencimiento(
          v_solicitud.primer_vencimiento,
          v_solicitud.frecuencia,
          v_numero
        ),
        v_importe
      );
    end loop;
  end if;

  update public.solicitudes_venta
  set estado = 'aprobada',
      motivo_revision = null,
      revisada_por = v_usuario_id,
      revisada_en = now(),
      venta_id = v_venta_id,
      cuenta_credito_id = v_cuenta_id,
      version = version + 1,
      actualizado_en = now()
  where id = v_solicitud.id;

  insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
  values (
    'solicitud_aprobada',
    'solicitud_venta',
    v_solicitud.id,
    v_usuario_id,
    jsonb_build_object(
      'venta_id', v_venta_id,
      'cuenta_credito_id', v_cuenta_id,
      'cliente_id', v_cliente_id,
      'cantidad_cuotas', case when v_es_financiada then v_solicitud.cantidad_cuotas else 0 end
    )
  );

  insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
  values (
    'cuenta_creada',
    'cuenta_credito',
    v_cuenta_id,
    v_usuario_id,
    jsonb_build_object(
      'solicitud_id', v_solicitud.id,
      'venta_id', v_venta_id,
      'monto_financiado', v_saldo
    )
  );

  select to_jsonb(s) into v_resultado
  from public.solicitudes_venta s where s.id = v_solicitud.id;
  return v_resultado;
end;
$function$;

-- es_admin
CREATE OR REPLACE FUNCTION public.es_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'admin' and p.activo = true
  );
$function$;

-- mi_vendedor_id
CREATE OR REPLACE FUNCTION public.mi_vendedor_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.id from public.vendedores v
  where v.user_id = auth.uid() and v.activo = true
  limit 1;
$function$;

-- validar_cupo_venta
CREATE OR REPLACE FUNCTION public.validar_cupo_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total numeric; v_usado numeric; v_mes date; v_antes boolean; v_despues boolean;
begin
  v_antes := old.estado in ('aprobada_entrega','entregada','en_cobranza','consolidada') and public.es_venta_financiada(old.forma_pago);
  v_despues := new.estado in ('aprobada_entrega','entregada','en_cobranza','consolidada') and public.es_venta_financiada(new.forma_pago);
  if v_despues and not v_antes then
    v_mes := date_trunc('month',coalesce(new.fecha_entrega,new.fecha_venta,now()))::date;
    select monto_cupo into v_total from public.cupos_financiacion_mensual where mes=v_mes;
    v_total := coalesce(v_total,0);
    select coalesce(sum(monto_total),0) into v_usado from public.ventas where id<>new.id and date_trunc('month',coalesce(fecha_entrega,fecha_venta))::date=v_mes and estado in ('aprobada_entrega','entregada','en_cobranza','consolidada') and public.es_venta_financiada(forma_pago);
    if v_usado + new.monto_total > v_total then raise exception 'Cupo mensual de financiación insuficiente. Disponible: $%', greatest(v_total-v_usado,0); end if;
  end if;
  return new;
end; $function$;

-- credito_fecha_vencimiento
CREATE OR REPLACE FUNCTION public.credito_fecha_vencimiento(p_primer_vencimiento date, p_frecuencia text, p_numero integer)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
declare
  v_mes date;
  v_ultimo_dia integer;
  v_dia integer;
begin
  if p_numero < 1 then
    raise exception 'El número de cuota debe ser mayor a cero';
  end if;

  if p_frecuencia = 'semanal' then
    return p_primer_vencimiento + ((p_numero - 1) * 7);
  elsif p_frecuencia = 'quincenal' then
    return p_primer_vencimiento + ((p_numero - 1) * 14);
  elsif p_frecuencia = 'mensual' then
    v_mes := (date_trunc('month', p_primer_vencimiento)::date
      + make_interval(months => p_numero - 1))::date;
    v_ultimo_dia := extract(day from (v_mes + interval '1 month - 1 day'))::integer;
    v_dia := least(extract(day from p_primer_vencimiento)::integer, v_ultimo_dia);
    return v_mes + (v_dia - 1);
  end if;

  raise exception 'Frecuencia de cuota inválida';
end;
$function$;

-- es_venta_financiada
CREATE OR REPLACE FUNCTION public.es_venta_financiada(p_forma text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_forma is null then false
    when lower(p_forma) like '%contado%' then false
    when lower(p_forma) like '%entrega cuota 3%' then false
    when lower(p_forma) like '%entrega pactada%' then false
    else true
  end;
$function$;

-- recalcular_mes_vendedor
CREATE OR REPLACE FUNCTION public.recalcular_mes_vendedor(p_vendedor_id uuid, p_mes date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mes date := date_trunc('month', p_mes)::date;
  v_cant integer;
  v_fact numeric(14,2);
  v_cat text;
  v_basico numeric(14,2);
  v_pro_perm boolean;
begin
  select count(*), coalesce(sum(monto_total),0)
  into v_cant, v_fact
  from public.ventas
  where vendedor_id = p_vendedor_id
    and fecha_entrega >= v_mes
    and fecha_entrega < (v_mes + interval '1 month')
    and estado in ('entregada','en_cobranza','consolidada');

  select pro_permanente into v_pro_perm
  from public.vendedores where id = p_vendedor_id;

  if v_cant >= 3 and not coalesce(v_pro_perm,false) then
    update public.vendedores set pro_permanente = true, actualizado_en = now() where id = p_vendedor_id;
    v_pro_perm := true;
  end if;

  if v_fact >= 6000000 then
    v_cat := 'master'; v_basico := 200000;
  elsif v_fact >= 3000000 then
    v_cat := 'experto'; v_basico := 100000;
  elsif coalesce(v_pro_perm,false) or v_cant >= 3 then
    v_cat := 'pro'; v_basico := 0;
  else
    v_cat := 'junior'; v_basico := 0;
  end if;

  insert into public.estado_mensual_vendedor(vendedor_id, mes, ventas_validas, facturacion_valida, categoria_provisional, basico_provisional, actualizado_en)
  values (p_vendedor_id, v_mes, v_cant, v_fact, v_cat, v_basico, now())
  on conflict (vendedor_id, mes) do update set
    ventas_validas = excluded.ventas_validas,
    facturacion_valida = excluded.facturacion_valida,
    categoria_provisional = excluded.categoria_provisional,
    basico_provisional = excluded.basico_provisional,
    actualizado_en = now();
end;
$function$;

-- actualizar_categoria_actual
CREATE OR REPLACE FUNCTION public.actualizar_categoria_actual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.vendedores
  set categoria_actual = case when pro_permanente and new.categoria_provisional='junior' then 'pro' else new.categoria_provisional end,
      actualizado_en = now()
  where id = new.vendedor_id;
  return new;
end; $function$;

