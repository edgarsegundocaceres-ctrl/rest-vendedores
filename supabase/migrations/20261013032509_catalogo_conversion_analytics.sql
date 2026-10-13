-- Incremental, sin modificar solicitudes, precios, comisiones ni financiación.
create table private.catalogo_analitica_sesiones (
 id uuid primary key, visitante uuid not null, vendedor_id uuid not null references public.vendedores(id),
 creado_en timestamptz not null default now(), ultimo_evento timestamptz not null default now()
);
create index catalogo_analitica_sesiones_fecha on private.catalogo_analitica_sesiones(creado_en,vendedor_id);
create index catalogo_analitica_sesiones_vendedor on private.catalogo_analitica_sesiones(vendedor_id,creado_en);
create index catalogo_analitica_sesiones_visitante on private.catalogo_analitica_sesiones(visitante,creado_en);
create table private.catalogo_analitica_eventos (
 id bigint generated always as identity primary key,
 sesion_id uuid not null references private.catalogo_analitica_sesiones(id),
 producto_id uuid not null references public.productos(id), categoria text not null,
 tipo text not null check(tipo in ('PRODUCTO_VISTA','INTERES_CLICK','SOLICITUD_INICIADA')),
 creado_en timestamptz not null default now(), unique(sesion_id,producto_id,tipo)
);
create index catalogo_analitica_eventos_fecha on private.catalogo_analitica_eventos(creado_en,producto_id);
alter table private.catalogo_analitica_sesiones enable row level security;
alter table private.catalogo_analitica_eventos enable row level security;
revoke all on private.catalogo_analitica_sesiones,private.catalogo_analitica_eventos from public,anon,authenticated;

create function public.registrar_evento_catalogo(p_token text,p_visitante uuid,p_sesion uuid,p_tipo text,p_producto uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_vendedor uuid; v_sesion private.catalogo_analitica_sesiones%rowtype; v_categoria text;
begin
 if p_visitante is null or p_sesion is null or p_tipo is null or p_tipo not in ('CATALOGO_VISITA','PRODUCTO_VISTA','INTERES_CLICK','SOLICITUD_INICIADA') then return false; end if;
 select v.id into v_vendedor from public.vendedores v join public.perfiles p on p.id=v.user_id
 where v.catalogo_token::text=lower(btrim(p_token)) and v.activo and p.activo and p.rol='vendedor';
 if v_vendedor is null then return false; end if;
 -- Serializa cuotas de escritura por vendedor, incluso si rotan UUID anónimos.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_vendedor::text,731));
 select * into v_sesion from private.catalogo_analitica_sesiones where id=p_sesion for update;
 if found then
  if v_sesion.visitante<>p_visitante or v_sesion.vendedor_id<>v_vendedor or v_sesion.ultimo_evento<now()-interval '30 minutes' or v_sesion.creado_en<now()-interval '24 hours' then return false; end if;
 else
  if p_tipo<>'CATALOGO_VISITA' or p_producto is not null then return false; end if;
  if (select count(*) from private.catalogo_analitica_sesiones where vendedor_id=v_vendedor and creado_en>now()-interval '1 minute')>=120 then return false; end if;
  if exists(select 1 from private.catalogo_analitica_sesiones where visitante=p_visitante and vendedor_id=v_vendedor and ultimo_evento>now()-interval '30 minutes') then return false; end if;
  insert into private.catalogo_analitica_sesiones(id,visitante,vendedor_id) values(p_sesion,p_visitante,v_vendedor);
 end if;
 if p_tipo='CATALOGO_VISITA' then
  if p_producto is not null then return false; end if;
  update private.catalogo_analitica_sesiones set ultimo_evento=now() where id=p_sesion;
  return true;
 end if;
 select coalesce(nullif(p.subcategoria,''),p.categoria) into v_categoria from public.productos p
 where p.id=p_producto and p.activo and p.catalogo_publico and p.precio_contado>0 and p.categoria in ('hogar','celulares');
 if not found then return false; end if;
 if exists(select 1 from private.catalogo_analitica_eventos where sesion_id=p_sesion and producto_id=p_producto and tipo=p_tipo) then return true; end if;
 if (select count(*) from private.catalogo_analitica_eventos where sesion_id=p_sesion and creado_en>now()-interval '1 minute')>=30 then return false; end if;
 if (select count(*) from private.catalogo_analitica_eventos e join private.catalogo_analitica_sesiones s on s.id=e.sesion_id where s.vendedor_id=v_vendedor and e.creado_en>now()-interval '1 minute')>=600 then return false; end if;
 insert into private.catalogo_analitica_eventos(sesion_id,producto_id,categoria,tipo) values(p_sesion,p_producto,v_categoria,p_tipo) on conflict do nothing;
 update private.catalogo_analitica_sesiones set ultimo_evento=now() where id=p_sesion;
 return true;
