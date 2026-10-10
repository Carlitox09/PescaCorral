# PescaCorral: PWA para reservas y permisos de pesca

PescaCorral es una **aplicación web progresiva (PWA)** para la gestión de reservas de lugares en catamaranes y permisos digitales de pesca deportiva en el **Dique Cabra Corral** (Coronel Moldes, Salta). Es el prototipo tecnológico del Trabajo Final de Grado de la Licenciatura en Informática (Universidad Siglo 21).

La aplicación permite que pescadores y turistas consulten la disponibilidad de catamaranes, reserven lugares, paguen (pasarela simulada) y obtengan un permiso municipal digital con código QR. Los dueños de embarcaciones también reservan y pescan como cualquier usuario y, además, administran su flota (catamaranes y lugares, ocupación de cada salida y ganancias y pérdidas), y el Municipio cuenta con un panel de indicadores, reportes, alertas de fauna y gestión de usuarios.

Pescadores, turistas y dueños de catamaranes ingresan **con su cuenta de Google** (la aplicación no recibe sus contraseñas). El personal municipal y el administrador del sistema tienen **accesos propios con usuario y contraseña**: `/Municipio` y `/Admin`.

**Aplicación publicada:** https://carlitox09.github.io/PescaCorral/

---

## Arquitectura (alineada con el TFG)

| Capa | Tecnología | Detalle |
| --- | --- | --- |
| Presentación | PWA en HTML5, CSS3 y JavaScript (ES Modules) | Instalable en el teléfono, service worker con caché de la interfaz, manifest. Publicada en GitHub Pages bajo HTTPS. |
| Lógica | Supabase | Auth con proveedor Google (OAuth 2.0 / OpenID Connect, flujo PKCE, sesiones JWT), API REST generada automáticamente (PostgREST), funciones de negocio en PL/pgSQL y políticas RLS por rol, Storage (fotos de los catamaranes) y una Edge Function (`enviar-push`) que manda los avisos al teléfono (Web Push). |
| Datos | PostgreSQL (gestionado por Supabase) | Esquema en `database/schema.sql`. |

No hay servidor propio ni proceso de compilación: el repositorio se sirve tal cual.

### Modos de ejecución

* **Modo Supabase** (por defecto, `config.js` con credenciales): datos reales, ingreso con Google y RLS.
* **Modo demo** (si `config.js` queda sin credenciales): datos de ejemplo en el navegador, sin backend. El ingreso con Google se simula con un selector de cuentas de ejemplo.

---

## Funcionalidades por historia de usuario

