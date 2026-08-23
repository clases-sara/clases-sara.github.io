/**
 * Avisos.
 *
 * A Sara: un correo por solicitud, con todas las horas pedidas. Lo dispara la página
 * del alumno en cuanto ve su confirmación, no la propia reserva: enviarlo dentro de la
 * reserva le hacía esperar casi un segundo por algo que no le afecta.
 *
 * Al alumno: nada automático. El panel abre WhatsApp con el mensaje ya redactado y
 * Sara solo pulsa enviar, desde su WhatsApp de siempre. Un único mensaje por alumno,
 * con el resumen de todas sus clases.
 *
 * El día que se contrate una API de WhatsApp basta con implementar enviarWhatsApp_().
 */

/**
 * Envía el correo de una solicitud ya guardada, a partir de las clases que la
 * componen. La marca en caché evita mandarlo dos veces si la página repite la
 * llamada.
 */
function avisarDeReservas(ids) {
  var lista = [].concat(ids || []).filter(Boolean);
  if (!lista.length) return { ok: false, error: 'Falta la solicitud.' };

  var huella = lista.join('|');
  var cache = CacheService.getScriptCache();
  if (cache.get('avisado_' + huella)) return { ok: true, repetido: true };
  cache.put('avisado_' + huella, '1', 1800);

  var pedidos = {};
  lista.forEach(function (id) { pedidos[String(id).trim()] = true; });

  var reservas = filasComoObjetos(getHoja(HOJA_RESERVAS))
    .filter(function (f) { return pedidos[String(f.id).trim()]; })
    .map(reservaCompleta_);

  if (!reservas.length) return { ok: false, error: 'Solicitud no encontrada.' };

  avisarSaraNuevaSolicitud(reservas);
  return { ok: true };
}

/** Recibe una reserva o la lista de horas pedidas de una vez. */
function avisarSaraNuevaSolicitud(reservas) {
  if (String(config('avisar_por_email', 'SI')).toUpperCase() !== 'SI') return;

  var destino = primerEmailAdmin_();
  if (!destino) return;

  var lista = [].concat(reservas);
  if (!lista.length) return;
  var primera = lista[0];

  var asunto = lista.length === 1
    ? 'Nueva solicitud · ' + primera.etiqueta_fecha + ' a las ' + primera.hora_inicio
    : 'Nueva solicitud · ' + lista.length + ' clases de ' + primera.nombre;

  var cuerpo =
    primera.nombre + ' ha solicitado ' +
    (lista.length === 1 ? 'una clase' : lista.length + ' clases') + '.\n\n' +
    listaDeClases(lista, '  · ') + '\n\n' +
    'Móvil: ' + primera.telefono + '\n' +
    (primera.notas ? 'Nota: ' + primera.notas + '\n' : '') +
    '\nEntra en tu panel para confirmar o rechazar.';

  enviarEmail_(destino, asunto, cuerpo);
}

function enviarEmail_(destino, asunto, cuerpo) {
  try {
    MailApp.sendEmail(destino, asunto, cuerpo);
  } catch (e) {
    Logger.log('No se pudo enviar el aviso por email: ' + e.message);
  }
}

// --- Mensajes de WhatsApp ---------------------------------------------------

/**
 * Plantillas por estado. Van sin saludo a propósito: el alumno ya sabe quién le
 * escribe, porque le llega desde el WhatsApp de Sara.
 *
 * Hay dos versiones de cada una, para una clase y para varias. Escribir "estas
 * clases" cuando solo hay una canta mucho, y son mensajes que se leen a diario.
 *
 * El enlace va siempre solo en su línea y es el corto de la página: WhatsApp
 * convierte ese en enlace pulsable, mientras que la dirección larga de Google la
 * dejaba como texto plano.
 *
 * Marcadores:
 *   {clases}  la clase, o la lista de clases una por línea
 *   {motivo}  lo que Sara escriba, entre paréntesis, o nada
 *   {enlace}  enlace público de la página
 */
