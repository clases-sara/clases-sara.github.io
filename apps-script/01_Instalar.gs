/**
 * Instalación. Ejecutar instalar() UNA VEZ desde el editor de Apps Script.
 * Crea la hoja de cálculo, el calendario de disponibilidad y la configuración inicial.
 * Es idempotente: si vuelves a ejecutarlo no duplica nada.
 */

var NOMBRE_SHEET    = 'SARA · Reservas de clases';
var NOMBRE_CALENDAR = 'Clases – disponibilidad';

function instalar() {
  var props = PropertiesService.getScriptProperties();
  var ss;

  var idExistente = props.getProperty(PROP_SHEET_ID);
  if (idExistente) {
    ss = SpreadsheetApp.openById(idExistente);
  } else {
    ss = SpreadsheetApp.create(NOMBRE_SHEET);
    props.setProperty(PROP_SHEET_ID, ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);

  crearHojaReservas_(ss);
  crearHojaHorario_(ss);
  crearHojaConfig_(ss);

  var hojaPorDefecto = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hojaPorDefecto && ss.getSheets().length > 1) ss.deleteSheet(hojaPorDefecto);

  var calendarId = asegurarCalendario_();
  setConfig('calendar_id', calendarId);

  // Si aún no hay tramos, se generan a partir del horario por defecto
  if (getHoja(HOJA_HORARIO).getLastRow() < 2) guardarHorario(leerHorarioEditable());

  claveDelPanel_();   // deja la clave del enlace privado creada

  // Se pone al día sola cada cuarto de hora, aunque Sara no abra el panel
  var revision = 'no';
  try {
    activarRevisionAutomatica();
    revision = 'cada 15 minutos';
  } catch (e) {
    Logger.log('No se pudo activar la revisión automática: ' + e.message);
  }

  var resumen =
    'Instalación completada.\n\n' +
    'Hoja de cálculo: ' + ss.getUrl() + '\n' +
    'Calendario: ' + NOMBRE_CALENDAR + '\n' +
    'ID de calendario: ' + calendarId + '\n\n' +
    'Revisión automática: ' + revision + '\n\n' +
    'Siguiente paso: abre la hoja "Config" y rellena telefono_sara y email_admin.';
  Logger.log(resumen);
  return resumen;
}

function crearHojaReservas_(ss) {
  var hoja = ss.getSheetByName(HOJA_RESERVAS);
  if (hoja) return ocultarColumnasTecnicas_(asegurarColumnas_(hoja));

  hoja = ss.insertSheet(HOJA_RESERVAS);
  hoja.getRange(1, 1, 1, COLS_RESERVAS.length).setValues([COLS_RESERVAS])
      .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  hoja.setFrozenRows(1);
  // Fecha y horas como texto: evita que Sheets las reinterprete con otra zona horaria
  hoja.getRange('C:E').setNumberFormat('@');
  hoja.setColumnWidth(2, 140);
  hoja.setColumnWidth(9, 220);
  return ocultarColumnasTecnicas_(hoja);
}

/**
 * Esconde las columnas que solo usa el sistema.
 *
 * El identificador de la reserva y el del evento hacen falta para que Sara pueda
 * confirmar desde el panel y para que el calendario y la hoja vayan de la mano, pero
 * a ella no le dicen nada. Se quedan ahí, sin estorbar.
 */
function ocultarColumnasTecnicas_(hoja) {
  var cabecera = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0];

  COLS_OCULTAS.forEach(function (col) {
    var donde = cabecera.indexOf(col);
    if (donde !== -1) hoja.hideColumns(donde + 1);
  });
  return hoja;
}

function crearHojaHorario_(ss) {
  var hoja = ss.getSheetByName(HOJA_HORARIO);
  if (hoja) return hoja;
  hoja = ss.insertSheet(HOJA_HORARIO);
  hoja.getRange(1, 1, 1, 4).setValues([['dia_semana', 'hora_inicio', 'hora_fin', 'activo']])
      .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  hoja.setFrozenRows(1);
  hoja.getRange('B:C').setNumberFormat('@');
  // Los tramos los genera el horario editable: clases de 90 minutos desde las 08:30
  return hoja;
}