| HU | Funcionalidad | Dónde está |
| --- | --- | --- |
| HU-001 | Registro en el primer ingreso con Google: se crea la cuenta con los datos de Google y se solicitan DNI, teléfono y tipo de cuenta | `#/registro` |
| HU-002 | Inicio de sesión con Google para el público y con usuario y contraseña para el personal; mensaje de error si se cancela o las credenciales son incorrectas; redirección al ingreso sin sesión | `#/login`, `/Municipio`, `/Admin` |
| HU-003 | **Mi flota** del dueño (puede tener varios catamaranes): alta y edición de catamaranes (descripción, **fotos**, cantidad de lugares, precio, habilitación y estado; no se pueden quitar lugares con reservas desde hoy), **salidas** con la ocupación de cada fecha y turno sobre el plano, **aviso a los pasajeros** de una salida y **lista de embarque** (nombre y DNI de cada pasajero), y **finanzas**: ingresos por lugares vendidos, gastos por categoría y resultado del mes (ganancia o pérdida) por catamarán, con CSV. La administración asigna el dueño de cada catamarán | `#/gestion`, `#/embarque` |
| HU-004 | Disponibilidad por fecha y turno con **lugares libres por catamarán** (cada asiento se reserva por fecha y turno) | `#/catamaranes` |
| HU-005 | Reserva sobre el **plano del catamarán** visto desde arriba (proa, popa, babor y estribor; numeración en sentido horario desde la proa); marca los lugares propios y avisa si ya hay una reserva en el otro turno; sin doble reserva (índice único por asiento, fecha y turno). Un lugar por persona: se cargan los **datos y el permiso de cada pasajero** (nombre y DNI de cada acompañante); los datos no se pierden al cambiar de opción, de lugares o de turno, ni si falla el pago | `#/reserva/:id` |
| HU-006 | **Un permiso por pasajero**. **"Comprar permiso"**: se eligen **una o varias especies** (por ejemplo Dorado $ 2.000 + Pejerrey $ 2.000 + Dentudo $ 1.000) y se emite un permiso digital con QR, a nombre de esa persona, que vale para la fecha de la salida y cuesta la suma de las especies. **"Ya tengo permiso"**: se registra el número tal como se ingresa, sin validarlo en el sistema (se presenta al embarcar). Estado vigente / vencido / anulado; se comparte como imagen por WhatsApp u otras aplicaciones | `#/permiso/:id` |
| HU-007 | **Pasarela de pago simulada** (tarjeta, Mercado Pago o efectivo en la boletería) con escenario de rechazo. Al pagar se muestra el **comprobante**: número de reserva, comprobante de pago y permiso | `#/comprobante/:id` |
| HU-008 | Reportes con gráficos, exportación CSV (Excel) y PDF | `#/reportes` |
| HU-009 | **Envío de reportes al municipio** (manual y cierre mensual automático) con registro de fecha, destinatario y origen | `#/reportes` |
| HU-010 | Historial de reservas y permisos, **consultables sin conexión** con su comprobante y su código QR; el dueño consulta las reservas de sus catamaranes en Mi flota › Salidas, también sin conexión | `#/historial` |
| HU-011 | Centro de notificaciones y **recordatorios de salida** (día previo y día de la reserva), con preferencia del usuario; avisos del municipio y avisos del dueño sobre una salida (suspensión, zarpe). Los avisos también llegan **al teléfono aunque la aplicación esté cerrada** (Web Push), si el usuario los activa | campana / `#/perfil` |
| HU-012 | Gestión de roles y activación o desactivación de cuentas: el tipo de cuenta (pescador o dueño) lo cambian el municipio y la administración, también desde el teléfono, con búsqueda y filtros | `#/usuarios` |
| HU-013 | Panel municipal con **filtros por rango de fechas y embarcación** y exportación PDF | `#/admin` |
| HU-014 | Perfil de usuario | `#/perfil` |
| HU-015 | Monitoreo de fauna: permisos por especie y **alertas automáticas** cuando los permisos del mes alcanzan el 80 % del umbral. La administración carga las **especies, su precio en el permiso** y su umbral, y las habilita o no | `#/reportes`, `#/especies` |

---

## Estructura del proyecto

```text
PescaCorral/
├── .github/workflows/
│   └── mantener-activa.yml # Tarea diaria que consulta la base para que Supabase no la pause
├── index.html              # Punto de entrada
├── 404.html                # Redirige /municipio y /admin en cualquier combinación de mayúsculas
├── Municipio/index.html    # /Municipio: acceso del personal municipal (#/acceso/municipio)
├── Admin/index.html        # /Admin: acceso del administrador del sistema (#/acceso/admin)
├── manifest.webmanifest    # Configuración de la PWA
├── service-worker.js       # Caché offline del app shell y avisos al teléfono (push)
├── config.js               # Credenciales de Supabase (anon key), clave pública de los avisos y datos del municipio
├── css/styles.css
├── js/
│   ├── app.js              # Enrutador por hash, guardas de sesión, primer ingreso y rol
│   ├── data.js             # Capa de datos: Supabase / demo (misma API)
│   ├── views.js            # Pantallas
│   ├── ui.js               # Íconos, modales, toasts y formato
│   ├── charts.js           # Gráficos SVG
│   └── sw-registro.js      # Registro del service worker y aviso de versión nueva
├── vendor/
│   ├── qrcode.min.js       # Generador de QR offline
│   └── supabase.min.js     # Cliente de Supabase (supabase-js 2.117.3, copia local con versión fija)
├── icons/                  # Íconos de la PWA
├── img/demo/               # Fotos de ejemplo de los catamaranes del modo demo (ver "Fotos de ejemplo")
├── supabase/functions/
│   └── enviar-push/index.ts # Edge Function que manda cada aviso al teléfono (Web Push)
└── database/
    ├── schema.sql          # Esquema completo (tablas, funciones, vistas, RLS, pg_cron)
    ├── seed.sql            # Datos iniciales (especies, catamaranes y sus lugares)
    ├── verificar_base.sql  # Chequeo de sólo lectura: compara la base con schema.sql y revisa los datos
    └── pruebas_seguridad.sql     # Pruebas de acceso con cada perfil (no deja datos)
```

