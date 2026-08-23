/*
 * Revisión del panel de Sara.
 *
 * El panel es una sola página con su JavaScript dentro, y sus botones llaman a las
 * funciones por nombre desde atributos onclick. Si al editar se pierde una función,
 * nada avisa: el navegador falla en silencio y Sara se queda con un panel en blanco.
 * Ya pasó una vez, al recortar código y llevarse por delante el editor de horarios.
 *
 *   node pruebas/panel.js
 */

const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', 'apps-script', 'panel.html');
const html = fs.readFileSync(RUTA, 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let fallos = 0;
function comprobar(descripcion, condicion, extra) {
  if (condicion) {
    console.log('  OK   ' + descripcion);
  } else {
    fallos++;
    console.log('  FALLA ' + descripcion + (extra ? '  -> ' + extra : ''));
  }
}

/** Nombres que aparecen como "algo(" detrás de un patrón dado. */
function nombresTras(texto, patron) {
  const encontrados = new Set();
  const expresion = new RegExp(patron + '([A-Za-z_$][\\w$]*)\\(', 'g');
  let coincidencia;
  while ((coincidencia = expresion.exec(texto)) !== null) {
    encontrados.add(coincidencia[1]);
  }
  return encontrados;
}

// --- Qué funciones define ---
const definidas = nombresTras(js, 'function\\s+');
// También las que se guardan en una variable: var dosD = function (n) { ... }
(js.match(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function/g) || []).forEach(function (t) {
  definidas.add(t.replace(/(?:var|let|const)\s+/, '').replace(/\s*=\s*function/, ''));
});
console.log('\n== Lo que el panel define ==');
console.log('  ' + definidas.size + ' funciones');

// --- Qué funciones invocan los botones ---
// Tanto los del HTML fijo, onclick="cargar()", como los que el propio código
// escribe dentro de cadenas, onclick=\"responder('...
const desdeBotones = new Set();
nombresTras(html, 'on(?:click|change)=\\\\?"').forEach(function (n) { desdeBotones.add(n); });
nombresTras(js, '"').forEach(function (n) { desdeBotones.add(n); });

const delNavegador = ['location', 'window', 'alert', 'open', 'href'];
const llamadas = Array.from(desdeBotones)
  .filter(function (n) { return delNavegador.indexOf(n) === -1; })
  .sort();

console.log('\n== Botones y sus funciones ==');
comprobar('los botones llaman a alguna función', llamadas.length > 0, 'no se detectó ninguna');
llamadas.forEach(function (nombre) {
  comprobar(nombre + '() existe', definidas.has(nombre), 'no está definida en el panel');
});

// --- Llamadas dentro del propio código ---
console.log('\n== Llamadas internas ==');
const globalesPermitidas = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Math', 'JSON', 'Date',
  'setTimeout', 'clearTimeout', 'encodeURIComponent', 'decodeURIComponent',
  'parseInt', 'parseFloat', 'isNaN', 'require'
]);

// Sin contar lo que va tras una barra invertida: en '\n(' el paréntesis es texto
const usadas = nombresTras(js, '(?:^|[^.\\w$\\\\])');
const huerfanas = Array.from(usadas).filter(function (n) {
  return !definidas.has(n) && !globalesPermitidas.has(n);
}).sort();

comprobar('no se llama a ninguna función que no exista', huerfanas.length === 0,
          huerfanas.join(', '));

// --- Elementos que el JavaScript busca por id ---
console.log('\n== Elementos de la página ==');
const idsEnHtml = new Set();
(html.match(/id="([\w-]+)"/g) || []).forEach(function (t) {
  idsEnHtml.add(t.replace(/id="/, '').replace('"', ''));
});

const idsBuscados = new Set();
(js.match(/el\('([\w-]+)'\)/g) || []).forEach(function (t) {
  idsBuscados.add(t.replace(/el\('/, '').replace("')", ''));
});

// Los que se construyen al vuelo, el('ck-' + r.id), no se pueden comprobar aquí
const perdidos = Array.from(idsBuscados).filter(function (id) {
  return !idsEnHtml.has(id);
}).sort();

comprobar('todos los elementos que busca están en la página', perdidos.length === 0,
          perdidos.join(', '));

// --- Piezas que no pueden faltar ---
console.log('\n== Piezas imprescindibles ==');
[
  ['la clave del enlace llega al navegador', /var CLAVE = '<\?= clave \?>'/],
  ['las acciones la devuelven al servidor', /conClave\(/],
  ['confirmar', /'confirmar'/],
  ['rechazar', /'rechazar'/],
  ['liberar una hora', /'anular'/],
  ['marcar campo o calle', /marcar_tipo/],
  ['cambiar los horarios', /guardar_horario/],
  ['apuntar las clases en el calendario', /'agendar'/],
  ['poner la agenda al día', /agendar_todo/],
  ['el mensaje de WhatsApp con todas las clases', /\{clases\}/]
].forEach(function (par) {
  comprobar(par[0], par[1].test(js));
});

// --- La guía tiene que nombrar todos los archivos ---
console.log('\n== La guía de instalación ==');
const guia = fs.readFileSync(path.join(__dirname, '..', 'INSTALACION.md'), 'utf8');
const archivos = fs.readdirSync(path.join(__dirname, '..', 'apps-script'));

archivos.forEach(function (archivo) {
  comprobar('la guía manda pegar ' + archivo, guia.indexOf(archivo) !== -1,
            'quien siga la guía se lo dejará');
});

// --- El diagnóstico tiene que conocer todos los archivos ---
console.log('\n== La revisión del sistema ==');
const diag = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '08_Diagnostico.gs'), 'utf8');
const bloque = (diag.match(/var esperado = \{([\s\S]*?)\n  \};/) || [])[1] || '';

archivos.filter(function (a) { return a.slice(-3) === '.gs'; }).forEach(function (archivo) {
  const nombre = archivo.replace('.gs', '');
  comprobar('la revisión vigila ' + nombre, bloque.indexOf("'" + nombre + "'") !== -1,
            'si falta ese archivo, nadie avisará');
});

// Y las funciones que dice vigilar tienen que existir de verdad
const desajustes = [];
bloque.split('\n').forEach(function (linea) {
  const m = linea.match(/'([\w]+)':\s*\[(.*)\]/);
  if (!m) return;

  let fuente;
  try {
    fuente = fs.readFileSync(path.join(__dirname, '..', 'apps-script', m[1] + '.gs'), 'utf8');
  } catch (e) {
    desajustes.push(m[1] + ' (no existe)');
    return;
  }

  m[2].split(',')
    .map(function (x) { return x.trim().replace(/'/g, ''); })
    .filter(Boolean)
    .forEach(function (f) {
      if (fuente.indexOf('function ' + f) === -1) desajustes.push(m[1] + '.' + f);
    });
});
comprobar('y todas esas funciones existen', desajustes.length === 0, desajustes.join(', '));

console.log('== El editor de horarios ==');

const editor = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'panel.html'), 'utf8');

comprobar('el editor llega hasta el viernes y para',
          editor.indexOf("'Viernes'") !== -1 &&
          editor.indexOf("'S\\u00e1bado'") === -1 &&
          editor.indexOf("'Domingo'") === -1,
          'sigue ofreciendo el fin de semana');

comprobar('los dias se recorren hasta ULTIMO_DIA',
          editor.indexOf('var ULTIMO_DIA = 5') !== -1 &&
          editor.indexOf('d <= 7') === -1,
          'queda algun bucle hasta el domingo');

/*
 * El aviso de guardado salia solo abajo del todo y duraba dos segundos: pulsando el
 * boton desde arriba no se veia y parecia que no hacia nada.
 */
comprobar('el boton de guardar avisa en el propio boton',
          editor.indexOf("id=\"btn-guardar-horario\"") !== -1 &&
          editor.indexOf("boton.textContent = 'Guardando\u2026'") !== -1,
          'no se entera de si ha guardado');

comprobar('y dice cuantas clases caben, no cuantas ventanas',
          editor.indexOf('resp.clases') !== -1 && editor.indexOf('resp.tramos') === -1,
          'sigue contando ventanas como si fueran clases');

const horarioGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '07_Horario.gs'), 'utf8');
comprobar('y el servidor lo devuelve', horarioGs.indexOf('clases: caben') !== -1);

console.log('== El testigo de la version ==');

const baseGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '00_Base.gs'), 'utf8');
const reservasGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');

