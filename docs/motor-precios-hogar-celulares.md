# PR #6 — transición híbrida Celulares, revisión 14/10/2026

Repositorio exclusivo: edgarsegundocaceres-ctrl/rest-vendedores. Supabase leído: gajlmcqaylezudttoaju. Rama work/motor-precios-hogar-celulares. Main base a75ac4c. No producción, merge ni escrituras productivas.

## Decisión vigente

Esta revisión reemplaza la estrategia de activación anterior del PR, no las fórmulas autorizadas.

- Celular con costo proveedor USD validado: (USD + 10) × Dólar REST. Contado ×1,40; total 6 ×2,50; total 9 ×3,20. Primera cuota al inicio, sin registrar un pago ficticio.
- Celular sin costo USD: compatibilidad transitoria desde precio contado existente. Totales 6 = contado ×1,57; 9 = contado ×1,99. No se infieren costos.
- Hogar: permanece en regla vigente, incluso si una estructura contiene costo ARS. Nueva fórmula Hogar queda inactiva hasta autorización; RPC de carga Hogar rechaza activación accidental.
- Dólar REST inicial autorizado 1550 en la migración PENDIENTE; editable solo ADMIN. Seed auditado como instalación autorizada, sin atribuirlo a un usuario Auth inventado. No usa API externa.
- No backfill de precios, operaciones o snapshots durante instalación. Solo al cargar un costo USD validado se sincroniza el contado de ese celular.
- No se permite borrar/anular silenciosamente un costo USD ya activado: eso requeriría definir una transición explícita para no reutilizar un contado derivado como precio legado.

## Cruce de proveedor

Informe íntegro A/B/C/D y manifiesto conservados fuera de este repositorio público; entregados privadamente a Edgar. 73 líneas: 41 matches seguros, 21 revisión, 11 variantes nuevas (no creadas). 86 productos REST sin equivalencia segura; incluye candidatos ambiguos. 40 de los 41 matches están habilitados en catálogo; un producto permanece inactivo. No se activan productos ocultos.

Lista titulada STOCK ACTUALIZADO 5/9, sin año. No acredita stock actual. Los atributos omitidos no se completan por suposición. Colores REST agrupados solo se aceptan si están cubiertos por la lista; variantes con condición/capacidad dudosa no reciben costo. Poco X8 Pro Max no aparece en la lista efectivamente enviada.

Carga exclusivamente en PostgreSQL efímero TEST desde el manifiesto revisado. No hay script que cargue producción automáticamente. Datos y reportes de costos no se suben a GitHub (repositorio público) ni a los assets web. scripts/build-static.cjs agrega exclusión defensiva. El preview usa ejemplos de control, no publica la lista de proveedor. Producción tampoco incluye SQL, fixtures o páginas de prueba.

## Fuente única y snapshots

Se reutilizan private.calcular_cotizacion_producto, cotizar_producto, calcular_presupuesto_rest, crear_presupuesto_vendedor, productos, productos_costos, solicitudes_venta, presupuestos y conversión existente. costo_proveedor_usd guarda 420, nunca 430 para el ejemplo TEST. El adicional lo agrega el motor.

Presupuestos y solicitudes guardan condiciones comerciales; auditoría privada guarda costo, adicional, dólar, base y plan. Ventas del portal también guardan snapshot privado inmutable. Actualizar dólar afecta solo precios/cotizaciones nuevas de celulares activados. Históricos no se recalculan.

## Portal Vendedor

Se restaura el resultado operativo anterior: Vendedor → venta pendiente → gestión habitual de Administración. No se crea solicitud intermedia ni se incorpora ese canal a la bandeja pública.

La nueva RPC registrar_venta_catalogo valida producto activo, vendedor, modalidad, cantidad, frecuencia, anticipo, cuota y total contra backend. Genera cliente y venta pendiente atómicamente. Doble clic/reintento usa UUID y bloqueo transaccional. La oportunidad vinculada debe pertenecer al vendedor y al producto. Importes alterados o cotización obsoleta se rechazan. No se permite INSERT directo que evada validación; UPDATE de campos económicos por vendedor queda bloqueado.

El vendedor debe seleccionar un producto y cotización oficial; una venta manual sin producto identificable no puede validarse contra este motor. No se agrega una aprobación distinta ni se cambian los estados administrativos.