---

## Puesta en marcha

### Ejecución local

Servir la carpeta con cualquier servidor estático (los módulos ES y el service worker no funcionan con `file://`):

```bash
python -m http.server 8080
```

Abrir `http://localhost:8080`.

### Base de datos en Supabase

1. Crear un proyecto en https://supabase.com.
2. **SQL Editor → New query**: pegar y ejecutar `database/schema.sql` completo, y luego `database/seed.sql`. `schema.sql` crea la base desde cero y **borra los datos existentes**: no se usa sobre una base en producción.
3. Para comprobar que la base coincide con el esquema y que los datos están al día, ejecutar `database/verificar_base.sql` (no modifica nada): devuelve una fila por cada diferencia, o "OK".
4. Para probar la seguridad, ejecutar `database/pruebas_seguridad.sql`: crea cuentas y datos de prueba, intenta cada operación con la identidad de cada perfil (sin sesión, pescador, dueño, municipio, administrador y cuentas desactivadas), muestra el resultado de cada caso (OK / FALLA) y revierte todo.
5. Un cambio de esquema sobre una base en uso (sin borrar sus datos) se aplica con un script idempotente en `database/migrations/`, y después se corren los pasos 3 y 4. Los scripts ya aplicados se quitan del repositorio y quedan en su historial.
6. (Opcional) **Database → Extensions**: habilitar `pg_cron` para que el reporte mensual y los recordatorios diarios se generen sin intervención. Si no está habilitado, la app los genera al ingresar a Reportes y a la pantalla principal.

### Avisos en el teléfono (Web Push)

Los avisos del municipio, los del dueño sobre una salida ("Estamos por zarpar", "Salida suspendida") y los recordatorios llegan al teléfono aunque la aplicación esté cerrada. Cuando se crea una de esas notificaciones, el disparador `trg_notificacion_push` llama (con la extensión `pg_net`) a la Edge Function `enviar-push`, que la manda a los teléfonos que el usuario habilitó. Para configurarlo:

1. Generar un par de claves VAPID, por ejemplo con `npx web-push generate-vapid-keys`. La **pública** va en `VAPID_PUBLIC_KEY` de `config.js`; la **privada** nunca se publica ni se guarda en el repositorio.
2. En Supabase, **Edge Functions → Secrets**: cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_CONTACTO` (una dirección `mailto:` o `https:` de contacto para el servicio de push).
3. **Edge Functions → Deploy a new function**: nombre `enviar-push`, pegar el contenido de `supabase/functions/enviar-push/index.ts` y desplegar con **Verify JWT desactivado** (la llama la base de datos, sin sesión de usuario). Con la CLI: `supabase functions deploy enviar-push --no-verify-jwt`.
4. La extensión `pg_net` la crea `schema.sql`. La dirección de la función está en `enviar_push()`: en otro proyecto de Supabase hay que cambiarla.

Cada usuario los activa en **Perfil → Avisos en el teléfono → Activar** (también se ofrece después de reservar) y acepta el permiso de notificaciones del navegador. En iPhone (iOS 16.4 o posterior) primero hay que agregar la aplicación a la pantalla de inicio y abrirla desde ahí. Al cerrar sesión el teléfono deja de recibirlos.

### Instalar la aplicación

Al ingresar, a pescadores y dueños se les ofrece instalar PescaCorral en el teléfono y activar los avisos, si les falta alguna de las dos cosas: en Chrome, Edge o Samsung Internet con el botón **Instalar**; en iPhone, con las instrucciones de Safari (**Compartir → Agregar a inicio**). Se muestra una vez por sesión y, con **Ahora no**, deja de mostrarse por tres días. Desde **Perfil** también se puede instalar. Instalada, se abre desde su ícono, sin la barra del navegador.

### Ingreso con Google

Se configura una sola vez, en dos consolas.

**En Google Cloud** (https://console.cloud.google.com):

1. Crear un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth** (Google Auth Platform): tipo de usuario *Externo*, nombre de la aplicación, correo de asistencia y de contacto. Los permisos básicos (`openid`, `email`, `profile`) alcanzan.
3. En **Público**, publicar la aplicación (*En producción*) para que cualquier cuenta de Google pueda ingresar. Mientras esté *En prueba*, solo ingresan los usuarios de prueba agregados a mano.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   * Orígenes de JavaScript autorizados: `https://carlitox09.github.io` y `http://localhost:8080`.
   * URI de redireccionamiento autorizados: `https://<proyecto>.supabase.co/auth/v1/callback` (la *Project URL* de Supabase seguida de `/auth/v1/callback`).
