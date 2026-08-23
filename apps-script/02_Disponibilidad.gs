/**
 * Cálculo de huecos libres.
 *
 * LIBRE = ventanas de trabajo del día
 *         − eventos del calendario "Clases – disponibilidad"
 *         − reservas pendientes o confirmadas
 *         − el rato de traslado, si la clase de al lado es de otra autoescuela
 *         − franjas dentro de la antelación mínima  (se muestran como "urgente")
 *
 * El horario no son casillas fijas, sino ventanas: "los lunes, de 08:30 a 13:00".
 * Dentro de lo que quede libre, las clases se ofrecen pegadas a algo: al principio
 * de la ventana, justo cuando acaba un evento, justo cuando acaba otra clase, o
 * terminando al final de la ventana. Nunca flotando en medio.
 *
 * Con casillas fijas, un médico de 08:00 a 09:00 tiraba la clase de 08:30 entera y
 * la siguiente hora no se ofrecía a nadie: se perdían sesenta minutos vendibles.
 * Ahora la clase se ofrece a las 09:00, en cuanto Sara sale del médico.
 */

/**
 * Devuelve los días con sus franjas desde hoy hasta el final de la semana que viene.
 *
 * No son "catorce días", sino semanas naturales: lo que queda de esta semana más la
 * siguiente entera. Así un viernes se ven dos días y la semana que viene completa,
 * en vez de un trozo suelto de tres semanas distintas.
 */
function obtenerDisponibilidad(escuela) {
  // Cada autoescuela ve horas distintas, porque el rato de traslado no es el mismo
  var slug = escuela ? slugDeEscuela_(escuela) : '';
  var clave = 'disponibilidad_' + (slug || 'todas');

  // Consultar la hoja y el calendario cuesta unos tres segundos, y varios alumnos
  // mirando a la vez piden exactamente lo mismo. Se guarda medio minuto; al reservar
  // se vuelve a comprobar contra los datos reales, así que nadie pilla un hueco muerto.
  var cache = CacheService.getScriptCache();
  var guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);

  var respuesta;
  try {
    respuesta = calcularDisponibilidad_(escuela);
  } catch (e) {
    if (String(e.message).indexOf('CALENDARIO_INACCESIBLE') === -1) throw e;
    avisarDelCalendario_();
    return {
      dias: [],
      sin_calendario: true,
      telefono_sara: telefonoSara(),
      nombre_sitio: config('nombre_sitio', 'Clases con Sara')
    };
  }

  cache.put(clave, JSON.stringify(respuesta), 30);
  return respuesta;
}

/** Avisa a Sara, como mucho una vez cada seis horas para no llenarle el correo. */
function avisarDelCalendario_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('aviso_calendario')) return;
  cache.put('aviso_calendario', '1', 21600);

  var destino = primerEmailAdmin_();
  if (!destino) return;

  enviarEmail_(destino, 'Tus alumnos no pueden reservar',
    'El calendario de disponibilidad no responde, así que la página no está ofreciendo ' +
    'ninguna hora.\n\nSuele pasar si el calendario se ha borrado o si se ha retirado el ' +
    'acceso. Revisa que sigue existiendo el calendario indicado en calendar_id de la hoja ' +
    'Config.\n\nPrefiero no ofrecer nada antes que ofrecer horas que quizá no tengas libres.');
}

/**
 * Se llama al reservar, cancelar o cambiar el estado de una reserva.
 * Hay una copia guardada por autoescuela, y todas se quedan viejas a la vez.
 */
function olvidarDisponibilidad() {
  var claves = ['disponibilidad', 'disponibilidad_todas', 'libres_panel'];
  try {
    listaDeEscuelas().forEach(function (e) { claves.push('disponibilidad_' + e.slug); });
  } catch (err) { /* todavía sin configuración */ }

  CacheService.getScriptCache().removeAll(claves);
}

