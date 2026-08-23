/**
 * Revisión del sistema.
 *
 * Ejecutar diagnostico() desde el editor cuando algo no cuadre. No cambia nada:
 * solo mira y cuenta lo que encuentra. El resultado sale en el registro de ejecución.
 */

function diagnostico() {
  var lineas = ['REVISIÓN DEL SISTEMA', '====================',
                'Código pegado: ' + VERSION_CODIGO,
                '(si el panel muestra otra fecha abajo, falta publicar la nueva versión)'];

  lineas = lineas.concat(revisarArchivos_());
  lineas = lineas.concat(revisarConfig_());
  lineas = lineas.concat(revisarHoja_());
  lineas = lineas.concat(revisarReservas_());
  lineas = lineas.concat(revisarHorario_());
  lineas = lineas.concat(revisarCalendario_());

  var informe = lineas.join('\n');
  Logger.log(informe);
  return informe;
}

/**
 * Lo mínimo para saber desde fuera si el sistema está vivo, sin dar ningún dato de
 * nadie. Lo devuelve la API pública con accion=salud. Es lo que habría delatado en
 * un minuto que el código publicado no era el último.
 */
function estadoDeSalud() {
  var salida = {
    ok: true,
    version: VERSION_CODIGO,
    hora_servidor: Utilities.formatDate(ahora(), TZ, 'yyyy-MM-dd HH:mm:ss'),
    revision_automatica: revisionAutomaticaActiva(),
    ultima_revision: ultimaRevision_()
  };

  try {
    var faltan = COLS_RESERVAS.filter(function (c) { return cabeceraReservas_().indexOf(c) === -1; });
    salida.hoja = faltan.length ? 'faltan columnas: ' + faltan.join(', ') : 'ok';
  } catch (e) {
    salida.hoja = 'error: ' + e.message;
    salida.ok = false;
  }

  var calId = config('calendar_id', '');
  if (!calId) {
    salida.calendario = 'sin configurar';
  } else {
    try {
      var cal = CalendarApp.getCalendarById(calId);
      salida.calendario = cal ? 'ok' : 'inaccesible';
      if (!cal) salida.ok = false;
    } catch (e) {
      salida.calendario = 'error: ' + e.message;
      salida.ok = false;
    }
  }

  if (!salida.revision_automatica) salida.ok = false;
  return salida;
}

/** Cuándo pasó por última vez la revisión automática, o '' si nunca. */
function ultimaRevision_() {
  try {
    var sello = PropertiesService.getScriptProperties().getProperty('ultima_revision') || '';
    return /^\d{4}-\d{2}-\d{2}/.test(sello) ? sello : '';
  } catch (e) {
    return '';
  }
}

function revisarConfig_() {
  var lineas = ['', 'CONFIGURACIÓN'];
  var obligatorias = {
    email_admin: 'nadie podrá entrar al panel',
    telefono_sara: 'los alumnos no podrán escribirle',
    calendar_id: 'no se leerán sus bloqueos y se ofrecerán horas ocupadas',
    url_publica: 'los mensajes saldrán sin el enlace de reservas',
    url_api: 'no se podrá ofrecer el añadir al calendario'
  };

  Object.keys(obligatorias).forEach(function (clave) {
    var valor = config(clave, '');
    lineas.push(valor
      ? '  OK    ' + clave + ' = ' + valor
      : '  FALTA ' + clave + ' · ' + obligatorias[clave]);
  });

  return lineas;
}