comprobar('el codigo lleva su fecha', /var VERSION_CODIGO = '\d{4}-\d{2}-\d{2}'/.test(baseGs),
          'sin VERSION_CODIGO');
comprobar('el panel la recibe', reservasGs.indexOf('version: VERSION_CODIGO') !== -1);
comprobar('y la ensena al pie',
          editor.indexOf("el('pie-version')") !== -1 && editor.indexOf('id="pie-version"') !== -1,
          'no se ve por ningun lado');

const guiaPublicar = fs.readFileSync(path.join(__dirname, '..', 'INSTALACION.md'), 'utf8');
comprobar('la guia explica como publicar',
          guiaPublicar.indexOf('Gestionar implementaciones') !== -1 &&
          guiaPublicar.indexOf('Nueva implementaci') !== -1,
          'no dice como republicar');

console.log('== La pagina del alumno, sin pedir el movil ==');

const paginaHtml = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const paginaJs   = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
const paginaCss  = fs.readFileSync(path.join(__dirname, '..', 'docs', 'estilo.css'), 'utf8');

// El alumno ve sus clases por el movil desde el que reservo, sin escribir nada
comprobar('no queda el bloque de buscar por movil',
          paginaHtml.indexOf('otro m') === -1 &&
          paginaHtml.indexOf('entrada-movil') === -1,
          'sigue pidiendo el numero');

comprobar('ni el codigo que lo movia',
          paginaJs.indexOf('buscarPorMovil') === -1 &&
          paginaJs.indexOf('btn-buscar-movil') === -1,
          'queda codigo huerfano');

comprobar('ni sus estilos',
          paginaCss.indexOf('bloque-buscar') === -1 &&
          paginaCss.indexOf('fila-formulario') === -1,
          'queda CSS muerto');

// Y tampoco rastro de los codigos de reserva, que se quitaron antes
comprobar('sin rastro de codigos de reserva',
          paginaHtml.toLowerCase().indexOf('codigo') === -1 &&
          paginaCss.indexOf('codigo') === -1,
          'vuelve a hablar de codigos');

console.log('== La agenda del panel ==');

const reservasGsAg = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');
const agendaGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '09_Agenda.gs'), 'utf8');

comprobar('las proximas se pintan como agenda, no como tarjetas de alumno',
          editor.indexOf('function pintarAgenda') !== -1 &&
          editor.indexOf("pintarAgenda('lista-proximas'") !== -1,
          'siguen agrupadas por alumno');

comprobar('con una cabecera por dia', editor.indexOf('dia-agenda') !== -1);

comprobar('y cada clase enseña hora, alumno, autoescuela y tipo',
          editor.indexOf('clase-hora') !== -1 &&
          editor.indexOf('clase-nombre') !== -1 &&
          editor.indexOf('clase-tipo') !== -1 &&
          editor.indexOf("chipsDeTipo(r, 'proxima')") !== -1 &&
          editor.indexOf('chipsDeEscuela(ESTADO.grupos[clave], clave) +\n        \'<div class="iconos">\'') !== -1,
          'falta algun dato en la agenda');

// Sara pidio que el permiso (B, J...) no saliera en ningun sitio del panel
comprobar('el permiso del alumno no sale en ningun sitio del panel',
          editor.indexOf('chipsDeCategoria') === -1 && editor.indexOf('marcarCategoria') === -1 &&
          html.indexOf('Permiso') === -1,
          'el panel sigue enseñando el permiso');
comprobar('y al elegir autoescuela la tarjeta cambia de color',
          editor.indexOf("['esc-1', 'esc-2', 'esc-3', 'esc-4'].forEach(function (c) { tarjeta.classList.remove(c); });") !== -1,
          'la barra de color no sigue a la autoescuela');

// Cada dato en su columna: pegados, "Jesus prueba3Circulacion" se leia como un nombre
comprobar('cada dato en su columna, y el tipo a la derecha',
          editor.indexOf('grid-template-columns:auto 3px 1fr auto auto') !== -1 &&
          editor.indexOf('.clase-tipo{') !== -1 &&
          editor.indexOf('text-align:right') !== -1,
          'el nombre y el tipo salen pegados');

// La autoescuela va como barra de color: escrita se comia el sitio del alumno
comprobar('la autoescuela se pinta, no se escribe',
          editor.indexOf('clase-carril') !== -1 &&
          editor.indexOf('function claseDeEscuela') !== -1 &&
          editor.indexOf('.esc-1{--color-esc') !== -1,
          'sigue gastando renglon en el nombre de la autoescuela');

comprobar('con su leyenda, para saber que color es cada una',
          editor.indexOf('function leyendaDeEscuelas') !== -1);

// Los botones no aparecen hasta que Sara toca la clase: es lo que ahorra sitio
comprobar('los botones estan escondidos hasta que se toca',
          editor.indexOf('function alternarClase') !== -1 &&
          editor.indexOf('clase-detalle" hidden') !== -1,
          'los botones ocupan sitio siempre');

