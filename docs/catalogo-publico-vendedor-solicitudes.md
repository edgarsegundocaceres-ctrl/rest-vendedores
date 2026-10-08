# APP INTEGRAL REST · Catálogo público por vendedor y solicitudes de compra

Fecha del diagnóstico e implementación: 8 de octubre de 2026.

## Límite inequívoco del trabajo

- Aplicación: **APP INTEGRAL REST**.
- Repositorio: `edgarsegundocaceres-ctrl/rest-vendedores`.
- Supabase: `gajlmcqaylezudttoaju` (`REST Vendedores`, región `sa-east-1`).
- Rama: `work/catalogo-publico-vendedor-solicitudes`, creada desde `origin/main` en `0ec608cd9260138868903d5d8c7777cf26b93861`.
- No se inspeccionó ni modificó código, tablas, datos, catálogo, planes, alquileres o contratos de APP INTEGRAL REST Motos.
- No se aplicó la migración al Supabase operativo, no se hizo merge a `main` y no se publicó en producción.

## Diagnóstico de la aplicación real

| Área revisada | Hallazgo | Decisión |
|---|---|---|
| Catálogo, imágenes y categorías | `productos` es la fuente vigente; tiene nombre, categoría, subcategoría, imagen, orden, activo y `precio_contado`. Al diagnóstico había 272 productos: 118 celulares activos, 99 hogar activos y 3 motos activas; el resto estaba inactivo. Las imágenes usan Storage público `catalogo-productos`. | Reutilizar `productos`; el catálogo público nuevo filtra exclusivamente activos de `hogar` y `celulares`. |
| Contado y financiación | `cotizar_producto(uuid)` calcula contado y crédito personal. Para Hogar/Celulares: 6 cuotas con interés simple mensual 9,5% y 9 cuotas con interés simple mensual 11%. | Extraer el cálculo a una única función privada y mantener `cotizar_producto` como wrapper autenticado. No hay precios hardcodeados en el flujo real. |
| Clientes y oportunidades | Existen `clientes`, `clientes_portal`, `intereses_clientes` y referidos, con propósitos diferentes. | No convertir el interés genérico en solicitud de compra; conservar cliente declarado en la entidad transaccional existente. |
| Presupuestos | `presupuestos` ya conserva snapshots de cotizaciones del vendedor. Había 22 registros. | Reutilizar el patrón de snapshot, sin mezclar presupuesto y solicitud. |
| Solicitudes previas | Ya existe `solicitudes_venta`, con idempotencia, producto/cliente/plan, estados internos y vínculo a venta/cuenta. Al diagnóstico estaba vacía. | Extender esta tabla; no crear una segunda bandeja de solicitudes. |
| Ventas | `ventas` es el circuito operativo único. Al diagnóstico estaba vacía. | La solicitud pública nunca inserta ventas; la conversión llama al motor existente `aprobar_solicitud_venta`. |
| Créditos y cuotas | Ya existen `cuentas_credito`, `cuotas_credito`, cupo mensual, fechas de vencimiento y auditoría. Estaban vacías. | Reutilizar la creación transaccional existente al convertir. |
| Vendedores y rol | Había 7 filas de vendedor: 5 activos vinculados a perfiles VENDEDOR activos y 2 duplicados inactivos sin usuario. | Token UUID por vendedor. Solo un vendedor y perfil activos habilitan nuevas solicitudes. |
| Portal del Vendedor | Ya contiene inicio, catálogo, presupuestos, ventas, oportunidades, referidos, metas, mensajes y comisiones. | Agregar “Mi catálogo” en el inicio, sin rediseñar el portal. |
| Atribución | `ventas.vendedor_id`, `clientes.creado_por_vendedor_id` y `cuentas_credito.vendedor_id` ya propagan al vendedor. | Conservar el vendedor de origen en la solicitud y pasarlo al motor existente. |
| Comisiones | El trigger existente al entregar una venta crea la comisión una sola vez: 3% para categoría `junior`, 5% para las demás categorías, respetando el momento operativo actual. | No crear tablas, funciones ni disparadores paralelos de comisión. |
| Captación | La postulación de vendedores y su activación ya están separadas del flujo comercial. | No reutilizar postulaciones como solicitudes de clientes. |
| Administración | La SPA existente usa módulos por pestañas y cards responsive. | Agregar la pestaña visible “Solicitudes de compra” y su indicador de nuevas. |
| RLS y Auth | Supabase Auth usa `perfiles`; `es_admin()` y `mi_vendedor_id()` centralizan autorización. `solicitudes_venta` permite lectura propia o de Administración y revoca escrituras directas. | Mantener RLS; las mutaciones sensibles se ejecutan por RPC `SECURITY DEFINER`, con `search_path=''`, chequeo de rol y grants explícitos. |
| Funciones existentes | `guardar_solicitud_venta`, `resolver_solicitud_venta`, `aprobar_solicitud_venta`, `cotizar_producto`, cálculo de vencimientos y comisión ya resolvían piezas críticas. | Integrar y proteger, no duplicar. |

