/**
 * Base: acceso a la hoja de cálculo, configuración y helpers de fecha.
 * Todo lo demás depende de este archivo.
 */

var PROP_SHEET_ID = 'SHEET_ID';
var HOJA_RESERVAS = 'Reservas';
var HOJA_HORARIO  = 'HorarioBase';
var HOJA_CONFIG   = 'Config';
var TZ            = 'Europe/Madrid';

/*
 * Columnas de la hoja de reservas.
 *
 * 'id' y 'evento_id' son de uso interno y van ocultas: la primera identifica la clase
 * cuando Sara la responde desde el panel, y la segunda la ata a su evento del
 * calendario, que es lo que permite enterarse de si la mueve o la borra allí.
 *
 * 'tipo' es campo o circulación y 'escuela' la autoescuela: de ahí salen las
 * comisiones que se resumen en la pestaña Resumen.
 */
/**
 * Fecha del código, para saber si lo publicado es lo último que se pegó.
 *
 * Apps Script sirve la aplicación web desde una versión congelada: se puede pegar
 * código nuevo, guardarlo, y seguir viendo el viejo en el panel hasta que se hace
 * "Implementar → Gestionar implementaciones → Nueva versión". Esto sale abajo del
 * panel: si la fecha no es la que toca, es que falta republicar.
 *
 * Al tocar el código, subir también esta fecha.
 */
var VERSION_CODIGO = '2026-08-23';

var COLS_RESERVAS = ['id', 'creado_en', 'fecha', 'hora_inicio', 'hora_fin', 'estado',
                     'nombre', 'telefono', 'notas', 'actualizado_en',
                     'avisado', 'motivo_rechazo', 'tipo', 'evento_id', 'escuela', 'categoria'];

/** Las que Sara no necesita ver. */
var COLS_OCULTAS = ['id', 'evento_id'];

// --- Hoja de cálculo -------------------------------------------------------

// Abrir la hoja de cálculo cuesta cerca de medio segundo, y una sola petición la
// abre varias veces. Se guarda mientras dura la ejecución.
var _ss = null;
var _hojas = {};

function getSpreadsheet() {
  if (_ss) return _ss;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID);
  if (!id) {
    throw new Error('Sin hoja de cálculo. Ejecuta instalar() una vez desde el editor.');
  }
  _ss = SpreadsheetApp.openById(id);
  return _ss;
}

function getHoja(nombre) {
  if (_hojas[nombre]) return _hojas[nombre];
  var hoja = getSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error('Falta la hoja "' + nombre + '". Vuelve a ejecutar instalar().');
  _hojas[nombre] = hoja;
  return hoja;
}

/** Devuelve las filas de una hoja como objetos, usando la fila 1 como cabecera. */
function filasComoObjetos(hoja) {
  var datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];
  var cabecera = datos[0];
  var salida = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = {};
    for (var c = 0; c < cabecera.length; c++) {
      fila[cabecera[c]] = datos[i][c];
    }
    fila._fila = i + 1; // número de fila real en la hoja
    salida.push(fila);
  }
  return salida;
}

// --- Configuración ---------------------------------------------------------

function leerConfig() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('config');
  if (guardado) return JSON.parse(guardado);

  var conf = {};
  filasComoObjetos(getHoja(HOJA_CONFIG)).forEach(function (fila) {
    if (fila.clave) conf[String(fila.clave).trim()] = String(fila.valor).trim();
  });
  cache.put('config', JSON.stringify(conf), 60);
  return conf;
}

function config(clave, porDefecto) {
  var valor = leerConfig()[clave];
  return (valor === undefined || valor === '') ? porDefecto : valor;
}

function configNum(clave, porDefecto) {
  var valor = Number(config(clave, porDefecto));
  return isNaN(valor) ? porDefecto : valor;
}

function setConfig(clave, valor) {
  var hoja = getHoja(HOJA_CONFIG);
  var filas = filasComoObjetos(hoja);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].clave).trim() === clave) {
      hoja.getRange(filas[i]._fila, 2).setValue(valor);
      CacheService.getScriptCache().remove('config');
      return;
    }
  }
  hoja.appendRow([clave, valor, '']);
  CacheService.getScriptCache().remove('config');
}

// --- Fechas y horas --------------------------------------------------------

/** Normaliza a 'YYYY-MM-DD' tanto si viene Date como texto. */
function aFechaISO(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, TZ, 'yyyy-MM-dd');
  return String(valor).trim().substring(0, 10);
}

/** Normaliza a 'HH:MM' tanto si viene Date como texto ('9:00', '09:00:00'). */
function aHoraHHMM(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, TZ, 'HH:mm');
  var txt = String(valor).trim();
  var m = txt.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return txt;
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

/** 'HH:MM' -> minutos desde medianoche. Las clases ya no duran una hora exacta. */
function enMinutos(hora) {
  var partes = String(hora).split(':');
  return Number(partes[0]) * 60 + Number(partes[1] || 0);
}