// Un rato libre de 20 minutos no sirve para nada y ensucia la pantalla
/*
 * 45 minutos entre dos clases de Andorra son una clase. Los mismos 45 entre una de
 * Andorra y una de Encamp no son nada: se los come el viaje.
 */
comprobar('el hueco se mide desde la clase mas corta que Sara da',
          editor.indexOf('conf.duracion_minima || 45') !== -1 &&
          editor.indexOf('libre < minima') !== -1,
          'sigue con un umbral fijo');

comprobar('y descontando el viaje cuando la de al lado es de otra autoescuela',
          editor.indexOf('!== e.nombre ? traslado : 0') !== -1,
          'ofrece huecos a los que no da tiempo a llegar');

comprobar('si solo vale para una autoescuela, lo dice',
          editor.indexOf('hueco-esc') !== -1 &&
          editor.indexOf('caben.length === escuelas.length ? null : caben') !== -1,
          'no dice a quien puede llamar');

comprobar('y el servidor le manda con que medirlo',
          reservasGsAg.indexOf('duracion_minima:') !== -1 &&
          reservasGsAg.indexOf('traslado:') !== -1,
          'el panel no sabe ni la duracion minima ni el traslado');

comprobar('los dias cercanos se nombran en vez de fecharse',
          editor.indexOf("return 'hoy'") !== -1 && editor.indexOf("return 'mañana'") !== -1,
          'dice "lun 24 ago" hasta para hoy');

/*
 * Las pendientes tambien van en orden de reloj, pero lo que se marca se junta por
 * alumno al confirmar: las tres clases de Marta salen en un solo WhatsApp aunque en
 * la lista estuvieran en tres dias distintos.
 */
comprobar('las pendientes van en orden de reloj, con casilla',
          editor.indexOf("pintarPendientes('lista-pendientes'") !== -1 &&
          editor.indexOf('function alternarPendiente') !== -1,
          'siguen agrupadas por alumno');

comprobar('la barra dice cuantos WhatsApp van a salir',
          editor.indexOf('function refrescarBarraPendientes') !== -1 &&
          editor.indexOf("alumnos + (alumnos === 1 ? ' alumno' : ' alumnos')") !== -1,
          'no avisa de cuantos mensajes saldran');

comprobar('vienen todas marcadas: lo normal es confirmarlo todo',
          editor.indexOf('PENDIENTES.marcadas[r.id] = true') !== -1,
          'hay que marcarlas una a una');

// Lo que se perdia al ordenar por hora, recuperado
comprobar('los avisos se juntan por alumno antes de mandarse',
          editor.indexOf('function colaDeAvisos') !== -1 &&
          editor.indexOf('porAlumno[quien] = {') !== -1,
          'mandaria un WhatsApp por clase');

comprobar('y se abre uno por persona, de uno en uno',
          editor.indexOf('function siguienteAviso') !== -1,
          'los moviles no dejan abrir varios de golpe');

// La autoescuela se sigue pudiendo corregir si el alumno entro por el enlace de otra
comprobar('la autoescuela se corrige desde la clase pendiente',
          editor.indexOf('chipsDeEscuela(ESTADO.grupos[clave], clave)') !== -1,
          'ya no se puede corregir la autoescuela');

const reservasPend = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');
comprobar('y el servidor las manda ya ordenadas',
          reservasPend.indexOf('pendientes.sort(porReloj)') !== -1 &&
          reservasPend.indexOf('pendientes: pendientes,') !== -1,
          'el servidor sigue agrupando las pendientes');

comprobar('el servidor las manda en orden de reloj',
          reservasGsAg.indexOf('proximas: proximas') !== -1 &&
          reservasGsAg.indexOf('proximas: agruparPorAlumno_') === -1,
          'el servidor sigue agrupando las proximas');

comprobar('lo que ya paso se marca como realizada',
          reservasGsAg.indexOf('function marcarRealizadas') !== -1 &&
          agendaGs.indexOf('marcarRealizadas()') !== -1,
          'nadie las marca');

/*
 * La trampa: al dejar de estar confirmada, el paso de sincronizar veria "no esta
 * confirmada pero tiene evento" y se lo borraria del calendario.
 */
comprobar('y su evento se queda en el calendario',
          agendaGs.indexOf("if (estado === 'realizada') return false;") !== -1 &&
          agendaGs.indexOf("if (estado === 'realizada') return;") !== -1,
          'una clase dada perderia su evento');

console.log('== La cuenta de los huecos ==');

/*
 * Las comprobaciones de arriba miran que el codigo diga lo que tiene que decir. Esta
 * saca las funciones del panel y las ejecuta: la resta del traslado es justo donde se
 * cuela un error que ningun texto delata.
 */
function extraerFuncion(nombre) {
  const desde = js.indexOf('function ' + nombre + '(');
  if (desde === -1) return '';

  let nivel = 0;
  for (let i = js.indexOf('{', desde); i < js.length; i++) {
    if (js[i] === '{') nivel++;
    else if (js[i] === '}' && --nivel === 0) return js.slice(desde, i + 1);
  }
  return '';
}

const fuenteHuecos = ['enMinutosReloj', 'textoDeHueco', 'claseDeEscuela', 'quienCabe',
                      'pintarHueco', 'huecoEntre']
  .map(extraerFuncion).join('\n\n');

comprobar('se pueden sacar las funciones del hueco',
          fuenteHuecos.indexOf('function huecoEntre') !== -1 &&
          fuenteHuecos.indexOf('function textoDeHueco') !== -1,
          'no se encontraron en el panel');

const ESTADO_PRUEBA = {
  datos: { config: {
    duracion_minima: 45,
    traslado: 25,
    escuelas: [{ nombre: 'Andorra', slug: 'andorra' }, { nombre: 'Encamp', slug: 'encamp' }]
  } }
};

const huecos = new Function('ESTADO', 'escapar',
  fuenteHuecos + '\nreturn { huecoEntre: huecoEntre, textoDeHueco: textoDeHueco };'
)(ESTADO_PRUEBA, function (t) { return String(t); });

function clase(inicio, fin, escuela) {
  return { hora_inicio: inicio, hora_fin: fin, escuela: escuela };
}

// --- Como se lee un rato libre ---
comprobar('45 minutos se dicen en minutos', huecos.textoDeHueco(45) === '45 min libres',
          huecos.textoDeHueco(45));
comprobar('dos horas justas, sin minutos', huecos.textoDeHueco(120) === '2 h libres',
          huecos.textoDeHueco(120));
comprobar('y una hora y media, en singular', huecos.textoDeHueco(90) === '1 h 30 libre',
          huecos.textoDeHueco(90));

// --- Entre dos clases de la misma autoescuela ---
const corto = huecos.huecoEntre(clase('08:30', '10:00', 'Andorra'),
                                clase('10:45', '12:15', 'Andorra'));
