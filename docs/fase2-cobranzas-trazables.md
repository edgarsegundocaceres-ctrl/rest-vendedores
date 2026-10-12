# APP INTEGRAL REST · Fase 2 · Cobranzas trazables

Estado: candidata para revisión. **Sin merge, sin despliegue productivo y sin migración aplicada a Supabase operativo.**

Revalidación del 12/10/2026: main continúa en la misma base y Supabase no tiene objetos parciales ni la migración de Fase 2. Se repitieron las 53 pruebas, los smoke SQL/DOM y se ampliaron los controles financieros a 79 (83 en PostgreSQL nativo con concurrencia). Se verificó el pago/anulación como `authenticated` y la conversión del catálogo después de instalar Fase 2. El fixture de ventas ahora reproduce el permiso SELECT y la política existentes en producción. La publicación está autorizada condicionalmente, pero la validación del ingreso ADMIN real quedó pendiente: el sitio rechazó el intento de acceso. No se aplicó la migración operativa ni se hizo merge.

## Diagnóstico previo y proyecto

Se verificaron el repositorio `edgarsegundocaceres-ctrl/rest-vendedores`, `origin/main` en `a999df019219dc9027e13b35f36d5ece1a9df7cc` y Supabase `gajlmcqaylezudttoaju` (REST Vendedores, ACTIVE_HEALTHY, PostgreSQL 17.6). La migración del catálogo `20261008145528` figura aplicada. Se hizo únicamente lectura del proyecto real durante esta fase.

El esquema operativo tenía 1 cuenta, sin saldo, 0 cuotas y 0 cobranzas al diagnosticar; ninguna discrepancia entre saldo de cuenta y suma de cuotas. El desarrollo histórico `work/modulo-financiero-fase2` se inspeccionó: era una simulación en memoria sin movimientos persistentes ni RPC de cobro, sobre una base anterior a la publicación del catálogo. Se reutilizó su diagnóstico conceptual, conservando como base técnica el main actual.

| Estructura/función | Estado encontrado | Decisión |
|---|---|---|
| clientes / vendedores / perfiles | Existentes, con roles y RLS | Reutilizar; no duplicar personas ni roles. |
| ventas | Existente, logística y comisiones por entrega | Reutilizar. Cobrar no entrega una venta ni genera otra comisión. |
| solicitudes_venta / solicitudes de compra | Una entidad extendida por el catálogo, con snapshots | Conservar el circuito de aprobación y conversión. |
| cuentas_credito | Una cuenta única por venta y solicitud | Reutilizar saldo y estados existentes. |
| cuotas_credito | Importe, pagado, saldo generado, vencimiento y estados | Reutilizar el cronograma; no crear un segundo plan. |
| aprobar_solicitud_venta | Transaccional; genera cliente/cuenta/cuotas | Reutilizar sin modificarla. |
| credito_fecha_vencimiento | Mensual, quincenal y semanal; ajusta fin de mes | Reutilizar y comprobar fechas. |
| credito_auditoria | Inmutable, con actor, detalle y fecha | Reutilizar para pagos, anulaciones, cierre y reapertura. |
| cupos_financiacion_mensual | Existente, controla aprobación | Conservar. Un cobro no modifica cupos. |
| cobranzas_ventas | Una fila por venta/número de cuota, sin cuenta/imputaciones/medio/fecha efectiva separada | Ampliar esta entidad; no crear pagos_credito paralelos. |
| Registrar cuota | INSERT directo y cambio de estado de venta | Sustituir la entrada por el circuito transaccional de cobranzas. |
| fin_movimientos / fin_cuentas / fin_obligaciones | Caja/obligaciones por ámbito REST o personal; no son cartera de clientes | Mantener; no duplicarlos ni usarlos como otro crédito. No se implementa contabilización automática de caja en esta fase. |
| clientes_portal / Portal Cliente / G-CRED | Portal y enlace externo vigentes | Conservar íntegros. No conectar todavía la nueva cartera al portal público. |
| Portal Vendedor / captación / catálogo / presupuestos | Publicados, con Auth/RLS y atribución comercial | Conservar; se ejecutaron las regresiones existentes. |
| Catálogo de medios de cobro | No existe para la cartera | La RPC publica efectivo/transferencia/tarjeta/otro desde el backend. |
| Detalle pago→cuota | No existe | Crear solamente cobranzas_imputaciones. |

