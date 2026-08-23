/**
 * Horario semanal de Sara.
 *
 * La hoja HorarioBase guarda los tramos ya calculados, que es lo que consulta el
 * sistema. Pero Sara no debería tener que escribir tramo a tramo: aquí se guarda
 * su horario en forma sencilla (a qué hora empieza y acaba cada mañana y cada
 * tarde, y cuánto dura una clase) y desde ahí se generan los tramos.
 *
 * Así puede cambiar la duración de las clases o alargar una tarde desde su panel,
 * en el móvil, sin tocar la hoja de cálculo.
 */

var HORARIO_POR_DEFECTO = {
  duracion: 90,
  dias: {
    '1': { activo: true, manana: ['08:30', '13:00'], tarde: ['14:00', '18:30'] },
    '2': { activo: true, manana: ['08:30', '13:00'], tarde: ['14:00', '18:30'] },
    '3': { activo: true, manana: ['08:30', '13:00'], tarde: ['14:00', '18:30'] },
    '4': { activo: true, manana: ['08:30', '13:00'], tarde: ['14:00', '18:30'] },
    '5': { activo: true, manana: ['08:30', '13:00'], tarde: ['14:00', '17:00'] },
    '6': { activo: false, manana: ['', ''], tarde: ['', ''] },
    '7': { activo: false, manana: ['', ''], tarde: ['', ''] }
  }
};

/** Lo que el panel necesita para pintar el editor. */
function leerHorarioEditable() {
  var guardado = config('horario_config', '');
  if (!guardado) return clonar_(HORARIO_POR_DEFECTO);

  try {
    var leido = JSON.parse(guardado);
    if (!leido.dias) return clonar_(HORARIO_POR_DEFECTO);
    // Rellena los días que falten, por si la configuración viene de una versión vieja
    for (var d = 1; d <= 7; d++) {
      if (!leido.dias[d]) leido.dias[d] = clonar_(HORARIO_POR_DEFECTO.dias[d]);
    }
    if (!leido.duracion) leido.duracion = HORARIO_POR_DEFECTO.duracion;
    return leido;
  } catch (e) {
    return clonar_(HORARIO_POR_DEFECTO);
  }
}

/**
 * Guarda el horario de Sara y regenera los tramos de la hoja.
 * Las clases ya reservadas no se tocan: si una queda fuera del horario nuevo,
 * sigue en pie y Sara decide qué hacer con ella.
 */
function guardarHorario(nuevo) {
  var duracion = Math.round(Number(nuevo && nuevo.duracion) || 0);
  if (duracion < 15 || duracion > 480) {
    return { ok: false, error: 'La duración debe estar entre 15 y 480 minutos.' };
  }

  var dias = (nuevo && nuevo.dias) || {};
  var limpio = { duracion: duracion, dias: {} };
  var tramos = [];

  for (var d = 1; d <= 7; d++) {
    var dia = dias[d] || dias[String(d)] || { activo: false };
    var manana = normalizarTramo_(dia.manana);
    var tarde  = normalizarTramo_(dia.tarde);
    var activo = !!dia.activo && (manana || tarde);

    limpio.dias[d] = {
      activo: activo,
      manana: manana || ['', ''],
      tarde: tarde || ['', '']
    };
    if (!activo) continue;

    /*
     * Se guarda la ventana entera, no las clases ya cortadas.
     *
     * Antes esto escribía una fila por clase: 08:30, 10:00, 11:30… y esas casillas
     * eran lo único que se podía ofrecer. Si Sara tenía médico hasta las nueve, la
     * casilla de las 08:30 se caía entera y hasta las diez no había nada. Guardando
     * "de 08:30 a 13:00" y repartiendo sobre lo que quede libre, la clase se ofrece
     * a las nueve en punto.
     */
    if (manana) tramos.push([d, manana[0], manana[1], 'SI']);
    if (tarde)  tramos.push([d, tarde[0], tarde[1], 'SI']);
  }

  if (!tramos.length) {
    return { ok: false, error: 'No queda ninguna franja. Revisa las horas.' };
  }

  // Una ventana donde no cabe ni una clase no sirve de nada, y suele ser un desliz
  var caben = tramos.reduce(function (total, ventana) {
    return total + clasesQueCaben_(ventana[1], ventana[2], duracion);
  }, 0);

  if (!caben) {
    return {
      ok: false,
      error: 'Con esas horas no cabe ninguna clase de ' + duracion + ' minutos.'
    };
  }

  escribirHorarioBase_(tramos);
  setConfig('horario_config', JSON.stringify(limpio));
  setConfig('duracion_minutos', String(duracion));

  CacheService.getScriptCache().remove('horario');
  olvidarDisponibilidad();

  // 'clases' es lo que le interesa a Sara; 'tramos' son las ventanas guardadas
  return { ok: true, tramos: tramos.length, clases: caben, horario: limpio };
}

/** ['08:30','13:00'] si el tramo es válido, o null. */
function normalizarTramo_(tramo) {
  if (!tramo || tramo.length < 2) return null;
  var inicio = aHoraHHMM(String(tramo[0] || '').trim());
  var fin    = aHoraHHMM(String(tramo[1] || '').trim());

  if (!/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fin)) return null;
  if (enMinutos(fin) <= enMinutos(inicio)) return null;
  return [inicio, fin];
}