comprobar('45 minutos entre dos de Andorra son una clase',
          corto.indexOf('45 min libres') !== -1, corto || '(no sale)');
comprobar('y se dice que son para Andorra',
          corto.indexOf('Andorra') !== -1 && corto.indexOf('Encamp') === -1, corto);

const cortisimo = huecos.huecoEntre(clase('08:30', '10:00', 'Andorra'),
                                    clase('10:30', '12:00', 'Andorra'));
comprobar('media hora no da para nada y no se enseña', cortisimo === '', cortisimo);

// --- Con cambio de autoescuela de por medio ---
const conViaje = huecos.huecoEntre(clase('08:30', '10:00', 'Andorra'),
                                   clase('10:45', '12:15', 'Encamp'));
comprobar('los mismos 45 minutos con viaje de por medio no valen',
          conViaje === '', conViaje || '(no sale)');

const viajeLargo = huecos.huecoEntre(clase('08:30', '10:00', 'Andorra'),
                                     clase('11:40', '13:10', 'Encamp'));
comprobar('con hora y 40 si queda sitio pese al viaje',
          viajeLargo.indexOf('1 h 40 libre') !== -1, viajeLargo || '(no sale)');

// --- Un rato largo le sirve a todo el mundo ---
const largo = huecos.huecoEntre(clase('08:30', '10:00', 'Andorra'),
                                clase('12:00', '13:30', 'Andorra'));
comprobar('dos horas les valen a las dos autoescuelas',
          largo.indexOf('2 h libres') !== -1 && largo.indexOf('Andorra') === -1,
          largo || '(no sale)');

// --- Sin autoescuela apuntada no se descuenta nada ---
const sinEscuela = huecos.huecoEntre(clase('08:30', '10:00', ''),
                                     clase('10:45', '12:15', ''));
comprobar('sin autoescuela apuntada, el hueco es el que es',
          sinEscuela.indexOf('45 min libres') !== -1, sinEscuela || '(no sale)');

console.log('== La pagina del alumno dice hasta que hora ==');

const alumnoJs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');

/*
 * Sin la hora de fin en el boton, dos clases seguidas parecen durar lo que hay hasta
 * la siguiente: el alumno elegia las 10:30 y la barra le decia hora y media, cuando
 * el boton de al lado ponia 11:30.
 */
comprobar('el boton lleva la hora de fin',
          alumnoJs.indexOf("'<small>' + franja.hora_fin + '</small>'") !== -1,
          'el alumno no sabe cuanto dura la clase que elige');

comprobar('la pagina no pone rotulos de semana: el dia ya lleva su fecha entera',
          alumnoJs.indexOf('titulo-semana') === -1 && alumnoJs.indexOf('La semana que viene') === -1,
          'sigue el rotulo que confundia');

comprobar('y no deja elegir dos clases que se pisen',
          alumnoJs.indexOf('function sePisaConOtra') !== -1 &&
          alumnoJs.indexOf('se solapa con otra') !== -1,
          'se pueden pedir dos clases encima de otra');

console.log('== Las horas de cada dia y de cada semana ==');

/*
 * Sara hacia la cuenta de cabeza: cuanto tiene ya esta semana y cuanto le queda por
 * rellenar. Ahora la hace el panel, dia a dia y semana a semana, y lo libre sale
 * en ambar para que se vea de lejos.
 */
comprobar('cada dia dice sus horas de clase',
          editor.indexOf('dia-agenda-clases') !== -1 &&
          editor.indexOf("textoHoras(minutosClase) + ' de clase'") !== -1,
          'la cabecera del dia no cuenta horas');

comprobar('y sus horas libres, resaltadas',
          editor.indexOf('dia-libre') !== -1 &&
          editor.indexOf("(minutosLibres ? ' con-libre' : '')") !== -1 &&
          editor.indexOf('.dia-agenda.con-libre .dia-agenda-nombre{color:var(--alerta)}') !== -1,
          'los dias con hueco no se distinguen');

comprobar('las semanas se resumen arriba',
          editor.indexOf('function pintarResumenSemanas') !== -1 &&
          html.indexOf('id="resumen-semanas"') !== -1 &&
          editor.indexOf("'Esta semana'") !== -1 &&
          editor.indexOf("'La semana que viene'") !== -1,
          'no hay resumen por semanas');

comprobar('las clases de hoy ya dadas siguen contando',
          editor.indexOf("r.estado === 'realizada' && r.fecha === fechaISO(new Date())") !== -1,
          'a media tarde el dia parece vacio');

// Los ratos libres vienen del servidor, ya restado el calendario
const reservasGsLibres = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');
const dispGsLibres = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '02_Disponibilidad.gs'), 'utf8');
comprobar('los ratos libres los calcula el servidor, con el calendario delante',
          dispGsLibres.indexOf('function huecosLibresParaPanel') !== -1 &&
          dispGsLibres.indexOf('leerEventosOcupados_(desde, hasta)') !== -1 &&
          reservasGsLibres.indexOf('libres: libres,') !== -1,
          'el panel solo mide entre clase y clase y no ve los bloqueos del calendario');

comprobar('y el panel los pinta, incluso en dias sin ninguna clase',
          editor.indexOf('(libres || []).forEach(function (d) { dia(d.fecha).tramos = d.tramos || []; })') !== -1 &&
          editor.indexOf('if (!d.clases.length && !huecos.length && !d.examenes.length) return;') !== -1,
          'un dia vacio no sale, y es el que Sara quiere ver');

comprobar('si el servidor es mas viejo y no los manda, se mide entre clases',
          editor.indexOf('if (!libres && anterior) html += huecoEntre(anterior, r);') !== -1,
          'un panel nuevo con servidor viejo se queda sin huecos');

comprobar('cada rato libre abre el calendario en ese dia',
          editor.indexOf("onclick=\"abrirCalendario(\\'' + escapar(fecha || '') + '\\')\"") !== -1 &&
          editor.indexOf("ruta += '/day/'") !== -1,
          'el rato libre no lleva a ninguna parte');

// Las cuentas, ejecutadas
const fuenteCuentas = ['enMinutosReloj', 'textoHoras', 'textoDeTrabajo', 'htmlDeTrabajo', 'textoDeHueco', 'claseDeEscuela',
                       'quienCabe', 'pintarHueco', 'fechaISO', 'fechaDesdeISO', 'lunesDe',
                       'duracionDe', 'escapar', 'diaCorto', 'pintarResumenSemanas']
  .map(extraerFuncion).join('\n\n');