5. Copiar el **ID de cliente** y el **secreto del cliente**.

**En Supabase**:

1. **Authentication → Sign In / Providers → Google**: habilitar y pegar el ID de cliente y el secreto.
2. **Authentication → URL Configuration**: *Site URL* `https://carlitox09.github.io/PescaCorral/`; en *Redirect URLs* agregar `https://carlitox09.github.io/PescaCorral/**` y `http://localhost:8080/**`.
3. **Authentication → Sign In / Providers → Email**: habilitar con *Confirm email* encendido, mínimo de 12 caracteres y contraseñas con minúsculas, mayúsculas, números y símbolos. Lo usa sólo el personal: el trigger `handle_new_user` rechaza cualquier alta con contraseña que no esté autorizada en `personal_autorizado`.

En el primer ingreso de cada persona, el trigger `handle_new_user` crea el perfil con el nombre, el correo y la foto de Google; la aplicación pide DNI, teléfono y tipo de cuenta antes de habilitar el resto de las pantallas.

### Acceso del personal (usuario y contraseña)

El personal municipal ingresa por `https://carlitox09.github.io/PescaCorral/Municipio` y el administrador del sistema por `.../Admin`. El usuario es un nombre corto (`municipio`, `admin`) que la aplicación traduce a `<usuario>@pescacorral.example.com`, un dominio reservado que no recibe correos (`DOMINIO_PERSONAL` en `config.js`). Cada acceso acepta sólo su rol: `/Municipio` → `admin_municipal`, `/Admin` → `admin_sistema`.

Alta de una cuenta (no hay registro abierto): el administrador del sistema la crea desde la aplicación, en **Personal** (`#/personal`): usuario, nombre, rol y contraseña (al menos 12 caracteres, con minúsculas, mayúsculas, números y símbolos). Desde ahí también cambia contraseñas y activa o desactiva cuentas del personal. Lo hace la función `crear_cuenta_personal`, que registra la autorización en `personal_autorizado` y crea la cuenta en Supabase Auth con la contraseña cifrada.

La primera cuenta del administrador (o cualquier otra, si se prefiere) se puede crear también desde Supabase:

1. En el SQL Editor (la autorización vence a los 15 minutos y se usa una sola vez):
   ```sql
   insert into public.personal_autorizado (usuario, email, rol, nombre, apellido)
   values ('municipio', 'municipio@pescacorral.example.com', 'admin_municipal', 'Nombre', 'Apellido');
   ```
2. **Authentication → Users → Add user → Create new user**: ese correo, la contraseña y *Auto Confirm User* tildado. El trigger crea el perfil con el rol autorizado.

Para el administrador del sistema se repite con `'admin'`, `'admin@pescacorral.example.com'` y `'admin_sistema'`.

### Roles administrativos

Toda cuenta nueva de Google es *Pescador/Turista* (o *Dueño de catamarán*, si lo elige en el alta). Los roles administrativos no pueden autoasignarse: el trigger `proteger_perfil` impide que un usuario cambie su rol, su correo o su estado. Desde la pantalla Usuarios, la administración sólo cambia el tipo de cuenta (pescador o dueño) y el estado de las cuentas del público. Las cuentas del personal reciben su rol al crearse (en Personal o desde `personal_autorizado`) y ese rol no cambia; sólo el administrador del sistema las da de alta, les cambia la contraseña y las activa o desactiva.

### Uso sin conexión

En el dique la señal es irregular. Para pescadores y dueños, al abrir la aplicación con conexión quedan guardados en el dispositivo el perfil, **todas las reservas y los permisos de la cuenta** (con su comprobante y su código QR, aunque nunca se hayan abierto), las notificaciones y lo último que se vio de los catamaranes. Sin internet la sesión se mantiene y esas pantallas muestran los datos guardados, con un aviso de su fecha; el permiso digital con su código QR se puede mostrar al embarcar. El dueño de un catamarán también consulta sin conexión su flota: las salidas de sus embarcaciones (fecha, turno, plano con los lugares vendidos y cada reserva, sin los datos personales, el pago ni el permiso del pasajero) y sus finanzas. Con señal débil, si la red no responde en unos segundos también se muestran los datos guardados. Reservar y pagar necesitan conexión. Al volver internet la aplicación se actualiza sola. Lo guardado se borra al cerrar sesión, y el personal no usa este modo.