## Problema corregido

El antiguo botón guardaba `cobranzas_ventas.numero_cuota/monto` sin actualizar `cuotas_credito.importe_pagado`, sin recalcular `cuentas_credito.saldo_actual`, y sin permitir varios pagos parciales de la misma cuota. Fecha de pago y carga se confundían. La nueva candidata registra movimientos, conserva cada imputación y permite anular con trazabilidad.

## Arquitectura y migración pendiente

Archivo: `supabase/migrations/20261011140519_fase2_cobranzas_trazables.sql`.

La migración está envuelta en una transacción `BEGIN/COMMIT`. Un error revierte el conjunto. No es para repetir a ciegas: antes de aplicarla hay que verificar su versión en el historial de migraciones. Si la cartera tiene pagos previos o saldos discrepantes, la migración se detiene y exige conciliación; no inventa una imputación histórica ni transforma pagos anteriores en nuevas cobranzas.

Tablas ampliadas: `cobranzas_ventas`, con cuenta/cliente, clave de idempotencia, número interno de recibo, fecha efectiva, medio, referencia, estado, datos de anulación y snapshot del cliente/producto/registrador/saldos. La fecha de registro sigue en `creado_en` y se guarda con reloj del servidor. `fecha_pago` se mantiene para compatibilidad histórica. Se conserva la unicidad anterior para filas legadas sin cuenta, mediante índice parcial; las filas nuevas admiten varios cobros parciales para una cuota.

Tabla nueva: `cobranzas_imputaciones`, con `cobranza_id`, `cuota_id` e importe exacto. Clave única por pago/cuota, FKs restrictivas e índices para consultar en ambas direcciones. El detalle permanece después de anular.

Las estructuras de cuenta, cronograma y auditoría conservan sus columnas. Se agregan índices y triggers de validación, sin reemplazar los triggers existentes. Un esquema privado no expuesto contiene las funciones auxiliares y la vista de agenda.

| RPC pública administrativa | Función |
|---|---|
| cobranzas_tablero | KPIs reales, agenda, filtros, búsqueda, clientes y paginación. |
| ficha_financiera_cliente | Resumen, cuentas activas/finalizadas, cronogramas, movimientos y auditoría. Admite cliente, cuenta o venta como entrada. |
| previsualizar_cobro | Calcula la imputación y devuelve una revisión del saldo/cronograma para confirmar. |
| registrar_cobro_credito | Registra movimiento e imputaciones, recalcula cuenta/cuotas y escribe auditoría atómicamente. |
| anular_cobro_credito | Revierte el efecto contable sin borrar el movimiento ni sus imputaciones. |
| obtener_recibo_cobranza | Devuelve comprobante interno con snapshot, imputaciones y estado de anulación. |

## Motor de pagos, saldos y concurrencia

Se opera sobre la cuenta; la distribución por defecto sigue vencimiento más antiguo, número e ID. Un cobro puede cancelar una cuota y dejar otra parcial. `importe_pagado` se obtiene de la suma de imputaciones de movimientos registrados; los pagos anulados quedan fuera de los saldos y KPIs. `saldo` de cuota continúa siendo la columna generada existente. `saldo_actual` de cuenta coincide con la suma del cronograma válido.

Cuando el saldo queda en cero, la cuenta se finaliza. Al anular un pago que la había cerrado, se reabre si vuelve a existir deuda, dejando ambos eventos en auditoría. Los triggers diferidos verifican al cerrar la transacción que cada cobro esté imputado por su importe exacto y que cuota/cuenta concuerden. Los triggers de inmutabilidad bloquean DELETE y modificaciones silenciosas de pagos/imputaciones.

