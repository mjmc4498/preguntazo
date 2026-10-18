<p align="center">
  <img src="extension/icons/icon-128.png" width="96" alt="Preguntazo">
</p>

<h1 align="center">Preguntazo</h1>
<p align="center">Preguntas, encuestas y reacciones en vivo para tus charlas, clases y talleres.<br>
Tu público escanea un QR en pantalla y, desde su celular, te envía preguntas, vota en<br>
encuestas rápidas y lanza emojis que flotan sobre tus diapositivas en tiempo real.</p>
<p align="center"><sub>Creado por <b>Miguel Mogrovejo</b> · v1.0.0 · hermano de <a href="https://github.com/mjmc4498/mando">Presentazo</a>, <a href="https://github.com/mjmc4498/botonazo">Botonazo</a> y <a href="https://github.com/mjmc4498/capturazo">Capturazo</a></sub></p>

---

## Funciones

| | |
|---|---|
| **Preguntas** | Cada persona escribe su pregunta con su nombre o de forma anónima. El público vota las de los demás y las más votadas suben solas. Quien pregunta ve el estado de su pregunta (en revisión, publicada, respondida) y recibe un aviso cuando la respondes. |
| **Sobre tus diapositivas** | Una capa transparente encima de la presentación (también en pantalla completa) con un QR pequeño en la esquina para quien llegue tarde, el QR en grande (Alt+Shift+Q), la pregunta destacada (Alt+Shift+N muestra la más votada y marca la anterior como respondida) y los resultados de la encuesta en vivo. No toca tus archivos ni recibe clics. |
| **Encuestas** | Cuatro tipos: una opción, varias opciones, calificación con estrellas y nube de palabras (las respuestas iguales se juntan sin importar mayúsculas ni tildes). Se preparan antes y se abren con un clic: los celulares cambian solos a la encuesta. Resultados en vivo en pantalla y, si quieres, en los celulares. |
| **Reacciones** | Seis emojis a elección que suben flotando sobre la presentación. Pasan por detrás de la pregunta o la encuesta destacada (el texto siempre se lee) y cada celular tiene un límite por segundo. |
| **Panel del presentador** | Moderación (revisar antes de publicar), fijar, ocultar, marcar respondidas, buscar y filtrar; editor de encuestas con plantillas; elección de emojis y totales; lista del público con opción de desconectar; vista previa en vivo de lo que ve la sala; exportación a CSV. |
| **Para invitar a participar** | El código de la sala (6 letras y números, sin caracteres que se confunden) no cambia entre charlas: descarga el QR en PNG y pégalo en tu primera diapositiva. Quien no pueda escanear entra a `mjmc4498.github.io/preguntazo` y escribe el código. Pantalla completa aparte para el proyector. |
| **Conexión** | WebRTC directo y cifrado entre cada celular y tu computadora; retransmisión de Cloudflare para redes restrictivas (por ejemplo, el Wi-Fi de un auditorio); reconexión automática; las preguntas sobreviven a un cierre de Chrome. |

Probado de principio a fin con **42 comprobaciones automáticas** (extensión, panel, presentación con la capa encima y tres celulares reales conectados por PeerJS) y con una **prueba de carga de 150 personas a la vez**.

## Cómo funciona

```
┌────────────── Chrome del presentador ──────────────┐           ┌──── Celulares del público ────┐
│                                                    │    QR     │                               │
│  popup.html ── QR, números y accesos rápidos       │ ────────▶ │  remote/ (GitHub Pages)       │
│  panel.html ── moderación, encuestas, público      │           │  preguntar, votar, reaccionar │
│      │  (puerto «preguntazo-live»)                 │  WebRTC   │           │                   │
│      ▼                                             │ ◀═══════  │  PeerJS (cliente)             │
│  offscreen.html ── la sala: PeerJS (anfitrión),    │  cifrado  │                               │
│      valida y limita cada mensaje, agrupa los      │ ════════▶ │  cambios agrupados cada 300 ms│
│      cambios y guarda todo (vía service worker)    │           └───────────────────────────────┘
│      │                                             │
│      ▼                                             │        Señalización: 0.peerjs.com
│  content/overlay.js + lib/stage.js ── la capa      │        (solo para conectar; no ve las
│      sobre las diapositivas («top layer»)          │         preguntas, los votos ni los nombres)
│  pantalla.html ── lo mismo, a pantalla completa    │
└────────────────────────────────────────────────────┘
```

