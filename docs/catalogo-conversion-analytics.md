# Catálogo REST: conversión y analítica

## Auditoría y alcance
Base: main a75ac4cac44d48dc9d17350f00436089b8dfefbc. Repositorio rest-vendedores, Supabase gajlmcqaylezudttoaju. Se reutilizan catálogo público, token por vendedor, productos, precios y opciones calculados por las RPC vigentes, solicitudes_venta, snapshots, historial, aprobación y conversión. No se cambian funciones comerciales históricas ni finanzas. Producción se consultó en modo lectura; las migraciones históricas constan aplicadas.

DNI y domicilio se conservan: son obligatorios en la RPC pública y forman parte de la identificación de cliente y conversión administrativa vigente. Quitarlos requiere decidir cómo completar esos datos antes de convertir; no se relaja silenciosamente el contrato. Observaciones sigue opcional. Se mantienen autocompletado y teclados adecuados.

## UX
CTA: ME INTERESA. Guía breve plegable, categorías/subcategorías reales, búsqueda sin distinción de acentos, render inicial de 36 productos y botón para cargar otros 36. Precios y financiación intactos.

Antes de enviar: «Enviar una solicitud NO confirma una compra. No genera deuda ni obligación de pago. Solo nos permite saber qué producto y opción te interesan para contactarte. La financiación está sujeta a evaluación.»

Confirmación: solicitud recibida, contacto por WhatsApp, compra aún no confirmada.

## Modelo y definiciones
Una migración nueva: 20261013032509_catalogo_conversion_analytics.sql. PENDIENTE; no aplicada a producción.

- private.catalogo_analitica_sesiones: una visita por sesión y vendedor, UUID anónimo del navegador, inicio y última actividad comercial. Inactividad 30 minutos; máximo 24 horas. Sin heartbeats, scroll ni mousemove. Reiniciar almacenamiento cambia el visitante aproximado; no equivale a persona única.
- private.catalogo_analitica_eventos: PRODUCTO_VISTA al abrir detalle; INTERES_CLICK al pulsar CTA; SOLICITUD_INICIADA al primer cambio del formulario. Una ocurrencia por sesión/producto/tipo. No nombres, DNI, teléfonos, emails, IP ni user agent.
- CATALOGO_VISITA se representa por la sesión; no contador adicional.
- SOLICITUD_ENVIADA, aprobaciones y SOLICITUD_CONVERTIDA se derivan de solicitudes_venta. Una venta requiere estado convertida_en_venta y venta_id; la RPC de tracking no admite esos eventos.
- Vendedor resuelto en servidor por token y perfil activo; categoría resuelta desde el producto real. No se recibe vendedor_id ni categoría del visitante.

## Métricas y límites de interpretación
Fechas Argentina. Tráfico/eventos por fecha; solicitudes creadas dentro del período, con su aprobación/conversión actual (cohorte de solicitudes). Conversión solicitud → venta es ventas/solicitudes de esa cohorte.

Los cocientes interés/visita, solicitud/interés y venta/visita comparan volúmenes; NO son tasas individuales. Una sesión puede interesarse en varios productos, puede fallar tracking y hay solicitudes previas a instalarlo. Pueden superar 100%. La interfaz lo explica. No se vincula el UUID anónimo a los datos personales de la solicitud. Una futura atribución individual requeriría una decisión de privacidad y un contrato de correlación adicional.

## Seguridad y rendimiento
Tablas en esquema privado, RLS activada, sin permisos directos para anon/authenticated. registrar_evento_catalogo permite solo eventos de navegación definidos. analitica_catalogo exige auth.uid y es_admin internamente, además de revocar anon/PUBLIC. search_path vacío y referencias calificadas. No modifica registros comerciales.

Límite por vendedor: 120 sesiones nuevas/minuto, 600 eventos nuevos/minuto; por sesión 30 eventos nuevos/minuto. Se serializa por vendedor mediante advisory lock transaccional. Una identidad no abre otra sesión del mismo vendedor antes de 30 minutos. Claves únicas deduplican F5 y concurrencia. Límites protegen escrituras, no garantizan detectar bots: un cliente controlado puede fabricar UUID y consumir el límite compartido. No hay fingerprinting. Índices por fechas, visitante y FK/clave única. Período administrativo máximo 367 días.

Tracking asíncrono, errores absorbidos, sin bloquear render ni envío. Almacenamiento local con fallback en memoria. Si falta crypto se omite tracking. No identifica personas. Sin eliminación automática de históricos en esta fase; antes de crecer, definir retención y observar volumen real.

## Preview
/?demo=catalogo-publico reutiliza el catálogo demo existente y no llama Supabase.
/catalogo-analytics-preview.html muestra las interacciones TEST realizadas en ese navegador; usa eventos locales acotados a 2000 registros. Aprobaciones y ventas no se simulan visualmente: su derivación está probada con PostgreSQL local y las RPC existentes. Los datos TEST nunca se presentan como métricas productivas.

## Pruebas reproducibles
NODE_MODULES debe apuntar a una instalación local de @electric-sql/pglite y jsdom.

- node --test tests/*.test.js
- PGLITE_MODULE_DIR=$NODE_MODULES node tests/catalogo-analytics-db.cjs
- PGLITE_MODULE_DIR=$NODE_MODULES node tests/migration-smoke.cjs
- JSDOM_MODULE_DIR=$NODE_MODULES node tests/ui-dom-smoke.cjs
- PGLITE_MODULE_DIR=$NODE_MODULES node tests/finance-engine-smoke.cjs

La prueba nueva ejecuta la migración sobre todas las estructuras existentes, roles anon/authenticated, sesión ADMIN/vendedor, dedup, token inválido, atribución, expiración, rankings y solicitud→aprobación→venta con conversión repetida. Las pruebas JS ejecutan dedup, F5, fallo de red/almacenamiento, expiración y aislamiento demo. Regresión financiera: 79 controles en PostgreSQL embebido; no se pretende afirmar concurrencia nativa nueva a partir de PGlite.

## Entrega
Solo rama + PR + preview. Sin merge, migración productiva ni deployment productivo. Sin cambios de precios, Fase 2, G-CRED, comisiones ni REST Motos. Validación posterior en Supabase y dispositivos/WebViews reales pendiente antes de autorizar publicación.
