# Fase 1 Solicitudes de venta

## Estado de esta entrega

Versión candidata en la rama técnica `work/fase1-solicitudes-recuperada`. La migración aditiva ya fue aplicada en Supabase y la rama cuenta con un preview de Vercel en estado `READY`. `main` y el frontend de producción permanecen sin cambios.

La entrega implementa el cambio mínimo seguro definido en el Documento Maestro: solicitud unificada del vendedor, revisión administrativa y base transaccional de cliente, venta, cuenta y cuotas. El alcance es exclusivamente Hogar y Celulares. Motos continúa en REST Motos.

## Alcance funcional

- El vendedor elige un producto activo del catálogo y completa una sola ficha con cliente y operación.
- Al cargar una venta desde una oportunidad, el formulario consulta `cotizar_producto` y ofrece los planes vigentes del mismo producto. La modalidad y la cantidad de cuotas autocompletan total, anticipo mínimo, valor, periodicidad y primer vencimiento; la carga manual permanece disponible para excepciones.
- El envío crea una solicitud pendiente, sin crear cliente, venta ni deuda.
- Administración puede aprobar, rechazar o pedir corrección con motivo obligatorio.
- El vendedor puede editar y reenviar solicitudes pendientes o con corrección solicitada.
- Al aprobar se busca el cliente por DNI y se crea, en una única transacción, la venta, la cuenta y el calendario de cuotas.
- Las oportunidades de “Me interesa” se cierran recién cuando la aprobación termina correctamente.
- Las ventas históricas y sus flujos actuales permanecen sin cambios.

## Invariantes de seguridad

- La clave de idempotencia evita solicitudes duplicadas por doble toque o reintento de red.
- La aprobación es idempotente y sólo puede ejecutarla Administración.
- Cada vendedor sólo puede consultar sus propias solicitudes, cuentas y cuotas mediante RLS.
- Las mutaciones directas de las cuatro tablas nuevas están revocadas para clientes web; se realizan mediante RPC controladas.
- La aprobación serializa por DNI y por cupo mensual para evitar altas o sobreasignaciones concurrentes.
- Un DNI histórico ambiguo bloquea la aprobación y revierte toda la operación; no fusiona clientes automáticamente.
- La oportunidad vinculada se vuelve a validar y bloquear antes de aprobar.
- La auditoría de crédito no admite actualización ni eliminación.

## Orden de liberación propuesto

1. Completado: se aplicó `supabase/migrations/20260920211644_app_integral_fase1_solicitudes.sql` mediante el flujo de migraciones.
2. Completado: se verificaron exposición en PostgREST, permisos, RLS y asesores de seguridad y rendimiento.
3. Completado: se ejecutó una aceptación transaccional en la base real con `ROLLBACK`, sin dejar clientes, ventas, cuentas ni cuotas de prueba.
4. En curso: el flujo base de solicitudes fue validado por el usuario en el preview; falta validar allí el nuevo selector automático de planes.
5. Pendiente: publicar juntos `index.html` y `sw.js` sólo cuando todas las pruebas pasen y exista autorización expresa.
6. Después de publicar: observar solicitudes, errores y cupo durante el período inicial sin migrar cartera de G-CRED.

## Lista de aceptación previa a Producción

- Contado: una solicitud produce una venta, una cuenta sin saldo y cero cuotas.
- Financiado: la suma de cuotas coincide exactamente con el saldo; la última absorbe diferencias de centavos.
- Desde “Oportunidades > Cargar venta”, Contado, Crédito personal, Anticipo + cuotas mensuales/semanales y Tarjeta Sol muestran sus cantidades de cuotas y completan los importes sin carga manual.
- Al cambiar el anticipo de un plan que lo admite, se recalculan el total y la cuota; “Carga manual / excepción” vuelve a habilitar los campos.
- Vencimientos mensual, quincenal y semanal quedan en las fechas esperadas.
- Pedir corrección permite editar y reenviar; rechazo impide aprobar.
- Dos aprobaciones o doble clic sobre la misma solicitud crean una sola venta y una sola cuenta.
- Un vendedor no puede aprobar ni ver solicitudes de otro vendedor.
- Un DNI histórico duplicado produce rollback completo.
- Una oportunidad vinculada se cierra y enlaza una sola vez.
- Catálogo, oportunidades, referidos, ventas históricas, logística y Portal Cliente continúan funcionando.
- Una operación de Motos queda bloqueada con indicación de continuar en REST Motos.
- La vista móvil permite completar, revisar y enviar la ficha sin desplazamiento horizontal.

## Evidencia de validación local

Validación ejecutada el 20 de septiembre de 2026 sobre la candidata, sin escribir en Producción:

- La migración completa se aplicó en PostgreSQL embebido y terminó sin errores.
- Se verificaron envío idempotente, aprobación idempotente, contado y entrega pactada sin saldo, financiación con calendarios mensual/semanal/quincenal, ajuste exacto de centavos en la última cuota, corrección y reenvío, rechazo irreversible, aislamiento RLS, bloqueo al vendedor y auditoría inmutable.
- Se comprobó el rollback completo cuando el DNI normalizado corresponde a más de un cliente histórico.
- Se comprobó que la oportunidad vinculada queda cerrada únicamente después de aprobar.
- La prueba de integración del frontend completó 13 controles del flujo vendedor/administrador, incluida la protección contra contenido HTML, el bloqueo de Motos, el vínculo con oportunidades y la presentación correcta de operaciones no financiadas.
- El JavaScript embebido, el service worker y la revisión de whitespace finalizaron sin errores.
- El motor compartido de planes pasó pruebas para contado, crédito personal de 6 y 9 cuotas, anticipo mensual, anticipo semanal y Tarjeta Sol, incluidos redondeos y rechazo de opciones no disponibles.
- La migración quedó registrada en Supabase como `20260920211644_app_integral_fase1_solicitudes`.
- Las cuatro tablas nuevas quedaron vacías, con RLS activo y sólo permiso de lectura para usuarios autenticados; las escrituras continúan encapsuladas en RPC.
- PostgREST reconoce tablas y RPC: las solicitudes anónimas reciben denegación de permisos en lugar de recurso inexistente.
- La aceptación transaccional sobre la base real verificó envío y aprobación idempotentes, contado sin saldo ni cuotas, financiación con tres cuotas, corrección y reenvío, rechazo irreversible, aislamiento RLS, auditoría inmutable y rollback ante DNI histórico ambiguo.
- Toda la aceptación se revirtió al terminar: quedaron cero solicitudes y cero ventas de prueba persistidas.
- Los asesores sólo señalan como advertencias nuevas las tres RPC `SECURITY DEFINER` expuestas deliberadamente a usuarios autenticados. Cada RPC valida internamente vendedor o Administración, usa `search_path` vacío, niega acceso anónimo y evita escritura directa en las tablas.

La inspección visual del nuevo selector de planes en navegador real sigue siendo una puerta obligatoria de la candidata. Debe completarse en el preview antes de autorizar el cambio de `main` y la publicación del frontend.

## Reversión segura

Si el frontend presenta un problema después de publicar, revertir `index.html` y `sw.js` al commit estable. Las tablas nuevas son aditivas y deben conservarse para no perder solicitudes o auditoría ya generadas. No eliminarlas como mecanismo de rollback.