const pintado = {};
const cuentas = new Function('ESTADO', 'el', 'DIAS_CORTOS', 'MESES_CORTOS', 'abrirCalendario',
  fuenteCuentas + '\nreturn { textoHoras: textoHoras, textoDeTrabajo: textoDeTrabajo, lunesDe: lunesDe, quienCabe: quienCabe, ' +
  'pintarHueco: pintarHueco, pintarResumenSemanas: pintarResumenSemanas };'
)(ESTADO_PRUEBA, function () { return pintado; },
  ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  function () {});

comprobar('9 horas justas', cuentas.textoHoras(540) === '9 h', cuentas.textoHoras(540));
comprobar('cuatro y media', cuentas.textoHoras(270) === '4 h 30', cuentas.textoHoras(270));
comprobar('tres cuartos', cuentas.textoHoras(45) === '45 min', cuentas.textoHoras(45));
comprobar('nada', cuentas.textoHoras(0) === '0 h', cuentas.textoHoras(0));

comprobar('el lunes de un miercoles', cuentas.lunesDe('2026-08-26') === '2026-08-24',
          cuentas.lunesDe('2026-08-26'));
comprobar('el lunes de un domingo es el anterior', cuentas.lunesDe('2026-08-30') === '2026-08-24',
          cuentas.lunesDe('2026-08-30'));
comprobar('y el de un lunes es el mismo', cuentas.lunesDe('2026-08-24') === '2026-08-24');

// Un rato libre del servidor, con clase de Andorra a la izquierda y nada a la derecha
const trasAndorra = cuentas.quienCabe({ hora_inicio: '11:30', hora_fin: '12:30', esc_izq: 'Andorra', esc_der: '' });
comprobar('una hora detras de una de Andorra vale para Andorra',
          !!trasAndorra && trasAndorra.libre === 60 && trasAndorra.caben &&
          trasAndorra.caben.length === 1 && trasAndorra.caben[0].nombre === 'Andorra',
          JSON.stringify(trasAndorra));
const ventanaEntera = cuentas.quienCabe({ hora_inicio: '14:00', hora_fin: '18:30', esc_izq: '', esc_der: '' });
comprobar('una tarde entera vale para todos',
          !!ventanaEntera && ventanaEntera.libre === 270 && ventanaEntera.caben === null,
          JSON.stringify(ventanaEntera));
comprobar('y media hora no vale para nadie',
          cuentas.quienCabe({ hora_inicio: '10:00', hora_fin: '10:30', esc_izq: '', esc_der: '' }) === null);

const botonHueco = cuentas.pintarHueco({ hora_inicio: '10:00', hora_fin: '13:00', esc_izq: '', esc_der: '' }, '2026-08-24');
comprobar('el rato libre es un boton que abre ese dia',
          botonHueco.indexOf("abrirCalendario('2026-08-24')") !== -1 &&
          botonHueco.indexOf('3 h libres') !== -1 &&
          botonHueco.indexOf('10:00 – 13:00') !== -1,
          botonHueco);

// El resumen por semanas, con clases y ratos libres de dos semanas distintas
const hoyPrueba = new Date();
const lunesPrueba = cuentas.lunesDe(
  hoyPrueba.getFullYear() + '-' + ('0' + (hoyPrueba.getMonth() + 1)).slice(-2) + '-' +
  ('0' + hoyPrueba.getDate()).slice(-2));
const masDias = function (iso, n) {
  const t = iso.split('-');
  const d = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]) + n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
};
cuentas.pintarResumenSemanas(
  [{ fecha: masDias(lunesPrueba, 1), hora_inicio: '08:30', hora_fin: '10:00' },
   { fecha: masDias(lunesPrueba, 2), hora_inicio: '08:30', hora_fin: '10:00' },
   { fecha: masDias(lunesPrueba, 8), hora_inicio: '14:00', hora_fin: '15:00' }],
  [{ fecha: masDias(lunesPrueba, 3), tramos: [{ hora_inicio: '14:00', hora_fin: '18:30', esc_izq: '', esc_der: '' }] },
   { fecha: masDias(lunesPrueba, 9), tramos: [{ hora_inicio: '10:00', hora_fin: '10:30', esc_izq: '', esc_der: '' }] }]);
comprobar('esta semana suma sus clases y su rato libre',
          pintado.innerHTML.indexOf('Esta semana') !== -1 &&
          pintado.innerHTML.indexOf('3 h de clase') !== -1 &&
          pintado.innerHTML.indexOf('4 h 30 libres') !== -1,
          pintado.innerHTML);
comprobar('y la que viene, lo suyo, sin contar la media hora que no vale',
          pintado.innerHTML.indexOf('La semana que viene') !== -1 &&
          pintado.innerHTML.indexOf('1 h de clase') !== -1 &&
          pintado.innerHTML.indexOf('30 min libres') === -1,
          pintado.innerHTML);

console.log('== Los examenes, en la agenda y en las horas ==');

/*
 * Los miercoles Sara esta en el examen. No es una clase, pero es parte de su dia y
 * son horas trabajadas: va en su sitio de la cronologia y cuenta en la semana.
 */
comprobar('el servidor manda los examenes del calendario con los ratos libres',
          dispGsLibres.indexOf('function examenesParaPanel_') !== -1 &&
          dispGsLibres.indexOf('examenes: examenesParaPanel_(') !== -1,
          'el panel no sabe de los examenes');
comprobar('el panel los pinta como una fila distinta, sin botones',
          editor.indexOf('function filaDeExamen') !== -1 &&
          editor.indexOf('.clase.examen{') !== -1 &&
          editor.indexOf("{ inicio: e.hora_inicio, html: filaDeExamen(e) }") !== -1,
          'los examenes no salen en la agenda');
comprobar('y cuentan como horas trabajadas, diciendo cuanto es examen',
          cuentas.textoDeTrabajo(180, 240) === '7 h de trabajo (4 h examen)' &&
          cuentas.textoDeTrabajo(180, 0) === '3 h de clase' &&
          cuentas.textoDeTrabajo(0, 0) === 'sin clases',
          cuentas.textoDeTrabajo(180, 240));
pintado.innerHTML = '';
cuentas.pintarResumenSemanas(
  [{ fecha: masDias(lunesPrueba, 1), hora_inicio: '08:30', hora_fin: '10:00' }],
  [],
  [{ fecha: masDias(lunesPrueba, 2), hora_inicio: '09:00', hora_fin: '13:00', titulo: 'Exámenes' }]);
comprobar('el resumen de la semana suma el examen',
          pintado.innerHTML.indexOf('5 h 30 de trabajo <span class="sinpartir">(4 h examen)</span>') !== -1,
          pintado.innerHTML);
// En un movil estrecho la linea se parte delante del parentesis, nunca por dentro
comprobar('y el parentesis del examen no se parte en dos lineas',
          editor.indexOf('.sinpartir{white-space:nowrap}') !== -1 &&
          editor.indexOf("'<span class=\"dia-agenda-clases\">' + htmlDeTrabajo(") !== -1,
          'el "(2 h 45" se queda en una linea y el "examen)" en otra');

