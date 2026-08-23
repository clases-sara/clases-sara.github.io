/**
 * Punto de entrada web.
 *
 * El mismo proyecto se publica DOS veces, con configuraciones distintas:
 *
 *   Implementación "API"    · ejecutar como: yo · acceso: cualquiera, incluso anónimo
 *                             La llama el front del alumno alojado en GitHub Pages.
 *
 *   Implementación "Panel"  · ejecutar como: usuario que accede · acceso: cualquiera con cuenta de Google
 *                             Sara abre esta URL y Google le pide su cuenta.
 *
 * Una petición con parámetro "accion" devuelve JSON. Sin parámetros, sirve el panel.
 */

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  if (!params.accion) return servirPanel_(params.t);

  var datos;
  try {
    datos = params.datos ? JSON.parse(params.datos) : params;
  } catch (err) {
    datos = null;
  }
  var salida = datos ? enrutar_(params.accion, datos)
                     : { ok: false, error: 'Petición mal formada.' };

  if (params.callback) return respuestaJsonp_(salida, params.callback);
  return respuestaJson_(salida);
}

function doPost(e) {
  var cuerpo = {};
  try {
    if (e && e.postData && e.postData.contents) cuerpo = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuestaJson_({ ok: false, error: 'Petición mal formada.' });
  }
  return respuestaJson_(enrutar_(cuerpo.accion, cuerpo));
}

// --- Router ----------------------------------------------------------------

function enrutar_(accion, datos) {
  try {
    switch (accion) {
      // Públicas
      case 'disponibilidad':
        // Cada autoescuela ve horas distintas: el traslado no cae en el mismo sitio
        return { ok: true, datos: obtenerDisponibilidad(datos.escuela) };
      case 'reservar':
        return crearReserva(datos);
      case 'consultar':
        return consultarPorTelefono(datos.telefono);
      case 'avisar':
        return avisarDeReservas(datos.ids);
      case 'salud':
        // Sin datos personales: sirve para comprobar desde fuera que lo publicado
        // es lo último, que el calendario responde y que la revisión automática vive
        return estadoDeSalud();

      // De Sara
      case 'panel':
        return exigirAdmin_(datos.t) || datosPanel();
      case 'confirmar':
        return exigirAdmin_(datos.t) ||
               cambiarEstado(datos.ids || datos.id, 'confirmada', '', datos.tipos);
      case 'rechazar':
        return exigirAdmin_(datos.t) || cambiarEstado(datos.ids || datos.id, 'rechazada', datos.motivo);
      case 'anular':
        return exigirAdmin_(datos.t) ||
               cambiarEstado(datos.ids || datos.id, 'cancelada', datos.motivo || 'Anulada por Sara');
      case 'agendar':
        return exigirAdmin_(datos.t) || sincronizarAgenda(datos.ids || datos.id);
      case 'agendar_todo':
        return exigirAdmin_(datos.t) || sincronizarTodo();
      case 'traer_calendario':
        return exigirAdmin_(datos.t) || traerCambiosDelCalendario();
      case 'marcar_escuela':
        return exigirAdmin_(datos.t) || marcarEscuela(datos.ids || datos.id, datos.escuela);
      case 'marcar_tipo':
        return exigirAdmin_(datos.t) || marcarTipo(datos.ids || datos.id, datos.tipo);
      case 'marcar_categoria':
        return exigirAdmin_(datos.t) || marcarCategoria(datos.ids || datos.id, datos.categoria);
      case 'marcar_avisado':
        return exigirAdmin_(datos.t) || marcarAvisado(datos.ids || datos.id);
      case 'guardar_config':
        return exigirAdmin_(datos.t) || guardarConfigPanel_(datos);
      case 'guardar_horario':
        return exigirAdmin_(datos.t) || guardarHorario(datos.horario);
      case 'guardar_horario_extendido':
        return exigirAdmin_(datos.t) || guardarHorarioExtendido(datos.horario_extendido);
      case 'diagnostico':
        return exigirAdmin_(datos.t) || { ok: true, informe: diagnostico() };

      default:
        return { ok: false, error: 'Acción no reconocida.' };
    }
  } catch (err) {
    Logger.log('Error en ' + accion + ': ' + err.message);
    return { ok: false, error: 'Error del servidor: ' + err.message };
  }
}

// --- Seguridad -------------------------------------------------------------

/**
 * Sara entra de dos formas, y basta con una:
 *
 *   · Con su cuenta de Google, si su correo está en email_admin. Solo funciona
 *     cuando el panel se publica como "ejecutar como el usuario que accede", que
 *     obliga a Sara a autorizar la aplicación y a tener permiso sobre la hoja.
 *
 *   · Con la clave del enlace. El panel se publica entonces como "ejecutar como yo",
 *     Sara no autoriza nada ni ve avisos, y el enlace privado hace de llave.
 *
 * La clave se genera sola al instalar y se puede cambiar cuando se quiera.
 */
function claveDelPanel_() {
  var clave = config('token_panel', '');
  if (clave) return clave;

  clave = generarClaveLarga_();
  setConfig('token_panel', clave);
  return clave;
}

function generarClaveLarga_() {
  var alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var salida = '';
  for (var i = 0; i < 24; i++) {
    salida += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  }
  return salida;
}

function claveValida_(clave) {
  if (!clave) return false;
  var buena = claveDelPanel_();
  // Comparación de longitud fija, para no filtrar por dónde falla
  if (String(clave).length !== buena.length) return false;
  var iguales = 0;
  for (var i = 0; i < buena.length; i++) {
    if (String(clave).charAt(i) === buena.charAt(i)) iguales++;
  }
  return iguales === buena.length;
}

