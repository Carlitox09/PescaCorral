# 🎣 PescaCorral — PWA de reservas y permisos de pesca

Aplicación web progresiva (**PWA**) para digitalizar la pesca deportiva en el **Dique Cabra Corral** (Coronel Moldes, Salta). Permite a los pescadores reservar lugares en catamaranes habilitados, pagar y obtener un **permiso municipal digital con código QR**; a los dueños de embarcaciones gestionar sus catamaranes; y al **Municipio** monitorear la actividad y la presión sobre la fauna desde un panel de control.

Este repositorio es la implementación del TFG e incluye **dos piezas**:

1. Una **PWA** en HTML/CSS/JavaScript *vanilla* (sin framework ni paso de compilación), lista para **GitHub Pages**.
2. La **base de datos relacional completa** (PostgreSQL / Supabase) en `database/`.

La app arranca en **modo demo** (datos de ejemplo en el navegador) y, al cargar credenciales de Supabase, pasa a usar la **base de datos real** con autenticación y seguridad por filas (RLS).

---

## ✨ Funcionalidades

- **Pescador / Turista:** registro con validación de contraseña segura, exploración de catamaranes por fecha y turno, selección visual de asientos, pago simulado, permiso digital con QR, historial de reservas y permisos, notificaciones.
- **Dueño de catamarán:** alta y edición de embarcaciones (estado, precio, capacidad, habilitación).
- **Administración municipal:** panel con indicadores (reservas, permisos, ingresos), gráficos de reservas por día y permisos por especie, ocupación por catamarán, gestión de usuarios y roles, reportes exportables (PDF/CSV) y **monitoreo de fauna** con alertas por umbral de permisos.
- **PWA:** instalable en el celular, funciona offline (service worker), íconos y splash propios.

---

## 📁 Estructura del proyecto

```
pescacorral/
├── index.html              # Punto de entrada (carga config, QR y la app)
├── manifest.webmanifest    # Metadatos PWA (instalación)
├── service-worker.js       # Caché offline (precache + estrategias)
├── config.js               # ← Acá pegás las credenciales de Supabase
├── css/
│   └── styles.css          # Sistema de diseño (paleta del TFG)
├── js/
│   ├── app.js              # Enrutador por hash + arranque
│   ├── data.js             # Capa de datos (demo localStorage / Supabase)
│   ├── views.js            # Render de todas las pantallas
│   ├── ui.js               # Helpers, íconos SVG, toasts, modales, formato
│   └── charts.js           # Gráficos SVG (barras y dona)
├── vendor/
│   └── qrcode.min.js       # Generador de QR offline (MIT)
├── icons/                  # Íconos PWA (192/512/maskable/favicons)
└── database/
    ├── schema.sql          # Esquema relacional + funciones + vistas + RLS
    └── seed.sql            # Datos iniciales (especies y catamaranes)
```

---

## 🚀 Puesta en marcha rápida (modo demo)

No necesitás backend para probarla.

**Opción A — Servidor local** (recomendado, el service worker requiere `http://`):

```bash
# Python 3
cd pescacorral
python3 -m http.server 8080
# Abrí http://localhost:8080
```

> ⚠️ Abrir `index.html` con doble clic (`file://`) puede bloquear los módulos JS y el service worker. Usá siempre un servidor local o GitHub Pages.

**Opción B — GitHub Pages** (ver más abajo).

Iniciá sesión con cualquiera de las **cuentas demo** (contraseña `Demo1234!`):

| Cuenta                 | Rol                       |
|------------------------|---------------------------|
| `pescador@demo.com`    | Pescador / Turista        |
| `dueno@demo.com`       | Dueño de catamarán        |
| `municipio@demo.com`   | Administración municipal  |
| `admin@demo.com`       | Administrador del sistema |

En **Perfil → Reiniciar datos de demo** se restauran los datos de ejemplo.

---

## 🌐 Desplegar en GitHub Pages

1. Creá un repositorio en GitHub (por ejemplo `pescacorral`) y subí **el contenido de esta carpeta** a la raíz.

   ```bash
   cd pescacorral
   git init
   git add .
   git commit -m "PescaCorral PWA"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/pescacorral.git
   git push -u origin main
   ```

2. En GitHub: **Settings → Pages**.
3. En *Build and deployment* → *Source*, elegí **Deploy from a branch**.
4. Branch: **main**, carpeta **/ (root)**. Guardá.
5. Esperá ~1 minuto. Tu app quedará en:
   `https://TU_USUARIO.github.io/pescacorral/`

> Las rutas del proyecto son **relativas** (`./js/...`), así que funciona perfecto aunque GitHub Pages la publique en un subdirectorio. No hace falta configurar nada más.

Para una **PWA instalable**, GitHub Pages ya sirve por HTTPS: al abrirla en el celular vas a poder “Agregar a pantalla de inicio”.

---

## 🗄️ Conectar la base de datos real (Supabase)

Con esto la app deja el modo demo y guarda todo en **PostgreSQL** con login real.