Se serializa la clave de idempotencia y se bloquean cuenta y cuotas antes de registrar. Anular usa el mismo orden de bloqueo. Si otro operador modifica el saldo después del resumen de confirmación, el segundo cobro se rechaza y debe revisarse. Un envío repetido con la misma clave y mismos datos devuelve el pago existente; usar la clave con otros datos falla. No se permite saldo negativo ni saldo a favor automático.

Los importes admiten centavos y se rechazan NaN, infinito, negativos, cero o precisión mayor a dos decimales. El formulario reconoce separadores argentinos. La fecha efectiva es explícita y puede ser anterior a la carga; no admite fechas futuras.

## Agenda, ficha, historial y WhatsApp

Administración incorpora Cobranzas y acceso desde Clientes a fichas financieras. La agenda muestra cliente, DNI/teléfono, producto, número/vencimiento, importe original, pagado, saldo, estado y acciones. Hoy, vencidas, próximos 7 días, mes, pagadas y todas son filtros del backend; nombre, DNI y teléfono admiten búsqueda y paginación.

Los KPIs muestran cuotas/importe de hoy, vencidas y próximos 7 días, cobrado hoy/mes por **fecha efectiva** y cartera de cuentas activas. Próximos 7 días excluye hoy e incluye días 1 a 7. El mes es el calendario de Argentina. Todos los importes provienen del backend; no hay cifras de cartera hardcodeadas.

El estado operativo se calcula con la fecha local `America/Argentina/Cordoba`, vencimiento y saldo. Una cuota pasada parcialmente pagada aparece como **Vencida · pago parcial**, conservando su estado contable parcial. La señal visual incluye texto además del color.

La ficha presenta datos del cliente, total original, pagos registrados de cuotas, saldo, vencido y próximo vencimiento; las cuentas detallan anticipo pactado y financiado. No se presenta un anticipo pactado como cobrado: esta fase no registra ni importa anticipos/cobros históricos de G-CRED. Las ventas de contado permanecen sin saldo y sin cuotas. Cada cuota permite consultar los movimientos que la pagaron.

WhatsApp abre una conversación preparada mediante acción humana. El mensaje usa el saldo pendiente de la cuota, fecha, producto y cliente. Normaliza teléfonos argentinos con país, 0 y 15; no inventa el código de área cuando el número es incompleto. No existe envío automático.

## Recibos y anulaciones

Se implementó comprobante interno imprimible: REST, número, cliente/DNI, fecha efectiva, fecha de registro, importe, medio, cuenta/venta, imputación, referencia y usuario. Conserva el snapshot de emisión y muestra por separado saldo al cobrar y saldo actual. No es un documento fiscal.

Un pago incorrecto se anula con motivo obligatorio. El historial y el recibo siguen mostrando PAGO ANULADO, fecha, actor y motivo. La operación revierte importes pagados, saldos y estados; las imputaciones históricas no se borran.

## RLS, permisos y Auth

RLS permanece activa. La tabla de imputaciones permite SELECT administrativo. Se revocan todas las escrituras directas de `anon` y `authenticated` sobre pagos/imputaciones y sobre saldos/cuotas/auditoría. La lectura propia histórica de cobranzas del vendedor se conserva; no puede registrar, anular, modificar saldos ni utilizar RPC administrativas. El público no recibe lectura financiera ni EXECUTE financiero.

Las RPC administrativas usan `search_path=''`, EXECUTE revocado a PUBLIC/anon, y comprueban `auth.uid()` y `es_admin()` (rol/actividad desde perfiles). No usan metadata editable del usuario. Las funciones auxiliares y vista quedan en esquema privado, sin permisos públicos. La vista es `security_invoker`.

Se probaron roles PostgreSQL reales `anon`/`authenticated`, Administración y vendedor en bases aisladas, usando un shim local de `auth.uid()`. **No se afirma una validación nueva de JWT/Auth/PostgREST en Supabase operativo**, porque la migración no se aplicó allí. Esa frontera debe comprobarse en staging o mediante el procedimiento seguro autorizado al liberar. El login y los portales existentes conservan su código de autenticación.

## Pruebas y evidencia