function revisarHoja_() {
  var lineas = ['', 'HOJA DE RESERVAS'];
  var hoja = getHoja(HOJA_RESERVAS);
  var cabecera = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0];

  /*
   * Una columna fuera de sitio no es un detalle: el sistema escribe por posición y
   * acaba guardando cada dato en la casilla de al lado sin dar ningún error. Así se
   * llenó una vez el calendario de clases duplicadas. Por eso esto es un problema
   * grave y no un aviso, y trae la solución escrita.
   */
  var descuadrada = false;

  COLS_RESERVAS.forEach(function (col, i) {
    if (cabecera.indexOf(col) === -1) {
      lineas.push('  FALTA la columna "' + col + '"');
      descuadrada = true;
    } else if (cabecera.indexOf(col) !== i) {
      lineas.push('  PROBLEMA la columna "' + col + '" está en la posición ' +
                  (cabecera.indexOf(col) + 1) + ' y debería estar en la ' + (i + 1));
      descuadrada = true;
    }
  });

  var sobran = cabecera.filter(function (col) {
    return col && COLS_RESERVAS.indexOf(col) === -1;
  });
  if (sobran.length) {
    lineas.push('  PROBLEMA sobran columnas: ' + sobran.join(', '));
    descuadrada = true;
  }

  if (descuadrada) {
    lineas.push('        >>> Ejecuta repararHoja() ANTES de seguir usando el sistema.');
  } else {
    lineas.push('  OK    las ' + COLS_RESERVAS.length + ' columnas están en su sitio');
  }
  return lineas;
}

function revisarReservas_() {
  var lineas = ['', 'RESERVAS'];
  var filas = filasComoObjetos(getHoja(HOJA_RESERVAS));
  var hoy = hoyISO();

  var porEstado = {};
  var vistosId = {};
  var idsRepetidos = [], sinId = [], estadosRaros = [];
  var choques = {}, dobles = [];
  var validos = { pendiente: 1, confirmada: 1, realizada: 1, rechazada: 1, cancelada: 1 };

  filas.forEach(function (fila) {
    var id     = String(fila.id || '').trim();
    var estado = String(fila.estado || '').trim();

    if (!id) { sinId.push(fila._fila); return; }

    porEstado[estado] = (porEstado[estado] || 0) + 1;
    if (!validos[estado]) estadosRaros.push('fila ' + fila._fila + ': "' + estado + '"');

    if (vistosId[id]) idsRepetidos.push(id); else vistosId[id] = true;

    /*
     * Dos clases que se pisan serían dos alumnos a la vez en el mismo coche.
     *
     * Se comparan los intervalos enteros, no la hora de inicio: desde que el horario
     * se adapta al calendario, una clase de 09:00 a 10:30 y otra de 10:00 a 11:30 se
     * pisan de sobra sin empezar a la misma hora, y mirando solo el inicio no salía.
     */
    if (estado === 'pendiente' || estado === 'confirmada' || estado === 'realizada') {
      var dia = aFechaISO(fila.fecha);
      var desde = enMinutos(aHoraHHMM(fila.hora_inicio));
      var hasta = enMinutos(aHoraHHMM(fila.hora_fin)) || desde + 90;

      if (!choques[dia]) choques[dia] = [];
      choques[dia].forEach(function (otra) {
        if (desde < otra.fin && hasta > otra.inicio) {
          dobles.push(dia + ' ' + otra.hi + ' con ' + aHoraHHMM(fila.hora_inicio));
        }
      });
      choques[dia].push({ inicio: desde, fin: hasta, hi: aHoraHHMM(fila.hora_inicio) });
    }
  });

  lineas.push('  Total: ' + filas.length + ' filas');
  Object.keys(porEstado).forEach(function (estado) {
    lineas.push('    ' + (estado || '(vacío)') + ': ' + porEstado[estado]);
  });

  apuntarProblema_(lineas, idsRepetidos, 'identificadores repetidos');
  apuntarProblema_(lineas, sinId, 'filas sin identificador');
  apuntarProblema_(lineas, estadosRaros, 'estados desconocidos');
  apuntarProblema_(lineas, dobles, 'HORAS CON DOS RESERVAS ACTIVAS');

  var futuras = filas.filter(function (f) {
    var estado = String(f.estado).trim();
    return (estado === 'pendiente' || estado === 'confirmada') && aFechaISO(f.fecha) >= hoy;
  });
  lineas.push('  Activas de hoy en adelante: ' + futuras.length);

  return lineas;
}

