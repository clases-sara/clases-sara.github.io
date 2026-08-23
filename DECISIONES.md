# Plataforma de reservas de clases — Sara

Documento de decisiones. Actualizado: 2026-08-22.

## Objetivo

Sara comparte **un único enlace público**. El alumno abre, ve los huecos que Sara tiene
libres, elige uno y lo solicita dejando nombre y móvil. Sara aprueba o rechaza.
Prioridad absoluta: **simplicidad operativa para Sara**.

## Decisiones cerradas

| # | Decisión | Elegido |
|---|---|---|
| 1 | Acceso del alumno | Enlace público único, sin alta previa de alumnos |
| 2 | Flujo de reserva | Solicitud → Sara aprueba o rechaza |
| 3 | Stack | GitHub Pages (front) + Apps Script (API) + Google Sheets (datos) |
| 4 | Disponibilidad | Horario base semanal + eventos en Google Calendar = OCUPADO |
| 5 | Calendario | Calendario **secundario dedicado**, nunca el personal de Sara |
| 6 | Datos del alumno | Nombre + móvil |
| 7 | Aviso al alumno | WhatsApp al confirmar/rechazar |
| 8 | Aviso a Sara | WhatsApp al entrar una solicitud nueva |
| 9 | Acceso de Sara al panel | Su cuenta de Google |
| 10 | Avisos de WhatsApp | Enlaces wa.me desde el panel, sin API. Meta Cloud API queda para fase 2 |
| 11 | Dominio propio | Descartado |
| 12 | Horario de Sara | Clases de 90 min · L-J 08:30-13:00 y 14:00-18:30 · V 08:30-13:00 y 14:00-17:00, editable desde el panel |
| 13 | Antelación mínima | 6 horas. Por debajo, se invita a escribir a Sara por WhatsApp |
| 14 | Semanas a la vista | 2 |
| 15 | Límite por alumno | Sin tope de clases, pero al menos 1 hora de descanso entre dos del mismo día |
| 17 | Cancelaciones | El alumno no cancela: habla con Sara y ella libera la hora |
| 18 | Campo o calle | Sara lo marca por clase; queda en la hoja para sus comisiones |
| 16 | Cuenta de Google de Sara | La suya de siempre; se guarda en `email_admin` de la hoja Config |

## Arquitectura

Dos despliegues distintos de Apps Script, cada uno con su modo de acceso:

```
ALUMNO (público)
  clases-sara.github.io  ──fetch──▶  Web App "API"
                                     ejecutar como: Sara
                                     acceso: cualquiera, incluso anónimo
                                          │
SARA (privado)                            ▼
  Web App "Panel" (HtmlService)   ┌──────────────────┐
  ejecutar como: usuario ─────────▶│  Google Sheets   │  reservas + alumnos + config
  acceso: solo Sara                └──────────────────┘
                                          │
                                          ▼
                                   Google Calendar
                                   "Clases – disponibilidad"  (solo lectura)
                                          │
                                          ▼
                                     WhatsApp API
```

Motivo del doble despliegue: el panel de Sara necesita identidad de Google, lo que
exige sesión y redirecciones incompatibles con una llamada cross-origin desde GitHub
Pages. Sirviéndolo desde HtmlService, Google gestiona el login por nosotros.

CORS del alumno: los POST se envían con `Content-Type: text/plain` para evitar el
preflight, patrón estándar con Apps Script.

## Cálculo de huecos libres

```
LIBRE = horario_base(día)
        − eventos del calendario "Clases – disponibilidad"
        − reservas en estado pendiente o confirmada
        − franjas con menos de X horas de antelación
```

## Herencia del MVP PHP

El código PHP anterior queda como **especificación funcional de referencia**, no se
despliega. Reaprovechable de [includes/funciones.php](includes/funciones.php):

- Estados de reserva: `pendiente / confirmada / rechazada / cancelada`
- Protección anti doble reserva
- Marca de cancelación tardía (< 24 h)
- Rejilla semanal de slots

## Por qué no hay API de WhatsApp

WATI cuesta 39-49 €/mes y la Cloud API de Meta cobra por plantilla enviada. Las dos
exigen verificación de empresa y, sobre todo, **absorben el número**: Sara perdería
WhatsApp normal en su móvil y necesitaría una segunda línea.

En su lugar el panel abre WhatsApp con el mensaje ya escrito y Sara pulsa enviar.
Coste cero, sin verificaciones y el alumno recibe el mensaje desde el número de Sara
de siempre. El módulo queda aislado en `04_Avisos.gs`: para automatizarlo solo hay
que implementar `enviarWhatsApp_()`.