function calcularDisponibilidad_(escuela) {
  var minHoras  = configNum('antelacion_minima_horas', 6);
  var ahoraTs   = ahora().getTime();
  var limiteTs  = ahoraTs + minHoras * 3600 * 1000;

  var desde     = ahora();
  var diaHoy    = diaSemanaIso(desde);      // 1 = lunes … 7 = domingo
  var totalDias = diasQueSeOfrecen_();
  var hasta     = sumarDias(desde, totalDias);

  var horario  = leerHorarioBase_();
  // Desde el principio de hoy, no desde ahora: un bloqueo que acabó a las 08:50
  // también empuja las clases de después, y al reservar se valida con el día entero.
  // Leer solo desde ahora ofrecía horas que el servidor luego rechazaba.
  var ocupados = leerEventosOcupados_(aDate(hoyISO(), '00:00'), hasta);
  var reservas = indexarReservasActivas_();
  var reglas   = reglasDeHuecos_(escuela);

  var dias = [];
  for (var i = 0; i < totalDias; i++) {
    var dia     = sumarDias(desde, i);
    var fecha   = Utilities.formatDate(dia, TZ, 'yyyy-MM-dd');
    var diaSem  = diaSemanaIso(dia);
    // Las del día de la semana, o más largas si Sara ha marcado ese día como extendido
    var ventanas = ventanasDelDia_(horario, fecha);
    if (ventanas.length === 0) continue;

    var franjas = ofertasDelDia_(fecha, ventanas, ocupados, reservas, reglas)
      .filter(function (oferta) {
        return aDate(fecha, oferta.hora_fin).getTime() > ahoraTs;   // ya pasó
      })
      .map(function (oferta) {
        return {
          hora_inicio: oferta.hora_inicio,
          hora_fin: oferta.hora_fin,
          estado: aDate(fecha, oferta.hora_inicio).getTime() < limiteTs ? 'urgente' : 'libre'
        };
      });

    if (franjas.length > 0) {
      dias.push({
        fecha: fecha,
        etiqueta: fechaLarga(fecha),
        dia_nombre: nombreDia(diaSem),
        dia_num: dia.getDate(),
        es_hoy: fecha === hoyISO(),
        // 0 = lo que queda de esta semana, 1 = la semana que viene, etc.
        semana: Math.floor((i + diaHoy - 1) / 7),
        franjas: franjas
      });
    }
  }

  return {
    dias: dias,
    antelacion_minima_horas: minHoras,
    cancelacion_horas: configNum('cancelacion_horas', 24),
    max_por_reserva: configNum('max_horas_por_reserva', 20),
    separacion_minima: configNum('separacion_minima_minutos', 60),
    telefono_sara: telefonoSara(),
    nombre_sitio: config('nombre_sitio', 'Clases con Sara'),
    escuelas: listaDeEscuelas()
  };
}

/**
 * Los ratos libres de Sara, día a día, para su panel.
 *
 * Es la misma resta que ve el alumno (horario − calendario − clases), pero sin
 * trocearla en clases de hora y media ni esconder lo que queda dentro de la
 * antelación mínima: Sara quiere ver el rato entero que tiene libre para rellenarlo
 * ella desde el calendario o llamando a quien le convenga. Solo se enseña lo que da
 * al menos para la clase más corta que da.
 *
 * Cada rato dice de qué autoescuela es la clase que tiene pegada a cada lado: con
 * eso el panel sabe si el traslado se come parte del hueco y para quién vale.
 */
function huecosLibresParaPanel() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('libres_panel');
  if (guardado) return JSON.parse(guardado);

  var salida;
  try {
    salida = calcularLibresParaPanel_();
  } catch (e) {
    if (String(e.message).indexOf('CALENDARIO_INACCESIBLE') === -1) throw e;
    return { dias: [], sin_calendario: true };
  }

  cache.put('libres_panel', JSON.stringify(salida), 30);
  return salida;
}