function revisarHorario_() {
  var lineas = ['', 'HORARIO'];
  var horario = leerHorarioBase_();
  var total = 0;

  var duracion = configNum('duracion_minutos', 90);

  // El horario son ventanas -"los lunes, de 08:30 a 13:00"-, no clases ya cortadas
  for (var d = 1; d <= 7; d++) {
    var ventanas = horario[d] || [];
    total += ventanas.length;
    if (!ventanas.length) continue;

    var caben = 0;
    var texto = ventanas.map(function (v) {
      caben += Math.floor((enMinutos(v.hora_fin) - enMinutos(v.hora_inicio)) / duracion);
      return v.hora_inicio + ' a ' + v.hora_fin;
    }).join(' y ');

    lineas.push('  ' + nombreDia(d) + ': ' + texto + ' · caben ' + caben +
                (caben === 1 ? ' clase' : ' clases') + ' de ' + duracion + ' min');
  }

  if (!total) lineas.push('  FALTA no hay ninguna franja. Sara no puede recibir reservas.');

  // Los días sueltos en los que Sara alarga la jornada
  var extendido = leerHorarioExtendido();
  if (extendido.fechas.length) {
    lineas.push('  Horario extendido de ' + extendido.tramo[0] + ' a ' + extendido.tramo[1] +
                ' en: ' + extendido.fechas.join(', '));
  }

  /*
   * Clases activas que caen fuera del horario de ahora.
   *
   * Se mira si entran DENTRO de alguna ventana, no si empiezan a una hora concreta:
   * desde que el horario se adapta al calendario, una clase puede empezar a las 09:15
   * y estar perfectamente en su sitio. Comparando la hora exacta salían casi todas
   * como sueltas, y el aviso dejaba de servir para nada.
   */
  var sueltas = [];
  filasComoObjetos(getHoja(HOJA_RESERVAS)).forEach(function (fila) {
    var estado = String(fila.estado).trim();
    if (estado !== 'pendiente' && estado !== 'confirmada') return;
    var fecha = aFechaISO(fila.fecha);
    if (fecha < hoyISO()) return;

    // Con el horario extendido, si ese día lo tiene: una clase a las 19:00 de un día
    // alargado está en su sitio
    var ventanas = ventanasDelDia_(horario, fecha);
    var inicio = enMinutos(aHoraHHMM(fila.hora_inicio));
    var fin    = enMinutos(aHoraHHMM(fila.hora_fin)) || inicio + duracion;

    var dentro = ventanas.some(function (v) {
      return inicio >= enMinutos(v.hora_inicio) && fin <= enMinutos(v.hora_fin);
    });
    if (!dentro) sueltas.push(fecha + ' ' + aHoraHHMM(fila.hora_inicio));
  });

  if (sueltas.length) {
    lineas.push('  AVISO ' + sueltas.length + ' clases activas caen fuera del horario actual:');
    lineas.push('        ' + sueltas.slice(0, 10).join(', '));
    lineas.push('        Se mantienen y Sara puede responderlas con normalidad.');
  }

  return lineas;
}