## Deuda del repositorio anterior — resuelta

- [x] `.git` estaba vacío: repositorio inicializado y con historial
- [x] Árbol partido entre `plataformas/sara/` y la raíz: todo el PHP vive ahora en `legacy-php/`
- [x] `plataformas/sara_copytest/`, duplicado byte a byte: eliminado

## Añadido después de las primeras pruebas

| Qué | Cómo |
|---|---|
| Clases confirmadas en el calendario de Sara | En *Clases – disponibilidad*, el mismo que ya usa y tiene compartido. Con el nombre del alumno y aviso una hora antes; se apuntan y se quitan solas |
| Recordar a los alumnos de mañana | Hubo una sección *Mañana* en el panel con un botón que iba abriendo un WhatsApp por alumno. **Se quitó el 23 de agosto** a petición de Sara |
| Si el calendario no responde | No se ofrece ninguna hora y se avisa a Sara por correo. Antes se ofrecían todas |
| Archivado | `archivarAntiguas(meses)` mueve lo viejo a la pestaña *Historico* |

## El día que una clase se convirtió en 250 eventos

Una sola clase real (lunes 24, 08:30) acabó como más de 250 eventos idénticos en el
calendario y otras tantas filas en la hoja, creciendo cada quince minutos.

**Qué pasó.** Al quitar las columnas `codigo` y `grupo` del código, la hoja de verdad
se quedó con las suyas: `instalar()` solo añade las columnas que faltan, nunca retira
las que sobran. El sistema buscaba cada columna contando posiciones en una lista del
código en lugar de mirar la cabecera de la hoja, así que a partir de la décima columna
escribía todo corrido un sitio. El identificador del evento se guardaba en `grupo` y
la columna `evento_id` quedaba vacía para siempre. A partir de ahí:

1. Toda clase confirmada parecía no tener evento → se le creaba uno nuevo.
2. Ningún evento del calendario constaba como conocido → se importaban todos como
   clases nuevas.
3. A esas clases nuevas se les creaba su evento → vuelta a empezar, duplicando.

Lo disparaban a la vez la revisión automática y el panel, que la lanza cada vez que
Sara lo abre.

**Lo que se hizo.** La hoja manda: `indiceCol_()` lee la cabecera real y las filas se
escriben poniendo cada dato en su columna por nombre. Además, cuatro redes por si
alguna vez vuelve a fallar algo parecido:

| Red | Qué evita |
|---|---|
| Firma en los eventos que crea el sistema | Que se reimporten como clases de Sara |
| No se importa nada sobre una hora ya ocupada | Filas duplicadas |
| Antes de crear un evento se mira si ya está | Copias de la misma clase |
| Tope de 20 cambios por vuelta, con aviso por correo | Que un fallo crezca sin freno |
| Un cierre en `sincronizarTodo()` | Que el panel y la revisión automática se pisen |

**La lección.** El fallo no estaba en ninguna función suelta: estaba en repetirlas. Las
pruebas comprobaban una llamada y todas pasaban. Ahora se comprueban diez seguidas,
que es como se ejecuta de verdad, y también con la hoja descuadrada a propósito.

## Auditoría antes de abrir a los alumnos

Repaso completo buscando fallos, no confirmando que todo iba bien. Nueve hallazgos.

### Lo mismo que llenó el calendario, esperando en otros sitios

| Dónde | Qué pasaba |
|---|---|
| `archivarAntiguas` | Escribía el histórico **por posición** en una hoja que pudo crearse con otras columnas. Nadie se habría enterado hasta consultar el histórico un año después |
| Mover un evento | Escribía tres columnas seguidas dando por hecho que `fecha`, `hora_inicio` y `hora_fin` iban pegadas |

Los dos van ahora por `escribirCampos_()`, que coloca cada dato en la columna que
lleva su nombre estén donde estén.

### La puerta pública estaba demasiado abierta

La dirección de la API es anónima por diseño: acepta lo que le manden, no solo lo que
manda la página.

- **Sin tope por arriba**: se podía pedir una clase para dentro de tres años, fuera de
  lo que Sara ve en su panel. Ahora no se pasa de lo que se ofrece.
- **Nombre sin recortar**: cabían diez mil letras en una fila. Ahora 80.

### El detector se había quedado ciego

`diagnostico()` es lo que avisa de que algo va mal, y **nunca se había ejecutado en las
pruebas**. Tenía dos fallos heredados del cambio de horario:

- Buscaba dos clases que empezaran **a la misma hora**. Desde que las horas se adaptan
  al calendario, una de 09:00 a 10:30 y otra de 10:00 a 11:30 se pisan de sobra sin
  empezar igual.
- Daba por «fuera de horario» toda clase que no empezara a una hora exacta: con horas
  adaptadas eso son casi todas, y el aviso se llenaba de falsos.

Además, su lista de funciones vigiladas ignoraba doce de las nuevas: no habría avisado
si faltaba media pegada.

### Lo demás

- **Solicitudes zombis**: una que Sara nunca respondía se quedaba pendiente para
  siempre. Desaparecía de su panel y el alumno la seguía viendo como «sin respuesta»
  sin que nadie fuera a contestarle. Ahora se cierran solas al pasárseles la fecha.
- **Datos personales en un repositorio público**: el móvil real de Sara como ejemplo en
  el código, su correo y el de la cuenta del proyecto en las dos guías.
- **Permiso de más**: se pedía acceso a internet (`script.external_request`) sin usarlo.

### Lo que se probó y estaba bien

Zona horaria y cambio de hora · las ocho acciones de Sara protegidas · el doble toque
al reservar · las cuotas de correo y de disparadores · el fallo seguro cuando el
calendario no responde · la clave del panel, que no está en ningún archivo.

### Las dos pruebas que faltaban

**Estrés**: cien vueltas de revisión con la hoja descuadrada a propósito, rastros
borrados y eventos sueltos. Se cuenta antes y después: si algo crece, salta.

**De punta a punta**: los once pasos de un día real, por las mismas llamadas que usan
la página y el panel. Desde que el alumno ve las horas hasta que Sara libera una y el
hueco vuelve a ofrecerse.

**367 comprobaciones** en la lógica y **137** en el panel.

## Las incidencias de la semana de lanzamiento

Tres cosas vistas con la página ya en la calle, el 22 de agosto.

### "Revisa el número de móvil", con cualquier número

Un alumno escribía `618090` y no le dejaba pedir la clase. La página aceptaba seis
dígitos, pero **la API desplegada exigía ocho**: el archivo `00_Base.gs` que había
pegado en Apps Script era anterior al soporte de móviles de Andorra. Se comprobó
llamando a la API pública con `consultar`, que pasa por la misma validación sin crear
nada: `618090` → error, `+376618090` → pasaba.

Arreglo doble: republicar con el código actual y, de paso, que el móvil se entienda
**como lo escriba el alumno**. Espacios, puntos, guiones, paréntesis, `+`, `00`, con
prefijo o sin él. Se quitan todos los signos, se deduce el prefijo por la longitud
(6 dígitos = Andorra, 9 = España) y lo que no encaje se guarda con sus dígitos tal
cual. Con seis dígitos ya vale, en la página y en el servidor. Dieciséis formas de
escribirlo, probadas.

### Las clases borradas del calendario seguían confirmadas

Sara quitaba una clase del calendario y el panel la seguía enseñando; la hora no
volvía a ofrecerse a los alumnos. El lunes 24 tenía el día casi libre en el
calendario y la página no ofrecía nada.

La causa está en Google: un evento borrado **se queda treinta días en la papelera y
`getEventById` lo sigue devolviendo** como si estuviera vivo. El código lo buscaba
primero en el listado por fechas (que sí excluye los borrados) y, si no estaba, lo
pedía por su id "por si Sara lo había movido a otra semana". Ahí lo encontraba, veía
que seguía en la misma hora y no hacía nada.

Ahora un evento que solo aparece por su id tiene que aparecer también en el listado
de su propia hora. Si no, está en la papelera y la clase se libera. La imitación del
calendario en las pruebas tiene ahora papelera, y la prueba del borrado falla con el
código de antes.

### El panel de Sara: horas y huecos

- Cada día de la agenda dice **cuántas horas de clase** tiene y, en ámbar, **cuántas le
  quedan libres**. Arriba, lo mismo por semana.
- Los ratos libres ya no se miden entre clase y clase en el panel: **los calcula el
  servidor** con el calendario delante, así que un médico o unos exámenes recortan el
  hueco como deben. Salen también los días sin ninguna clase, que son los que Sara
  quiere ver. Cada rato es un botón que abre el calendario en ese día.
- Se mantiene el umbral de 45 minutos (`duracion_minima_minutos`) y el descuento del
  traslado entre autoescuelas.

### Fuera las reseñas