function calcularLibresParaPanel_() {
  var desde     = ahora();
  var ahoraTs   = desde.getTime();
  var totalDias = diasQueSeOfrecen_();
  var hasta     = sumarDias(desde, totalDias);
  var minima    = configNum('duracion_minima_minutos', 45);
  var paso      = configNum('redondeo_minutos', 15);

  var horario  = leerHorarioBase_();
  var ocupados = leerEventosOcupados_(aDate(hoyISO(), '00:00'), hasta);
  var reservas = indexarReservasActivas_();

  var dias = [];
  for (var i = 0; i < totalDias; i++) {
    var dia      = sumarDias(desde, i);
    var fecha    = Utilities.formatDate(dia, TZ, 'yyyy-MM-dd');
    var ventanas = ventanasDelDia_(horario, fecha);
    if (!ventanas.length) continue;

    var ocupaciones = ocupacionesDelDia_(fecha, ocupados, reservas[fecha]);
    // Lo de hoy que ya ha pasado no está libre: se corta por la hora actual
    var yaPasado = Math.max(0, Math.ceil((ahoraTs - aDate(fecha, '00:00').getTime()) / 60000));

    var tramos = [];
    ventanas.forEach(function (ventana) {
      var marco = { ini: enMinutos(ventana.hora_inicio), fin: enMinutos(ventana.hora_fin) };

      intervalosLibres_(marco, ocupaciones).forEach(function (libre) {
        var ini = Math.max(libre.ini, redondearArriba_(yaPasado, paso));
        var fin = Math.min(libre.fin, 1439);
        if (fin - ini < minima) return;

        tramos.push({
          hora_inicio: deMinutos(ini),
          hora_fin: deMinutos(fin),
          minutos: fin - ini,
          esc_izq: libre.escIzq || '',
          esc_der: libre.escDer || ''
        });
      });
    });

    if (!tramos.length) continue;

    var total = 0;
    tramos.forEach(function (t) { total += t.minutos; });
    var diaLibre = { fecha: fecha, minutos: total, tramos: tramos };
    // Que el panel pueda decir por qué ese día tiene más horas de lo normal
    if (esDiaExtendido_(fecha)) diaLibre.extendido = true;
    dias.push(diaLibre);
  }

  return { dias: dias, examenes: examenesParaPanel_(aDate(hoyISO(), '00:00'), hasta) };
}

/**
 * Los exámenes que Sara tiene reservados en el calendario, para su agenda.
 *
 * No son clases, pero son horas de trabajo y parte de su día: los miércoles por la
 * mañana está en el examen y quiere verlo en la cronología del panel, contado en
 * las horas de la semana. Se reconocen por el título ("Examen", "Exámenes",
 * "Exàmens"), igual que en el parte semanal. Lo demás del calendario (médico,
 * vacaciones) sigue siendo un bloqueo mudo.
 */
function examenesParaPanel_(desde, hasta) {
  var calId = config('calendar_id', '');
  if (!calId) return [];

  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) return [];

  var salida = [];
  cal.getEvents(desde, hasta).forEach(function (ev) {
    if (ev.isAllDayEvent() || !esTituloDeExamen_(ev.getTitle())) return;
    salida.push({
      fecha: Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd'),
      hora_inicio: Utilities.formatDate(ev.getStartTime(), TZ, 'HH:mm'),
      hora_fin: Utilities.formatDate(ev.getEndTime(), TZ, 'HH:mm'),
      titulo: String(ev.getTitle() || '').trim()
    });
  });

  salida.sort(function (a, b) {
    return (a.fecha + a.hora_inicio) < (b.fecha + b.hora_inicio) ? -1 : 1;
  });
  return salida;
}

function esTituloDeExamen_(titulo) {
  return /ex[aàá]m/i.test(String(titulo || ''));
}

/**
 * Cuántos días por delante se ofrecen: lo que queda de esta semana más las siguientes.
 *
 * Semanas naturales, no "catorce días": un viernes se ven dos días y la semana que
 * viene entera, en vez de un trozo suelto de tres semanas distintas.
 */
