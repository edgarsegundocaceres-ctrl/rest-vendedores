-- APP INTEGRAL REST exclusivamente. Pendiente: no aplicar en producción durante revisión.
-- Reutiliza cobranzas_ventas, cuentas_credito, cuotas_credito y credito_auditoria.
begin;

-- Una cartera con pagos previos necesita conciliación explícita, nunca un backfill inventado.
do $$ begin
  if exists(select 1 from public.cuotas_credito where importe_pagado <> 0)
     or exists(select 1 from public.cobranzas_ventas p join public.cuentas_credito c on c.venta_id=p.venta_id)
     or exists(select 1 from public.cuentas_credito c where c.estado<>'anulada'
       and c.saldo_actual<>coalesce((select sum(q.saldo) from public.cuotas_credito q where q.cuenta_id=c.id and q.estado<>'anulada'),0)) then
    raise exception 'Conciliar la cartera existente antes de habilitar cobranzas trazables';
  end if;
end $$;

create schema rest_finanzas_privado;
revoke all on schema rest_finanzas_privado from public, anon, authenticated;

alter table public.cobranzas_ventas
  add column cuenta_credito_id uuid references public.cuentas_credito(id) on delete restrict,
  add column cliente_id uuid references public.clientes(id) on delete restrict,
  add column clave_idempotencia uuid unique,
  add column numero_recibo bigint generated always as identity unique,
  add column fecha_efectiva date,
  add column medio_pago text not null default 'legado' check(medio_pago in ('efectivo','transferencia','tarjeta','otro','legado')),
  add column referencia text check(char_length(referencia)<=240),
  add column estado text not null default 'registrado' check(estado in ('registrado','anulado')),
  add column anulada_en timestamptz,
  add column anulada_por uuid references public.perfiles(id) on delete restrict,
  add column motivo_anulacion text check(char_length(motivo_anulacion)<=2000),
  add column snapshot jsonb not null default '{}'::jsonb,
  add constraint cobranza_anulacion_completa check(
    (estado='registrado' and anulada_en is null and anulada_por is null and motivo_anulacion is null)
    or (estado='anulado' and anulada_en is not null and anulada_por is not null and char_length(btrim(motivo_anulacion))>=3)),
  add constraint cobranza_cuenta_completa check(cuenta_credito_id is null or
    (cliente_id is not null and clave_idempotencia is not null and fecha_efectiva is not null
      and registrado_por is not null and medio_pago<>'legado' and snapshot<>'{}'::jsonb));
update public.cobranzas_ventas set fecha_efectiva=(fecha_pago at time zone 'America/Argentina/Cordoba')::date;
alter table public.cobranzas_ventas drop constraint cobranzas_ventas_venta_id_numero_cuota_key;
-- Mantiene la unicidad histórica; los nuevos pagos pueden ser parciales y abarcar varias cuotas.
create unique index cobranzas_legado_venta_cuota_uq on public.cobranzas_ventas(venta_id,numero_cuota) where cuenta_credito_id is null;
create index cobranzas_cuenta_fecha_idx on public.cobranzas_ventas(cuenta_credito_id,fecha_efectiva desc,creado_en desc);
create index cobranzas_cliente_idx on public.cobranzas_ventas(cliente_id);
create index cobranzas_fecha_valida_idx on public.cobranzas_ventas(fecha_efectiva) where estado='registrado' and cuenta_credito_id is not null;
create index cobranzas_anulada_por_idx on public.cobranzas_ventas(anulada_por) where anulada_por is not null;

create table public.cobranzas_imputaciones (
  id uuid primary key default gen_random_uuid(),
  cobranza_id uuid not null references public.cobranzas_ventas(id) on delete restrict,
  cuota_id uuid not null references public.cuotas_credito(id) on delete restrict,
  importe numeric(14,2) not null check(importe>0 and importe::text !~ '^(NaN|[-+]?Infinity)$'),
  unique(cobranza_id,cuota_id)
);
create index cobranzas_imputaciones_cuota_idx on public.cobranzas_imputaciones(cuota_id);
create index cuotas_credito_agenda_idx on public.cuotas_credito(vencimiento,cuenta_id) where estado<>'anulada';

