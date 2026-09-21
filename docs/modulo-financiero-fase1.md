# App Integral REST · Módulo financiero y cobranzas · Fase 1

Fecha de candidata: 21/09/2026  
Rama: `work/modulo-financiero-fase1`  
Base: `work/fase1-solicitudes-recuperada` (copia local `5eba94d6b67c01091736a30d19ace761d53dacb4`; referencia remota `d7c990de85cf501e08c4ef111d0af7238718cd73`; mismo árbol `24795d8e97dbf700dba9ecbbd99c585c9ac3ab54`)

## Resultado de esta etapa

Se incorporó un módulo administrativo de consulta para REST Hogar y Celulares. La candidata no registra pagos, no modifica saldos y no reemplaza a G-CRED.

Incluye:

- Agenda de Cobros por mes y año.
- Atajos para hoy, vencidos del mes y próximos siete días.
- Filtros combinables por estado, unidad, vendedor, ciudad y búsqueda.
- Resumen del período con importes programados, aplicados y pendientes.
- Estados visuales calculados sin escribir en la base.
- WhatsApp individual con mensaje preparado para revisión manual.
- Sugerencia segura del Portal Cliente por coincidencia exacta y única de DNI.
- Ficha financiera con datos personales, resumen, operaciones separadas y cuotas.
- Diseño adaptable a celulares.

La pantalla y la ficha muestran esta leyenda:

> Información interna de REST en etapa de validación. G-CRED continúa siendo el estado financiero oficial.

## Auditoría previa

Se revisaron el Documento Maestro Técnico, el repositorio, la rama candidata y el esquema real de Supabase.

### Tablas reutilizadas

| Tabla | Uso en esta fase |
|---|---|
| `clientes` | Datos personales de la ficha y la agenda. |
| `clientes_portal` | Verificación de una coincidencia exacta y única de DNI antes de sugerir el portal. |
| `ventas` | Producto y fecha de cada operación. |
| `solicitudes_venta` | Identificación de la solicitud relacionada. |
| `cuentas_credito` | Cuenta, modalidad, importes, unidad, vendedor y estado. |
| `cuotas_credito` | Cronograma, importe aplicado, saldo y vencimiento. |
| `vendedores` | Vendedor relacionado y filtro. |

No se reutilizaron las tablas `fin_*`: corresponden al bloque de caja, gastos y obligaciones generales, no a las cuentas de crédito de clientes.

### Migraciones

No se necesita una migración para esta candidata. Los índices existentes cubren las consultas principales por vencimiento, cuenta, cliente, unidad, estado y vendedor.

No se aplicó DDL ni se modificaron datos reales.

## Arquitectura de consulta

1. El navegador pide solamente las cuotas del rango visible mediante filtros de fecha en Supabase.
2. La consulta se pagina en bloques de 500 filas para soportar miles de vencimientos sin cargar toda la cartera.
3. Se consultan por lotes sólo las cuentas, clientes, vendedores y ventas relacionados con esas cuotas.
4. Los filtros de la pantalla operan sobre el conjunto ya acotado al período.
5. La ficha del cliente se consulta bajo demanda y se limita al `cliente_id` elegido.

No hay inserciones, actualizaciones, eliminaciones ni llamadas RPC dentro del bloque financiero de esta fase.

## Estados visuales

El estado visible se calcula con fecha de Argentina (`America/Argentina/Buenos_Aires`) y comparaciones de fechas `YYYY-MM-DD`, evitando el desplazamiento de un día por UTC.

| Estado visible | Regla |
|---|---|
| Rojo | Fecha anterior a hoy y saldo mayor que cero. Una cuota vencida parcial conserva la alerta roja. |
| Naranja | Vence hoy y tiene saldo. |
| Azul | Es futura, no está pagada, anulada ni parcial. |
| Amarillo | Tiene importe aplicado y saldo, pero todavía no está vencida. |
| Verde | Saldo cero o estado pagado en una cuenta no cerrada. |
| Gris | Cuota anulada o cuenta finalizada/sin saldo. |

Una cuota pagada, cerrada o anulada nunca se presenta como vencida. El cálculo es visual: no actualiza el campo `estado` original.

## Resumen financiero

La cabecera calcula sobre las filas que coinciden con el período y los filtros:

- Programado para el período.
- Aplicado a esas cuotas.
- Saldo de esas cuotas.
- Vencido pendiente.
- Cantidad de cuotas vencidas.
- Cantidad única de clientes con deuda vencida.
- Saldo que vence hoy.
- Saldo de los próximos siete días.

La interfaz evita llamar al importe aplicado “cobranza real del mes” porque todavía no existe un historial completo con fecha efectiva de pago.

## Portal Cliente

El esquema vigente no contiene una relación persistente entre `clientes` y `clientes_portal`. Por seguridad, esta fase no intenta enlazar registros por nombre o teléfono y no guarda una asociación automática.

Comportamiento implementado:

- Se buscan solamente portales activos cuyo DNI almacenado coincide exactamente con el DNI del cliente.
- Una coincidencia activa y única habilita `ENVIAR PORTAL` como sugerencia.
- Antes de abrir WhatsApp, Administración debe confirmar nombre, DNI y número de destino.
- Cero coincidencias, más de una coincidencia o un portal revocado muestran `PORTAL NO VINCULADO`.
- El token no se escribe en la interfaz, la URL ni los registros; se incorpora al mensaje sólo después de la confirmación.

Una vinculación permanente y auditable requiere una migración posterior, que no debe aplicarse sin autorización expresa.

## Seguridad

- El menú se renderiza dentro del panel administrativo autenticado.
- Las funciones de carga y ficha rechazan un perfil que no sea Administración.
- RLS permanece activa.
- Las políticas existentes permiten a Administración consultar la cartera y limitan al vendedor a sus propias cuentas.
- Las consultas incluyen filtros explícitos; no se confía solamente en RLS ni en ocultar botones.
- No se muestran ni registran tokens de portal, credenciales o enlaces de G-CRED.
- WhatsApp abre un mensaje individual para que el usuario lo revise y envíe manualmente. No existen envíos automáticos o masivos.

## Funciones existentes preservadas

- Solicitudes de venta de Hogar y Celulares.
- Aprobación administrativa transaccional.
- Creación o reutilización de cliente.
- Venta, cuenta y cuotas.
- Selección automática de planes.
- Oportunidades del Portal Cliente.
- Catálogo, vendedores, referidos, logística, portal y PWA.
- Página pública actual.

## Funciones agregadas

- `loadCollectionsAgenda`: carga paginada y acotada al período.
- `financeVisualState`: estado visual sin mutación.
- `financeFilterRows`: filtros combinables.
- `financeSummarize`: totales y cantidades del período.
- `financeOpenInstallmentWhatsApp`: recordatorio individual revisable.
- `financePortalState` y `financeSendPortal`: control de coincidencia y confirmación.
- `openFinancialClient` y `renderFinancialClient`: ficha completa por cliente y operación.
- Utilidades de fechas de Argentina, paginación, moneda y normalización de WhatsApp.

## Pendiente para etapas posteriores

- Crear clientes desde el módulo financiero.
- Crear créditos manuales con autorización.
- Registrar pagos parciales o totales con fecha efectiva.
- Recibos y auditoría de pagos.
- Promesas de pago.
- Cobradores, zonas y recorridos.
- Importación o API de G-CRED.
- Conciliación REST contra G-CRED.
- Estado de cuenta interno dentro del Portal Cliente.
- Relación persistente y auditable entre cliente interno y portal.

Nada de esta lista se implementó en la Fase 1.

## Evidencia de pruebas

El archivo `tests/finance-module.test.js` ejecuta controles sobre las funciones reales extraídas de `index.html`.

| Caso | Resultado |
|---|---|
| Cuota futura, de hoy, vencida, parcial, pagada y anulada | Superado |
| Parcial vencida con alerta roja | Superado |
| Cuenta finalizada sin saldo | Superado |
| Cliente con dos operaciones y conteo único de deuda | Superado |
| Filtros combinados | Superado |
| Totales del período | Superado |
| Meses de 28, 29, 30 y 31 días | Superado |
| Cambio de año en ambos sentidos | Superado |
| Normalización de números de WhatsApp | Superado |
| Cliente sin portal, portal único, ambiguo y revocado | Superado |
| Bloque financiero sin operaciones de escritura | Superado |
| Control administrativo en interfaz | Superado |
| Consulta acotada por fecha y cliente | Superado |
| IDs HTML sin duplicados | Superado |
| Presencia de módulos anteriores | Superado |
| JavaScript embebido y diferencias Git | Superado |

Comando reproducible:

```bash
node tests/finance-module.test.js
```

Resultado actual: `OK: 32 controles del módulo financiero superados`.

## Limitaciones conocidas

1. G-CRED no está integrado. La agenda contiene solamente las cuentas y cuotas internas generadas por el flujo nuevo de REST.
2. La base real tiene actualmente muy pocos registros en `cuentas_credito` y `cuotas_credito`; por eso los estados adicionales se verificaron con datos simulados aislados, sin insertar datos de prueba en Supabase.
3. La coincidencia de portal usa DNI exacto almacenado. Variantes de formato no se adivinan porque el esquema no ofrece todavía una relación segura y persistente.
4. El campo aplicado no tiene todavía un historial financiero completo con fecha efectiva; no equivale a cobranza real mensual.
5. REST Motos queda expresamente fuera de este módulo.

## Despliegue

- `main`: sin cambios.
- Producción: sin cambios.
- URL pública: sin cambios.
- Preview aislado protegido: `https://rest-vendedores-git-work-modulo-5c4b8e-edgarsegundocaceres-1114.vercel.app/`.
- Promoción a producción: prohibida hasta la prueba y autorización del responsable.