## Arquitectura implementada

1. Cada vendedor recibe `vendedores.catalogo_token` UUID único.
2. El enlace canónico es `https://rest-vendedores.vercel.app/?catalogo=<uuid>`.
3. `obtener_catalogo_publico` valida token, vendedor activo, perfil activo y rol VENDEDOR; devuelve únicamente nombre público del vendedor, datos comerciales seguros del producto y opciones calculadas en servidor.
4. `crear_solicitud_compra_publica` vuelve a validar token y producto, recalcula contado/6/9 en servidor, valida y normaliza al cliente, aplica honeypot y límite de 5 solicitudes cada 10 minutos por huella IP/agente, y crea solo una `solicitudes_venta`.
5. `snapshot_solicitado` conserva producto, precio, tres opciones, regla/tasa relevante, modalidad elegida, fecha y vendedor de origen.
6. Un trigger impide cambiar token lógico de origen, vendedor personalizado, snapshot y datos declarados fuera del circuito autorizado.
7. Administración gestiona `estado_comercial`: `nueva`, `en_revision`, `contactado`, `aprobada`, `rechazada`, `convertida_en_venta`.
8. Historial inmutable y notas internas se guardan en tablas separadas, visibles solo para Administración.
9. Las condiciones reformuladas se recalculan con reglas vigentes y se guardan en `snapshot_final`; nunca reemplazan `snapshot_solicitado`.
10. `convertir_solicitud_compra` bloquea la fila, comprueba aprobación, impide una segunda conversión, aplica la selección final u original y llama a `aprobar_solicitud_venta`.
11. El motor existente busca al cliente por DNI, evita duplicados, crea venta, cuenta y cuotas, y mantiene `vendedor_id`.
12. La comisión continúa naciendo en el momento ya definido por APP INTEGRAL REST: al entregar/consolidar la venta.

## Comportamiento de seguridad y atribución

- El UUID público no autentica al vendedor ni permite entrar al Portal.
- El navegador nunca decide vendedor, nombre/precio de producto, importe o cuota; solo envía token, UUID de producto, código de modalidad y datos del cliente.
- `anon` no tiene `SELECT` sobre solicitudes, historial ni notas. Solo puede ejecutar los dos RPC públicos acotados.
- Los RPC administrativos validan `auth.uid()` y `es_admin()`; un VENDEDOR puede ejecutarlos por el rol SQL compartido, pero la función lo rechaza por su perfil.
- Si se desactiva al vendedor, el link deja de aceptar nuevas solicitudes. Las ya creadas conservan su vendedor y pueden convertirse con atribución histórica.
- Una solicitud de catálogo personalizado no puede reasignarse silenciosamente. Una futura solicitud del catálogo general admite `vendedor_id = NULL`, pero deberá recibir una asignación administrativa explícita y auditada antes de convertir.
- El WhatsApp se abre con un texto preparado; REST no envía mensajes automáticamente.