function crearHojaConfig_(ss) {
  var hoja = ss.getSheetByName(HOJA_CONFIG);
  var nueva = !hoja;

  if (nueva) {
    hoja = ss.insertSheet(HOJA_CONFIG);
    hoja.getRange(1, 1, 1, 3).setValues([['clave', 'valor', 'descripcion']])
        .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
  }

  var filas = [
    ['nombre_sitio', 'Clases con Sara', 'Título que ve el alumno en su página'],
    ['nombre_panel', 'Clases con Sarita', 'Título que ve Sara en su panel. Si se deja vacío, usa el del alumno'],
    ['email_admin', Session.getEffectiveUser().getEmail(), 'Correos que pueden entrar al panel (separados por coma)'],
    ['telefono_sara', '', 'Móvil de Sara con prefijo de país y sin signos, ej. 376000000'],
    ['calendar_id', '', 'Calendario de Sara: sus bloqueos y sus clases. Se rellena solo al instalar'],
    ['antelacion_minima_horas', '6', 'Horas mínimas de antelación para reservar por la web'],
    ['semanas_vista', '2', 'Semanas naturales que ve el alumno: 2 = esta y la siguiente'],
    ['semana_extra_desde', '', 'Día de la semana (1=lunes … 7=domingo) a partir del cual se abre una semana más. Ej. 4: de jueves a domingo se ve una semana más. Vacío = nunca'],
    ['autoescuelas', 'Andorra; Encamp', 'Autoescuelas separadas por punto y coma. Con la direccion detras de un igual sale en el calendario: Andorra = Av. Meritxell 1'],
    ['tipos_clase', 'Campo, Circulación', 'Tipos de clase entre los que Sara elige al confirmar, separados por comas'],
    ['max_horas_por_reserva', '20', 'Tope técnico de horas por solicitud, para que nadie vacíe el calendario por error'],
    ['separacion_minima_minutos', '60', 'Descanso mínimo entre dos clases del mismo alumno el mismo día. 0 para permitirlas pegadas'],
    ['duracion_minutos', '90', 'Duración de la clase que pide el alumno. Sara puede recortarla al confirmar'],
    ['traslado_minutos', '25', 'Rato de coche entre autoescuelas. Solo se cuenta cuando la clase de al lado es de otra'],
    ['duracion_minima_minutos', '45', 'La clase más corta que Sara da. Los ratos libres a partir de aquí salen marcados en su agenda'],
    ['redondeo_minutos', '15', 'A qué múltiplo se redondean las horas cuando el calendario obliga a una hora rara'],
    ['cancelacion_horas', '24', 'Por debajo de esto la cancelación se marca como tardía'],
    ['avisar_por_email', 'SI', 'Enviar email a Sara con cada solicitud nueva'],
    ['url_publica', '', 'Enlace que Sara comparte. Se usa en los mensajes'],
    ['url_api', '', 'URL de la implementación API, terminada en /exec. Sin ella no se ofrece el añadir al calendario'],
    ['token_panel', '', 'Clave del enlace privado del panel. Se genera sola; cámbiala si el enlace se filtra']
  ];
  if (nueva) {
    hoja.getRange(2, 1, filas.length, 3).setValues(filas);
    hoja.setColumnWidth(1, 200);
    hoja.setColumnWidth(2, 260);
    hoja.setColumnWidth(3, 420);
    return hoja;
  }

  // Ya existía: se añaden solo los ajustes nuevos, sin tocar los valores de Sara
  var existentes = {};
  filasComoObjetos(hoja).forEach(function (f) {
    if (f.clave) existentes[String(f.clave).trim()] = true;
  });

  var pendientes = filas.filter(function (f) { return !existentes[f[0]]; });
  if (pendientes.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, pendientes.length, 3).setValues(pendientes);
  }
  return hoja;
}

/**
 * Añade a la hoja de reservas las columnas que falten, sin tocar los datos que ya haya.
 * Permite ampliar el sistema sin rehacer la hoja ni perder el histórico.
 */
function asegurarColumnas_(hoja) {
  var actuales = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0];
  var faltan = [];

  COLS_RESERVAS.forEach(function (col) {
    if (actuales.indexOf(col) === -1) faltan.push(col);
  });

  if (faltan.length) {
    hoja.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan])
        .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  }
  return hoja;
}

/**
 * Crea en el calendario un bloqueo semanal de los miércoles por la mañana, que es
 * cuando suele haber exámenes. Sara borra la semana concreta que no lo necesite,
 * desde su propio calendario y sin tocar nada más.
 *
 * Ejecutar a mano una vez, si se quiere. No forma parte de instalar().
 */
function bloquearMiercolesManana() {
  var calId = config('calendar_id', '');
  if (!calId) throw new Error('Ejecuta instalar() primero.');
  var cal = CalendarApp.getCalendarById(calId);

  var hoy = ahora();
  var dias = (3 - diaSemanaIso(hoy) + 7) % 7;   // próximo miércoles
  if (dias === 0) dias = 7;
  var primer = sumarDias(hoy, dias);

  var inicio = new Date(primer.getFullYear(), primer.getMonth(), primer.getDate(), 9, 0, 0);
  var fin    = new Date(primer.getFullYear(), primer.getMonth(), primer.getDate(), 13, 0, 0);
  var hasta  = sumarDias(hoy, 365);

  cal.createEventSeries(
    'Exámenes',
    inicio,
    fin,
    CalendarApp.newRecurrence().addWeeklyRule().onlyOnWeekday(CalendarApp.Weekday.WEDNESDAY).until(hasta)
  );

  var mensaje = 'Miércoles de 09:00 a 13:00 bloqueados durante un año, a partir del ' +
                Utilities.formatDate(inicio, TZ, 'dd/MM/yyyy') + '.\n' +
                'Sara puede borrar la semana suelta que no haga falta desde su calendario.';
  Logger.log(mensaje);
  return mensaje;
}

/** Crea el calendario dedicado si no existe. Nunca toca el calendario personal. */
function asegurarCalendario_() {
  var existentes = CalendarApp.getCalendarsByName(NOMBRE_CALENDAR);
  if (existentes && existentes.length > 0) return existentes[0].getId();

  var cal = CalendarApp.createCalendar(NOMBRE_CALENDAR, {
    summary: 'Horas que Sara tapa y clases confirmadas con sus alumnos',
    timeZone: TZ,
    color: CalendarApp.Color.ORANGE
  });
  return cal.getId();
}

function dosDigitos_(n) {
  return ('0' + n).slice(-2);
}

/** Utilidad de mantenimiento: muestra la URL de la hoja en el registro. */
function verHojaDeCalculo() {
  Logger.log(getSpreadsheet().getUrl());
}