function diasQueSeOfrecen_() {
  var diaHoy  = diaSemanaIso(ahora());
  var semanas = configNum('semanas_vista', 2);

  /*
   * Una semana más a partir de cierto día. Los exámenes son los miércoles: quien
   * suspende quiere coger clases de la semana siguiente ese mismo día, no esperar
   * al lunes a que se abra. Con semana_extra_desde = 4, de jueves a domingo se ve
   * una semana más que de lunes a miércoles. Vacío o 0 = nunca.
   */
  var desde = configNum('semana_extra_desde', 0);
  if (desde >= 1 && desde <= 7 && diaHoy >= desde) semanas += 1;

  return (7 - diaHoy) + ((semanas - 1) * 7) + 1;
}

/**
 * El último día que se puede pedir, en 'YYYY-MM-DD'.
 *
 * La página enseña dos semanas, pero la dirección de la API es pública y acepta lo
 * que le manden: sin este tope, cualquiera podía pedir una clase para dentro de tres
 * años y ocupar un hueco que Sara no ve venir.
 */
function ultimoDiaOfrecido_() {
  return Utilities.formatDate(sumarDias(ahora(), diasQueSeOfrecen_() - 1), TZ, 'yyyy-MM-dd');
}

// --- El motor de huecos -----------------------------------------------------

/** Lo que hace falta saber para repartir un día: duración, traslado y redondeo. */
function reglasDeHuecos_(escuela) {
  return {
    duracion: configNum('duracion_minutos', 90),
    traslado: configNum('traslado_minutos', 25),
    paso:     configNum('redondeo_minutos', 15),
    escuela:  escuela ? slugDeEscuela_(escuela) : ''
  };
}

/**
 * Las clases que se pueden ofrecer un día concreto: [{hora_inicio, hora_fin}].
 *
 * Se trabaja en minutos desde medianoche, que es mucho más fácil de razonar que
 * con fechas, y solo al final se vuelve a horas.
 */
function ofertasDelDia_(fecha, ventanas, ocupadosMs, reservas, reglas) {
  var ocupaciones = ocupacionesDelDia_(fecha, ocupadosMs, reservas[fecha]);
  var salida = [];

  ventanas.forEach(function (ventana) {
    var marco = { ini: enMinutos(ventana.hora_inicio), fin: enMinutos(ventana.hora_fin) };

    intervalosLibres_(marco, ocupaciones).forEach(function (libre) {
      ofertasEnIntervalo_(libre, reglas).forEach(function (minuto) {
        salida.push({
          hora_inicio: deMinutos(minuto),
          hora_fin: deMinutos(minuto + reglas.duracion)
        });
      });
    });
  });

  salida.sort(function (a, b) { return a.hora_inicio < b.hora_inicio ? -1 : 1; });
  return salida;
}

/**
 * Todo lo que tapa horas ese día, en minutos y ordenado.
 *
 * De las reservas se guarda además la autoescuela: es lo que después dice si hace
 * falta contar el rato de ir de Andorra a Encamp. De los eventos del calendario no
 * se sabe dónde son, así que no obligan a ningún traslado.
 */
function ocupacionesDelDia_(fecha, ocupadosMs, reservasDelDia) {
  var inicioDia = aDate(fecha, '00:00').getTime();
  var lista = [];

  (reservasDelDia || []).forEach(function (r) {
    lista.push({ ini: r.inicio, fin: r.fin, escuela: r.escuela || '' });
  });

  (ocupadosMs || []).forEach(function (ev) {
    var ini = Math.floor((ev.inicio - inicioDia) / 60000);
    var fin = Math.ceil((ev.fin - inicioDia) / 60000);
    if (fin <= 0 || ini >= 1440) return;      // es de otro día
    lista.push({ ini: Math.max(0, ini), fin: Math.min(1440, fin), escuela: '' });
  });

  lista.sort(function (a, b) { return a.ini - b.ini; });
  return lista;
}