## Superficies de interfaz

- Catálogo público mobile-first, sin login, con buscador, categorías, cards, contado, 6 y 9 cuotas.
- Ficha de producto con imagen, categoría/subcategoría existente y opciones vigentes.
- Checkout de tres pasos: modalidad, datos y resumen.
- Confirmación “Solicitud recibida”; nunca comunica compra, crédito o venta confirmados.
- Portal del Vendedor: enlace personal, copiar, compartir por WhatsApp y resumen limitado de solicitudes originadas; sin acciones administrativas.
- Administración: indicador de nuevas, KPIs, filtros por estado/vendedor/modalidad/fecha, detalle, snapshots original/final, notas, historial, WhatsApp, aprobación/rechazo y conversión explícita.

## Migración y funciones

Migración: `supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql`.

Funciones nuevas o reorganizadas:

- `private.calcular_cotizacion_producto(uuid)` — fuente única de cálculo.
- `public.cotizar_producto(uuid)` — wrapper autenticado compatible con el portal actual.
- `private.opciones_catalogo_producto(uuid)` — proyección pública Contado/6/9.
- `private.controlar_limite_solicitud_catalogo()` — limitación antiabuso.
- `private.proteger_origen_solicitud_catalogo()` — integridad de snapshot, origen y conversión explícita.
- `public.obtener_catalogo_publico(text)`.
- `public.crear_solicitud_compra_publica(text,uuid,text,jsonb,uuid,text)`.
- `public.actualizar_estado_solicitud_compra(uuid,text,text)`.
- `public.guardar_condiciones_finales_solicitud(uuid,text)`.
- `public.agregar_nota_solicitud_compra(uuid,text)`.
- `public.convertir_solicitud_compra(uuid)`.

Tablas nuevas estrictamente necesarias:

- `solicitudes_compra_historial`: trazabilidad inmutable.
- `solicitudes_compra_notas`: notas privadas de Administración.
- `private.catalogo_solicitudes_rate_limit`: ventana antiabuso sin datos legibles del cliente.

## Pruebas ejecutadas

- `node --test tests/*.test.js`: 41/41 aprobadas.
- Smoke PostgreSQL con PGlite: migración completa aplicada sobre un esquema compatible, catálogo público, contado/6/9, solicitud, idempotencia, snapshot ante cambio de precio, inmutabilidad, rechazo, condiciones finales, cliente existente, desactivación posterior del vendedor, conversión única y atribución a venta: aprobado.
- Smoke DOM con JSDOM: catálogo, ficha, formulario, resumen, confirmación, Portal del Vendedor y bandeja de Administración: aprobado.
- Verificación de sintaxis de `catalogo-publico.js` e inline JavaScript: aprobada.
- `git diff --check`: aprobado.
- Inspección read-only del Supabase real para tablas, RLS, funciones, datos de referencia y reglas: aprobada; no hubo escrituras.

## Preview y rutas de revisión

El preview usa datos demostrativos aislados y no escribe en el Supabase operativo. Rutas:

- `?demo=catalogo-publico`
- `?demo=catalogo-producto`
- `?demo=catalogo-formulario`
- `?demo=catalogo-confirmacion`
- `?demo=mi-catalogo`
- `?demo=solicitudes-admin`

La URL remota se incorpora al informe de entrega después de crear el deployment de preview.

## Decisiones pendientes antes de producción

1. Aplicar primero la migración en una rama de Supabase o entorno no productivo y ejecutar el flujo con Auth/RLS reales.
2. Validar con REST si la descripción comercial debe incorporarse como campo propio en `productos`; hoy se muestra únicamente información existente y no se inventan características.
3. Confirmar texto legal/comercial definitivo del formulario y política de conservación de DNI.
4. Decidir si se habilita en una etapa posterior el catálogo general REST; la arquitectura admite origen directo, pero esta versión no publica ese enlace.
5. Tras la revisión visual, autorizar por separado migración operativa, merge y despliegue de producción.