console.log('== Sin historial ==');
comprobar('el panel ya no tiene la seccion de historial',
          html.indexOf('Historial') === -1 && html.indexOf('lista-recientes') === -1 &&
          editor.indexOf('pintarHistorial') === -1,
          'sigue habiendo historial');

console.log('== La pagina del alumno, sin resenas ==');

const alumnoSinResena = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
const estiloAlumno = fs.readFileSync(path.join(__dirname, '..', 'docs', 'estilo.css'), 'utf8');
const escuelasGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '06_Escuelas.gs'), 'utf8');

// Sara pidio que no saliera nada de resenas, y no sale: ni en la pagina ni en el servidor
comprobar('la pagina del alumno no menciona las resenas',
          !/rese[nñ]a/i.test(alumnoSinResena) && !/rese[nñ]a/i.test(estiloAlumno),
          'queda algo de resenas en la pagina');
comprobar('ni el servidor las manda',
          dispGsLibres.indexOf('resena') === -1 && escuelasGs.indexOf('Resena') === -1,
          'el servidor sigue mandando enlaces de resena');

console.log('== El movil, como lo escriba el alumno ==');

// baseGs ya esta leido arriba, en el testigo de la version
const indexAlumno = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');

/*
 * "618090" daba "Revisa el numero de movil": la pagina contaba seis digitos y el
 * servidor exigia ocho. Ahora los dos cuentan solo digitos y con seis vale.
 */
comprobar('la pagina solo cuenta digitos, y con seis vale',
          alumnoSinResena.indexOf('function contarDigitos') !== -1 &&
          alumnoSinResena.indexOf('if (contarDigitos(telefono) < 6)') !== -1,
          'la pagina sigue exigiendo un formato');
comprobar('el servidor tambien',
          baseGs.indexOf('return limpio.length >= 6 && limpio.length <= 15;') !== -1,
          'el servidor rechaza los moviles de Andorra');
comprobar('y el tope de letras deja sitio a los espacios y parentesis',
          reservasGsLibres.indexOf(".trim().substring(0, 40)") !== -1,
          'un movil con espacios se corta');
comprobar('la ayuda del campo lo dice',
          indexAlumno.indexOf('Escríbelo como quieras, con o sin espacios') !== -1 &&
          indexAlumno.indexOf('inputmode="tel"') !== -1,
          'la ayuda sigue pidiendo un formato');

console.log('== Lo que Sara borra del calendario, desaparece ==');

const agendaGsPapelera = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '09_Agenda.gs'), 'utf8');
comprobar('un evento en la papelera no cuenta como vivo',
          agendaGsPapelera.indexOf('function sigueEnElCalendario_') !== -1 &&
          agendaGsPapelera.indexOf('if (suelto && sigueEnElCalendario_(cal, suelto)) evento = suelto;') !== -1,
          'una clase borrada del calendario seguiria confirmada');

console.log('== Los enlaces para los alumnos ==');

/*
 * Se comparten una vez por grupo de alumnos y no hacen falta a diario, asi que van
 * al final: encima de las clases solo estorbaban.
 */
comprobar('estan por debajo de las clases y de los ajustes',
          editor.indexOf('id="bloque-enlace"') > editor.indexOf('id="lista-proximas"') &&
          editor.indexOf('id="bloque-enlace"') > editor.indexOf('guardarAjustes()'),
          'siguen arriba, encima de las clases');

comprobar('y antes del pie con la version',
          editor.indexOf('id="bloque-enlace"') < editor.indexOf('id="pie-version"'),
          'quedan por debajo del pie');

comprobar('los botones, pegados a la derecha',
          editor.indexOf('#enlaces-escuela{display:flex;gap:.375rem;flex-wrap:wrap;margin-left:auto}') !== -1,
          'no estan alineados a la derecha');

console.log('== El titulo de cada uno ==');

const apiGsTitulo = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '05_Api.gs'), 'utf8');
const reservasGsTitulo = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');

/*
 * Sara y sus alumnos ven titulos distintos. Estaban compartiendo el mismo ajuste, asi
 * que cambiar uno cambiaba el otro sin querer.
 */
comprobar('el panel tiene su propio titulo',
          reservasGsTitulo.indexOf("nombre_panel: config('nombre_panel'") !== -1 &&
          editor.indexOf('resp.config.nombre_panel || resp.config.nombre_sitio') !== -1,
          'panel y alumno comparten titulo');

comprobar('y sale ya escrito, sin parpadeo',
          editor.indexOf('<h1 id="titulo">Clases con Sarita</h1>') !== -1,
          'parpadea al cargar');

comprobar('tambien en la pestaña del navegador',
          apiGsTitulo.indexOf("config('nombre_panel', 'Clases con Sarita')") !== -1);

comprobar('y se puede cambiar desde los ajustes',
          apiGsTitulo.indexOf("'nombre_panel'") !== -1);

console.log('== El panel sin la barra de Google ==');

const envoltorio = fs.readFileSync(path.join(__dirname, '..', 'docs', 'panel.html'), 'utf8');

/*
 * Google pone en sus aplicaciones web un aviso que dice "esta aplicacion la ha creado
 * un usuario de Apps Script". Vive fuera del marco donde corre el panel, asi que no
 * hay forma de quitarlo desde dentro: metiendolo en un marco propio se queda fuera.
 */
comprobar('el panel se abre dentro de un marco propio',
          envoltorio.indexOf('<iframe id="panel"') !== -1 &&
          envoltorio.indexOf('CONFIG.URL_API') !== -1,
          'no monta el panel');

// La clave no puede acabar en un repositorio publico
comprobar('LA CLAVE NO ESTA EN EL ARCHIVO',
          !/[?#]t=[\w-]{8,}/.test(envoltorio.replace(/panel\.html#t=/g, '')),
          'hay una clave escrita en un archivo publico');

comprobar('se lee de detras de la almohadilla, que no viaja a ningun servidor',
          envoltorio.indexOf('window.location.hash.match') !== -1,
          'la clave viajaria al servidor');

comprobar('y sin ella se explica en vez de quedarse en blanco',
          envoltorio.indexOf('id="sin-clave"') !== -1);

comprobar('los buscadores no lo indexan',
          envoltorio.indexOf('noindex') !== -1, 'el panel seria rastreable');

const apiEnlace = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '05_Api.gs'), 'utf8');
comprobar('y es el enlace que se da al pedirlo',
          apiEnlace.indexOf("'panel.html#t=' + clave") !== -1,
          'sigue dando el de script.google.com');

console.log('== Los contadores ==');

/*
 * Las pendientes vienen agrupadas por alumno, asi que contar los grupos decia 1
 * cuando eran las tres clases que habia pedido la misma persona.
 */