/**
 * Los ratos libres dentro de una ventana, sabiendo qué los limita a cada lado.
 *
 * Guardar de quién es la clase que hay pegada por la izquierda y por la derecha es
 * lo que permite descontar el traslado después, sin volver a mirar nada.
 */
function intervalosLibres_(ventana, ocupaciones) {
  var libres = [];
  var cursor = ventana.ini;
  var escIzq = '';                 // el borde de la ventana no es una clase

  ocupaciones.forEach(function (oc) {
    if (oc.fin <= ventana.ini || oc.ini >= ventana.fin) return;

    var ini = Math.max(oc.ini, ventana.ini);
    var fin = Math.min(oc.fin, ventana.fin);

    if (ini > cursor) {
      libres.push({ ini: cursor, fin: ini, escIzq: escIzq, escDer: oc.escuela || '' });
    }
    if (fin > cursor) {
      cursor = fin;
      escIzq = oc.escuela || '';
    }
  });

  if (cursor < ventana.fin) {
    libres.push({ ini: cursor, fin: ventana.fin, escIzq: escIzq, escDer: '' });
  }
  return libres;
}

/**
 * Dónde puede empezar una clase dentro de un rato libre.
 *
 * Primero se recorta por los lados si hay que ir de una autoescuela a otra, y se
 * redondea a cuartos de hora: si el médico acaba a las 09:07 la clase se ofrece a
 * las 09:15, que es una hora que se puede decir por teléfono.
 *
 * Después se colocan una detrás de otra desde el principio, sin dejar aire entre
 * ellas. Nunca se ofrecen dos que se pisen: llegó a hacerse, ofreciendo además una
 * pegada al final del hueco, y era un engaño de dos maneras. En un hueco de cuatro
 * horas se veían las 10:30 y las 11:30 como si fueran clases seguidas, cuando la de
 * las 10:30 llega hasta las 12:00. Y no servía de nada: en un hueco caben las mismas
 * clases se pongan donde se pongan, así que aquello solo movía de sitio el rato
 * sobrante y encima lo dejaba en medio, partido y sin poder usarse.
 *
 * El rato que sobra al final queda para Sara, que lo ve marcado en su agenda y puede
 * meter ahí una clase corta.
 */
function ofertasEnIntervalo_(libre, reglas) {
  var ini = libre.ini;
  var fin = libre.fin;

  if (necesitaTraslado_(libre.escIzq, reglas.escuela)) ini += reglas.traslado;
  if (necesitaTraslado_(libre.escDer, reglas.escuela)) fin -= reglas.traslado;

  ini = redondearArriba_(ini, reglas.paso);
  fin = redondearAbajo_(fin, reglas.paso);

  var salida = [];
  for (var m = ini; m + reglas.duracion <= fin; m += reglas.duracion) salida.push(m);
  return salida;
}

/**
 * ¿Hay que contar el traslado con la clase de al lado?
 *
 * Solo cuando las dos tienen autoescuela y son distintas. Si no se sabe de dónde es
 * el alumno no se le recorta nada aquí: se le enseña todo y, si al reservar resulta
 * que su autoescuela obligaba a un traslado, se le dice en ese momento.
 */
function necesitaTraslado_(escuelaVecina, escuelaAlumno) {
  if (!escuelaVecina || !escuelaAlumno) return false;
  return slugDeEscuela_(escuelaVecina) !== slugDeEscuela_(escuelaAlumno);
}

function redondearArriba_(minutos, paso) {
  return paso > 1 ? Math.ceil(minutos / paso) * paso : minutos;
}

function redondearAbajo_(minutos, paso) {
  return paso > 1 ? Math.floor(minutos / paso) * paso : minutos;
}