A petición de Sara, la página del alumno no pide reseñas. Se ha quitado de la página,
del servidor y de las pruebas. Las filas `resenas` y `resena_siempre` de la hoja
Config ya no se leen; se pueden borrar o dejar.

### Cómo se publica a partir de ahora

Al bajar con clasp lo que había en Apps Script apareció la causa de fondo: el
`00_Base` publicado tenía el archivo **pegado dos veces, la segunda copia dentro del
cuerpo de `normalizarTelefono`**. Las funciones anidadas no existen fuera, así que la
validación efectiva era la vieja aunque el archivo "pareciera" nuevo. Dos archivos
más tenían nombres distintos a los del repositorio (`06_Autoescuelas`,
`08_diagnostico`).

Decisión: el código se sube con **clasp** (`clasp push --force` + `clasp redeploy`), que
sustituye el proyecto entero por lo que hay en el repositorio. Y la API tiene una
acción pública `salud`, sin datos personales, para comprobar desde fuera la fecha
del código, el calendario, las columnas de la hoja y la revisión automática.

### Revisión independiente antes de arrancar

Con todo lo anterior hecho, una revisión aparte buscando fallos (no confirmando que
todo iba bien) sacó ocho. Los tres que importaban estaban en el mismo sitio: **lo que
Sara hace en el calendario sin ver las solicitudes pendientes**, que viven solo en la
hoja.

| Qué pasaba | Ahora |
|---|---|
| Mover una clase encima de una solicitud pendiente dejaba la hoja en un día y el calendario en otro, para siempre, y el panel decía "1 movida" en cada apertura | Gana la clase de Sara: la pendiente se rechaza con motivo, el alumno lo ve en *Mis clases* y a Sara le llega un correo con el móvil para que le escriba |
| Mover una clase encima de otra confirmada dejaba el evento movido y la fila quieta | El evento vuelve a su sitio y Sara recibe un correo diciendo con quién chocaba |
| Apuntar a mano una clase en la hora de una pendiente la descartaba en silencio: dos alumnos a la misma hora y Sara se enteraba en el coche | Entra, la pendiente se rechaza y se avisa. Encima de una confirmada de otro alumno no entra, pero se avisa |
| Una clase apuntada como **serie repetida** entraba tres veces con el mismo identificador, marcaba "2 movidas" en cada apertura y a partir de la tercera semana no entraba nunca | Las series no se siguen: tapan la hora, no entran, y Sara recibe un correo pidiendo que las apunte de una en una |
| Entre crear el evento y apuntar su id cabía una revisión automática que lo borraba por huérfano: la clase recién confirmada se cancelaba sola un cuarto de hora después | `sincronizarAgenda` va bajo el mismo cierre que la revisión |
| La revisión daba por hechas las clases de la mañana antes de mirar si Sara las había movido a la tarde | Primero el calendario, después las realizadas |
| Con antelación mínima baja, la página ofrecía horas que el servidor rechazaba (los bloqueos de hoy ya terminados no contaban al ofrecer pero sí al validar) | Se leen desde el principio del día en los dos sitios |
| El móvil de Sara iba a `wa.me` tal cual lo escribiera en Ajustes ("+376 618 090") | Se guarda y se sirve normalizado |

Cada caso tiene su prueba, incluida la imitación de una serie repetida y de una
petición mal formada a la API.

## El parte semanal

La empresa pide a Sara cada semana un Excel con sus clases, y lo hacía a mano. Ahora
se genera solo cada sábado y llega por correo; el formato es el suyo porque se
construye sobre su propia plantilla (ver [INSTALACION.md](INSTALACION.md)).

| Decisión | Elegido | Por qué |
|---|---|---|
| Dónde se genera | Proyecto de Apps Script **aparte** ([partes/](partes/)) | Exportar a Excel y escribir en Drive exige permisos nuevos; añadirlos al proyecto de los alumnos obligaría a reautorizarlo con la página en la calle |
| Cómo se consigue el formato exacto | Copiar la plantilla de Sara y rellenar sus hojas copiando el formato de sus propias filas | Construir el Excel a mano nunca sería idéntico; así bordes, fuentes, celdas unidas y fórmulas son los suyos |
| La categoría del permiso (B, J…) | Columna nueva `categoria`, por alumno, con botones en el panel | La app no la sabía y la empresa la pide. Se marca una vez y se hereda en las clases siguientes |
| Los exámenes | Se leen del calendario por el título ("Examen", "Exámenes") | Son horas de trabajo y Sara los apuntaba; el resto de bloqueos (médico) son personales |
| Descansos y traslados | Reglas: ≤30 min entre clases = *Descanso*; ≤60 min al cambiar de autoescuela o tras un examen = *Traslado* | Es lo que hacía Sara a mano; la comida no se apunta |