function plantillasWhatsApp() {
  return {
    pendiente:      'He recibido tu solicitud:\n{clases}\nTe confirmo en breve.',
    pendiente_una:  'He recibido tu solicitud para {clases}. Te confirmo en breve.',

    confirmada:     'Te confirmo estas clases:\n{clases}\n¡Nos vemos!\nAquí las tienes, y puedes añadirlas a tu calendario:\n{enlace}',
    confirmada_una: 'Te confirmo la clase de {clases}. ¡Nos vemos!\nAquí la tienes, y puedes añadirla a tu calendario:\n{enlace}',

    rechazada:      'No voy a poder darte estas horas:\n{clases}{motivo}\nPuedes elegir otras aquí:\n{enlace}',
    rechazada_una:  'No voy a poder darte la clase de {clases}{motivo}\nPuedes elegir otra hora aquí:\n{enlace}',

    cancelada:      'He tenido que anular estas clases:\n{clases}{motivo}\nPuedes elegir otras aquí:\n{enlace}',
    cancelada_una:  'He tenido que anular la clase de {clases}{motivo}\nPuedes elegir otra hora aquí:\n{enlace}'
  };
}

/** 'mañana viernes 21, de 08:30 a 10:00'. */
function textoDeClase(reserva) {
  if (reserva.cuando) return reserva.cuando;
  // Por si llega una reserva armada a mano, sin el texto ya hecho
  return fechaCercana(reserva.fecha) + ', de ' + reserva.hora_inicio + ' a ' + reserva.hora_fin;
}

function listaDeClases(reservas, prefijo) {
  return [].concat(reservas).map(function (r) {
    return (prefijo || '• ') + textoDeClase(r);
  }).join('\n');
}

function rellenarPlantilla(plantilla, valores) {
  var texto = String(plantilla)
    .replace('{clases}', valores.clases || '')
    .replace('{motivo}', valores.motivo || '')
    .replace('{enlace}', valores.enlace || '');

  // Sin enlace configurado se cae también la frase que lo anunciaba
  if (!valores.enlace) {
    texto = texto
      .replace('\nAquí las tienes, y puedes añadirlas a tu calendario:\n', '')
      .replace('\nAquí la tienes, y puedes añadirla a tu calendario:\n', '')
      .replace('\nPuedes elegir otras aquí:\n', '')
      .replace('\nPuedes elegir otra hora aquí:\n', '');
  }
  return texto.trim();
}

/**
 * Un solo mensaje para todas las clases de un alumno.
 * Acepta una reserva suelta o una lista.
 */
function textoWhatsAppAlumno(reservas, motivo, clave) {
  var lista = [].concat(reservas);
  if (!lista.length) return '';

  var plantillas = plantillasWhatsApp();
  var estado     = clave || lista[0].estado;
  var una        = lista.length === 1;

  var plantilla = (una && plantillas[estado + '_una']) ||
                  plantillas[estado] ||
                  plantillas.pendiente;

  var textoMotivo = motivo || lista[0].motivo_rechazo || '';

  return rellenarPlantilla(plantilla, {
    // Una sola clase va dentro de la frase; varias, en lista con viñetas
    clases: una ? textoDeClase(lista[0]) : listaDeClases(lista),
    motivo: textoMotivo
      ? (una ? ' (' + textoMotivo + ').' : '\n(' + textoMotivo + ')')
      : (una ? '.' : ''),
    enlace: enlaceParaElAlumno_(estado)
  });
}

/**
 * Enlace público. Cuando la clase queda confirmada se apunta a la pestaña de sus
 * clases, que es donde tiene el botón de añadirla al calendario.
 */
function enlaceParaElAlumno_(estado) {
  var base = config('url_publica', '');
  if (!base) return '';
  return estado === 'confirmada' ? base.replace(/#.*$/, '') + '#mis-clases' : base;
}

/** Enlace que abre WhatsApp con el mensaje ya escrito. */
function enlaceWhatsApp(telefono, texto) {
  return 'https://wa.me/' + normalizarTelefono(telefono) + '?text=' + encodeURIComponent(texto);
}

function primerEmailAdmin_() {
  var lista = String(config('email_admin', '')).split(',');
  return lista.length ? lista[0].trim() : '';
}

/**
 * Punto de extensión para el día que haya API de WhatsApp (Meta Cloud API o WATI).
 * Implementar aquí y llamarla desde avisarSara* y desde los cambios de estado.
 */
function enviarWhatsApp_(telefono, texto) {
  throw new Error('Sin API de WhatsApp configurada. Se usan enlaces wa.me desde el panel.');
}