/**
 * Contexto compartido para validar varias horas de una vez.
 *
 * Comprobar cada hora por separado significaba preguntar al calendario de Google una
 * vez por hora, y eso cuesta más de un segundo cada vez: siete horas tardaban veinte
 * segundos. Aquí se lee todo una sola vez para el rango completo y después las
 * comprobaciones se hacen en memoria.
 */
function crearContexto_(fechas, escuela) {
  var ordenadas = fechas.slice().sort();
  var desde = aDate(ordenadas[0], '00:00');
  var hasta = sumarDias(aDate(ordenadas[ordenadas.length - 1], '00:00'), 1);
  var filas = filasComoObjetos(getHoja(HOJA_RESERVAS));

  return {
    horario:    leerHorarioBase_(),
    ocupados:   leerEventosOcupados_(desde, hasta),
    filas:      filas,
    reservadas: indexarDesdeFilas_(filas),
    escuela:    escuela || ''
  };
}

/**
 * ¿Se puede dar clase a esta hora, según lo ya leído? Sin tocar la hoja ni el
 * calendario. Se recalculan las ofertas del día y se mira si la hora pedida es una
 * de ellas: así la reserva se valida exactamente contra lo mismo que se ofreció.
 */
function huecoLibreEn_(ctx, fecha, horaInicio, escuela) {
  var ventanas = ventanasDelDia_(ctx.horario, fecha);
  if (!ventanas.length) {
    return { ok: false, error: 'Ese día no hay clases.' };
  }

  var reglas = reglasDeHuecos_(escuela !== undefined ? escuela : ctx.escuela);
  var ofertas = ofertasDelDia_(fecha, ventanas, ctx.ocupados, ctx.reservadas, reglas);

  for (var i = 0; i < ofertas.length; i++) {
    if (ofertas[i].hora_inicio !== horaInicio) continue;

    if (aDate(fecha, ofertas[i].hora_fin).getTime() <= ahora().getTime()) {
      return { ok: false, error: 'Esa hora ya ha pasado.' };
    }
    return { ok: true, tramo: ofertas[i] };
  }

  /*
   * Si sin contar el traslado esa hora sí valdría, el problema no es que esté
   * ocupada: es que Sara estaría en la otra autoescuela y no le da tiempo a llegar.
   * Decirlo con esas palabras evita el "pues a mí me salía libre".
   */
  if (reglas.escuela) {
    var sinTraslado = ofertasDelDia_(fecha, ventanas, ctx.ocupados, ctx.reservadas,
                                     reglasDeHuecos_(''));
    for (var j = 0; j < sinTraslado.length; j++) {
      if (sinTraslado[j].hora_inicio === horaInicio) {
        return {
          ok: false,
          error: 'A esa hora Sara está en la otra autoescuela y no le da tiempo a llegar. ' +
                 'Elige otra, por favor.'
        };
      }
    }
  }

  return { ok: false, error: 'Sara ya no tiene libre esa hora. Elige otra, por favor.' };
}

/** { 1: [{hora_inicio, hora_fin}, ...], ... } solo tramos activos. */
function leerHorarioBase_() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('horario');
  if (guardado) return JSON.parse(guardado);

  var porDia = {};
  filasComoObjetos(getHoja(HOJA_HORARIO)).forEach(function (fila) {
    var activo = String(fila.activo).trim().toUpperCase();
    if (activo !== 'SI' && activo !== 'SÍ' && activo !== 'TRUE' && activo !== '1') return;
    var dia = Number(fila.dia_semana);
    if (!dia) return;
    if (!porDia[dia]) porDia[dia] = [];
    porDia[dia].push({
      hora_inicio: aHoraHHMM(fila.hora_inicio),
      hora_fin: aHoraHHMM(fila.hora_fin)
    });
  });
  Object.keys(porDia).forEach(function (dia) {
    porDia[dia].sort(function (a, b) { return a.hora_inicio < b.hora_inicio ? -1 : 1; });
  });

  cache.put('horario', JSON.stringify(porDia), 300);
  return porDia;
}