**Limitación previa conservada:** la venta pendiente directa del portal no crea cuenta/cuotas automáticamente. El esquema actual exige solicitud_id para cuentas_credito. No se alteró ese motor financiero ni se crearon solicitudes ocultas para sortearlo. La conversión de solicitudes públicas sí reutiliza la generación existente de cuenta/cuotas y fue probada. Integrar la aprobación de ventas pendientes con ese circuito requiere una decisión separada antes de prometer un circuito financiero automático completo para el portal.

## Modalidades

Portal/cotizador/presupuesto conservan contado, crédito personal 6/9, anticipo mensual, anticipo semanal y Tarjeta Sol. Catálogo público y condiciones finales administrativas de sus solicitudes conservan contado/6/9. Reglas de anticipos y Tarjeta Sol sin cambios; toman contado vigente. Solo crédito personal del celular activado tiene primera cuota al inicio; legado conserva vencimiento anterior.

## Seguridad y precisión

ADMIN exclusivo para dólar/costos/inspección; sin costo, dólar o margen en respuesta pública. RLS y grants explícitos; SECURITY DEFINER con search_path vacío y control interno de identidad. Advisory compartido al cotizar y exclusivo al actualizar dólar/costos. Snapshots privados inmutables, no datos personales en el manifiesto proveedor.

Numeric PostgreSQL; totales a dos decimales. Cuota nominal round(total/n,2), última = total − (n−1) × cuota nominal. No redondeo a miles.

| Celular TEST: proveedor USD420 + 10; dólar1550 | Importe ARS |
|---|---:|
| Base | 666500 |
| Contado | 933100 |
| Total 6 | 1666250 |
| Cuotas 1–5 | 277708,33 |
| Última 6 | 277708,35 |
| Total 9 | 2132800 |
| Cuotas 1–8 | 236977,78 |
| Última 9 | 236977,76 |

## Validación

- 284 verificaciones híbridas: 41 costos seguros TEST mediante fixtures privados externos, 86 celulares y 142 Hogar preservados, mismo conjunto de productos públicos antes/después, ejemplo de control, venta pendiente, idempotencia, rechazos de importes, permisos y snapshot tras dólar1600.
- 24 controles de motor/integración: ejemplo USD300/dólar1500, cambios1550, presupuesto, solicitud pública, conversión, cuotas/primera/última, históricos inalterados.
- 79 controles financieros Fase2; UI financiera real → RPC → PostgreSQL con pagos, imputación, anulación y reversión.
- UI motor real → RPC → PostgreSQL: Administración dólar, cotizador, venta pendiente y doble clic.
- 53 tests JS existentes; DOM de catálogo, formulario, confirmación, Administración y vendedor.
- Build local preview/producción: costos y reportes privados excluidos; assets comerciales conservados. No deployment productivo.

Ejecución del cruce: REST_PRIVATE_PRICE_FIXTURES apunta a los JSON privados entregados a Edgar. PGLITE_MODULE_DIR y JSDOM_MODULE_DIR deben apuntar a node_modules con PGlite y jsdom. Ejecutar tests/motor-precios.test.cjs, tests/motor-precios-hibrido.cjs, tests/motor-precios-ui.cjs, tests/motor-precios-finance-regression.cjs; repetir este último con MOTOR_FINANCE_UI=1; node --test tests/*.test.js; tests/ui-dom-smoke.cjs.

## Pendientes antes de autorización final

Revisar cruce A/B/C/D y vigencia proveedor. Resolver variantes B si se desea ampliar activación. Revisar limitación financiera previa del portal. Ensayar instalación en staging equivalente y Auth real; PGlite no demuestra concurrencia entre conexiones independientes. No cargar costos ni aplicar migración hasta autorización final. No reaplicar Fase2 registrada externamente como 20261012213147. PR5 de analítica permanece separado.

Migración pendiente única del PR: 20261013140257_motor_precios_hogar_celulares.sql, actualizada antes de aplicarse. Ninguna migración histórica editada. APP INTEGRAL REST MOTOS y G-CRED no modificados. No recalculados históricos, cobranzas, saldos, comisiones o snapshots.
