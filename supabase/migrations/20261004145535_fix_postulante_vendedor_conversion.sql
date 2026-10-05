-- APP INTEGRAL REST · Corrección puntual de conversión Postulante → Vendedor
-- Migración aditiva/idempotente. No corresponde a REST Motos.

begin;

-- Conserva en el historial el vendedor relacionado cuando cambia el estado.
create or replace function public.postulantes_vendedores_auditar_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.estado is distinct from new.estado then
    insert into public.postulantes_vendedores_historial (
      postulante_id, estado_anterior, estado_nuevo, detalle, realizado_por
    ) values (
      new.id,
      old.estado,
      new.estado,
      jsonb_strip_nulls(jsonb_build_object(
        'origen', 'administracion',
        'evento', case
          when old.vendedor_id is distinct from new.vendedor_id then 'vendedor_vinculado'
          else 'estado_actualizado'
        end,
        'vendedor_id', new.vendedor_id
      )),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

-- Aprobar prepara inmediatamente un vendedor real, todavía sin acceso.
-- La fila del postulante se bloquea para que dos clics concurrentes no creen duplicados.
create or replace function public.aprobar_postulante_vendedor(
  p_postulante_id uuid,
  p_observaciones text default null,
  p_condiciones_comision text default null
)
returns public.postulantes_vendedores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postulante public.postulantes_vendedores;
  v_vendedor public.vendedores;
  v_estado_anterior text;
  v_vendedor_anterior uuid;
  v_coincidencias uuid[];
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Solo Administración';
  end if;

  select *
  into v_postulante
  from public.postulantes_vendedores
  where id = p_postulante_id
  for update;

  if not found then
    raise exception 'Postulante no encontrado';
  end if;

  if v_postulante.estado not in ('pendiente', 'contactado', 'aprobado') then
    raise exception 'No se puede aprobar una postulación en estado %', v_postulante.estado;
  end if;

  v_estado_anterior := v_postulante.estado;
  v_vendedor_anterior := v_postulante.vendedor_id;

  if v_postulante.vendedor_id is not null then
    select *
    into v_vendedor
    from public.vendedores
    where id = v_postulante.vendedor_id
    for update;

    if not found then
      raise exception 'La postulación tiene una vinculación de vendedor inválida';
    end if;
  else
    -- DNI y email autenticado son identificadores fuertes. El teléfono, por sí solo,
    -- no se usa para vincular personas y así se evita relacionar al vendedor equivocado.
    select coalesce(array_agg(candidato.id order by candidato.id), '{}'::uuid[])
    into v_coincidencias
    from (
      select v.id
      from public.vendedores v
      where v_postulante.dni_normalizado <> ''
        and regexp_replace(coalesce(v.dni, ''), '[^0-9]', '', 'g') = v_postulante.dni_normalizado

      union

      select v.id
      from public.vendedores v
      join auth.users u on u.id = v.user_id
      where lower(btrim(coalesce(u.email, ''))) = v_postulante.email_normalizado
    ) as candidato;

    if cardinality(v_coincidencias) > 1 then
      raise exception 'Hay más de un vendedor coincidente por DNI o email; revisá los registros antes de aprobar';
    end if;

    if cardinality(v_coincidencias) = 1 then
      select *
      into v_vendedor
      from public.vendedores
      where id = v_coincidencias[1]
      for update;

      if exists (
        select 1
        from public.postulantes_vendedores p
        where p.vendedor_id = v_vendedor.id
          and p.id <> v_postulante.id
      ) then
        raise exception 'El vendedor coincidente ya está vinculado a otra postulación';
      end if;
    else
      insert into public.vendedores (
        nombre, dni, telefono, categoria_actual, pro_permanente, activo
      ) values (
        btrim(concat_ws(' ', v_postulante.nombre, v_postulante.apellido)),
        v_postulante.dni,
        v_postulante.telefono,
        'junior',
        false,
        false
      )
      returning * into v_vendedor;
    end if;
  end if;

  update public.postulantes_vendedores
  set estado = 'aprobado',
      vendedor_id = v_vendedor.id,
      observaciones_internas = case
        when p_observaciones is null then observaciones_internas
        else nullif(btrim(p_observaciones), '')
      end,
      condiciones_comision = case
        when p_condiciones_comision is null then condiciones_comision
        else nullif(btrim(p_condiciones_comision), '')
      end,
      aprobado_en = coalesce(aprobado_en, now()),
      ultima_revision_por = auth.uid()
  where id = p_postulante_id
  returning * into v_postulante;

  -- Repara también postulaciones que ya estaban aprobadas, pero habían quedado
  -- sin vendedor. Como no hubo cambio de estado, registra el vínculo explícitamente.
  if v_estado_anterior = 'aprobado' and v_vendedor_anterior is null then
    insert into public.postulantes_vendedores_historial (
      postulante_id, estado_anterior, estado_nuevo, detalle, realizado_por
    ) values (
      v_postulante.id,
      'aprobado',
      'aprobado',
      jsonb_build_object(
        'origen', 'administracion',
        'evento', 'vendedor_vinculado',
        'vendedor_id', v_vendedor.id,
        'reparacion', true
      ),
      auth.uid()
    );
  end if;

  return v_postulante;
end;
$$;

-- Completa el alta después de crear el usuario en Supabase Auth. Perfil,
-- vendedor y postulación cambian juntos dentro de una única transacción.
create or replace function public.activar_postulante_vendedor(
  p_postulante_id uuid,
  p_usuario_id uuid,
  p_categoria text default 'junior',
  p_condiciones_comision text default null,
  p_activo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postulante public.postulantes_vendedores;
  v_vendedor public.vendedores;
  v_perfil public.perfiles;
  v_categoria text := lower(btrim(coalesce(p_categoria, 'junior')));
  v_estado_final text := case when coalesce(p_activo, true) then 'activo' else 'suspendido' end;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Solo Administración';
  end if;

  if v_categoria not in ('junior', 'pro', 'experto', 'master') then
    raise exception 'Categoría de vendedor inválida';
  end if;

  if not exists (select 1 from auth.users where id = p_usuario_id) then
    raise exception 'El usuario de acceso no existe';
  end if;

  select *
  into v_postulante
  from public.postulantes_vendedores
  where id = p_postulante_id
  for update;

  if not found then
    raise exception 'Postulante no encontrado';
  end if;

  if v_postulante.vendedor_id is null then
    raise exception 'Primero debe aprobarse y prepararse el vendedor';
  end if;

  select *
  into v_vendedor
  from public.vendedores
  where id = v_postulante.vendedor_id
  for update;

  if not found then
    raise exception 'Vendedor vinculado no encontrado';
  end if;

  -- Respuesta idempotente para un reintento cuya primera respuesta se perdió.
  if v_postulante.estado in ('activo', 'suspendido')
     and v_vendedor.user_id = p_usuario_id then
    return jsonb_build_object(
      'postulante', to_jsonb(v_postulante),
      'vendedor', to_jsonb(v_vendedor),
      'reutilizado', true
    );
  end if;

  if v_postulante.estado <> 'aprobado' then
    raise exception 'La postulación no está lista para activar';
  end if;

  if v_vendedor.user_id is not null and v_vendedor.user_id <> p_usuario_id then
    raise exception 'El vendedor ya posee otro usuario de acceso';
  end if;

  if exists (
    select 1 from public.vendedores v
    where v.user_id = p_usuario_id and v.id <> v_vendedor.id
  ) then
    raise exception 'El usuario ya está vinculado a otro vendedor';
  end if;

  select * into v_perfil from public.perfiles where id = p_usuario_id for update;
  if found and v_perfil.rol <> 'vendedor' then
    raise exception 'El usuario ya tiene un rol incompatible';
  end if;

  if found then
    update public.perfiles
    set nombre = btrim(concat_ws(' ', v_postulante.nombre, v_postulante.apellido)),
        activo = coalesce(p_activo, true)
    where id = p_usuario_id;
  else
    insert into public.perfiles (id, nombre, rol, activo)
    values (
      p_usuario_id,
      btrim(concat_ws(' ', v_postulante.nombre, v_postulante.apellido)),
      'vendedor',
      coalesce(p_activo, true)
    );
  end if;

  update public.vendedores
  set user_id = p_usuario_id,
      nombre = btrim(concat_ws(' ', v_postulante.nombre, v_postulante.apellido)),
      dni = v_postulante.dni,
      telefono = v_postulante.telefono,
      categoria_actual = v_categoria,
      pro_permanente = (v_categoria <> 'junior'),
      activo = coalesce(p_activo, true)
  where id = v_vendedor.id
  returning * into v_vendedor;

  update public.postulantes_vendedores
  set estado = v_estado_final,
      condiciones_comision = coalesce(
        nullif(btrim(p_condiciones_comision), ''),
        condiciones_comision
      ),
      activado_en = coalesce(activado_en, now()),
      suspendido_en = case when not coalesce(p_activo, true) then now() else suspendido_en end,
      ultima_revision_por = auth.uid()
  where id = v_postulante.id
  returning * into v_postulante;

  return jsonb_build_object(
    'postulante', to_jsonb(v_postulante),
    'vendedor', to_jsonb(v_vendedor),
    'reutilizado', false
  );
end;
$$;

-- Vincula/activa un acceso existente sin reemplazar silenciosamente al vendedor
-- provisional que ya quedó asociado al aprobar.
create or replace function public.vincular_postulante_vendedor(
  p_postulante_id uuid,
  p_vendedor_id uuid,
  p_condiciones_comision text default null
)
returns public.postulantes_vendedores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postulante public.postulantes_vendedores;
  v_vendedor public.vendedores;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Solo Administración';
  end if;

  select *
  into v_postulante
  from public.postulantes_vendedores
  where id = p_postulante_id
  for update;

  if not found then
    raise exception 'Postulante no encontrado';
  end if;

  select *
  into v_vendedor
  from public.vendedores
  where id = p_vendedor_id
  for update;

  if not found or v_vendedor.user_id is null then
    raise exception 'El vendedor o su acceso no existen';
  end if;

  if not exists (
    select 1 from public.perfiles p
    where p.id = v_vendedor.user_id and p.rol = 'vendedor'
  ) then
    raise exception 'El usuario vinculado no tiene rol VENDEDOR';
  end if;

  if v_postulante.estado = 'activo' and v_postulante.vendedor_id = p_vendedor_id then
    return v_postulante;
  end if;

  if v_postulante.estado <> 'aprobado' then
    raise exception 'Primero debe aprobarse la postulación';
  end if;

  if v_postulante.vendedor_id is not null
     and v_postulante.vendedor_id <> p_vendedor_id then
    raise exception 'La postulación ya está vinculada a otro vendedor';
  end if;

  update public.perfiles
  set activo = true
  where id = v_vendedor.user_id and rol = 'vendedor';

  update public.vendedores
  set activo = true
  where id = p_vendedor_id;

  update public.postulantes_vendedores
  set vendedor_id = p_vendedor_id,
      estado = 'activo',
      condiciones_comision = coalesce(
        nullif(btrim(p_condiciones_comision), ''),
        condiciones_comision
      ),
      activado_en = coalesce(activado_en, now()),
      ultima_revision_por = auth.uid()
  where id = p_postulante_id
  returning * into v_postulante;

  return v_postulante;
end;
$$;

revoke all on function public.aprobar_postulante_vendedor(uuid,text,text) from public, anon, authenticated;
revoke all on function public.activar_postulante_vendedor(uuid,uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public.vincular_postulante_vendedor(uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.aprobar_postulante_vendedor(uuid,text,text) to authenticated;
grant execute on function public.activar_postulante_vendedor(uuid,uuid,text,text,boolean) to authenticated;
grant execute on function public.vincular_postulante_vendedor(uuid,uuid,text) to authenticated;

comment on function public.aprobar_postulante_vendedor(uuid,text,text) is
  'Aprueba una postulación y crea o vincula idempotentemente un vendedor sin acceso.';
comment on function public.activar_postulante_vendedor(uuid,uuid,text,text,boolean) is
  'Completa atómicamente perfil, acceso y vínculo del vendedor aprobado.';

commit;
