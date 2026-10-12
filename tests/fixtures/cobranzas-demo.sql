-- Datos ficticios. Se ejecuta en base local/preview, JAMÁS en Supabase operativo.
update public.productos set nombre='TEST Sommier REST · 2 plazas' where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.productos set nombre='TEST Celular REST' where id='dddddddd-dddd-4ddd-8ddd-000000000002';
do $$
declare s jsonb; r jsonb; c uuid; i integer; h date:=(now() at time zone 'America/Argentina/Cordoba')::date;
begin
 for i in 1..5 loop
   perform set_config('app.test_uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
   s:=public.guardar_solicitud_venta(jsonb_build_object(
     'unidad',case when i=2 then 'celulares' else 'hogar' end,
     'producto_id',case when i=2 then 'dddddddd-dddd-4ddd-8ddd-000000000002' else 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' end,
     'cliente_nombre',case i when 1 then 'TEST María Pérez' when 2 then 'TEST María Pérez' when 3 then 'TEST Carlos Díaz' when 4 then 'TEST Lucía Gómez' else 'TEST Cliente contado' end,
     'cliente_dni',case when i in (1,2) then '30111222' else (31000000+i)::text end,
     'cliente_telefono','5493855550000','cliente_direccion','TEST República del Líbano 176','cliente_ciudad','La Banda',
     'forma_pago',case when i=5 then 'Contado' else 'Crédito personal · 3 cuotas' end,
     'monto_total',case when i=5 then 100000 else 300000 end,
     'anticipo',case when i=5 then 100000 else 0 end,'cantidad_cuotas',case when i=5 then 0 else 3 end,
     'valor_cuota',case when i=5 then 0 else 100000 end,'frecuencia',case when i=5 then 'unico' else 'mensual' end,
     'primer_vencimiento',case when i=5 then null else current_date+30 end),gen_random_uuid());
   perform set_config('app.test_uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
   r:=public.aprobar_solicitud_venta((s->>'id')::uuid); c:=(r->>'cuenta_credito_id')::uuid;
   update public.cuotas_credito set vencimiento=case when i=1 then h+(numero-2)*30 when i=2 then h+numero*2 when i=3 then h-10+(numero-1)*30 else h+numero*30 end where cuenta_id=c;
   update public.ventas set estado='entregada',fecha_entrega=now() where id=(r->>'venta_id')::uuid;
 end loop;
end $$;
set app.test_uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