/** Cuántas clases caben de seguido en un rango. Solo para enseñárselo a Sara. */
function clasesQueCaben_(inicio, fin, duracion) {
  return Math.floor((enMinutos(fin) - enMinutos(inicio)) / duracion);
}

function escribirHorarioBase_(tramos) {
  var hoja = getHoja(HOJA_HORARIO);
  var ultima = hoja.getLastRow();
  if (ultima > 1) hoja.getRange(2, 1, ultima - 1, 4).clearContent();
  hoja.getRange(2, 1, tramos.length, 4).setValues(tramos);
}

function clonar_(objeto) {
  return JSON.parse(JSON.stringify(objeto));
}

// --- Horario extendido: días sueltos en los que Sara alarga la jornada ----------

/*
 * Hay semanas en las que Sara quiere meter más clases: empezar a las ocho y acabar
 * a las ocho y media de la tarde. No es su horario de siempre, y cambiar el habitual
 * para volver a cambiarlo después es un lío. Así que el horario extendido es una
 * franja ("de 08:00 a 20:30") que ella enciende en días concretos desde el panel.
 *
 * En un día marcado la jornada se estira por los dos lados: empieza a la hora del
 * extendido y acaba a su hora, y el descanso del mediodía que tenga ese día de la
 * semana se respeta. Si es un día que normalmente no trabaja, vale la franja entera.
 *
 * Se guarda en Config como 'horario_extendido' y no toca HorarioBase: los días
 * marcados son excepciones, no reglas.
 */
var HORARIO_EXTENDIDO_POR_DEFECTO = { tramo: ['08:00', '20:30'], fechas: [] };

// Se lee varias veces por petición (una por día ofrecido); con una vale
var _extendido = null;

/** { tramo: ['08:00', '20:30'], fechas: ['2026-08-25', …] }, solo fechas de hoy en adelante. */
function leerHorarioExtendido() {
  if (_extendido) return clonar_(_extendido);

  var leido = null;
  var guardado = config('horario_extendido', '');
  if (guardado) {
    try { leido = JSON.parse(guardado); } catch (e) { leido = null; }
  }

  var tramo = normalizarTramo_(leido && leido.tramo) || HORARIO_EXTENDIDO_POR_DEFECTO.tramo.slice();
  var hoy = hoyISO();
  var fechas = fechasLimpias_(leido && leido.fechas).filter(function (f) { return f >= hoy; });

  _extendido = { tramo: tramo, fechas: fechas };
  return clonar_(_extendido);
}

/**
 * Guarda la franja y los días en los que se aplica. Las fechas pasadas se tiran:
 * no sirven para nada y la lista crecería sin parar.
 */
function guardarHorarioExtendido(nuevo) {
  var tramo = normalizarTramo_(nuevo && nuevo.tramo);
  if (!tramo) {
    return { ok: false, error: 'Revisa las horas: la de fin tiene que ir después de la de inicio.' };
  }

  var hoy = hoyISO();
  var fechas = fechasLimpias_(nuevo && nuevo.fechas).filter(function (f) { return f >= hoy; });

  var limpio = { tramo: tramo, fechas: fechas };
  setConfig('horario_extendido', JSON.stringify(limpio));
  _extendido = null;
  olvidarDisponibilidad();

  return { ok: true, horario_extendido: limpio };
}

/** Fechas 'YYYY-MM-DD' válidas, sin repetidas y en orden. */
function fechasLimpias_(lista) {
  var vistas = {};
  var salida = [];
  [].concat(lista || []).forEach(function (f) {
    var fecha = aFechaISO(f);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || vistas[fecha]) return;
    vistas[fecha] = true;
    salida.push(fecha);
  });
  return salida.sort();
}

/**
 * Las ventanas de trabajo de un día concreto: las de ese día de la semana, estiradas
 * si es un día con horario extendido.
 *
 * Es la única puerta por la que la disponibilidad, los ratos libres del panel y la
 * validación de una reserva preguntan "¿a qué horas trabaja Sara tal día?". Así los
 * tres ven lo mismo.
 */
function ventanasDelDia_(horario, fecha) {
  var base = horario[diaSemanaIso(aDate(fecha, '00:00'))] || [];
  var extendido = leerHorarioExtendido();
  if (extendido.fechas.indexOf(fecha) === -1) return base;

  var inicio = extendido.tramo[0];
  var fin    = extendido.tramo[1];
  if (!base.length) return [{ hora_inicio: inicio, hora_fin: fin }];

  var ventanas = base.map(function (v) {
    return { hora_inicio: v.hora_inicio, hora_fin: v.hora_fin };
  });
  var primera = ventanas[0];
  var ultima  = ventanas[ventanas.length - 1];
  if (enMinutos(inicio) < enMinutos(primera.hora_inicio)) primera.hora_inicio = inicio;
  if (enMinutos(fin) > enMinutos(ultima.hora_fin)) ultima.hora_fin = fin;
  return ventanas;
}

/** ¿Es un día con la jornada alargada? Para que el panel lo señale. */
function esDiaExtendido_(fecha) {
  return leerHorarioExtendido().fechas.indexOf(fecha) !== -1;
}