alter table public.cobranzas_imputaciones enable row level security;
drop policy cobranzas_admin_all on public.cobranzas_ventas;
revoke all on public.cobranzas_ventas,public.cobranzas_imputaciones from anon,authenticated;
grant select on public.cobranzas_ventas,public.cobranzas_imputaciones to authenticated;
create policy cobranzas_imputaciones_admin_lectura on public.cobranzas_imputaciones for select to authenticated using((select public.es_admin()));
-- El patrón de lectura histórica propia se conserva; ninguna escritura directa permanece habilitada.
revoke insert,update,delete,truncate on public.cuentas_credito,public.cuotas_credito,public.credito_auditoria from anon,authenticated;

create function rest_finanzas_privado.hoy() returns date language sql stable set search_path='' as $$
 select (now() at time zone 'America/Argentina/Cordoba')::date;
$$;
create function rest_finanzas_privado.exigir_admin() returns void language plpgsql stable set search_path='' as $$
begin if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración puede gestionar cobranzas' using errcode='42501'; end if; end;
$$;

create function rest_finanzas_privado.revision(p_cuenta uuid) returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_object('estado',c.estado,'saldo',c.saldo_actual,'cuotas',
   (select jsonb_agg(jsonb_build_array(q.id,q.vencimiento,q.importe,q.importe_pagado,q.estado) order by q.vencimiento,q.numero,q.id)
    from public.cuotas_credito q where q.cuenta_id=c.id))::text)
 from public.cuentas_credito c where c.id=p_cuenta;
$$;

create function rest_finanzas_privado.plan(p_cuenta uuid,p_importe numeric) returns jsonb language plpgsql stable set search_path='' as $$
declare v_resto numeric:=p_importe; v_aplica numeric; q record; v_plan jsonb:='[]'::jsonb;
begin
 for q in select * from public.cuotas_credito where cuenta_id=p_cuenta and estado<>'anulada' and saldo>0 order by vencimiento,numero,id loop
   exit when v_resto<=0;
   v_aplica:=least(v_resto,q.saldo);
   v_plan:=v_plan||jsonb_build_array(jsonb_build_object('cuota_id',q.id,'numero',q.numero,'vencimiento',q.vencimiento,'importe',v_aplica,'saldo_antes',q.saldo,'saldo_despues',q.saldo-v_aplica));
   v_resto:=v_resto-v_aplica;
 end loop;
 if v_resto<>0 then raise exception 'El importe supera el saldo pendiente de la cuenta.'; end if;
 return v_plan;
end $$;

create function rest_finanzas_privado.validar_importe(p_importe numeric) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_importe is null or p_importe::text ~ '^(NaN|[-+]?Infinity)$' or p_importe<=0 or p_importe<>round(p_importe,2) then
   raise exception 'Ingresá un importe positivo con hasta dos decimales';
 end if;
end $$;