**50 comprobaciones** propias, con una hoja de cálculo falsa que entiende insertar y
borrar filas, combinar celdas y copiar formatos.

**504 comprobaciones** en la lógica, **158** en el panel y **50** en el parte.

## Lo que Sara pidió al ver el panel (23 de agosto)

| Qué | Decisión | Por qué |
|---|---|---|
| Fuera la sección *Mañana* y el botón de ir avisando a los alumnos | Se quita entera: la sección, el código y la plantilla `recordatorio` del servidor | Sara no la usaba y ocupaba la mitad de la primera pantalla. Los alumnos ya reciben su confirmación y tienen la clase en su calendario |
| El parte semanal | Plegado, como los demás ajustes | Se pide una vez a la semana; abierto estorbaba entre las clases y los ajustes |
| **Horario extendido en días concretos** | Una franja ("de 08:00 a 20:30", editable) y una casilla por cada día a la vista, en *Tu disponibilidad*. Se guarda en Config como `horario_extendido`; `HorarioBase` no se toca | Hay semanas con más clases de lo normal. Cambiar el horario habitual para volver a cambiarlo después es un lío y se olvida: así son excepciones, no reglas, y las fechas pasadas se tiran solas |
| Qué pasa en un día marcado | La jornada se **estira por los dos lados**: empieza a la hora del extendido y acaba a la suya, y el descanso del mediodía de ese día se mantiene. Un día que normalmente no trabaja (sábado) abre la franja entera | Un alumno reservando a la hora de comer sin que Sara lo haya decidido es peor que un hueco sin vender. Si un día quiere trabajar seguido, le basta con quitar el descanso de su horario habitual |
| Una sola puerta para "¿a qué horas trabaja Sara tal día?" | `ventanasDelDia_()` en [07_Horario.gs](apps-script/07_Horario.gs). La disponibilidad del alumno, los ratos libres del panel y la validación de cada reserva pasan por ahí | Si cada sitio mirase el horario por su cuenta, un día extendido se ofrecería en la página y se rechazaría al reservar |
| Una semana más a partir del jueves | `semana_extra_desde` en Config (1 = lunes … 7 = domingo; vacío = nunca). Con `4`, de jueves a domingo se ve una semana más que de lunes a miércoles | Los exámenes son los miércoles: quien suspende quiere coger la semana siguiente ese mismo día. Es opcional y no cambia nada hasta que se rellena; a día de hoy la hoja tiene `semanas_vista` = 3, así que ya se ven dos semanas por delante todos los días |
| Los textos del panel en el móvil | Las filas que llevaban tres datos en un renglón (semanas, días de la agenda, ratos libres) pueden partirse en dos líneas por debajo de 400 px, y la cabecera deja de pelearse con los botones | En un móvil normal el resumen de la semana salía cortado o montado encima de lo libre |

**550 comprobaciones** en la lógica, **189** en el panel y **52** en el parte.

## Pendiente

- [ ] **Hoja de comisiones.** Falta saber en qué formato se las pide su jefa para
      adaptar la hoja a eso. El dato de campo o calle ya se guarda por clase.

- [x] Móvil de Sara para los enlaces de WhatsApp (`telefono_sara` en la hoja Config)
- [ ] **Publicar con clasp** (22 de agosto): `clasp push --force` y `clasp redeploy`.
      Hasta que `URL_API?accion=salud` diga `2026-08-22`, los alumnos de Andorra no
      pueden reservar y las clases borradas del calendario siguen saliendo
- [ ] **Parte semanal**: ejecutar `instalarPartes()` en el proyecto *Partes Sara* y
      aceptar los permisos. Después, que Sara marque el permiso (B, J…) de cada alumno
      en el panel
- [x] Repositorio `clases-sara.github.io` creado en la organización `clases-sara`, con
      Pages sirviendo `/docs`. La página vive en **https://clases-sara.github.io/**
- [ ] **`url_publica` en la hoja Config** apuntando a esa dirección. Es el enlace que
      viaja en todos los WhatsApp que manda Sara: si se queda con el antiguo, los
      alumnos reciben un enlace roto y nadie se entera hasta que uno lo dice
- [ ] Ejecutar `instalar()` en Apps Script y publicar la implementación