La sesión de Google queda abierta en el dispositivo hasta que se cierra. Si se cerró, el ingreso propone continuar con la última cuenta usada ("Continuar como …"), sin pasar por el selector de cuentas de Google; "Usar otra cuenta" lo muestra.

### Perfil del dueño de catamarán

El dueño tiene todas las opciones del pescador (también reserva y saca su permiso para salir a pescar) y, además, **Mi flota** (`#/gestion`), con tres pestañas:

* **Catamaranes**: puede tener varios. Alta con nombre, descripción, hasta 6 fotos (la primera es la portada; se reducen en el teléfono antes de subirse a Supabase Storage y los pescadores las ven en la lista y al reservar), cantidad de lugares, precio por lugar, habilitación municipal y estado. La cantidad de lugares se puede cambiar después: al sumar se crean los lugares nuevos y al quitar no se permite sacar lugares con reservas desde hoy (los que tuvieron reservas quedan fuera de servicio y conservan el historial). El plano se recalcula. Lo hacen las funciones `crear_catamaran` y `cambiar_capacidad`.
* **Salidas**: cada fecha y turno con reservas en sus catamaranes, con los lugares vendidos sobre el plano, la cantidad de reservas y el importe. Desde cada salida:
  * **Avisar a los pasajeros** (`avisar_pasajeros`): un aviso con plantillas ("Estamos por zarpar", "Salida suspendida", "Salida demorada" u otro) que llega a la campanita de todos los que reservaron (y a su teléfono, si activaron los avisos), sin que el dueño vea quiénes son. Hasta 10 por salida, de hoy en adelante.
  * **Lista de embarque** (`#/embarque`, `lista_embarque`): un renglón por lugar, con el nombre, el DNI, el permiso (el digital o el número del propio, para verificarlo al embarcar) y el número de reserva de cada pasajero (el titular y los acompañantes que se cargan al reservar), para imprimir o guardar en PDF y descargar en CSV (por ejemplo, para Prefectura). En las reservas hechas antes de registrar acompañantes, los lugares de más figuran sin nombre para anotarlos al embarcar.
  * El correo, el teléfono, el pago y el permiso de los pasajeros no se le muestran.
* **Finanzas**: resultado del mes (ganancia o pérdida), ingresos por lugares vendidos (el permiso de pesca es del Municipio y no se suma), gastos por categoría (combustible, mantenimiento, sueldos, seguros, amarre, impuestos y otros), comparación de los últimos 6 meses, detalle por catamarán y descarga en CSV. Los gastos se registran, corrigen y eliminan desde la misma pantalla y son privados de cada dueño (tabla `gasto`).

La pantalla principal del dueño suma un resumen de su flota: lugares vendidos hoy, ingresos y resultado del mes y las próximas salidas.

La administración (municipio y administrador del sistema) asigna el dueño de cada catamarán en **Catamaranes** (`asignar_propietario`): así los catamaranes cargados por el municipio pasan a su dueño, y un dueño puede tener varios. Al cambiar de dueño, los gastos del anterior en ese catamarán quedan como gastos generales suyos.

### Especies y precios

La administración (municipio y administrador del sistema) carga en **Especies** (`#/especies`) cada especie con su nombre científico, su **precio en el permiso de pesca** y el umbral de permisos por mes que dispara la alerta de fauna. Al reservar, cada pasajero elige las especies de su permiso, que cuesta la suma de sus precios. Un cambio de precio rige para los permisos que se emiten desde ese momento: los emitidos conservan el precio pagado (`permiso_especie.precio`). Una especie no habilitada deja de ofrecerse; no se borra porque tiene permisos emitidos.

### Avisos a los usuarios

La administración (municipio y administrador del sistema) publica avisos en **Avisos** (`#/avisos`): título, mensaje y destinatarios (todos los usuarios, pescadores y turistas, dueños de catamarán o una persona). Cada aviso llega como notificación a la campanita de los destinatarios con cuenta activa (y a su teléfono, si activaron los avisos) y queda registrado en la tabla `aviso` (fecha, autor y cantidad de destinatarios). Lo hace la función `publicar_aviso`.

