# Ficha para la Chrome Web Store — Preguntazo

Todo lo que pide el [Panel del desarrollador](https://chrome.google.com/webstore/devconsole), listo para copiar y pegar.

---

## 1. Paquete

| Campo | Valor |
|---|---|
| Archivo para subir | `dist/preguntazo-1.0.0.zip` · versión 1.0.0 |
| Autor | Miguel Mogrovejo |

> Antes de enviar a revisión publica el repositorio `preguntazo` con GitHub Pages (ver README, paso 1): el QR abre `https://mjmc4498.github.io/preguntazo/` en el celular del público y la política de privacidad vive en esa misma dirección.

---

## 2. Pestaña «Ficha de la tienda»

### Idioma: Español

**Nombre** (viene del manifiesto, 53 caracteres)
```
Preguntazo: preguntas, encuestas y reacciones en vivo
```

**Resumen** (viene del manifiesto, 126/132 caracteres)
```
Tu público escanea un QR y envía preguntas, vota en encuestas y lanza emojis que flotan sobre tus diapositivas en tiempo real.
```

**Descripción**

> Sin nombres de otros productos ni listas de palabras clave (Botonazo fue rechazado una vez por «Spam de palabras clave» por una lista de servicios). Solo se habla de «presentaciones», «charlas» y «clases» en general.

```
Convierte tu charla en una conversación. Muestra un código QR sobre tus diapositivas y tu público, desde su celular, te envía preguntas, vota en encuestas y lanza emojis que suben flotando sobre tu presentación. Sin apps, sin cuentas y sin registros.

🎤 PREGUNTAS DEL PÚBLICO
• Cada persona escribe su pregunta, con su nombre o de forma anónima.
• El público vota las preguntas de los demás: las más votadas suben solas.
• Muestra una pregunta en grande sobre tu diapositiva con un clic, o con Alt+Shift+N la más votada (la anterior queda como respondida).
• Modera antes de publicar, fija, oculta, marca como respondida y exporta todo a CSV.

📊 ENCUESTAS EN VIVO
• Cuatro tipos: una opción, varias opciones, calificación con estrellas y nube de palabras.
• Prepáralas antes de la charla y ábrelas con un clic: los celulares cambian solos a la encuesta.
• Resultados en vivo en tu pantalla y, si quieres, en los celulares de quienes votaron.

🎉 REACCIONES SOBRE TUS DIAPOSITIVAS
• Seis emojis a elección (aplausos, corazón, risa, fuego…) que flotan sobre tu presentación en tiempo real.
• Funciona encima de la presentación en pantalla completa, sin tocar tus archivos.

📱 UN QR Y LISTO
• Un QR pequeño queda en la esquina para quien llegue tarde; Alt+Shift+Q lo muestra en grande.
• Quien no pueda escanear entra a la dirección corta y escribe el código de 6 letras.
• El código no cambia entre charlas: descarga el QR y pégalo en tu primera diapositiva.
• Pantalla completa aparte para el proyector, si presentas desde otro programa.

CÓMO FUNCIONA
1. Abre tu presentación en Chrome, haz clic en el ícono de Preguntazo (o Alt+Shift+P) y activa «Mostrar en esta pestaña».
2. Tu público escanea el QR con la cámara de su celular.
3. Preguntan, votan y reaccionan; tú moderas desde el panel del presentador.

PRIVADO Y SEGURO
• Conexión directa y cifrada (WebRTC) entre cada celular y tu computadora: las preguntas, los votos y los nombres no pasan por servidores del desarrollador.
• El nombre del público es opcional y nadie ve quién votó qué.
• Las preguntas se guardan solo en tu Chrome; bórralas cuando quieras.
• La capa sobre tus diapositivas no lee ni modifica las páginas, y solo aparece donde tú la activas.
• Sin cuentas, sin anuncios, sin analítica.

Creado por Miguel Mogrovejo.
```

**Categoría:** Productividad › Herramientas (alternativa: Educación)

**Idioma:** Español

---

## 3. Recursos gráficos

| Recurso | Archivo | Tamaño |
|---|---|---|
| Ícono de la tienda | `store/icon-128.png` | 128×128 |
| Captura 1 | `store/screenshots/1-reacciones-sobre-tus-diapositivas.png` | 1280×800 |
| Captura 2 | `store/screenshots/2-preguntas-en-vivo.png` | 1280×800 |
| Captura 3 | `store/screenshots/3-encuestas-y-nube-de-palabras.png` | 1280×800 |
| Captura 4 | `store/screenshots/4-panel-del-presentador.png` | 1280×800 |
| Captura 5 | `store/screenshots/5-escanea-y-participa.png` | 1280×800 |
| Mosaico promocional pequeño | `store/promo-small-440x280.png` | 440×280 |
| Mosaico de marquesina (opcional) | `store/promo-marquee-1400x560.png` | 1400×560 |

---

## 4. Enlaces

| Campo | Valor |
|---|---|
| Sitio web oficial | `https://mjmc4498.github.io/preguntazo/` |
| URL de asistencia | `https://github.com/mjmc4498/preguntazo/issues` |
| Política de privacidad | `https://mjmc4498.github.io/preguntazo/privacy.html` |

---

## 5. Pestaña «Prácticas de privacidad»

**Descripción del propósito único**
```
Preguntazo permite que el público de una charla, clase o taller participe desde su celular. La extensión muestra un código QR sobre las diapositivas del presentador; al escanearlo, el celular abre una página web que envía preguntas, votos de encuestas y reacciones con emojis a la extensión por una conexión WebRTC directa y cifrada. La extensión las muestra al presentador en su panel y dibuja sobre la presentación las reacciones y la pregunta o la encuesta que el presentador elige destacar.
```

**Justificación de permisos**

`offscreen`
```
Mantiene en segundo plano la conexión WebRTC con los celulares del público (los service workers no pueden usar WebRTC): recibe las preguntas, los votos y las reacciones, aplica los límites por persona y reparte el estado de la sala al panel del presentador y a la capa sobre las diapositivas. Motivo: WEB_RTC.
```

`scripting`
```
Inserta la capa de Preguntazo (el QR, las reacciones y la pregunta o encuesta destacada) en la pestaña de la presentación cuando el usuario pulsa «Mostrar en esta pestaña» o un atajo de teclado (con activeTab). Si el usuario concede acceso a un sitio con «Mostrar sola al presentar en…», registra la capa en ese sitio (chrome.scripting.registerContentScripts) para que aparezca al presentar en pantalla completa.
```

`storage`
```
Guarda los ajustes del usuario (nombre de la charla, esquina y tamaño del QR, moderación, emojis), el código de la sala y, solo en el equipo del usuario, las preguntas, las encuestas y los totales de reacciones, para que no se pierdan si se cierra Chrome durante la charla.
```

`activeTab`
```
Cuando el usuario abre el panel de Preguntazo o usa un atajo (Alt+Shift+Q, Alt+Shift+N), permite insertar la capa en la pestaña actual —la de su presentación— sin pedir acceso a todos los sitios.
```

Permisos de host opcionales (`optional_host_permissions`: `https://*/*`, `http://*/*`)
```
No se piden al instalar: el paquete no declara host_permissions. Preguntazo los solicita en tiempo de ejecución con chrome.permissions.request y solo para el sitio que el usuario elige con el botón «Mostrar sola al presentar en <sitio>» (por ejemplo, https://presentaciones.example.com/*), o para todos los sitios si el usuario activa «Todos los sitios» en los ajustes. En esos sitios, la capa transparente de Preguntazo aparece al poner la presentación en pantalla completa. La capa no recibe clics y Preguntazo no lee, guarda ni envía el contenido de las páginas. El usuario puede quitar cada sitio en Ajustes › Sitios donde aparece sola.
```

**¿Usas código remoto?** → **No.** Todo el JavaScript va incluido en el paquete (PeerJS y el generador de QR están en `lib/`). La conexión con el servidor de señalización de PeerJS solo intercambia datos de conexión, no código.

**Uso de datos** — marca solo:
- ☑ **Información de identificación personal** — el nombre que una persona del público escribe, si quiere (es opcional), viaja cifrado de su celular a la computadora del presentador y nunca llega al desarrollador.
- ☑ **Comunicaciones personales** — las preguntas y respuestas del público viajan entre sus celulares y la computadora del presentador, cifradas, y se guardan solo en el Chrome del presentador.

Deja sin marcar **Contenido del sitio web**: Preguntazo no lee las páginas, solo dibuja una capa encima.

Y las tres certificaciones:
- ☑ No vendo ni transfiero datos de usuarios a terceros fuera de los casos de uso aprobados.
- ☑ No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único del elemento.
- ☑ No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni para otorgar préstamos.

---

## 6. Instrucciones para el revisor (campo «Notas para el revisor», opcional)

```
1. Al instalar se abre la bienvenida de Preguntazo, con el QR y el código de la sala.
2. Abre cualquier página web (por ejemplo, una presentación en el navegador) y haz clic en el ícono de Preguntazo: se abre la sala y se muestra el QR. Activa «Mostrar en esta pestaña»: aparece un QR pequeño en la esquina de la página.
3. Escanea el QR con un celular (o pulsa «Copiar enlace» y ábrelo en otra ventana o dispositivo). Escribe un nombre (opcional) y pulsa «Entrar».
4. En el celular envía una pregunta y toca los emojis de la barra inferior: la pregunta aparece en «Abrir el panel del presentador» y los emojis flotan sobre la página.
5. En el panel, «Mostrar en pantalla» destaca la pregunta sobre la página; en «Encuestas» crea una, pulsa «Guardar y abrir votación» y vota desde el celular. Alt+Shift+Q muestra el QR grande.
No se necesita cuenta ni credenciales.
```

---

## 7. Distribución

- **Visibilidad:** Pública
- **Regiones:** Todas
- **Precio:** Gratis