function deMinutos(minutos) {
  var h = Math.floor(minutos / 60);
  var m = minutos % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

/** Construye un Date real a partir de 'YYYY-MM-DD' y 'HH:MM' en la zona del proyecto. */
function aDate(fechaISO, horaHHMM) {
  var f = fechaISO.split('-');
  var h = horaHHMM.split(':');
  return new Date(Number(f[0]), Number(f[1]) - 1, Number(f[2]), Number(h[0]), Number(h[1]), 0, 0);
}

function ahora() {
  return new Date();
}

function hoyISO() {
  return Utilities.formatDate(ahora(), TZ, 'yyyy-MM-dd');
}

function sumarDias(fecha, dias) {
  var d = new Date(fecha.getTime());
  d.setDate(d.getDate() + dias);
  return d;
}

/** 1 = lunes ... 7 = domingo */
function diaSemanaIso(fecha) {
  var d = fecha.getDay();
  return d === 0 ? 7 : d;
}

function nombreDia(n) {
  return ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][n] || '';
}

function nombreMes(n) {
  return ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
          'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][n] || '';
}

/** 'Jueves, 21 de agosto' */
function fechaLarga(fechaISO) {
  var d = aDate(fechaISO, '00:00');
  return nombreDia(diaSemanaIso(d)) + ', ' + d.getDate() + ' de ' + nombreMes(d.getMonth() + 1);
}

/**
 * La fecha como la diría cualquiera: 'mañana viernes 21', 'el lunes 24'.
 *
 * Escribirle a alguien "Viernes, 21 de agosto" para una clase que tiene en dos días
 * suena a carta del banco. Solo se pone el mes cuando la fecha queda lejos y hace
 * falta para no confundirse.
 */
function fechaCercana(fechaISO) {
  var dia    = aDate(fechaISO, '00:00');
  var hoy    = aDate(hoyISO(), '00:00');
  var dias   = Math.round((dia.getTime() - hoy.getTime()) / 86400000);
  var nombre = nombreDia(diaSemanaIso(dia)).toLowerCase();

  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana ' + nombre + ' ' + dia.getDate();
  if (dias > 1 && dias <= 7) return 'el ' + nombre + ' ' + dia.getDate();

  return 'el ' + nombre + ' ' + dia.getDate() + ' de ' + nombreMes(dia.getMonth() + 1);
}

// --- Varios ----------------------------------------------------------------

/**
 * Unas letras al azar para el final del identificador, de modo que dos reservas
 * hechas en el mismo segundo no acaben llamándose igual. Nadie lo ve nunca.
 */
function sufijoAleatorio() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var salida = '';
  for (var i = 0; i < 6; i++) {
    salida += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  }
  return salida;
}

/**
 * Deja el móvil en dígitos y en formato internacional, como lo necesita wa.me.
 *
 * El alumno lo escribe como le sale: con espacios, con puntos, con guiones, con
 * paréntesis, con "+", con "00" o sin nada. Aquí se entiende todo. Andorra y España
 * conviven: los móviles andorranos tienen 6 dígitos (+376) y los españoles 9 (+34).
 * Se distinguen por la longitud, y un número que ya venga con prefijo se respeta.
 *
 * Lo que no encaje en ninguno de esos moldes se deja en sus dígitos tal cual: vale
 * más guardar un móvil francés raro que echar al alumno por una regla de formato.
 */
function normalizarTelefono(telefono) {
  var crudo = String(telefono || '').trim();
  var yaInternacional = /^\s*\(?\s*\+/.test(crudo);   // "+34", "(+34)", " +376"
  var limpio = crudo.replace(/\D/g, '');

  if (limpio.indexOf('00') === 0) {
    limpio = limpio.substring(2);
    yaInternacional = true;
  }
  if (yaInternacional) return limpio;

  // Ya trae prefijo: 376 + 6 dígitos, o 34 + 9 dígitos
  if (limpio.indexOf('376') === 0 && limpio.length === 9)  return limpio;
  if (limpio.indexOf('34')  === 0 && limpio.length === 11) return limpio;

  if (limpio.length === 6) return '376' + limpio; // móvil de Andorra
  if (limpio.length === 9) return '34'  + limpio; // móvil de España

  return limpio;
}

/**
 * El móvil de Sara, limpio, como lo necesita wa.me. Se guarda como ella lo escriba
 * en Ajustes ("+376 618 090") y aquí se deja en dígitos con prefijo.
 */
function telefonoSara() {
  return normalizarTelefono(config('telefono_sara', ''));
}

/**
 * Un móvil vale si tiene dígitos suficientes para ser uno, y punto.
 *
 * Seis es lo mínimo que se usa por aquí (Andorra); quince es el tope internacional.
 * Sara lo verá al confirmar y, si es raro, ya le preguntará.
 */
function esMovilValido(telefono) {
  var limpio = normalizarTelefono(telefono);
  return limpio.length >= 6 && limpio.length <= 15;
}