### Credenciales

`config.js` contiene la *Project URL* y la clave **anon public** (segura para el frontend: la protección real la dan las políticas RLS). Nunca publicar la clave `service_role` ni el secreto del cliente de Google.

---

## Seguridad implementada

* **Público con Google**: la identidad de pescadores, turistas y dueños la verifica Google (OAuth 2.0 / OpenID Connect). Contraseña, verificación en dos pasos, detección de accesos sospechosos y recuperación de la cuenta quedan a cargo de Google.
* **Personal con usuario y contraseña**: cuentas creadas sólo por la administración (`personal_autorizado` + trigger), contraseñas de al menos 12 caracteres guardadas cifradas por Supabase Auth, límite de intentos de Supabase y mensaje genérico ante credenciales incorrectas. Cada acceso admite sólo su rol.
* **Sesiones JWT** emitidas por Supabase Auth, con renovación automática. El flujo PKCE devuelve un código de un solo uso (`?code=`) que la aplicación intercambia por la sesión.
* **Primer ingreso controlado**: sin DNI y tipo de cuenta confirmados, el enrutador solo permite la pantalla de alta.
* **Protección del perfil** (trigger `proteger_perfil`): un usuario no puede cambiar su rol, su correo ni el estado de su cuenta; el tipo de cuenta se elige una sola vez. Los roles administrativos se fijan al dar de alta la cuenta del personal, y sólo el administrador del sistema da de alta, cambia contraseñas y activa o desactiva esas cuentas.
* **Cuentas desactivadas**: la administración puede desactivar una cuenta desde `#/usuarios`. Con `activo = false` la base le quita todos los permisos (también los de administración), cierra sus sesiones y la aplicación rechaza el ingreso.
* **RLS**: cada perfil (pescador, dueño, administración municipal, administrador del sistema) solo puede leer y modificar los registros que le corresponden, aun consultando la API directamente.
* **Escrituras sólo por funciones**: reservas, lugares, permisos y pagos se crean y anulan únicamente con `crear_reserva_completa` y `anular_reserva`, que validan fecha, catamarán, lugares libres, pago y permiso. Los catamaranes se dan de alta con `crear_catamaran` y su cantidad de lugares cambia sólo con `cambiar_capacidad`.
* **Gastos privados**: cada dueño ve y modifica sólo sus gastos, y sólo de sus propios catamaranes; ni otros usuarios ni la administración los leen.
* **Datos de los pasajeros**: el dueño sólo ve el nombre, el DNI y el número de permiso de los pasajeros de sus salidas (titulares y acompañantes), en la lista de embarque; los avisos a los pasajeros se envían sin revelar quiénes son. Los pasajeros se validan en `crear_reserva_completa` (uno por lugar, DNI de 7 u 8 dígitos sin repetir).
* **Permisos y precios**: el importe de cada permiso lo calcula la base con el precio vigente de las especies elegidas (habilitadas); el cliente no puede fijarlo. Sólo la administración da de alta especies y cambia sus precios, y no puede borrarlas. Un permiso propio se registra tal como lo declara el pasajero, sin validarlo: se verifica al embarcar con la lista de embarque.
* **Avisos al teléfono**: cada usuario registra y borra sólo sus propios teléfonos (`registrar_push`, `borrar_push`; hasta 10 por cuenta); la tabla `suscripcion_push` no admite escrituras directas. La función `enviar-push` sólo manda notificaciones creadas por la base en los últimos 10 minutos y que todavía no se enviaron, así que no sirve para mandar mensajes propios ni repetirlos. La clave privada VAPID vive sólo en los secretos de Supabase.
* **Fotos**: el depósito `catamaranes` de Supabase Storage es público para mirar; subir, reemplazar y borrar fotos sólo puede el dueño de cada catamarán y la administración (`es_foto_propia`), hasta 2 MB por foto y sólo imágenes.
* **Privilegios mínimos**: sin sesión no se accede a ninguna tabla, vista ni función; con sesión sólo se ejecutan las funciones que usa la aplicación.
* **Frontend**: política de seguridad de contenido (CSP) que sólo admite código propio, conexiones a Supabase e imágenes propias, de Google (foto de la cuenta) y de Supabase Storage (fotos de los catamaranes); el cliente de Supabase es una copia local con versión fija; todo dato se muestra escapado; los mensajes de error no se toman de la dirección.
* **Sesiones del personal**: se cierran solas después de 30 minutos sin actividad, para que no queden abiertas en una computadora compartida.
* **Pruebas**: `database/pruebas_seguridad.sql` verifica estos controles con 158 casos.