### 1. Crear el proyecto
1. Entrá a [supabase.com](https://supabase.com) → **New project**.
2. Elegí nombre, contraseña de base y región (la más cercana).

### 2. Crear las tablas
1. En el panel de Supabase: **SQL Editor → New query**.
2. Pegá **todo** el contenido de `database/schema.sql` y ejecutá (**Run**).
3. Nueva query: pegá `database/seed.sql` y ejecutá. Esto carga las **especies** y los **catamaranes** de ejemplo con sus asientos.

> El esquema crea las tablas, las **funciones** (incluida `crear_reserva_completa`, que arma reserva + asientos + pago + permiso en una sola operación atómica), las **vistas** del dashboard y las **políticas RLS** que aíslan los datos por rol. Un *trigger* sobre `auth.users` crea automáticamente el perfil en la tabla `usuario` cuando alguien se registra.

### 3. Ajustar la autenticación
Para que el alta de usuarios sea inmediata en la demostración:

- **Authentication → Providers → Email**: dejá habilitado *Email*.
- **Authentication → Sign In / Providers** (o *Settings*): **desactivá** “Confirm email” si querés que el registro inicie sesión al toque (sin verificar el correo). En producción se recomienda dejarlo activo.

### 4. Pegar las credenciales
1. En Supabase: **Project Settings → API**.
2. Copiá **Project URL** y la clave **anon public**.
3. Abrí `config.js` y completá:

   ```js
   window.PESCACORRAL_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...",   // clave anon public
     MUNICIPIO: "Municipio de Coronel Moldes",
     LUGAR: "Dique Cabra Corral",
   };
   ```

4. Volvé a subir el cambio a GitHub (`git commit` + `git push`). Listo: la app ahora usa Supabase.

> 🔐 **¿Es seguro publicar la clave `anon`?** Sí. Es una clave pública pensada para el front-end: lo que protege los datos son las **políticas RLS** definidas en `schema.sql`. **Nunca** pegues acá la clave `service_role`.

### 5. Crear un administrador
Los usuarios nuevos se registran siempre como `pescador` o `dueno`: **los roles administrativos no se pueden auto-asignar** desde el registro (aunque alguien manipule la llamada a la API, el trigger lo fuerza a `pescador`). Para tener un admin municipal, registrate desde la app y luego, en **SQL Editor**, ejecutá:

```sql
update public.usuario set rol = 'admin_municipal' where email = 'tu@email.com';
```

(Otro admin existente también puede cambiar roles desde **Panel → Usuarios**.)

> 🧪 **Validación:** el esquema, el seed, los RPC (`crear_reserva_completa`, `anular_reserva`), la prevención de doble reserva, las políticas RLS y las vistas del dashboard fueron probados contra un PostgreSQL real. Las vistas usan `security_invoker`, de modo que respetan RLS (un pescador no ve datos agregados ajenos).

---

## 🧱 Modelo de datos (resumen)

Entidades principales y sus relaciones (ver `schema.sql` para el detalle):

- **usuario** *(extiende `auth.users`)* — `rol`: `pescador` · `dueno` · `admin_municipal` · `admin_sistema`.
- **catamaran** *1—N* **lugar** (asientos).
- **reserva** *N—1* usuario y catamarán; *1—N* **reserva_lugar** (asientos concretos, con índice único que impide doble reserva del mismo asiento por fecha).
- **permiso** *1—1* reserva — numeración correlativa `PCC-000XXX`, QR y vencimiento según tipo (diario/semanal/anual).
- **pago** *1—1* reserva.
- **especie** y **alerta_fauna** — soporte al monitoreo de presión pesquera (HU-015).
- **notificacion**, **reporte** — avisos y snapshots de reportes.

Historias de usuario cubiertas: registro y login seguro, gestión de catamaranes, búsqueda y reserva de lugares, emisión de permiso digital, pago, notificaciones, panel municipal, reportes y monitoreo de fauna.

---

## 🛠️ Tecnología

- **Front-end:** HTML5, CSS3 y JavaScript ES Modules (sin framework, sin *build*).
- **PWA:** Web App Manifest + Service Worker (precache y *stale-while-revalidate*).
- **Backend (opcional):** Supabase — PostgreSQL, Auth y API REST automática con RLS.
- **QR:** `qrcode-generator` (MIT), 100 % offline.
- **Gráficos:** SVG generado a mano (sin librerías externas).

> El TFG planteaba Flutter + Node/Express + PostgreSQL. Esta entrega adapta el **mismo modelo y las mismas reglas de negocio** a una PWA + Supabase para poder publicarla gratis en GitHub Pages y mantener la base de datos relacional intacta.

---

## ❓ Preguntas frecuentes

**No carga / pantalla en blanco.** Asegurate de servirla por `http(s)://` (servidor local o GitHub Pages), no por `file://`.

**Cambié `config.js` pero sigue en demo.** Verificá que *ambos* valores (`SUPABASE_URL` y `SUPABASE_ANON_KEY`) estén completos y volvé a desplegar. Forzá recarga (Ctrl/Cmd+Shift+R) para actualizar el service worker.

**El registro no inicia sesión.** Está activada la confirmación por email en Supabase. Desactivala (paso 3) o confirmá el correo.

**Quiero reiniciar los datos de la demo.** Perfil → *Reiniciar datos de demo*.

---

Hecho para el Dique Cabra Corral 🐟 — *Municipio de Coronel Moldes*.