- **La sala vive en el documento offscreen.** Recibe la conexión de cada celular (`peer.on('connection')`), exige un `hello` con un identificador aleatorio del celular (sirve para recordar sus votos y sus preguntas si se reconecta) y aplica límites: una pregunta cada 3 s y 40 por persona, 500 por sala, 6 reacciones por segundo por celular (ráfagas de 15), 400 conexiones. Los textos se limpian (caracteres de control y de dirección) antes de guardarse.
- **Envíos agrupados.** Cada cambio marca qué hay que enviar; cada 300 ms sale un solo mensaje por destino: a los celulares solo las preguntas que cambiaron (`qs` con `upd`/`del`), la encuesta (con el voto propio de cada uno) y el número de personas cada 2 s. Las reacciones de toda la sala se juntan y salen hacia la capa cada 120 ms.
- **La capa sobre las diapositivas** es un elemento `popover="manual"` con un shadow root cerrado: al mostrarse entra en la *top layer*, por encima incluso del elemento en pantalla completa de la presentación, y vuelve arriba en cada `fullscreenchange`. No recibe clics (`pointer-events: none`) ni lee la página. Todo se mide en unidades del contenedor (`cqmin`), así que se ve igual en un proyector 4K, en la pantalla completa y en la miniatura del panel.
- **Dónde aparece.** Con «Mostrar en esta pestaña» (o un atajo) se inserta en esa pestaña con `activeTab`, sin pedir acceso a sitios. Si el usuario permite un sitio con «Mostrar sola al presentar en…», la capa queda registrada ahí y aparece sola al poner la presentación en pantalla completa.
- **El QR** contiene `https://…/preguntazo/#K7QM4P`: el código va en el fragmento `#` (nunca llega a un servidor) y la dirección corta deja un QR poco denso, legible desde el fondo de la sala. El identificador PeerJS de la sala es `preguntazo-k7qm4p`.
- **Persistencia.** El offscreen envía la sala al service worker, que la guarda en `chrome.storage.local`: si Chrome se cierra a mitad de la charla, al reabrir la sala vuelven las preguntas, las encuestas y los totales, y los celulares se reconectan solos.

### Carga

Medido con `npm run test:carga` (la extensión real y el público simulado con conexiones PeerJS en otro proceso de Chrome, llegando a unas 10 personas por segundo):

| Personas | Entran | Mediana para entrar | Votos contados | Reacciones en la diapositiva |
|---|---|---|---|---|
| 60 | 60/60 | 1,2 s | 60 en 0,3 s | 180 en 0,17 s (la primera a los 0,12 s) |
| 150 | 150/150 | 1,2 s (algunos reintentan y tardan ~13 s) | 150 en 0,3 s | 450 en 0,17 s |

Si llegan muchísimas personas en el mismo segundo, el servidor público de señalización pierde algunas negociaciones: el celular reintenta solo a los 8 s, así que todos terminan entrando. Para salas de varios cientos de personas conviene un servidor de señalización propio (ver *Limitaciones*).

## Estructura

```
preguntazo/
├── extension/           ← lo que se empaqueta y sube a la Chrome Web Store
│   ├── manifest.json
│   ├── background.js    service worker: sala, capa en las pestañas, atajos y guardado
│   ├── offscreen.*      la sala: conexión WebRTC con el público, límites y reparto
│   ├── popup.*          QR, números y accesos rápidos
│   ├── panel.*          panel del presentador (preguntas, encuestas, reacciones, público)
│   ├── pantalla.*       la sala a pantalla completa (proyector u OBS)
│   ├── options.*        bienvenida y ajustes
│   ├── content/         overlay.js (la capa sobre las diapositivas)
│   ├── lib/             stage.js (lo que ve la sala), live.js, qr.js, PeerJS, QR e i18n
│   ├── _locales/        textos en español (se generan con scripts/textos.py)
│   └── icons/
├── remote/              ← página del público (se publica en GitHub Pages)
│   ├── privacy.html     política de privacidad (URL pública para la tienda)
│   └── favicon.ico, icon.svg, manifest.webmanifest…
├── cloudflare/          ← Worker de credenciales TURN (opcional: se comparte el de Presentazo)
├── store/               ← imágenes y textos para la ficha de la tienda (LISTING.md)
├── design/              logos SVG, presentación de ejemplo y composiciones de la tienda
├── presentacion/        presentación del producto (preguntazo.pptx y .pdf)
├── scripts/             build.sh, textos.py, render.py, capture-store.mjs, presentacion.py
├── test/                prueba de punta a punta (e2e.mjs) y de carga (carga.mjs)
└── dist/                paquetes generados (.zip / .crx)
```