## Accesibilidad

Todas las pantallas se revisaron con axe-core (criterios WCAG 2.1 A y AA y buenas prácticas) sin incumplimientos: campos con etiqueta, botones y selectores con nombre accesible, diálogos con título, gráficos con una descripción de sus datos, una región principal y un título de nivel 1 por pantalla, y jerarquía de títulos ordenada.

---

## Datos de prueba

### Cuentas del modo demo

En modo demo, **Continuar con Google** abre un selector con las cuentas del público. *Usar otra cuenta* simula el primer ingreso de una persona nueva. El personal entra por su acceso con usuario y contraseña.

| Cuenta | Rol | Ingreso |
| --- | --- | --- |
| pescador@demo.com | Pescador / Turista | Google (simulado) |
| dueno@demo.com | Dueño de catamarán | Google (simulado) |
| `municipio` / `Municipio.2026` | Administración municipal | `/Municipio` |
| `admin` / `Admin.2026` | Administrador del sistema | `/Admin` |

Desde **Perfil → Reiniciar datos de demo** se restauran los datos iniciales.

### Fotos de ejemplo

Las fotos de los catamaranes del modo demo (`img/demo/`) son recortes de [“CATAMARANES - CAMPING CONEA - CABRA CORRAL”](https://commons.wikimedia.org/wiki/File:CATAMARANES_-_CAMPING_CONEA_-_CABRA_CORRAL_-_panoramio.jpg), de José Luis Fernández (Wikimedia Commons), con licencia [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/deed.es). Se recortaron, se redujeron y se difuminó el nombre de la embarcación. La aplicación muestra el crédito debajo de las fotos. En el modo Supabase las fotos las suben los dueños y la administración.

### Pasarela de pago simulada

| Escenario | Dato |
| --- | --- |
| Pago aprobado | `4111 1111 1111 1111`, cualquier titular, vencimiento futuro (MM/AA), CVV de 3 dígitos |
| Pago rechazado por la entidad | cualquier número terminado en `0000` |
| Mercado Pago | el correo de la cuenta; se aprueba al confirmar |
| Efectivo | se registra como cobrado en la boletería al confirmar |

Un pago rechazado no crea la reserva ni emite el permiso, y permite reintentar.

---

## Despliegue en GitHub Pages

Subir el contenido de la carpeta a la raíz del repositorio y, en **Settings → Pages**, elegir *Deploy from a branch* → rama `main`, carpeta `/ (root)`. El proyecto usa rutas relativas, por lo que funciona dentro de un subdirectorio. Bajo HTTPS puede instalarse como PWA desde el teléfono (*Agregar a pantalla de inicio*).

Tras cada cambio en `service-worker.js` se incrementa la constante `VERSION` para que los navegadores renueven la caché.

### Base de datos siempre activa

El plan gratuito de Supabase pausa el proyecto después de siete días sin uso. La tarea `.github/workflows/mantener-activa.yml` (GitHub Actions) consulta la base todos los días a las 9:00 con la clave pública: la base responde "permission denied" sin entregar datos, lo que confirma que está en línea y cuenta como actividad. Si no responde, la tarea falla y GitHub avisa por correo. Se puede ejecutar a mano desde la pestaña **Actions** (*Mantener activa la base de datos → Run workflow*). GitHub desactiva las tareas programadas de un repositorio público tras 60 días sin cambios: en ese caso se reactivan desde la misma pestaña.

---

## Modelo de datos

Definido en `database/schema.sql`:

* **usuario** (extiende `auth.users`; rol, perfil completo, foto de Google), **especie** (con su precio en el permiso y si está habilitada), **catamaran** (con sus fotos en Supabase Storage), **lugar** (con su ubicación en el plano), **reserva** (número `RES-` e importe de los permisos), **reserva_lugar** (asiento por fecha y turno, con el nombre y el DNI del acompañante que lo ocupa y su permiso: el digital o el número del propio), **permiso** (uno por pasajero: a nombre de quien lo usa, con su importe; vale para la fecha de la salida), **permiso_especie** (especies de cada permiso, con su precio al emitirse), **pago** (con código de autorización), **reporte** (con destinatario, origen y estado de envío), **notificacion** (con `id_reserva` para recordatorios y la marca de envío al teléfono), **alerta_fauna**, **gasto** (gastos del dueño por catamarán o generales de la flota), **suscripcion_push** (teléfonos habilitados para recibir avisos).
* Funciones: `crear_reserva_completa` (valida catamarán, asientos, fecha, turno, medio de pago, los pasajeros y el permiso de cada uno, y crea reserva + asientos + permisos + pago + notificación en una transacción), `ubicacion_lugar`, `actualizar_estados` (marca permisos vencidos y salidas realizadas; la llama `generar_recordatorios` a diario), `anular_reserva` (anula los permisos emitidos con la reserva, salvo el que otra reserva activa declaró como propio), `crear_catamaran` (alta con todos sus lugares), `cambiar_capacidad` (suma o quita lugares sin afectar reservas desde hoy), `asignar_propietario`, `avisar_pasajeros`, `lista_embarque`, `es_foto_propia` (fotos en Storage), `registrar_push` y `borrar_push` (teléfonos para los avisos), `generar_reporte_municipal` (el automático resume el mes que cerró), `generar_recordatorios`, `handle_new_user` (alta del perfil con los datos de Google) y `proteger_perfil` (protección de rol, correo y estado).
* Disparador `trg_notificacion_push` (`enviar_push`): manda al teléfono los avisos, los avisos de una salida y los recordatorios, por medio de la Edge Function `enviar-push`.
* Disparador `trg_permiso_especie_alerta` (`actualizar_alerta_fauna`): por cada especie de un permiso emitido, si los permisos del mes de esa especie alcanzan el 80 % del umbral, registra la alerta y avisa a la administración municipal.
* Vistas: `v_dashboard_resumen`, `v_reservas_por_dia`, `v_ocupacion_catamaran`, `v_permisos_por_especie`, `v_lugares_ocupados`.

---

## Problemas frecuentes

* **Pantalla en blanco**: la app debe servirse por `http://` o `https://`, no abrirse con doble clic.
* **Sigue en modo demo**: revisar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js` y recargar con `Ctrl + Shift + R`.
* **"El ingreso con Google todavía no está habilitado"**: falta habilitar el proveedor Google en Supabase.
* **Google muestra "Error 400: redirect_uri_mismatch"**: el URI de redireccionamiento del cliente de OAuth debe ser exactamente `https://<proyecto>.supabase.co/auth/v1/callback`.
* **Después de elegir la cuenta vuelve a otra dirección**: agregar la dirección de la app en *Authentication → URL Configuration → Redirect URLs*.
* **Solo pueden ingresar algunas cuentas**: la pantalla de consentimiento de Google sigue *En prueba*; publicarla.
* **Una pantalla falla con "function … does not exist" o "column … does not exist"**: la base no está al día con `schema.sql`; `verificar_base.sql` muestra qué falta.
* **Los avisos no llegan al teléfono**: revisar en Perfil que diga "Activados en este teléfono"; que la función `enviar-push` esté desplegada con *Verify JWT* desactivado y con sus tres secretos; y su registro en *Edge Functions → Logs*. En iPhone la aplicación tiene que estar instalada en la pantalla de inicio; en Android, el ahorro de batería puede demorarlos.
* **Las fotos no se ven**: revisar que exista el depósito `catamaranes` (público) en *Storage* y que `index.html` admita imágenes de `https://*.supabase.co` en la política de seguridad de contenido.
* **Una cuenta registrada como dueño ve sólo las opciones del pescador**: quedó guardada como *Pescador/Turista*; la administración la cambia a *Dueño de catamarán* en Usuarios.
* **El proyecto de Supabase no responde**: en el plan gratuito se pausa tras siete días sin actividad (la tarea diaria lo evita); reactivarlo desde el panel y revisar en **Actions** que la tarea siga habilitada.

---

## Autoría

Carlos Agustín Romero · Licenciatura en Informática · Universidad Siglo 21. Lugar de aplicación: Dique Cabra Corral, Municipio de Coronel Moldes, Salta.