| Verificación | Resultado |
|---|---|
| Suite Node completa | 53/53: 45 existentes y 8 nuevas para importes, fechas, WhatsApp y escape de datos. |
| Motor PostgreSQL embebido | 74 controles: cuenta/cuotas, fechas, filtros/búsqueda, parcial/total, dos cuotas, backdate, medios, recibos, saldo, finalización/reapertura, auditoría, anulación, sobrepago, permisos e idempotencia. |
| PostgreSQL nativo 18 en VM temporal separada | 78 controles, incluidos dos clientes independientes: misma clave, sobrepago concurrente, saldo exacto y anulación simultánea. Proceso terminó con código 0. VM detenida y descartada. |
| UI → RPC → PostgreSQL → respuesta | Cobro parcial sobre dos cuotas, fecha anterior, doble clic, recibo, ficha, historial, consulta de pagos por cuota y anulación con recálculo. |
| Navegador Chromium real | Pago de $125.000 imputado a dos cuotas, fecha anterior, doble clic único, recibo, anulación, WhatsApp y ficha con dos créditos. Escritorio y móviles de 375/320 px sin desbordes; importes revisados visualmente. |
| SQL/DOM de la versión anterior | Pasaron catálogo público, snapshots, atribución, conversión, comisiones, Administración y Portal Vendedor. |
| Sintaxis y diff | JavaScript válido y `git diff --check` sin errores. |

No se encontraron regresiones críticas en lo verificado. Captación/presupuestos conservan sus 19 pruebas de regresión; el catálogo conserva sus 26 pruebas. Las comprobaciones de acceso mediante JWT y Edge Functions reales de producción se reservan para la liberación: no se crearon usuarios ni ventas TEST en ese proyecto para esta revisión.

## Preview y límites

Entrada: `/cobranzas-preview.html`, sin login, exclusivamente con datos TEST. Usa la misma UI, migración y RPC PostgreSQL de la candidata, en una base aislada de la pestaña (PGlite 0.3.14, versión y licencia incluidas). Sus archivos no dependen de CDN externo. No carga el cliente Supabase ni sus claves. Los datos se reinician al recargar. El motor de PostgreSQL del preview solo se descarga en esa página; la aplicación administrativa normal no lo utiliza.

Prueba sugerida: abrir Vencidas → TEST María Pérez → Registrar cobro → importe parcial o que cubra dos cuotas → fecha efectiva → revisar imputación → confirmar → recibo → ficha/historial → anular con motivo. Probar además Hoy, Próximos 7 días, búsqueda y WhatsApp. TEST María tiene dos créditos; TEST Lucía muestra uno finalizado; existe una operación al contado sin deuda.

Una venta sin cuenta propia no se migra automáticamente: conserva G-CRED y muestra que no tiene cuenta financiera REST. Una venta cancelada/caída/rechazada no admite nuevos cobros: el cierre administrativo de una cuenta ligada a cancelaciones comerciales se deja para un flujo posterior, sin alterar silenciosamente la deuda. No se generan intereses de mora, ajustes manuales, saldos a favor, importación masiva, sincronización con G-CRED ni portal financiero público.

La futura apertura de cartera importada deberá tener un origen explícito y saldo de apertura conciliado. No se implementó en esta fase.

## Rama, publicación y próximos pasos

Rama: `work/fase2-cobranzas-trazables`. Base main: `a999df019219dc9027e13b35f36d5ece1a9df7cc`.

La candidata se entrega como PR borrador y preview. Service worker preparado: `rest-shell-v1.6.0`, con los nuevos recursos. Producción continúa con la versión anterior; no se promovió ningún deployment.

Después de la revisión y autorización: comprobar esquema y pagos operativos actuales, validar la migración en staging con Auth/PostgREST reales, repetir los controles críticos sobre ese ambiente, planificar respaldo y aplicar/liberar únicamente si todo coincide. Empezar con operaciones nuevas y cuentas de control. G-CRED continúa como respaldo.

**No se hizo merge. No se desplegó producción. No se aplicó esta migración a Supabase operativo. APP INTEGRAL REST MOTOS no fue modificada: repositorio, Supabase, datos, contratos, planes, cobranzas, portal y deployments quedaron fuera de la intervención.**