## Publicación paso a paso

### 1. Publica la página del público (una sola vez)

El QR abre `https://mjmc4498.github.io/preguntazo/`, así que esa página debe existir:

```bash
cd preguntazo
git init -b main && git add . && git commit -m "Preguntazo 1.0.0"
gh repo create mjmc4498/preguntazo --public --source . --push
gh api -X POST repos/mjmc4498/preguntazo/pages -f build_type=workflow
```

El flujo `.github/workflows/pages.yml` publica la carpeta `remote/` en cada cambio. En 1–2 minutos estarán disponibles:

- Público: `https://mjmc4498.github.io/preguntazo/`
- Privacidad: `https://mjmc4498.github.io/preguntazo/privacy.html`

> ¿Otra dirección? Cambia `REMOTE_URL` en `extension/config.js` (y `homepage_url` en el manifiesto) y vuelve a empaquetar. También puede cambiarse en **Ajustes › Avanzado** sin reempaquetar.

### 2. Prueba la extensión en tu Chrome

1. Ejecuta `./scripts/build.sh`.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar extensión sin empaquetar**.
3. Elige la carpeta `dist/preguntazo/` (su ruta no cambia entre versiones).
4. Abre tu presentación, haz clic en el ícono de Preguntazo (o `Alt+Shift+P`), activa **Mostrar en esta pestaña** y escanea el QR con tu celular.

### 3. Empaqueta

```bash
./scripts/build.sh
```

Genera `dist/preguntazo-<versión>.zip` para la tienda y la carpeta `dist/preguntazo/` para «Cargar extensión sin empaquetar» (valida manifiesto, íconos, textos y scripts antes de comprimir).

> Si el Escritorio se sincroniza con iCloud, borrar y volver a crear archivos enseguida deja copias de conflicto (`_locales 3`, `popup 2.js`) y Chrome responde *«Filenames starting with "_" are reserved»*. Por eso `build.sh` actualiza el ZIP y la carpeta en su lugar, borra esas copias de `dist/` y se detiene si encuentra alguna dentro de `extension/`.

Para un `.crx` instalable fuera de la tienda: `./scripts/build.sh --crx` (la clave queda en `keys/preguntazo.pem`; guárdala y no la subas a git). **La Chrome Web Store solo acepta el ZIP**; ella firma el paquete final.

### 4. Sube a la Chrome Web Store