end $$;
revoke all on function public.registrar_evento_catalogo(text,uuid,uuid,text,uuid) from public;
grant execute on function public.registrar_evento_catalogo(text,uuid,uuid,text,uuid) to anon,authenticated;

-- Fechas operativas Argentina. Solicitudes/ventas provienen del circuito real.
-- Ventas: conversiones actuales de solicitudes creadas en el período (cohorte).
create function public.analitica_catalogo(p_desde date,p_hasta date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_resultado jsonb; v_desde timestamptz; v_hasta timestamptz;
begin
 if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
 if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>366 then raise exception 'Período inválido (máximo 367 días)'; end if;
 v_desde:=p_desde::timestamp at time zone 'America/Argentina/Cordoba';
 v_hasta:=(p_hasta+1)::timestamp at time zone 'America/Argentina/Cordoba';
 with sesiones as(select * from private.catalogo_analitica_sesiones where creado_en>=v_desde and creado_en<v_hasta),
 eventos as(select e.*,s.vendedor_id from private.catalogo_analitica_eventos e join private.catalogo_analitica_sesiones s on s.id=e.sesion_id where e.creado_en>=v_desde and e.creado_en<v_hasta),
 solicitudes as(select * from public.solicitudes_venta where canal_origen='catalogo_publico_vendedor' and creado_en>=v_desde and creado_en<v_hasta),
 vendedores as(select vendedor_id id from sesiones union select vendedor_id from eventos union select vendedor_id from solicitudes),
 productos as(select producto_id id from eventos union select producto_id from solicitudes),
 ranking_v as(select v.id,x.nombre,
 (select count(*) from sesiones s where s.vendedor_id=v.id) visitas,
 (select count(distinct visitante) from sesiones s where s.vendedor_id=v.id) visitantes,
 (select count(*) from eventos e where e.vendedor_id=v.id and tipo='PRODUCTO_VISTA') vistas,
 (select count(*) from eventos e where e.vendedor_id=v.id and tipo='INTERES_CLICK') intereses,
 (select count(*) from solicitudes s where s.vendedor_id=v.id) solicitudes,
 (select count(*) from solicitudes s where s.vendedor_id=v.id and estado_comercial='convertida_en_venta' and venta_id is not null) ventas
 from vendedores v join public.vendedores x on x.id=v.id),
 ranking_p as(select p.id,x.nombre,
 (select count(*) from eventos e where e.producto_id=p.id and tipo='PRODUCTO_VISTA') vistas,
 (select count(*) from eventos e where e.producto_id=p.id and tipo='INTERES_CLICK') intereses,
 (select count(*) from solicitudes s where s.producto_id=p.id) solicitudes,
 (select count(*) from solicitudes s where s.producto_id=p.id and estado_comercial='convertida_en_venta' and venta_id is not null) ventas
 from productos p join public.productos x on x.id=p.id)
 select jsonb_build_object('desde',p_desde,'hasta',p_hasta,
 'visitas',(select count(*) from sesiones),'visitantes',(select count(distinct visitante) from sesiones),
 'vistas',(select count(*) from eventos where tipo='PRODUCTO_VISTA'),
 'intereses',(select count(*) from eventos where tipo='INTERES_CLICK'),
 'formularios',(select count(*) from eventos where tipo='SOLICITUD_INICIADA'),
 'solicitudes',(select count(*) from solicitudes),
 'aprobadas',(select count(*) from solicitudes where aprobado_comercial_en is not null),
 'ventas',(select count(*) from solicitudes where estado_comercial='convertida_en_venta' and venta_id is not null),
 'vendedores',coalesce((select jsonb_agg(to_jsonb(r) order by r.visitas desc,r.nombre) from ranking_v r),'[]'::jsonb),
 'productos',coalesce((select jsonb_agg(to_jsonb(r) order by r.vistas desc,r.nombre) from ranking_p r),'[]'::jsonb)) into v_resultado;
 return v_resultado;
end $$;
revoke all on function public.analitica_catalogo(date,date) from public,anon;
grant execute on function public.analitica_catalogo(date,date) to authenticated;