/**
 * Intervalos [inicio, fin) en milisegundos que Sara ha bloqueado en su calendario.
 *
 * Si el calendario está configurado pero no responde, esto revienta a propósito.
 * Devolver una lista vacía sería mucho peor: el sistema ofrecería como libres las
 * horas que Sara tenga tapadas, y acabaría con alumnos presentándose a la vez que
 * su médico. Ante la duda, mejor no ofrecer nada y avisarla.
 */
function leerEventosOcupados_(desde, hasta) {
  var calId = config('calendar_id', '');
  if (!calId) return [];   // sin calendario configurado, no hay bloqueos que leer

  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) throw new Error('CALENDARIO_INACCESIBLE');

  return cal.getEvents(desde, hasta).map(function (ev) {
    if (ev.isAllDayEvent()) {
      // Un evento de día completo tapa el día entero
      var ini = ev.getAllDayStartDate();
      var fin = ev.getAllDayEndDate();
      return { inicio: ini.getTime(), fin: fin.getTime() };
    }
    return { inicio: ev.getStartTime().getTime(), fin: ev.getEndTime().getTime() };
  });
}

function solapaConOcupado_(ocupados, inicio, fin) {
  for (var i = 0; i < ocupados.length; i++) {
    if (inicio < ocupados[i].fin && fin > ocupados[i].inicio) return true;
  }
  return false;
}

/**
 * Lo que ya está ocupado, por fecha y en minutos: { 'YYYY-MM-DD': [{inicio, fin}] }.
 *
 * Se guarda el intervalo entero y no solo la hora de inicio. Si Sara cambia la
 * duración de las clases, una reserva antigua de 09:00 a 10:00 tiene que seguir
 * tapando el tramo nuevo de 08:30 a 10:00; comparando solo la hora de inicio se
 * habrían podido meter dos alumnos a la vez en el coche.
 *
 * Solo mira de hoy en adelante: el histórico no ocupa ningún hueco futuro.
 */
function indexarReservasActivas_() {
  return indexarDesdeFilas_(filasComoObjetos(getHoja(HOJA_RESERVAS)));
}

function indexarDesdeFilas_(filas) {
  var indice = {};
  var hoy = hoyISO();

  filas.forEach(function (fila) {
    var estado = String(fila.estado).trim();
    // 'realizada' también ocupa: es una clase que se dio, no un hueco libre
    if (estado !== 'pendiente' && estado !== 'confirmada' && estado !== 'realizada') return;

    var fecha = aFechaISO(fila.fecha);
    if (fecha < hoy) return;

    var inicio = enMinutos(aHoraHHMM(fila.hora_inicio));
    var fin    = enMinutos(aHoraHHMM(fila.hora_fin));
    if (!(fin > inicio)) fin = inicio + 60;   // por si una fila vieja no tiene fin

    if (!indice[fecha]) indice[fecha] = [];
    // La autoescuela viaja con la reserva: de ahí sale si hace falta traslado
    indice[fecha].push({ inicio: inicio, fin: fin, escuela: String(fila.escuela || '').trim() });
  });

  Object.keys(indice).forEach(function (fecha) {
    indice[fecha].sort(function (a, b) { return a.inicio - b.inicio; });
  });

  return indice;
}

/** ¿Choca este tramo con alguna reserva activa de ese día? */
function estaReservado_(indice, fecha, horaInicio, horaFin) {
  var ocupados = indice[fecha];
  if (!ocupados) return false;

  var inicio = enMinutos(horaInicio);
  var fin    = enMinutos(horaFin);

  for (var i = 0; i < ocupados.length; i++) {
    if (inicio < ocupados[i].fin && fin > ocupados[i].inicio) return true;
  }
  return false;
}

/** ¿Sigue libre este hueco concreto? Atajo para cuando solo hay uno. */
function huecoSigueLibre_(fecha, horaInicio) {
  return huecoLibreEn_(crearContexto_([fecha]), fecha, horaInicio);
}