comprobar('por confirmar cuenta clases, no alumnos',
          editor.indexOf("el('n-pendientes').textContent = clases;") !== -1,
          'sigue contando alumnos');

/*
 * El subtitulo sumaba el total de cada grupo. Al pasar las pendientes a lista suelta
 * ese total dejo de existir y el panel decia "NaN clases esperando respuesta".
 */
comprobar('el subtitulo cuenta lo mismo que el contador',
          editor.indexOf('var clases = pendientes.length') !== -1 &&
          editor.indexOf('clases += g.total') === -1,
          'el subtitulo diria NaN');

/*
 * Los archivos se pegan a mano, asi que es facil actualizar el panel y no el resto.
 * Aqui se saca comoLista del panel y se ejecuta con las dos formas que puede mandar
 * el servidor: la de ahora y la agrupada de antes.
 */
const lista = new Function(extraerFuncion('comoLista') + '\nreturn comoLista;')();

const sueltas = lista([
  { id: 'b', fecha: '2026-09-08', hora_inicio: '09:00' },
  { id: 'a', fecha: '2026-09-07', hora_inicio: '10:30' }
]);
comprobar('con la forma de ahora, las devuelve ordenadas',
          sueltas.length === 2 && sueltas[0].id === 'a',
          JSON.stringify(sueltas.map(r => r.id)));

const agrupadas = lista([
  { nombre: 'Marta', total: 2, reservas: [
    { id: 'm2', fecha: '2026-09-09', hora_inicio: '09:00' },
    { id: 'm1', fecha: '2026-09-07', hora_inicio: '09:00' }
  ] },
  { nombre: 'Joan', total: 1, reservas: [
    { id: 'j1', fecha: '2026-09-08', hora_inicio: '15:00' }
  ] }
]);
comprobar('y con la agrupada de antes, las abre',
          agrupadas.length === 3, JSON.stringify(agrupadas.map(r => r.id)));
comprobar('mezclando los alumnos en orden de reloj',
          agrupadas.map(r => r.id).join(',') === 'm1,j1,m2',
          agrupadas.map(r => r.id).join(','));

comprobar('sin datos no se rompe',
          lista(undefined).length === 0 && lista([]).length === 0);
comprobar('ni con huecos en la lista', lista([null, undefined]).length === 0);

console.log('== Un WhatsApp por alumno, no por clase ==');

/*
 * Lo que se podia perder al ordenar por hora: Marta pide tres clases, caen en tres
 * dias distintos de la lista, y confirmarlas le manda tres mensajes seguidos. Aqui se
 * saca del panel la funcion que las junta y se ejecuta de verdad.
 */
const fuenteCola = extraerFuncion('claveDeAlumno') + '\n' + extraerFuncion('colaDeAvisos');

comprobar('se puede sacar la funcion que junta los avisos',
          fuenteCola.indexOf('function colaDeAvisos') !== -1, 'no se encontro');

const cola = new Function('AVISOS', 'pintarAvisoPendiente', 'el',
  fuenteCola + '\nreturn { colaDeAvisos: colaDeAvisos, ver: function () { return AVISOS; } };'
)({ turnos: [], indice: 0 }, function () {}, function () { return { style: {} }; });

function claseDe(nombre, telefono, fecha) {
  return { nombre: nombre, telefono: telefono, fecha: fecha,
           hora_inicio: '10:30', hora_fin: '12:00', etiqueta_fecha: fecha };
}

// Tres de Marta en tres dias distintos, y una de Joan por medio
cola.colaDeAvisos([
  claseDe('Marta Ruiz', '376600111', 'lunes'),
  claseDe('Joan Pla',   '376600222', 'lunes'),
  claseDe('Marta Ruiz', '376600111', 'miercoles'),
  claseDe('Marta Ruiz', '376600111', 'viernes')
], { hecho: 'Confirmadas', estado: 'confirmada' }, '');

const turnos = cola.ver().turnos;
comprobar('cuatro clases, dos alumnos: dos mensajes', turnos.length === 2,
          JSON.stringify(turnos.map(t => t.nombre + ':' + t.reservas.length)));
comprobar('las tres de Marta van en el mismo',
          turnos[0].nombre === 'Marta Ruiz' && turnos[0].reservas.length === 3,
          JSON.stringify(turnos[0].reservas.length));
comprobar('y la de Joan en el suyo',
          turnos[1].nombre === 'Joan Pla' && turnos[1].reservas.length === 1);

// Una clase apuntada a mano puede no tener movil: se junta por el nombre
cola.colaDeAvisos([
  claseDe('Ana Sense Mobil', '', 'lunes'),
  claseDe('Ana Sense Mobil', '', 'martes')
], { hecho: 'Confirmadas', estado: 'confirmada' }, '');

comprobar('sin movil se juntan por el nombre',
          cola.ver().turnos.length === 1 && cola.ver().turnos[0].reservas.length === 2,
          JSON.stringify(cola.ver().turnos.map(t => t.nombre + ':' + t.reservas.length)));

console.log('== Sin la seccion de mañana ==');

/*
 * Sara pidio quitar del panel la lista de las clases de mañana y el boton de ir
 * avisando a los alumnos. Fuera la seccion, fuera el codigo y fuera la plantilla
 * del recordatorio, que ya no la usaba nadie.
 */
const avisosGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '04_Avisos.gs'), 'utf8');
comprobar('el panel ya no tiene la seccion de mañana',
          html.indexOf('seccion-manana') === -1 && html.indexOf('btn-recordar') === -1 &&
          html.indexOf('lista-manana') === -1,
          'sigue la seccion de mañana');
comprobar('ni el codigo que la pintaba',
          editor.indexOf('pintarManana') === -1 && editor.indexOf('avanzarRecordatorio') === -1 &&
          editor.indexOf('refrescarBotonRecordar') === -1 && editor.indexOf('MANANA') === -1,
          'queda codigo huerfano');
comprobar('ni la plantilla del recordatorio en el servidor',
          avisosGs.indexOf('recordatorio') === -1 && editor.indexOf("'recordatorio'") === -1,
          'queda la plantilla del recordatorio');

console.log('== El parte semanal, plegado ==');

const seccionParte = (html.match(/<section class="seccion" id="seccion-parte"[\s\S]*?<\/section>/) || [''])[0];
comprobar('la seccion del parte existe', seccionParte.length > 0);
comprobar('y es un desplegable, no una tarjeta fija',
          seccionParte.indexOf('<details>') !== -1 && seccionParte.indexOf('<summary>') !== -1 &&
          seccionParte.indexOf('class="tarjeta"') === -1,
          'el parte sigue abierto siempre');