create function rest_finanzas_privado.recalcular(p_cuenta uuid) returns void language plpgsql set search_path='' as $$
declare v_saldo numeric; v_previo text; v_estado text;
begin
 select estado into v_previo from public.cuentas_credito where id=p_cuenta for update;
 update public.cuotas_credito q set
   importe_pagado=(select coalesce(sum(i.importe),0) from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado'),
   estado=case when q.estado='anulada' then 'anulada'
     when (select coalesce(sum(i.importe),0) from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado')=q.importe then 'pagada'
     when exists(select 1 from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado') then 'parcial' else 'pendiente' end,
   pagada_en=case when (select coalesce(sum(i.importe),0) from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado')=q.importe
     then (select max(p.fecha_efectiva)::timestamp at time zone 'America/Argentina/Cordoba' from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado') else null end,
   actualizado_en=clock_timestamp()
 where q.cuenta_id=p_cuenta;
 select coalesce(sum(saldo),0) into v_saldo from public.cuotas_credito where cuenta_id=p_cuenta and estado<>'anulada';
 v_estado:=case when v_previo='anulada' then 'anulada' when v_saldo=0 then 'finalizada' else 'activa' end;
 update public.cuentas_credito set saldo_actual=v_saldo,estado=v_estado,actualizado_en=clock_timestamp() where id=p_cuenta;
 if v_estado<>v_previo then
   insert into public.credito_auditoria(accion,entidad,entidad_id,usuario_id,detalle) values
     (case when v_estado='finalizada' then 'cuenta_finalizada' else 'cuenta_reabierta' end,'cuenta_credito',p_cuenta,auth.uid(),jsonb_build_object('estado_anterior',v_previo,'saldo',v_saldo));
 end if;
end $$;

create function rest_finanzas_privado.proteger_pago() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Los pagos no se borran; deben anularse con motivo'; end if;
 if tg_op='UPDATE' then
   if old.estado<>'registrado' or new.estado<>'anulado'
     or (to_jsonb(new)-array['estado','anulada_en','anulada_por','motivo_anulacion']) is distinct from (to_jsonb(old)-array['estado','anulada_en','anulada_por','motivo_anulacion']) then
     raise exception 'El pago es inmutable; solo admite anulación';
   end if;
   perform rest_finanzas_privado.exigir_admin();
   if new.anulada_por is distinct from auth.uid() then raise exception 'Usuario de anulación inválido'; end if;
 end if;
 if tg_op='INSERT' and new.cuenta_credito_id is not null then
   perform rest_finanzas_privado.exigir_admin();
   if not exists(select 1 from public.cuentas_credito c where c.id=new.cuenta_credito_id and c.cliente_id=new.cliente_id and c.venta_id=new.venta_id and c.estado='activa') then raise exception 'La cuenta no admite este pago'; end if;
 end if;
 return new;
end $$;
create trigger cobranzas_inmutables before update or delete or insert on public.cobranzas_ventas for each row execute function rest_finanzas_privado.proteger_pago();
create function rest_finanzas_privado.proteger_imputacion() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'Las imputaciones son inmutables; anulá el pago'; end if;
 if not exists(select 1 from public.cuotas_credito q join public.cobranzas_ventas p on p.id=new.cobranza_id
   where q.id=new.cuota_id and q.cuenta_id=p.cuenta_credito_id and q.estado<>'anulada' and p.estado='registrado') then raise exception 'La imputación no pertenece a la cuenta del pago'; end if;
 return new;
end $$;
create trigger imputaciones_inmutables before insert or update or delete on public.cobranzas_imputaciones for each row execute function rest_finanzas_privado.proteger_imputacion();

-- Defensa adicional frente a futuras rutas de escritura: valida el resultado final de toda la transacción.
create function rest_finanzas_privado.integridad() returns trigger language plpgsql set search_path='' as $$
declare v_cuenta uuid; v_pago uuid; c record;
begin
 if tg_table_name='cuentas_credito' then v_cuenta:=new.id;
 elsif tg_table_name='cuotas_credito' then v_cuenta:=new.cuenta_id;
 elsif tg_table_name='cobranzas_ventas' then v_cuenta:=new.cuenta_credito_id; v_pago:=new.id;
 else
   v_pago:=new.cobranza_id;
   select cuenta_credito_id into v_cuenta from public.cobranzas_ventas where id=v_pago;
 end if;
 if v_cuenta is null then return null; end if;
 select * into c from public.cuentas_credito where id=v_cuenta;
 if c.estado<>'anulada' and c.saldo_actual<>coalesce((select sum(saldo) from public.cuotas_credito where cuenta_id=v_cuenta and estado<>'anulada'),0) then raise exception 'Saldo de cuenta inconsistente'; end if;
 if (c.estado='finalizada' and c.saldo_actual<>0) or (c.estado='activa' and c.saldo_actual=0) then raise exception 'Estado de cuenta inconsistente'; end if;
 if exists(select 1 from public.cuotas_credito q where q.cuenta_id=v_cuenta and q.importe_pagado<>
   coalesce((select sum(i.importe) from public.cobranzas_imputaciones i join public.cobranzas_ventas p on p.id=i.cobranza_id where i.cuota_id=q.id and p.estado='registrado'),0)) then raise exception 'Pagos de cuota inconsistentes'; end if;
 if exists(select 1 from public.cobranzas_ventas p where p.cuenta_credito_id=v_cuenta and p.monto<>
   coalesce((select sum(importe) from public.cobranzas_imputaciones where cobranza_id=p.id),0)) then raise exception 'El pago debe imputarse por su importe exacto'; end if;
 return null;
end $$;
create constraint trigger cuenta_integridad after insert or update on public.cuentas_credito deferrable initially deferred for each row execute function rest_finanzas_privado.integridad();
create constraint trigger cuota_integridad after insert or update on public.cuotas_credito deferrable initially deferred for each row execute function rest_finanzas_privado.integridad();
create constraint trigger pago_integridad after insert or update on public.cobranzas_ventas deferrable initially deferred for each row execute function rest_finanzas_privado.integridad();
create constraint trigger imputacion_integridad after insert on public.cobranzas_imputaciones deferrable initially deferred for each row execute function rest_finanzas_privado.integridad();

create function public.previsualizar_cobro(p_cuenta_id uuid,p_importe numeric) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record;
begin
 perform rest_finanzas_privado.exigir_admin(); perform rest_finanzas_privado.validar_importe(p_importe);
 select z.*,v.estado as venta_estado into c from public.cuentas_credito z join public.ventas v on v.id=z.venta_id where z.id=p_cuenta_id;
 if not found or c.estado<>'activa' or c.venta_estado in ('cancelada','caida','rechazada') then raise exception 'La cuenta no está habilitada para cobrar'; end if;
 if p_importe>c.saldo_actual then raise exception 'El importe supera el saldo pendiente de la cuenta.'; end if;
 return jsonb_build_object('cuenta_id',c.id,'importe',p_importe,'saldo_antes',c.saldo_actual,'saldo_despues',c.saldo_actual-p_importe,
   'revision',rest_finanzas_privado.revision(c.id),'imputaciones',rest_finanzas_privado.plan(c.id,p_importe));
end $$;

create function public.obtener_recibo_cobranza(p_pago_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 perform rest_finanzas_privado.exigir_admin();
 select to_jsonb(p)||jsonb_build_object('codigo','REST-'||lpad(p.numero_recibo::text,8,'0'),
   'saldo_actual',c.saldo_actual,'anulador_nombre',a.nombre,'imputaciones',
   (select coalesce(jsonb_agg(jsonb_build_object('cuota_id',q.id,'numero',q.numero,'vencimiento',q.vencimiento,'importe',i.importe) order by q.vencimiento,q.numero),'[]'::jsonb)
     from public.cobranzas_imputaciones i join public.cuotas_credito q on q.id=i.cuota_id where i.cobranza_id=p.id)) into r
 from public.cobranzas_ventas p left join public.cuentas_credito c on c.id=p.cuenta_credito_id left join public.perfiles a on a.id=p.anulada_por where p.id=p_pago_id;
 if r is null then raise exception 'El pago no existe'; end if;
 return r;
end $$;

create function public.registrar_cobro_credito(p_cuenta_id uuid,p_importe numeric,p_fecha_efectiva date,p_medio_pago text,p_clave_idempotencia uuid,p_revision text,p_referencia text default null,p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; v_previo public.cobranzas_ventas%rowtype; v_id uuid; v_plan jsonb; a jsonb; v_nombre text;
 v_ref text:=nullif(btrim(p_referencia),''); v_obs text:=nullif(btrim(p_observaciones),'');
begin
 perform rest_finanzas_privado.exigir_admin(); perform rest_finanzas_privado.validar_importe(p_importe);
 if p_clave_idempotencia is null then raise exception 'Falta la clave de idempotencia'; end if;
 if p_fecha_efectiva is null or p_fecha_efectiva>rest_finanzas_privado.hoy() then raise exception 'La fecha efectiva es obligatoria y no puede ser futura'; end if;
 if p_medio_pago is null or p_medio_pago not in ('efectivo','transferencia','tarjeta','otro') then raise exception 'Medio de pago inválido'; end if;
 if char_length(v_ref)>240 or char_length(v_obs)>4000 then raise exception 'Referencia u observación demasiado larga'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rest-cobro:'||p_clave_idempotencia::text,0));
 select * into v_previo from public.cobranzas_ventas where clave_idempotencia=p_clave_idempotencia;
 if found then
   if v_previo.cuenta_credito_id is distinct from p_cuenta_id or v_previo.monto<>p_importe or v_previo.fecha_efectiva<>p_fecha_efectiva
      or v_previo.medio_pago<>p_medio_pago or v_previo.registrado_por<>auth.uid() or v_previo.referencia is distinct from v_ref or v_previo.notas is distinct from v_obs then raise exception 'La clave de idempotencia corresponde a otro cobro'; end if;
   return public.obtener_recibo_cobranza(v_previo.id)||jsonb_build_object('duplicado',true);
 end if;
 select z.*,v.estado as venta_estado,v.producto,cl.nombre as cliente_nombre,cl.dni as cliente_dni into c
 from public.cuentas_credito z join public.ventas v on v.id=z.venta_id join public.clientes cl on cl.id=z.cliente_id where z.id=p_cuenta_id for update of z;
 if not found or c.estado<>'activa' or c.venta_estado in ('cancelada','caida','rechazada') then raise exception 'La cuenta no está habilitada para cobrar'; end if;
 perform 1 from public.cuotas_credito where cuenta_id=c.id order by vencimiento,numero,id for update;
 if p_importe>c.saldo_actual then raise exception 'El importe supera el saldo pendiente de la cuenta.'; end if;
 if p_revision is null or p_revision is distinct from rest_finanzas_privado.revision(c.id) then raise exception 'El saldo cambió. Revisá nuevamente la aplicación del cobro.'; end if;
 v_plan:=rest_finanzas_privado.plan(c.id,p_importe);
 select nombre into v_nombre from public.perfiles where id=auth.uid();
 insert into public.cobranzas_ventas(venta_id,numero_cuota,monto,fecha_pago,registrado_por,notas,cuenta_credito_id,cliente_id,clave_idempotencia,fecha_efectiva,medio_pago,referencia,creado_en,snapshot)
 values(c.venta_id,(v_plan->0->>'numero')::integer,p_importe,p_fecha_efectiva::timestamp at time zone 'America/Argentina/Cordoba',auth.uid(),v_obs,c.id,c.cliente_id,p_clave_idempotencia,p_fecha_efectiva,p_medio_pago,v_ref,clock_timestamp(),
   jsonb_build_object('cliente',jsonb_build_object('id',c.cliente_id,'nombre',c.cliente_nombre,'dni',c.cliente_dni),'producto',c.producto,'forma_pago',c.forma_pago,'registrador_nombre',v_nombre,'saldo_antes',c.saldo_actual,'saldo_despues',c.saldo_actual-p_importe)) returning id into v_id;
 for a in select value from jsonb_array_elements(v_plan) loop
   insert into public.cobranzas_imputaciones(cobranza_id,cuota_id,importe) values(v_id,(a->>'cuota_id')::uuid,(a->>'importe')::numeric);
 end loop;
 perform rest_finanzas_privado.recalcular(c.id);
 insert into public.credito_auditoria(accion,entidad,entidad_id,usuario_id,detalle) values
   ('pago_registrado','cuenta_credito',c.id,auth.uid(),jsonb_build_object('pago_id',v_id,'importe',p_importe,'fecha_efectiva',p_fecha_efectiva,'medio_pago',p_medio_pago,'imputaciones',v_plan));
 return public.obtener_recibo_cobranza(v_id)||jsonb_build_object('duplicado',false);
end $$;

create function public.anular_cobro_credito(p_pago_id uuid,p_motivo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranzas_ventas%rowtype; v_cuenta uuid;
begin
 perform rest_finanzas_privado.exigir_admin();
 if p_motivo is null or char_length(btrim(p_motivo)) not between 3 and 2000 then raise exception 'Ingresá un motivo de anulación de al menos 3 caracteres'; end if;
 select cuenta_credito_id into v_cuenta from public.cobranzas_ventas where id=p_pago_id;
 if v_cuenta is null then raise exception 'El pago no pertenece al motor de crédito REST'; end if;
 -- Mismo orden de bloqueo que registrar: cuenta -> cuotas -> pago.
 perform 1 from public.cuentas_credito where id=v_cuenta for update;
 perform 1 from public.cuotas_credito where cuenta_id=v_cuenta order by vencimiento,numero,id for update;
 select * into p from public.cobranzas_ventas where id=p_pago_id for update;
 if p.estado='anulado' then return public.obtener_recibo_cobranza(p.id)||jsonb_build_object('duplicado',true); end if;
 update public.cobranzas_ventas set estado='anulado',anulada_en=clock_timestamp(),anulada_por=auth.uid(),motivo_anulacion=btrim(p_motivo) where id=p.id;
 perform rest_finanzas_privado.recalcular(v_cuenta);
 insert into public.credito_auditoria(accion,entidad,entidad_id,usuario_id,detalle) values
   ('pago_anulado','cuenta_credito',v_cuenta,auth.uid(),jsonb_build_object('pago_id',p.id,'importe',p.monto,'motivo',btrim(p_motivo)));
 return public.obtener_recibo_cobranza(p.id)||jsonb_build_object('duplicado',false);
end $$;

create view rest_finanzas_privado.agenda with(security_invoker=true) as
 select q.*,c.cliente_id,c.venta_id,c.estado as cuenta_estado,c.forma_pago,c.unidad,c.saldo_actual as saldo_cuenta,
 cl.nombre as cliente_nombre,cl.dni,cl.telefono,v.producto,v.estado as venta_estado,
 case when q.estado='anulada' then 'anulada' when q.saldo=0 then 'pagada'
      when q.vencimiento<rest_finanzas_privado.hoy() then 'vencida' when q.vencimiento=rest_finanzas_privado.hoy() then 'hoy' else 'proxima' end as estado_operativo,
 case when q.importe_pagado=0 then 'pendiente' when q.saldo=0 then 'pagada' else 'parcial' end as estado_pago
 from public.cuotas_credito q join public.cuentas_credito c on c.id=q.cuenta_id join public.clientes cl on cl.id=c.cliente_id join public.ventas v on v.id=c.venta_id;

create function public.cobranzas_tablero(p_filtro text default 'hoy',p_busqueda text default '',p_limite integer default 60,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_hoy date:=rest_finanzas_privado.hoy(); r jsonb; v_busca text:=lower(btrim(coalesce(p_busqueda,'')));
begin
 perform rest_finanzas_privado.exigir_admin();
 if p_filtro not in ('hoy','vencidas','proximos','mes','pagadas','todas') or p_limite not between 1 and 200 or p_offset<0 or char_length(v_busca)>120 then raise exception 'Filtro inválido'; end if;
 with cartera as (select * from rest_finanzas_privado.agenda where estado<>'anulada' and cuenta_estado<>'anulada'),
 filtrada as(select * from cartera where (v_busca='' or strpos(lower(cliente_nombre),v_busca)>0 or strpos(coalesce(dni,''),regexp_replace(v_busca,'[^0-9]','','g'))>0 and v_busca~'[0-9]' or strpos(regexp_replace(coalesce(telefono,''),'[^0-9]','','g'),regexp_replace(v_busca,'[^0-9]','','g'))>0 and v_busca~'[0-9]')
 and case p_filtro when 'hoy' then saldo>0 and vencimiento=v_hoy when 'vencidas' then saldo>0 and vencimiento<v_hoy
 when 'proximos' then saldo>0 and vencimiento>v_hoy and vencimiento<=v_hoy+7 when 'mes' then date_trunc('month',vencimiento)=date_trunc('month',v_hoy)
 when 'pagadas' then saldo=0 else true end),
 clientes as(select cl.id,cl.nombre,cl.dni,cl.telefono,count(c.id) as cuentas,coalesce(sum(c.saldo_actual) filter(where c.estado='activa'),0) as saldo
 from public.clientes cl join public.cuentas_credito c on c.cliente_id=cl.id
 where v_busca='' or strpos(lower(cl.nombre),v_busca)>0 or (v_busca~'[0-9]' and (strpos(regexp_replace(coalesce(cl.dni,''),'[^0-9]','','g'),regexp_replace(v_busca,'[^0-9]','','g'))>0 or strpos(regexp_replace(coalesce(cl.telefono,''),'[^0-9]','','g'),regexp_replace(v_busca,'[^0-9]','','g'))>0))
 group by cl.id)
 select jsonb_build_object('hoy',v_hoy,'medios_pago',jsonb_build_array('efectivo','transferencia','tarjeta','otro'),
 'kpis',jsonb_build_object(
   'hoy',jsonb_build_object('cantidad',(select count(*) from cartera where saldo>0 and vencimiento=v_hoy),'importe',(select coalesce(sum(saldo),0) from cartera where saldo>0 and vencimiento=v_hoy)),
   'vencidas',jsonb_build_object('cantidad',(select count(*) from cartera where saldo>0 and vencimiento<v_hoy),'clientes',(select count(distinct cliente_id) from cartera where saldo>0 and vencimiento<v_hoy),'importe',(select coalesce(sum(saldo),0) from cartera where saldo>0 and vencimiento<v_hoy)),
   'proximos',jsonb_build_object('cantidad',(select count(*) from cartera where saldo>0 and vencimiento>v_hoy and vencimiento<=v_hoy+7),'importe',(select coalesce(sum(saldo),0) from cartera where saldo>0 and vencimiento>v_hoy and vencimiento<=v_hoy+7)),
   'cobrado_hoy',(select coalesce(sum(monto),0) from public.cobranzas_ventas where cuenta_credito_id is not null and estado='registrado' and fecha_efectiva=v_hoy),
   'cobrado_mes',(select coalesce(sum(monto),0) from public.cobranzas_ventas where cuenta_credito_id is not null and estado='registrado' and date_trunc('month',fecha_efectiva)=date_trunc('month',v_hoy)),
   'cartera',(select coalesce(sum(saldo_actual),0) from public.cuentas_credito where estado='activa')),
 'agenda',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select * from filtrada order by vencimiento,cliente_nombre,numero,id limit p_limite offset p_offset) a),
 'total',(select count(*) from filtrada),
 'clientes',(select coalesce(jsonb_agg(to_jsonb(cl)),'[]'::jsonb) from (select * from clientes order by nombre,id limit p_limite offset p_offset) cl),
 'total_clientes',(select count(*) from clientes)) into r;
 return r;
end $$;

create function public.ficha_financiera_cliente(p_cliente_id uuid default null,p_cuenta_id uuid default null,p_venta_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_cliente uuid; r jsonb;
begin
 perform rest_finanzas_privado.exigir_admin();
 if num_nonnulls(p_cliente_id,p_cuenta_id,p_venta_id)<>1 then raise exception 'Elegí cliente, cuenta o venta'; end if;
 v_cliente:=p_cliente_id;
 if v_cliente is null then select cliente_id into v_cliente from public.cuentas_credito where (id=p_cuenta_id or venta_id=p_venta_id); end if;
 if v_cliente is null then raise exception 'Esta venta todavía no tiene una cuenta financiera propia. Consultá G-CRED.'; end if;
 select jsonb_build_object('hoy',rest_finanzas_privado.hoy(),'cliente',to_jsonb(cl),
 'resumen',jsonb_build_object(
   'original',(select coalesce(sum(monto_total),0) from public.cuentas_credito where cliente_id=cl.id and estado<>'anulada'),
   'anticipos',(select coalesce(sum(anticipo),0) from public.cuentas_credito where cliente_id=cl.id and estado<>'anulada'),
   'pagado',(select coalesce(sum(q.importe_pagado),0) from public.cuotas_credito q join public.cuentas_credito c on c.id=q.cuenta_id where c.cliente_id=cl.id and c.estado<>'anulada' and q.estado<>'anulada'),
   'saldo',(select coalesce(sum(saldo_actual),0) from public.cuentas_credito where cliente_id=cl.id and estado='activa'),
   'vencido',(select coalesce(sum(saldo),0) from rest_finanzas_privado.agenda where cliente_id=cl.id and estado<>'anulada' and cuenta_estado='activa' and vencimiento<rest_finanzas_privado.hoy()),
   'proximo_vencimiento',(select min(vencimiento) from rest_finanzas_privado.agenda where cliente_id=cl.id and estado<>'anulada' and cuenta_estado='activa' and saldo>0 and vencimiento>=rest_finanzas_privado.hoy())),
 'cuentas',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('producto',v.producto,'venta_estado',v.estado,
   'cuotas',(select coalesce(jsonb_agg(to_jsonb(a) order by a.numero),'[]'::jsonb) from rest_finanzas_privado.agenda a where a.cuenta_id=c.id)) order by c.creada_en desc),'[]'::jsonb) from public.cuentas_credito c join public.ventas v on v.id=c.venta_id where c.cliente_id=cl.id),
 'pagos',(select coalesce(jsonb_agg(public.obtener_recibo_cobranza(p.id) order by p.fecha_efectiva desc,p.creado_en desc),'[]'::jsonb) from public.cobranzas_ventas p where p.cliente_id=cl.id),
 'historial',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('usuario_nombre',pr.nombre) order by a.creada_en desc,a.id desc),'[]'::jsonb)
   from public.credito_auditoria a join public.cuentas_credito c on c.id=a.entidad_id and a.entidad='cuenta_credito' join public.perfiles pr on pr.id=a.usuario_id where c.cliente_id=cl.id)) into r
 from public.clientes cl where cl.id=v_cliente;
 if r is null then raise exception 'El cliente no existe'; end if;
 return r;
end $$;

revoke all on all functions in schema rest_finanzas_privado from public,anon,authenticated;
revoke all on all tables in schema rest_finanzas_privado from public,anon,authenticated;
revoke execute on function public.previsualizar_cobro(uuid,numeric),public.obtener_recibo_cobranza(uuid),
 public.registrar_cobro_credito(uuid,numeric,date,text,uuid,text,text,text),public.anular_cobro_credito(uuid,text),
 public.cobranzas_tablero(text,text,integer,integer),public.ficha_financiera_cliente(uuid,uuid,uuid) from public,anon;
grant execute on function public.previsualizar_cobro(uuid,numeric),public.obtener_recibo_cobranza(uuid),
 public.registrar_cobro_credito(uuid,numeric,date,text,uuid,text,text,text),public.anular_cobro_credito(uuid,text),
 public.cobranzas_tablero(text,text,integer,integer),public.ficha_financiera_cliente(uuid,uuid,uuid) to authenticated;
comment on table public.cobranzas_imputaciones is 'Detalle inmutable de aplicaciones de movimientos de cobranzas_ventas a cuotas_credito. Las anulaciones conservan el detalle.';
comment on column public.cobranzas_ventas.fecha_efectiva is 'Día operativo de Argentina declarado por Administración, distinto de creado_en (registración).';
comment on column public.cobranzas_ventas.snapshot is 'Datos de cliente, producto, registrador y saldos al cobrar; base del comprobante interno, no fiscal.';
notify pgrst,'reload schema';
commit;