function revisarCalendario_() {
  var lineas = ['', 'CALENDARIO'];
  var calId = config('calendar_id', '');
  if (!calId) {
    lineas.push('  FALTA sin calendario configurado');
    return lineas;
  }

  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) {
    lineas.push('  ERROR no se puede abrir el calendario. ¿Se ha borrado o se ha perdido el acceso?');
    return lineas;
  }

  var desde = ahora();
  var hasta = sumarDias(desde, 14);
  var eventos = cal.getEvents(desde, hasta);
  lineas.push('  OK    "' + cal.getName() + '" con ' + eventos.length +
              ' eventos en los próximos 14 días');

  // Copias de la misma clase: la señal de que algo se está duplicando solo
  var vistos = {}, repetidos = 0;
  eventos.forEach(function (ev) {
    if (ev.isAllDayEvent() || !esTituloDeClase_(ev.getTitle())) return;
    var clave = ev.getTitle() + ' · ' +
                Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd HH:mm');
    if (vistos[clave]) repetidos++; else vistos[clave] = true;
  });

  if (repetidos) {
    lineas.push('  PROBLEMA ' + repetidos + ' eventos son copias de otra clase igual.');
    lineas.push('        >>> Ejecuta pararTodo() y después limpiarDuplicados().');
  }

  lineas.push(revisionAutomaticaActiva()
    ? '  OK    revisión automática puesta, cada 15 minutos'
    : '  AVISO sin revisión automática. Lo que cambies en el calendario no se ' +
      'recogerá hasta que abras el panel. Se pone con activarRevisionAutomatica()');

  return lineas;
}

function apuntarProblema_(lineas, lista, texto) {
  if (!lista.length) return;
  lineas.push('  PROBLEMA ' + lista.length + ' ' + texto + ': ' + lista.slice(0, 10).join(', '));
}

/**
 * Archiva las reservas antiguas en otra pestaña.
 *
 * La hoja se lee entera en cada consulta, así que cuanto más corta, más rápido va
 * todo. Se conserva el histórico completo en 'Historico', que nadie consulta al vuelo.
 *
 * Ejecutar de vez en cuando, por ejemplo al empezar el curso. Por defecto archiva
 * lo de hace más de seis meses.
 */
function archivarAntiguas(meses) {
  var limite = Utilities.formatDate(sumarDias(ahora(), -30 * (meses || 6)), TZ, 'yyyy-MM-dd');
  var hoja   = getHoja(HOJA_RESERVAS);
  var filas  = filasComoObjetos(hoja);

  var viejas = filas.filter(function (fila) {
    return fila.id && aFechaISO(fila.fecha) < limite;
  });

  if (!viejas.length) {
    var nada = 'No hay nada anterior al ' + limite + ' que archivar.';
    Logger.log(nada);
    return nada;
  }

  var ss = getSpreadsheet();
  var historico = ss.getSheetByName('Historico');
  if (!historico) {
    historico = ss.insertSheet('Historico');
    historico.getRange(1, 1, 1, COLS_RESERVAS.length).setValues([COLS_RESERVAS])
             .setFontWeight('bold').setBackground('#5b6472').setFontColor('#ffffff');
    historico.setFrozenRows(1);
    historico.getRange('C:E').setNumberFormat('@');
  }

  /*
   * Se escribe según la cabecera que tenga el Historico, no según la lista del código.
   *
   * Esa hoja pudo crearse con otras columnas: dar por hecho que coinciden es lo que
   * descuadró la hoja de reservas y acabó llenando el calendario de clases repetidas.
   * Aquí cada dato va a la columna que lleva su nombre, y lo que no encaje se queda
   * en blanco en lugar de correrse un sitio.
   */
  var cabecera = historico.getRange(1, 1, 1, Math.max(historico.getLastColumn(), 1))
                          .getValues()[0]
                          .map(function (c) { return String(c).trim(); });

  var datos = viejas.map(function (fila) {
    return cabecera.map(function (col) { return fila[col] !== undefined ? fila[col] : ''; });
  });

  historico.getRange(historico.getLastRow() + 1, 1, datos.length, cabecera.length)
           .setValues(datos);

  // De abajo arriba, para que los números de fila no bailen al ir borrando
  viejas.sort(function (a, b) { return b._fila - a._fila; });
  viejas.forEach(function (fila) { hoja.deleteRow(fila._fila); });

  olvidarDisponibilidad();

  var resumen = viejas.length + ' reservas anteriores al ' + limite +
                ' movidas a la pestaña Historico. Quedan ' + (filas.length - viejas.length) +
                ' en la hoja de trabajo.';
  Logger.log(resumen);
  return resumen;
}