comprobar('con sus tres botones dentro',
          seccionParte.indexOf('id="btn-parte-actual"') !== -1 &&
          seccionParte.indexOf('id="btn-parte-pasada"') !== -1 &&
          seccionParte.indexOf('id="btn-parte-proxima"') !== -1,
          'falta algun boton del parte');

console.log('== El horario extendido, en dias concretos ==');

/*
 * Una franja mas larga ("de 08:00 a 20:30") que Sara enciende en dias sueltos desde
 * el panel. El horario habitual no se toca, y el servidor es el unico que sabe que
 * ventanas tiene cada dia: disponibilidad, ratos libres y validacion pasan por ahi.
 */
const horarioExtGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '07_Horario.gs'), 'utf8');
const dispExtGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '02_Disponibilidad.gs'), 'utf8');
const apiExtGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '05_Api.gs'), 'utf8');
const reservasExtGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '03_Reservas.gs'), 'utf8');

comprobar('el servidor guarda la franja y los dias',
          horarioExtGs.indexOf('function guardarHorarioExtendido') !== -1 &&
          horarioExtGs.indexOf('function leerHorarioExtendido') !== -1 &&
          horarioExtGs.indexOf("'horario_extendido'") !== -1,
          'no hay donde guardarlo');
comprobar('y las tres puertas preguntan por el mismo sitio',
          (dispExtGs.match(/ventanasDelDia_\(/g) || []).length === 3 &&
          dispExtGs.indexOf('horario[diaSem] || []') === -1 &&
          dispExtGs.indexOf("ctx.horario[diaSemanaIso(aDate(fecha, '00:00'))]") === -1,
          'alguna parte sigue mirando el horario por dia de la semana');
comprobar('la accion del panel existe y va con clave',
          apiExtGs.indexOf("case 'guardar_horario_extendido':") !== -1 &&
          apiExtGs.indexOf('exigirAdmin_(datos.t) || guardarHorarioExtendido(') !== -1,
          'la accion no existe o esta abierta');
comprobar('el panel lo recibe, con los dias que tiene a la vista',
          reservasExtGs.indexOf('horario_extendido: leerHorarioExtendido()') !== -1 &&
          reservasExtGs.indexOf('dias_vista: diasQueSeOfrecen_()') !== -1,
          'el panel no sabe que dias ofrecer');
comprobar('y lo pinta en su desplegable, con guardado propio',
          html.indexOf('id="bloque-extendido"') !== -1 &&
          editor.indexOf('function pintarHorarioExtendido') !== -1 &&
          editor.indexOf("apiPanel('guardar_horario_extendido'") !== -1,
          'no hay editor del horario extendido');
comprobar('si el servidor es mas viejo, el bloque no sale',
          editor.indexOf("if (!extendido || !extendido.tramo) { bloque.style.display = 'none'; return; }") !== -1,
          'un servidor viejo dejaria el bloque a medias');
comprobar('y al guardar se vuelven a pedir los ratos libres',
          extraerFuncion('guardarHorarioExtendidoPanel').indexOf('cargar(false, true)') !== -1,
          'la agenda se quedaria vieja');

// Ejecutado: la lista de dias con su casilla
const fuenteExt = ['fechaISO', 'fechaDesdeISO', 'diaCorto', 'escapar', 'pintarHorarioExtendido']
  .map(extraerFuncion).join('\n\n');
const elementosExt = {};
const elExt = function (id) {
  if (!elementosExt[id]) elementosExt[id] = { style: {}, value: '', innerHTML: '' };
  return elementosExt[id];
};
const hoyExt = new Date();
const isoExt = function (n) {
  const d = new Date(hoyExt.getFullYear(), hoyExt.getMonth(), hoyExt.getDate() + n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
};
// El sabado mas cercano, para ver el aviso de "cerrado de normal"
let saltoSabado = 0;
while (new Date(hoyExt.getFullYear(), hoyExt.getMonth(), hoyExt.getDate() + saltoSabado).getDay() !== 6) saltoSabado++;

const ESTADO_EXT = { datos: { config: { horario: { dias: {
  1: { activo: true }, 2: { activo: true }, 3: { activo: true }, 4: { activo: true }, 5: { activo: true },
  6: { activo: false }, 7: { activo: false } } } } } };
const pintaExt = new Function('ESTADO', 'el', 'EXTENDIDO', 'DIAS_CORTOS', 'MESES_CORTOS',
  fuenteExt + '\nreturn { pintar: pintarHorarioExtendido, ver: function () { return EXTENDIDO; } };'
)(ESTADO_EXT, elExt, { fechas: [] },
  ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']);

pintaExt.pintar({ tramo: ['08:00', '20:30'], fechas: [isoExt(2)] }, 10);
const listaExt = elementosExt['dias-extendidos'].innerHTML;
comprobar('sale una casilla por dia a la vista',
          (listaExt.match(/type="checkbox"/g) || []).length === 10,
          (listaExt.match(/type="checkbox"/g) || []).length + ' casillas');
comprobar('el dia guardado viene marcado',
          listaExt.indexOf('id="ext-' + isoExt(2) + '" checked') !== -1 &&
          listaExt.indexOf('id="ext-' + isoExt(3) + '" checked') === -1,
          'no respeta lo guardado');
comprobar('el primero es hoy y el segundo mañana',
          listaExt.indexOf('>hoy<') !== -1 && listaExt.indexOf('>mañana<') !== -1,
          'los dias no se nombran');
comprobar('los dias que de normal no trabaja lo dicen',
          saltoSabado < 10 ? listaExt.indexOf('cerrado de normal') !== -1 : true,
          'un sabado no avisa de que es sabado');
comprobar('la franja sale en sus campos',
          elementosExt['ext-desde'].value === '08:00' && elementosExt['ext-hasta'].value === '20:30');
comprobar('y el bloque se enseña',
          elementosExt['bloque-extendido'].style.display === 'block');

pintaExt.pintar(null, 10);
comprobar('sin datos del servidor, el bloque se esconde',
          elementosExt['bloque-extendido'].style.display === 'none');

console.log('== Una semana mas a partir del jueves ==');

const instalarGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', '01_Instalar.gs'), 'utf8');
comprobar('la regla vive en Config y el instalador la explica',
          dispExtGs.indexOf("configNum('semana_extra_desde', 0)") !== -1 &&
          instalarGs.indexOf("'semana_extra_desde'") !== -1,
          'la semana extra no se puede configurar');
comprobar('y la guia dice como activarla',
          guia.indexOf('semana_extra_desde') !== -1, 'la guia no lo cuenta');

console.log('\n' + (fallos === 0
  ? 'TODO CORRECTO — el panel, la guía y la revisión están al día'
  : fallos + ' PROBLEMAS'));
process.exit(fallos === 0 ? 0 : 1);