function emailActual_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function esAdmin() {
  var actual = emailActual_();
  if (!actual) return false;
  var permitidos = String(config('email_admin', '')).toLowerCase().split(',');
  for (var i = 0; i < permitidos.length; i++) {
    if (permitidos[i].trim() === actual) return true;
  }
  return false;
}

/** Devuelve un error si quien llama no es Sara, o null si puede continuar. */
function exigirAdmin_(clave) {
  if (esAdmin() || claveValida_(clave)) return null;
  return { ok: false, error: 'Solo Sara puede hacer esto.', no_autorizado: true };
}

// --- Respuestas ------------------------------------------------------------

function respuestaJson_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function respuestaJsonp_(objeto, callback) {
  var nombre = String(callback).replace(/[^\w$]/g, '');
  return ContentService
    .createTextOutput(nombre + '(' + JSON.stringify(objeto) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// --- Panel de Sara ---------------------------------------------------------

function servirPanel_(clave) {
  if (!esAdmin() && !claveValida_(clave)) {
    var aviso = HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:2rem;' +
      'border:1px solid #e5e7eb;border-radius:12px;text-align:center">' +
      '<h2 style="margin:0 0 .5rem">Acceso restringido</h2>' +
      '<p style="color:#6b7280">Esta página es solo para Sara.</p>' +
      '<p style="color:#6b7280;font-size:.875rem">Has entrado con <b>' +
      (emailActual_() || 'una cuenta no identificada') + '</b>.</p>' +
      '<p style="color:#6b7280;font-size:.875rem">Si tienes el enlace privado de Sara, ' +
      'ábrelo entero: la clave va al final. Si ha dejado de funcionar, pide el enlace ' +
      'nuevo: la clave puede haber cambiado.</p>' +
      '</div>');
    // Tambien dentro del marco de clases-sara.github.io: sin esto el navegador
    // enseña "script.google.com ha rechazado la conexion" y nadie sabe que pasa
    return aviso.setTitle('Acceso restringido')
                .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var plantilla = HtmlService.createTemplateFromFile('panel');
  // La clave viaja al navegador para que las acciones del panel la lleven de vuelta
  plantilla.clave = clave ? claveDelPanel_() : '';
  return plantilla.evaluate()
    .setTitle(config('nombre_panel', 'Clases con Sarita') + ' · Panel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** El panel llama a estas funciones directamente con google.script.run. */
function apiPanel(accion, datos) {
  return enrutar_(accion, datos || {});
}

/**
 * Enlace privado de Sara. Ejecutar desde el editor para copiarlo.
 *
 * Sirve la misma URL que usa la pagina de los alumnos: publicada como "ejecutar como
 * yo" y abierta a cualquiera, esa direccion devuelve JSON cuando se le pide una accion
 * y el panel cuando se le pasa la clave. No hace falta una segunda implementacion.
 */
function enlaceDelPanel() {
  var clave = claveDelPanel_();
  var url = config('url_api', '');

  if (!url) {
    try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  }

  if (!url) {
    var aviso = 'Falta la URL. Rellena url_api en la hoja Config y vuelve a ejecutar.' +
                '\n' + 'La clave del panel es: ' + clave;
    Logger.log(aviso);
    return aviso;
  }

  var enlace = url + '?t=' + clave;

  /*
   * El segundo enlace abre el mismo panel dentro de la página de los alumnos, y así
   * se queda fuera la barra gris de Google que dice "esta aplicación la ha creado un
   * usuario de Apps Script". Ese aviso vive fuera del marco donde corre el panel, de
   * modo que no hay forma de quitarlo desde dentro.
   *
   * La clave va detrás de la almohadilla a propósito: el navegador no la manda a
   * ningún servidor, así que no queda en los registros de GitHub ni en ningún sitio.
   */
  var publica = String(config('url_publica', '')).trim();
  // Sin dirección no hay enlace limpio: normalizar antes dejaba una barra suelta
  var limpio  = publica
    ? publica.replace(/#.*$/, '').replace(/\/?$/, '/') + 'panel.html#t=' + clave
    : '';

  Logger.log('Enlace del panel de Sara:' + '\n' + '\n' + enlace + '\n' + '\n' +
             (limpio
               ? 'O este otro, sin la barra gris de Google y con mejor pinta:' +
                 '\n' + '\n' + limpio + '\n' + '\n'
               : 'Rellena url_publica en Config para tener tambien la version sin la barra de Google.\n\n') +
             'Guardalo en el movil de Sara y anadelo a su pantalla de inicio.' + '\n' +
             'Quien tenga este enlace entra: no lo publiques ni lo mezcles con el de los alumnos.');

  return limpio || enlace;
}

/** Cambia la clave: el enlace antiguo deja de servir. */
function cambiarClaveDelPanel() {
  setConfig('token_panel', generarClaveLarga_());
  return enlaceDelPanel();
}

function guardarConfigPanel_(datos) {
  var permitidas = ['telefono_sara', 'url_publica', 'url_api', 'antelacion_minima_horas',
                    'semanas_vista', 'semana_extra_desde', 'nombre_sitio', 'nombre_panel', 'avisar_por_email',
                    'separacion_minima_minutos', 'autoescuelas'];
  permitidas.forEach(function (clave) {
    if (datos[clave] === undefined) return;
    var valor = String(datos[clave]).trim();
    // El móvil se guarda ya limpio: "+376 618 090" acababa tal cual en los enlaces wa.me
    if (clave === 'telefono_sara' && valor) valor = normalizarTelefono(valor);
    setConfig(clave, valor);
  });
  return { ok: true };
}

/**
 * El panel compone los enlaces de WhatsApp en el navegador, con las plantillas que
 * recibe en datosPanel(). Así la ventana se abre dentro del propio clic de Sara y
 * el navegador no la bloquea como si fuera una ventana emergente.
 */
