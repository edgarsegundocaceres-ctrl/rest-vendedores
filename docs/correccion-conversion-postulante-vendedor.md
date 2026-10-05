# APP INTEGRAL REST — Corrección Postulante → Vendedor

Fecha: 4 de octubre de 2026  
Rama: `fix/postulante-vendedor-conversion`  
Base: `origin/main` (`77d0eef`)  
Repositorio: `edgarsegundocaceres-ctrl/rest-vendedores`

## Alcance

Corrección puntual del circuito de captación de vendedores de **APP INTEGRAL REST**. No incluye cambios de catálogo, precios, financiación, clientes, ventas, cobranzas ni otros módulos. **APP INTEGRAL REST Motos no fue consultada ni modificada.**

## Diagnóstico confirmado

El botón **APROBAR** ejecutaba únicamente:

```text
actualizar_postulante_vendedor(..., "aprobado", ...)
```

La RPC cambiaba el estado de la postulación, pero no insertaba ni vinculaba una fila en `vendedores`. La creación real quedaba para un segundo botón, **CREAR ACCESO Y VINCULAR**. Por eso el listado de vendedores —cuya consulta sí era correcta— no tenía ningún registro que mostrar.

El caso ya aprobado quedó exactamente en ese estado intermedio:

- postulación: `APROBADO`;
- `vendedor_id`: vacío;
- usuario Auth: inexistente;
- perfil/rol: inexistente;
- vendedor: inexistente.

Los registros de actividad de la API confirmaron que, al aprobar, se invocó `actualizar_postulante_vendedor`, pero no la función `crear-vendedor` ni `vincular_postulante_vendedor`.

## Comportamiento corregido

### Aprobar

La nueva RPC `aprobar_postulante_vendedor`:

1. bloquea la postulación durante la operación;
2. acepta `PENDIENTE`, `CONTACTADO` o un reintento en `APROBADO`;
3. reutiliza la tabla existente `vendedores`;
4. busca coincidencias fuertes por DNI o por email de un usuario Auth ya vinculado;
5. no vincula automáticamente por teléfono solamente;
6. crea, cuando corresponde, un vendedor provisional con `activo = false` y `user_id = null`;
7. vincula `postulantes_vendedores.vendedor_id`;
8. conserva la postulación y su historial;
9. devuelve el mismo vendedor ante un segundo clic, sin duplicarlo.

El registro aparece inmediatamente en **Administración → Vendedores** con la etiqueta **Pendiente de acceso**.

### Configurar acceso

La Edge Function versionada `crear-vendedor` conserva el alta manual histórica. Cuando recibe `postulante_id`:

1. comprueba que quien llama sea Administración;
2. comprueba que la postulación esté aprobada y tenga vendedor provisional;
3. crea el usuario mediante Supabase Auth;
4. ejecuta `activar_postulante_vendedor`;
5. la RPC crea/actualiza el perfil con rol `vendedor`, completa el mismo registro de `vendedores` y cambia la postulación a `ACTIVO` o `SUSPENDIDO` dentro de una sola transacción;
6. si la transacción falla, elimina el usuario Auth recién creado para evitar un alta parcial.

No existe una columna de contraseña y la contraseña no se registra en logs ni tablas.

### Vendedor ya existente

`vincular_postulante_vendedor` ahora:

- exige un usuario real con perfil de rol `vendedor`;
- activa perfil y vendedor juntos;
- conserva el vendedor ya preparado y no lo reemplaza silenciosamente;
- admite reintentos sin crear duplicados.

## Archivos

- `captacion-vendedores.js`
- `index.html`
- `sw.js`
- `supabase/migrations/20261004145535_fix_postulante_vendedor_conversion.sql`
- `supabase/functions/crear-vendedor/index.ts`
- `tests/recruitment-budget.test.js`

## Pruebas realizadas sin persistencia

- 17 pruebas automáticas de JavaScript y contratos de seguridad: correctas.
- Sintaxis de `captacion-vendedores.js` e scripts embebidos: correcta.
- Migración completa ejecutada dentro de `BEGIN … ROLLBACK`: correcta.
- Postulación ficticia → aprobación → vendedor provisional: correcta.
- Segunda aprobación: devolvió el mismo `vendedor_id` y no duplicó el historial.
- Reutilización de un vendedor real con Auth/rol dentro de rollback: correcta.
- Vínculo y activación idempotentes dentro de rollback: correctos.
- Caso aprobado preexistente: la reparación fue ensayada en rollback y produjo un vendedor pendiente, vínculo e historial de reparación sin duplicar.
- Verificación posterior: funciones de prueba y datos ficticios no quedaron persistidos.
- `git diff --check`: correcto.
- Preview separado desplegado desde la rama correctiva: correcto.
- Página pública de captación verificada en navegador: carga completa y formulario disponible en modo demostración.
- Administración verificada en navegador: al aprobar, conserva la ficha original, muestra `APROBADO`, crea el bloque **Vendedor vinculado**, etiqueta al vendedor como **Pendiente de acceso** y ofrece **CREAR ACCESO SEGURO**.
- No se registraron errores propios de la aplicación en la consola del preview.

Preview separado (protegido por Vercel):

```text
https://rest-vendedores-6qug5smyn-edgarsegundocaceres-1114.vercel.app/?demo=admin-captacion
```

El enlace compartido temporal se entrega fuera del repositorio. La rama remota es `fix/postulante-vendedor-conversion`.

## Estado de publicación

Esta rama no modifica `main`. La migración correctiva y la nueva versión de la Edge Function todavía no se aplicaron al proyecto activo porque requieren autorización expresa. Por esa razón, el caso aprobado existente sigue intacto en producción; la reparación ya fue validada con rollback y queda lista para ejecutarse de forma idempotente después de instalar la migración.

Para completar la prueba punta a punta real hacen falta, en este orden:

1. aplicar la migración al proyecto REST autorizado;
2. desplegar `crear-vendedor` con verificación JWT;
3. ejecutar la reparación idempotente del caso aprobado;
4. configurar un acceso ficticio, iniciar sesión como vendedor y comprobar Portal, permisos y atribución de presupuesto;
5. eliminar el usuario/datos ficticios de esa prueba si se utiliza la base activa;
6. detenerse antes de cualquier merge a `main` o producción.
