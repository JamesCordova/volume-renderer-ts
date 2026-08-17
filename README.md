# axial-volume-renderer

Frontend de visualización volumétrica de **Axial**. Port a TypeScript del
render de Three.js de [Donitzo/three.js-volume-renderer](https://github.com/Donitzo/three.js-volume-renderer)
(incluido como submódulo de referencia en `../volume-renderer`, sin
modificar), con integración real contra `api-repo`.

## Qué hace

`VolumeRenderer.ts` (el núcleo del render) es completamente agnóstico al
origen del volumen — recibe un array de voxels + dimensiones
(`THREE.Data3DTexture`). Todo el conocimiento de formato/origen vive en
`App.ts`, en `loadNiftiFromArrayBuffer` (parsea NIfTI con `nifti-reader-js`,
sea que el `ArrayBuffer` venga de un archivo local o de la API).

`src/api/client.ts` es el cliente HTTP hacia `api-repo` — deliberadamente sin
dependencia de `localStorage`/DOM (recibe el token como parámetro), para
poder probarlo desde Node sin navegador. Cubre: registro/login, listar
estudios propios, descargar el volumen real (`.nii.gz`, mismo NIfTI que ya
sabe leer el renderer — cero parser nuevo), sesiones/interacciones,
consentimiento informado y el cuestionario SUS.

`App.ts` agrega, vía `lil-gui` (mismo patrón que el resto de la demo):

- **Cuenta Axial**: email/password, iniciar sesión, registrarse, cerrar
  sesión. Token persistido en `localStorage` (best-effort — si no está
  disponible, sigue funcionando sin persistir entre recargas).
- **Subir Estudio (DICOM)**: crea el estudio, sube cada slice (`PUT
  /estudios/{id}/archivos/{filename}`, un archivo = una llamada — sección 6.2
  del documento de clean architecture), confirma la subida (encola el
  procesamiento en `worker-repo`) y hace polling hasta `ready`/`failed`,
  mostrando `stage`/`progress_percent` en vivo. Acepta también un **`.zip`**
  con varios DICOM adentro — se descomprime en el navegador con `fflate`
  (~8kB) antes de subir cada archivo por separado; la API/worker nunca se
  enteran de que hubo un zip, no se rompe el diseño de "un archivo = una
  llamada" (nunca aceptar un blob grande de una sola subida). Filtra
  entradas que no son imagen (`DICOMDIR`, `.txt`, `.xml`, etc.) y aplana
  subcarpetas para evitar colisiones de nombre.
- **Subir Volumen RAW (sin cabecera)**: un `.raw` no trae dims/dtype/spacing
  (a diferencia de un DICOM real) — ninguna librería puede inferirlos si no
  están en el archivo, así que el usuario los declara acá (dims Z/Y/X, tipo
  de dato, spacing en mm) antes de subir. Sube el archivo con el mismo `PUT`
  genérico de arriba y confirma vía `POST .../confirmar-subida-raw`, que
  encola `procesar_volumen_raw` en `worker-repo`. Por defecto usa min-max
  automático (sin asumir HU); hay un toggle **"Declarar ventana HU
  (opcional)"** + dos campos (mínimo/máximo) para cuando el `.raw` SÍ trae
  valores HU real conocidos (típico en 16 bits, `int16`/`uint16`, sin
  comprimir a 8 bits) — declarar la ventana evita que el tejido de interés
  quede aplastado si min-max estira automáticamente entre aire y hueso.
  Mismo polling que la subida DICOM.
- **Mis Estudios (Axial)**: lista los estudios del usuario autenticado
  (`GET /estudios`), elegir nivel de detalle (`preview`/`full`, LOD) y
  cargarlo — reemplaza la descarga de una muestra local por la descarga real
  vía `GET /estudios/{id}/volumen`. Si un estudio falló, muestra el motivo
  real (`error_message`, ver api-repo) en vez de un mensaje genérico.
- **Sesiones e interacciones**: al cargar un estudio se abre una sesión
  (`POST /estudios/{id}/sesiones`); al cargar otro estudio, cerrar sesión, o
  cerrar la pestaña (`beforeunload`, con `fetch(..., {keepalive:true})`
  porque no se puede `await` ahí) se cierra. Cada vez que se termina de
  rotar la cámara (evento `end` de `OrbitControls`) con una sesión activa, se
  registra una interacción `rotar_volumen` con el ángulo/distancia de
  cámara — no bloqueante, solo se loguea el error si falla.
- **Consentimiento informado**: estado actual + botón para aceptar.
- **Cuestionario SUS**: las 10 preguntas (1-5) + envío, muestra el puntaje
  calculado por el backend.

Variable de entorno opcional `VITE_AXIAL_API_URL` (default
`http://localhost:8000`) para apuntar a otro backend sin tocar código.

## Verificado

- `tsc --noEmit` y `npm run build` (`tsc && vite build`) sin errores.
- El cliente HTTP (`src/api/client.ts`) se probó **real** contra el stack
  completo de `infra-repo` (Postgres/Redis/MinIO/worker/api reales, no
  mocks) ejecutándolo directamente con `node --experimental-strip-types`
  (Node 22+, sin build previo): registro → login → listar estudios reales →
  descargar un volumen real y confirmar que es NIfTI válido
  (`nifti-reader-js`) → abrir sesión → registrar interacción → cerrar sesión
  → consultar/aceptar consentimiento → enviar y releer el cuestionario SUS.
  Esto encontró y corrigió 2 bugs reales de tipado en el cliente
  (`endSession` y `recordInteraction` estaban tipados con un cuerpo de
  respuesta que el endpoint real no devuelve/sí devuelve, respectivamente).
- El servidor de desarrollo (`npm run dev`) sirve `index.html` y todos los
  módulos nuevos (`App.ts`, `src/api/client.ts`) sin error.
- **Probado en un navegador real** (por el usuario, no automatizado) contra
  el stack completo — esto encontró y corrigió 2 bugs reales más que ningún
  script hubiera detectado: (1) el dropdown de "Mis Estudios" armaba sus
  etiquetas (`"nombre (estado)"`) como clave de un objeto — dos estudios con
  el mismo nombre+estado colisionaban y uno desaparecía del dropdown; se
  agregó el id corto a la etiqueta para desambiguar. (2) `StudyResponse` (en
  `api-repo`) nunca exponía `error_message` de un estudio `failed` — el
  motivo real quedaba solo en Postgres, sin forma de que el cliente lo viera;
  se agregó al schema/router de `api-repo` con test, y el frontend ahora
  distingue `failed` (definitivo, muestra el motivo) de `pending`/`processing`
  (temporal, "reintentá en un momento").
- **Subida de `.zip` real probada por el usuario**: reveló que subir un
  `.zip` sin descomprimir lo trataba como un solo archivo ilegible (SimpleITK
  no sabe abrir zips, no es un formato de imagen) — se agregó `fflate` para
  descomprimir en el navegador (ver arriba). Verificado también con datos que
  NO son CT (un dataset de oftalmología real: OCT + foto de retina) — el
  error de SimpleITK/GDCM es claro y explica por qué (falta la geometría 3D
  que un CT real sí trae).
- **Subida de volumen `.raw` verificada de punta a punta** (`node
  --experimental-strip-types` contra el stack real, incluida una
  reconstrucción completa de las imágenes Docker `api`/`worker`): crear
  estudio → subir `.raw` → confirmar con `dims=[8,16,16]`,
  `spacing=[2.0,1.0,1.0]` → `ready` → NIfTI resultante con
  `dims:[16,16,16]` — coincide exacto con la geometría física esperada.
- **`value_range` (ventana HU opcional) verificado con valores conocidos**:
  un volumen sintético `int16` `[-1000, 0, 1000]` (aire/tejido/hueso) — sin
  declarar ventana dio `[0, 0.5, 1]` (min-max automático); declarando la
  misma ventana que el rango observado (`[-1000, 1000]`) dio exactamente lo
  mismo (matemáticamente equivalente); declarando una ventana más ancha
  (`[-2000, 2000]`) dio `[0.25, 0.5, 0.75]` — genuinamente distinto,
  confirmado leyendo los píxeles reales del `.nii.gz` con `nifti-reader-js`,
  no solo que el estudio llegó a `ready`.

**No verificado — límite honesto de este entorno**: no hay un navegador
automatizado disponible aquí, así que el flujo completo *dentro* de la UI
real (abrir la página, tipear el login, hacer clic, ver el volumen
renderizado) no se probó de forma automatizada — solo su lógica subyacente
(el cliente HTTP) contra el backend real, y que el código compila/bundlea
sin errores. Antes de dar esto por "listo para usar", conviene que alguien
lo abra en un navegador real (`npm run dev`) y lo pruebe a mano una vez.

## Pendiente explícito

- Instrumentar más tipos de interacción además de `rotar_volumen` y
  `cargar_volumen` (ej. cambios de paleta, de ventana HU) si el análisis de
  usabilidad de la tesis lo requiere — se dejó acotado a lo mínimo
  significativo para no sobre-construir sin un pedido concreto.
- UI de login real (hoy el campo de password es un input de texto plano de
  `lil-gui`, sin `type="password"` — aceptable para esta demo, no para producción).
- Manejo de estudios `pending`/`processing` en la lista (hoy el botón
  "Cargar" simplemente avisa que no está listo, sin poll automático).

## Desarrollo local

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # tsc && vite build
```

Necesita `api-repo` (y, para procesar estudios nuevos, `worker-repo` +
Redis/MinIO/Postgres — ver `infra-repo`) corriendo y accesible en
`VITE_AXIAL_API_URL` (default `http://localhost:8000`).