1. Entra al [Panel del desarrollador](https://chrome.google.com/webstore/devconsole) (la misma cuenta de Presentazo, Botonazo y Capturazo; el registro de USD 5 ya está pagado).
2. **Nuevo elemento** → sube `dist/preguntazo-1.0.0.zip`.
3. Completa las pestañas copiando los textos de [`store/LISTING.md`](store/LISTING.md) y sube las imágenes de `store/`.
4. **Enviar para revisión.** El acceso a los sitios es un permiso opcional que se pide en tiempo de ejecución, así que el paquete no declara permisos de host; las justificaciones de cada permiso ya están redactadas en `LISTING.md`.

### Nuevas versiones

1. Sube `version` en `extension/manifest.json` (y `VERSION` en `remote/app.js`, y el `?v=` de `remote/index.html` si cambió la página del público).
2. Anota los cambios en `CHANGELOG.md`.
3. `./scripts/build.sh` y sube el nuevo ZIP en el panel (**Paquete › Subir nuevo paquete**).

## Usarlo con cualquier programa de presentaciones

- **Presentaciones en el navegador:** «Mostrar en esta pestaña» y presenta en pantalla completa; la capa queda encima. Con «Mostrar sola al presentar en…» aparece sola cada vez.
- **PowerPoint, Keynote u otro programa:** abre la **pantalla completa** de Preguntazo en el proyector (o una segunda pantalla) y alterna con tu programa, o pega el QR descargado en tus diapositivas. En OBS, captura la ventana de la pantalla completa (H oculta los controles).

## Desarrollo

```bash
npm install                 # Puppeteer (solo para pruebas y capturas)
npm run serve               # servidor local en http://localhost:8768 (otra terminal)
npm run test:e2e            # prueba completa extensión ↔ presentación ↔ 3 celulares (42 comprobaciones)
npm run test:carga          # 60 personas a la vez (CARGA=150 npm run test:carga)
npm run textos              # regenera _locales/es/messages.json desde scripts/textos.py
npm run icons               # regenera íconos y favicon desde design/*.svg
npm run store:capture       # capturas reales de la extensión, la capa y el celular
npm run store:images        # compone las imágenes de la tienda
npm run presentacion        # genera presentacion/preguntazo.pptx (requiere python-pptx)
```

- Vista previa del celular sin computadora: `http://localhost:8768/remote/?demo` (añade `&view=poll`, `&kind=multi|rating|words`, `&voted`, `&closed`, `&join`, `&enter`, `&mod`, `&ask` o `&react`).
- Presentación de ejemplo: `design/demo/charla.html` (las pruebas la sirven como `https://charla.example.com`).
- Las pruebas usan una copia de la extensión en la carpeta temporal del sistema (fuera de iCloud) con `host_permissions` para la presentación de ejemplo (el diálogo de permisos no se puede pulsar en modo headless) y contextos separados del navegador como «celulares». La capa expone su estado en atributos del elemento anfitrión (`data-spot`, `data-lobby`, `data-reactions`) para poder comprobarlo desde fuera del shadow root cerrado.
- La presentación en PDF se exporta desde Keynote (`presentacion/preguntazo.pdf`).

### Retransmisión con Cloudflare (redes restrictivas)

Preguntazo comparte con Presentazo, Botonazo y Capturazo el Worker `https://mando-turn.mjmc4498.workers.dev`, que entrega credenciales temporales del servidor TURN de Cloudflare (gratis hasta 1.000 GB al mes, con pausa automática a los 900 GB). Acepta cualquier extensión de Chrome y el origen `https://mjmc4498.github.io`. Preguntazo solo envía texto, así que consume muy poco: aunque toda una sala pasara por la retransmisión, son unos pocos megabytes por charla. Consumo del mes: <https://mando-turn.mjmc4498.workers.dev/estado>.

La carpeta `cloudflare/` tiene una copia (`preguntazo-turn`): `cd cloudflare && npx wrangler deploy`, guarda los secretos `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` y `CF_ANALYTICS_TOKEN`, y cambia `ICE_ENDPOINT` en `extension/config.js` y `remote/app.js`.

## Permisos

| Permiso | Para qué |
|---|---|
| `activeTab` | Insertar la capa en la pestaña de la presentación cuando lo pides desde el panel o con un atajo, sin pedir acceso a sitios. |
| `scripting` | Insertar la capa en esa pestaña y, en los sitios que permitas, registrarla para que aparezca sola al presentar. |
| `offscreen` | Mantener la conexión WebRTC con los celulares del público. |
| `storage` | Guardar los ajustes, el código de la sala, las preguntas y las encuestas. |
| Sitios web (opcional: `https://*/*`, `http://*/*`) | Se pide sitio por sitio con «Mostrar sola al presentar en…» (o para todos en los ajustes) y se quita en **Ajustes › Sitios donde aparece sola**. |

## Atajos

| Atajo | Acción |
|---|---|
| `Alt+Shift+P` | Abrir Preguntazo (QR de la sala) |
| `Alt+Shift+Q` | Mostrar u ocultar el QR grande sobre la diapositiva |
| `Alt+Shift+N` | Mostrar la pregunta más votada (y marcar la anterior como respondida) |
| `Alt+Shift+X` | Quitar de la pantalla la pregunta, la encuesta o el QR grande |

Se cambian en `chrome://extensions/shortcuts`. En la pantalla completa: F, H, Q, N y Esc.

## Limitaciones

- La capa aparece sobre **páginas web** en Chrome. Sobre PowerPoint o Keynote de escritorio no puede dibujar: usa la pantalla completa de Preguntazo o pega el QR en tus diapositivas.
- Chrome no permite extensiones en `chrome://` ni en la Chrome Web Store.
- Probado con 150 personas a la vez. Para salas de varios cientos, el servidor público de señalización de PeerJS puede tardar en conectar a todos (el celular reintenta solo); con un servidor PeerJS propio se quita ese límite.
- La conexión directa necesita que el celular y la computadora puedan encontrarse; si el Wi-Fi del lugar lo impide, se usa la retransmisión de Cloudflare, o el público puede usar sus datos móviles.
- La sala vive en el Chrome del presentador: si se cierra la computadora, el público ve «La sala se cerró» y vuelve a entrar solo al reabrirla.

## Licencia

© 2026 Miguel Mogrovejo. Incluye PeerJS y QR Code Generator (MIT) e íconos basados en Lucide (ISC) — ver `extension/THIRD_PARTY_NOTICES.txt`.