/**
 * Comprueba que están todos los archivos del proyecto.
 *
 * Al pegar el código a mano es fácil dejarse uno, y entonces algo falla en el peor
 * momento con un críptico "no está definida". Esto lo dice antes y con nombres.
 *
 * Si se añade una función importante a un archivo, conviene apuntarla aquí.
 */
function revisarArchivos_() {
  var lineas = ['', 'ARCHIVOS DEL PROYECTO'];

  var esperado = {
    '00_Base':         ['getHoja', 'config', 'aDate', 'fechaCercana', 'enMinutos',
                        'normalizarTelefono', 'sufijoAleatorio', 'telefonoSara'],
    '01_Instalar':     ['instalar', 'asegurarColumnas_', 'ocultarColumnasTecnicas_',
                        'bloquearMiercolesManana'],
    '02_Disponibilidad': ['obtenerDisponibilidad', 'crearContexto_', 'huecoLibreEn_',
                        'estaReservado_', 'ofertasDelDia_', 'intervalosLibres_',
                        'ofertasEnIntervalo_', 'reglasDeHuecos_', 'ultimoDiaOfrecido_',
                        'huecosLibresParaPanel', 'examenesParaPanel_'],
    '03_Reservas':     ['crearReserva', 'cambiarEstado', 'datosPanel', 'marcarTipo',
                        'validarSeguidas_', 'marcarRealizadas', 'indiceCol_',
                        'cabeceraReservas_', 'filaParaHoja_', 'escribirCampos_',
                        'asegurarHojaAlDia_'],
    '04_Avisos':       ['plantillasWhatsApp', 'textoWhatsAppAlumno', 'avisarDeReservas'],
    '05_Api':          ['doGet', 'enrutar_', 'claveDelPanel_', 'enlaceDelPanel',
                        'cambiarClaveDelPanel'],
    '06_Escuelas':     ['listaDeEscuelas', 'escuelaValida', 'listaDeTipos',
                        'ubicacionDeEscuela', 'listaDeCategorias', 'marcarCategoria'],
    '07_Horario':      ['leerHorarioEditable', 'guardarHorario', 'clasesQueCaben_',
                        'leerHorarioExtendido', 'guardarHorarioExtendido', 'ventanasDelDia_'],
    '08_Diagnostico':  ['diagnostico', 'archivarAntiguas', 'estadoDeSalud'],
    '09_Agenda':       ['sincronizarAgenda', 'sincronizarTodaLaAgenda',
                        'traerCambiosDelCalendario', 'sigueEnElCalendario_', 'sincronizarTodo',
                        'quienHayEn_', 'avisarDeConflictos_', 'avisarDeDescartes_', 'esSerie_',
                        'nombreDesdeElEvento_',
                        'sincronizarAgendaSinCierre_',
                        'revisionAutomatica', 'activarRevisionAutomatica',
                        'importarClasesDelCalendario', 'limpiarHuerfanos',
                        'esEventoDelSistema_'],
    '10_Resumen':      ['actualizarResumen', 'asegurarHojaResumen_'],
    '11_Reparar':      ['pararTodo', 'repararHoja', 'limpiarDuplicados',
                        'empezarDeCero', 'continuarLimpieza']
  };

  var faltan = [];
  Object.keys(esperado).forEach(function (archivo) {
    var perdidas = esperado[archivo].filter(function (nombre) {
      return typeof globalThis[nombre] !== 'function';
    });

    if (perdidas.length) {
      faltan.push(archivo);
      lineas.push('  FALTA ' + archivo + ' · no está o quedó a medias (' +
                  perdidas.join(', ') + ')');
    }
  });

  if (!faltan.length) {
    lineas.push('  OK    los 11 archivos están completos');
  } else {
    lineas.push('        Pégalos de nuevo desde el repositorio y vuelve a publicar.');
  }

  return lineas;
}
