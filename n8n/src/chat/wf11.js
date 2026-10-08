//// Validar
// @incluir comun-chat
// Cuerpo de la web (index.html, JS 12d) reenviado por tools/chat-proxy.py: {sessionId, mensaje, pagina:{seccion, producto?}}.
const w = $('POST chat-tienda').first().json || {};
const b = w.body && typeof w.body === 'object' && !Array.isArray(w.body) ? w.body : {};
const malo = function (status, msg) { return [{ json: { valido: false, status: status, cuerpo: { respuesta: msg, escribiendo_ms: 0 } } }]; };
const sesion = typeof b.sessionId === 'string' ? b.sessionId.trim().toLowerCase() : '';
if (!/^[a-z0-9-]{8,64}$/.test(sesion)) return malo(400, 'No pude leer tu sesión de chat. Recarga la página y vuelve a escribirme.');
const mensaje = (typeof b.mensaje === 'string' ? b.mensaje : '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const n = Array.from(mensaje).length;
if (n < 1) return malo(400, 'Escríbeme tu consulta y te ayudo.');
if (n > CHAT.MAX_MENSAJE) return malo(400, 'Tu mensaje es muy largo (máximo ' + CHAT.MAX_MENSAJE + ' caracteres). ¿Me lo resumes?');
const pg = b.pagina && typeof b.pagina === 'object' && !Array.isArray(b.pagina) ? b.pagina : {};
const pagina = { seccion: /^[a-z0-9-]{1,30}$/.test(String(pg.seccion || '')) ? String(pg.seccion) : '', producto: /^prd-\d{4,6}$/.test(String(pg.producto || '')) ? String(pg.producto) : '' };
return [{ json: { valido: true, sesion: sesion, mensaje: mensaje, pagina: pagina, ip_hash: hashIp(ipDe(w.headers || {})), ahora: Date.now() } }];

//// Config
// @incluir comun
// @incluir comun-chat
// pb_config -> Config del núcleo + claves propias del chat (opcionales; si faltan, valores por defecto):
//   CHAT_MODELO (llama3.1:8b) y TELEGRAM_API_URL (https://api.telegram.org; solo se cambia en pruebas con un Telegram simulado).
const filas = $input.all().map(function (i) { return i.json; });
const cfg = armarConfig(filas);
const raw = {};
filas.forEach(function (f) { if (f && typeof f.clave === 'string') raw[f.clave] = f.valor === null || f.valor === undefined ? '' : String(f.valor).trim(); });
cfg.CHAT_MODELO = /^[a-z0-9._:\/-]{2,80}$/i.test(raw.CHAT_MODELO || '') ? raw.CHAT_MODELO : CHAT.MODELO;
cfg.TELEGRAM_API_URL = /^https?:\/\/[a-z0-9.-]+(:\d{2,5})?\/?$/i.test(raw.TELEGRAM_API_URL || '') ? raw.TELEGRAM_API_URL.replace(/\/$/, '') : 'https://api.telegram.org';
cfg.DESTINOS = admins(cfg).filter(function (a) { return a.id > 0; }).map(function (a) { return a.id; });
return [{ json: cfg }];

//// Catálogo
// @incluir validar.js
// @incluir comun-chat
// Catálogo compacto y datos de la tienda desde la web publicada (lo mismo que ve el visitante), en caché 10 min
// (datos estáticos del workflow: solo persisten en ejecuciones de producción). Si la web no responde: caché vieja o aviso.
const cfg = $('Config').first().json;
const sd = $getWorkflowStaticData('global');
const ahora = Date.now();
if (sd.catalogo && sd.catalogo.v === 4 && ahora - Number(sd.catalogo.ts) < CHAT.CACHE_MS) return [{ json: Object.assign({}, sd.catalogo, { fuente: 'cache' }) }];
const base = String(cfg.SITIO_URL || '').replace(/\/?$/, '/');
const traer = async function (f) {
  const r = await this.helpers.httpRequest({ method: 'GET', url: base + 'data/' + f + '?v=' + Math.floor(ahora / CHAT.CACHE_MS), json: true, timeout: 8000 });
  return typeof r === 'string' ? JSON.parse(r) : r;
}.bind(this);
let prod = null, site = null, error = '';
try { const r = await Promise.all([traer('products.json'), traer('site.json')]); prod = r[0]; site = r[1]; } catch (e) { error = String((e && e.message) || e).slice(0, 200); }
if (!prod || !Array.isArray(prod.productos)) {
  if (sd.catalogo) return [{ json: Object.assign({}, sd.catalogo, { fuente: 'cache-vieja', error: error || 'products.json inválido' }) }];
  return [{ json: { v: 4, ts: 0, precios: [], fuente: 'sin-datos', error: error || 'products.json inválido', n: 0, ids: {}, whatsapp: CHAT.WHATSAPP, tienda: tiendaTexto(null, base),
    catalogo: '(El catálogo no se pudo cargar ahora: no menciones productos ni precios; invita a ver la web o a escribir por WhatsApp.)' } }];
}
sd.catalogo = Object.assign({ v: 4, ts: ahora }, compactarCatalogo(prod, site, base));
return [{ json: Object.assign({}, sd.catalogo, { fuente: 'web' }) }];

//// Preparar
// @incluir comun-chat
// @incluir prompt-vendedor
// Límites (sesión, IP y global en 10 min), estado de la cita (última fila "asistente"), notas aprendidas y prompt del sistema.
const v = $('Validar').first().json;
const cfg = $('Config').first().json;
const cat = $('Catálogo').first().json;
const filas = function (n) { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined; }); };
const ahora = v.ahora;
const wa = 'https://wa.me/' + (cat.whatsapp || CHAT.WHATSAPP);
const ventana = filas('Recientes').filter(function (r) { return Number(r.fecha_ms) > ahora - CHAT.VENTANA_MS; });
const nSesion = ventana.filter(function (r) { return r.sesion === v.sesion; }).length;
const nIp = ventana.filter(function (r) { return r.ip_hash === v.ip_hash; }).length;
if (nSesion >= CHAT.LIMITE_SESION || nIp >= CHAT.LIMITE_IP) {
  return [{ json: { llamar_ia: false, status: 429, cuerpo: { respuesta: 'Vas muy rápido: espera unos minutos y vuelve a escribirme. Si es urgente, escríbenos por WhatsApp: ' + wa, escribiendo_ms: 0 } } }];
}
if (ventana.length >= CHAT.LIMITE_GLOBAL) {
  return [{ json: { llamar_ia: false, status: 200, cuerpo: { respuesta: 'Ahora mismo estoy atendiendo muchas consultas a la vez. Escríbenos por WhatsApp y te respondemos al toque: ' + wa, escribiendo_ms: 0 } } }];
}
const hist = filas('Historial').sort(function (a, b) { return a.id - b.id; });
const ultimo = hist.slice().reverse().find(function (r) { return r.rol === 'asistente'; });
const estado = leerEstado(ultimo && ultimo.cita_json);
const turno = hist.reduce(function (m, r) { return Math.max(m, Number(r.turno) || 0); }, 0) + 1;
// v3: seguimiento de pedido SIN IA (WF15): "Hacer seguimiento de mi pedido", "¿dónde está mi pedido?", "PB-000123"… o la respuesta a
// "dame tu número y correo". Número y correo se toman de este mensaje y de los 3 anteriores del visitante.
const enSeguimiento = !!(ultimo && ultimo.intencion === 'seguimiento');
if (pideSeguimiento(v.mensaje) || (enSeguimiento && (numeroPedidoDe(v.mensaje) || correoDe(v.mensaje)))) {
  let numero = '', correo = '';
  (enSeguimiento ? hist.filter(function (r) { return r.rol === 'usuario'; }).slice(-3).map(function (r) { return String(r.texto || ''); }) : []).concat([v.mensaje])
    .forEach(function (t) { numero = numeroPedidoDe(t) || numero; correo = correoDe(t) || correo; });
  return [{ json: { llamar_ia: false, seguimiento: true, consultar: !!(numero && correo), numero: numero, correo: correo, ip_hash: v.ip_hash, sesion: v.sesion, turno: turno, whatsapp: wa, estado: estado } }];
}
const ocupados = filas('Citas').filter(function (c) { return c.estado === 'confirmada'; }).map(function (c) { return { inicio_ms: Number(c.inicio_ms), fin_ms: Number(c.fin_ms), fecha: c.fecha, hora: c.hora }; });
const hasta = ahora + CHAT.DIAS_CALENDARIO * 86400000;
const ocTexto = ocupados.filter(function (o) { return o.inicio_ms > ahora && o.inicio_ms < hasta; }).sort(function (a, b) { return a.inicio_ms - b.inicio_ms; })
  .map(function (o) { return o.fecha + ' ' + o.hora; }).join(', ') || 'ninguno';
const notas = notasAprendidas(filas('Aprendizaje'));
const pag = v.pagina || {};
const pagTexto = (pag.seccion ? 'Sección de la web: ' + pag.seccion + '. ' : '') + (pag.producto && cat.ids && cat.ids[pag.producto] ? 'Está viendo (o vio hace poco) ' + pag.producto + ' ' + cat.ids[pag.producto] + '.' : '') || '(sin datos)';
const poner = function (t, k, val) { return t.split('{{' + k + '}}').join(val); };
let sistema = PROMPT_VENDEDOR;
[['TIENDA', cat.tienda], ['WHATSAPP', wa], ['CATALOGO', cat.catalogo], ['APRENDIZAJE', notas.texto], ['FECHA', fechaTexto(ahora)], ['CALENDARIO', calendarioTexto(ahora)],
  ['OCUPADOS', ocTexto], ['PAGINA', pagTexto], ['CITA', estadoTexto(estado)]].forEach(function (x) { sistema = poner(sistema, x[0], String(x[1] || '')); });
const mensajes = [{ role: 'system', content: sistema }]
  .concat(hist.slice(-CHAT.HISTORIAL).map(function (r) { return { role: r.rol === 'usuario' ? 'user' : 'assistant', content: Array.from(String(r.texto || '')).slice(0, CHAT.MAX_TEXTO_HIST).join('') }; }))
  .concat([{ role: 'user', content: v.mensaje }]);
const cuerpo = { model: cfg.CHAT_MODELO, messages: mensajes, stream: false, format: ESQUEMA_CHAT, keep_alive: '10m',
  options: { num_ctx: 8192, temperature: 0.6, num_predict: 512 } };
return [{ json: { llamar_ia: true, cuerpo: cuerpo, estado: estado, turno: turno, ocupados: ocupados, notas: notas.n, catalogo_fuente: cat.fuente, whatsapp: wa } }];

//// Interpretar
// @incluir validar.js
// @incluir comun-chat
// Respuesta del modelo -> reglas deterministas. La cita SOLO se agenda si: datos completos y válidos (correo, teléfono peruano,
// Lun–Sáb 9:00–20:00 hora de Perú, bloque de 30 min, >= 1 h de anticipación, sin choque) + el resumen fijo ya se mostró con
// esos mismos datos + el visitante confirmó (el modelo lo marca o el texto es un "sí") y no pidió cambios.
const v = $('Validar').first().json;
const p = $('Preparar').first().json;
const r = $input.first().json || {};
const ahora = Date.now();
const wa = p.whatsapp;
const respaldo = 'Disculpa, ahora mismo no puedo responderte bien por aquí. Escríbenos por WhatsApp y te atendemos al toque: ' + wa;
const contenido = r.message && typeof r.message.content === 'string' ? r.message.content : '';
const llm = contenido ? extraerJson(contenido) : null;
const msIa = Number(r.total_duration) > 0 ? Math.round(Number(r.total_duration) / 1e6) : 0;
const est = p.estado;
const base = { intencion: 'otro', ms_ia: msIa, estado_nuevo: est, agendar: false, cita: null, aprender: p.turno % CHAT.APRENDER_CADA === 0 };
if (!llm || typeof llm.respuesta !== 'string' || !limpiarRespuesta(llm.respuesta)) {
  const e = r.error ? (typeof r.error === 'string' ? r.error : r.error.message || JSON.stringify(r.error)) : contenido ? 'JSON inválido del modelo' : 'sin respuesta del modelo';
  return [{ json: Object.assign(base, { respuesta: respaldo, error: 'ia: ' + String(e).replace(/\s+/g, ' ').slice(0, 180), aprender: false }) }];
}
let intencion = ['consulta_producto', 'seguimiento', 'interes_servicio', 'agendar', 'confirmar_cita', 'otro'].indexOf(llm.intencion) >= 0 ? llm.intencion : 'otro';
// Si el visitante pide la reunión con sus palabras (o deja su correo), es "agendar" aunque el modelo diga otra cosa.
const mN = sinTildes(v.mensaje).toLowerCase();
if (['interes_servicio', 'otro', 'consulta_producto'].indexOf(intencion) >= 0 && !negativo(v.mensaje) && !/\bsin (reuni|cita)|\bno (quiero|deseo|necesito|busco) (una |ninguna )?(reuni|cita)/.test(mN) &&
  (/\b(agend\w*|reuni\w*|citas?|conversar con abner|hablar con abner)\b/.test(mN) || /@/.test(v.mensaje))) intencion = 'agendar';
let respuesta = limpiarRespuesta(llm.respuesta);
// Los códigos internos (prd-0028) no se muestran al visitante aunque el modelo los copie del catálogo.
respuesta = respuesta.replace(/\s*\(\s*(c[oó]digo:?\s*)?prd-\d{4,6}\s*\)/gi, '').replace(/\b(c[oó]digo:?\s*)?prd-\d{4,6}\b\s*/gi, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim() || respuesta;
// "No tengo esa información": siempre ofrecer el WhatsApp de la tienda.
if (/\bno (tengo|cuento con) (esa |esta |mas )?informacion|\bno (lo )?se\b|\bno puedo ayudarte con eso/.test(sinTildes(respuesta).toLowerCase()) && !/wa\.me|whatsapp/i.test(respuesta)) {
  respuesta = unir(respuesta, 'Puedes confirmarlo por WhatsApp: ' + p.whatsapp);
}
// v3: envíos -> texto FIJO con las opciones reales de site.envios (costo desde y tiempo de la zona; opcionesDeEnvio de validar.js).
// El modelo a veces inventa plazos. Solo fuera de la conversación de la cita.
const catJ = $('Catálogo').first().json || {};
if (preguntaEnvio(v.mensaje) && catJ.envios && ['agendar', 'confirmar_cita'].indexOf(intencion) < 0 && est.estado !== 'recogiendo' && est.estado !== 'por_confirmar') {
  const envTxt = textoEnvio(catJ.envios, v.mensaje);
  if (envTxt) {
    respuesta = envTxt;
    if (/\b(pag(o|a|ar|amos|an)|tarjeta|yape|mercado ?pago|efectivo)\b/.test(sinTildes(v.mensaje).toLowerCase())) respuesta = unir(respuesta, 'Pagas con Mercado Pago (tarjeta de crédito o débito) al finalizar la compra en la web.');
    intencion = 'consulta_producto';
  }
}
// Honestidad: si preguntan si es un bot o una persona, la respuesta debe decir que es una asistente virtual con IA.
if (preguntaSiEsBot(v.mensaje) && !mencionaIA(respuesta)) respuesta = 'Soy Vale, la asistente virtual con inteligencia artificial de Palmera Brava. ' + respuesta;
// Sin presentaciones repetidas (la web ya saludó): se quita un "Soy Vale…" inicial si no preguntaron quién es.
if (!preguntaSiEsBot(v.mensaje)) {
  const sinIntro = respuesta.replace(/^(¡?hola[^.!?]{0,20}[.!?,]\s*)?soy vale(ria)?\b[^.!?]*[.!?]\s*/i, '');
  if (sinIntro.length >= 15) respuesta = sinIntro.charAt(0).toUpperCase() + sinIntro.slice(1);
}
// Preguntó el precio de una prenda y la respuesta no lo da: se añade el precio exacto del catálogo.
if (preguntaPrecio(v.mensaje) && !/S\/ ?\d/.test(respuesta)) {
  const pr = productosNombrados($('Catálogo').first().json.precios, v.mensaje + ' ' + respuesta);
  if (pr.length) respuesta = unir(respuesta, pr.map(function (x) { return x.nombre + ': ' + x.texto; }).join('; ') + '.');
}
const salida = function (o) { return [{ json: Object.assign(base, { intencion: intencion, respuesta: respuesta, error: '' }, o || {}) }]; };
if (pareceInyeccion(v.mensaje)) return salida({ intencion: 'otro', respuesta: RESPUESTA_INYECCION });
// v3: la IA cree que pregunta por un pedido ya hecho -> se piden número y correo (la web muestra el formulario del chat).
if (intencion === 'seguimiento' && est.estado !== 'recogiendo' && est.estado !== 'por_confirmar') {
  return salida({ accion: 'formulario_seguimiento', respuesta: 'Claro, te ayudo con el seguimiento. Escríbeme el número de tu pedido (empieza con PB-, por ejemplo PB-000123) y el correo con el que compraste.' });
}
if (est.estado === 'agendada') return salida();
// Datos: lo nuevo del modelo sobre lo ya recogido; correo y teléfono escritos por el visitante mandan sobre el modelo.
// Anti-invención: correo, teléfono y textos solo se aceptan si aparecen en lo que escribió el visitante.
const escrito = $('Historial').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.rol === 'usuario'; }).map(function (j) { return String(j.texto || ''); }).concat([v.mensaje]).join('\n');
const escritoN = sinTildes(escrito).toLowerCase();
const digitos = escrito.replace(/[^\d]/g, ' ').replace(/(\d) (?=\d)/g, '$1');
const nuevo = llm.cita && typeof llm.cita === 'object' ? llm.cita : {};
const datos = Object.assign({}, est.datos);
CAMPOS_CITA.forEach(function (c) {
  const val = limpio(nuevo[c], c === 'notas' ? 300 : 120);
  if (!val || sinTildes(val).toLowerCase() === sinTildes(datos[c] || '').toLowerCase()) return;
  if (c === 'correo' && escritoN.indexOf(val.toLowerCase()) < 0) return;
  if (c === 'telefono' && digitos.indexOf(val.replace(/\D/g, '').slice(-8)) < 0) return;
  if (['nombre', 'negocio', 'rubro'].indexOf(c) >= 0) {
    const palabras = sinTildes(val).toLowerCase().split(/[^a-z0-9ñ]+/).filter(function (x) { return x.length >= 3; });
    if (palabras.length && !palabras.some(function (x) { return escritoN.indexOf(x) >= 0; })) return;
  }
  if (c === 'modalidad' && !/presencial|persona|video|virtual|online|en linea|zoom|meet|teams|llamada|oficina|local|visita/.test(escritoN)) return;
  if (c === 'fecha' && !/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana|pasado|semana|\d{1,2})\b/.test(escritoN)) return;
  if (c === 'hora' && !/\d|medio ?dia|media/.test(escritoN)) return;
  datos[c] = val;
});
const mCorreo = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/i.exec(v.mensaje);
if (mCorreo) datos.correo = mCorreo[0];
const mTel = /(?:\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/.exec(v.mensaje);
if (mTel) datos.telefono = mTel[0];
if (!datos.rubro) datos.rubro = rubroDe(escrito);
// La conversación de la cita empieza cuando el visitante acepta (intención agendar/confirmar); antes solo se recuerdan los datos.
const enCurso = est.estado === 'recogiendo' || est.estado === 'por_confirmar' || intencion === 'agendar' || intencion === 'confirmar_cita';
// Día y hora escritos en este mensaje ("el sábado 10 a las 4 de la tarde") mandan sobre la conversión del modelo.
if (enCurso) { const fh = fechaHoraDeTexto(v.mensaje, ahora); if (fh.fecha) datos.fecha = fh.fecha; if (fh.hora) datos.hora = fh.hora; }
if (!enCurso) {
  // Interés en el servicio: siempre invitar a la reunión con Abner (objetivo de la demo).
  if (intencion === 'interes_servicio' && !/reuni|cita|agend/i.test(respuesta)) respuesta = unir(respuesta, 'Si quieres, te agendo una reunión gratuita de 30 minutos con Abner para ver cómo funcionaría en tu negocio. ¿Te parece?');
  const guardados = hayDatos(datos) ? validarCita(datos, { ahoraMs: ahora, ocupados: p.ocupados }).datos : est.datos;
  return salida({ respuesta: respuesta, estado_nuevo: { datos: guardados, estado: 'ninguno', firma: '', cita_id: '' } });
}
const val = validarCita(datos, { ahoraMs: ahora, ocupados: p.ocupados });
const errores = Object.keys(val.errores);
if (errores.length) {
  return salida({ respuesta: val.errores[errores[0]], estado_nuevo: { datos: val.datos, estado: 'recogiendo', firma: '', cita_id: '' } });
}
if (!val.ok) {
  if (!pideAlgo(respuesta, val.faltan)) respuesta = unir(respuesta, 'Para agendar me falta ' + faltanTexto(val.faltan) + '.');
  return salida({ respuesta: respuesta, estado_nuevo: { datos: val.datos, estado: 'recogiendo', firma: '', cita_id: '' } });
}
const firma = firmaCita(val.datos);
const confirma = est.estado === 'por_confirmar' && est.firma === firma && !negativo(v.mensaje) && (afirmativo(v.mensaje) || llm.cliente_confirmo === true);
if (!confirma) {
  if (est.estado === 'por_confirmar' && est.firma === firma && negativo(v.mensaje)) {
    return salida({ respuesta: /\?/.test(respuesta) ? respuesta : 'Claro, ¿qué dato quieres cambiar?', estado_nuevo: { datos: val.datos, estado: 'recogiendo', firma: '', cita_id: '' } });
  }
  return salida({ intencion: 'confirmar_cita', respuesta: resumenCita(val.datos), estado_nuevo: { datos: val.datos, estado: 'por_confirmar', firma: firma, cita_id: '' } });
}
const id = nuevoIdCita(ahora);
const d = val.datos;
const cita = { cita_id: id, sesion: v.sesion, nombre: d.nombre, negocio: d.negocio, rubro: d.rubro, correo: d.correo, telefono: d.telefono, fecha: d.fecha, hora: d.hora,
  inicio_ms: val.inicio_ms, fin_ms: val.fin_ms, modalidad: d.modalidad, notas: d.notas, estado: 'confirmada', resumen: '', aviso_telegram: '', ip_hash: v.ip_hash, creada_ms: ahora };
return salida({
  intencion: 'confirmar_cita', agendar: true, cita: cita, aprender: true,
  respuesta: '¡Listo, ' + d.nombre.split(' ')[0] + '! Tu reunión con Abner quedó agendada para el ' + fechaLarga(d.fecha) + ' a las ' + d.hora + ' (hora de Perú), ' +
    (d.modalidad === 'presencial' ? 'de forma presencial en Tarapoto' : 'por videollamada') + '. Abner te escribirá al ' + d.telefono + ' o a ' + d.correo + ' para confirmarte los detalles. ¿Te ayudo con algo más mientras tanto?',
  estado_nuevo: { datos: d, estado: 'agendada', firma: firma, cita_id: id }
});

//// Confirmar cita
// @incluir comun-chat
// Revisión final justo antes de guardar (otra persona pudo tomar el horario mientras respondía la IA) y tope de citas por contacto.
const it = $('Interpretar').first().json;
const p = $('Preparar').first().json;
const c = it.cita;
const ya = $input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined; });
const ahora = Date.now();
const contacto = ya.filter(function (x) { return Number(x.inicio_ms) > ahora && (x.correo === c.correo || x.telefono === c.telefono); });
const choque = ya.some(function (x) { return Number(x.inicio_ms) < Number(c.fin_ms) && Number(c.inicio_ms) < Number(x.fin_ms); });
const volver = function (respuesta, datos) {
  return [{ json: Object.assign({}, it, { agendar: false, cita: null, aprender: p.turno % CHAT.APRENDER_CADA === 0, respuesta: respuesta, estado_nuevo: { datos: datos, estado: 'recogiendo', firma: '', cita_id: '' } }) }];
};
if (contacto.length >= CHAT.MAX_CITAS_CONTACTO) {
  return volver('Veo que ya tienes ' + contacto.length + ' reuniones agendadas con ese correo o teléfono. Si necesitas cambiar alguna, escríbenos por WhatsApp: ' + p.whatsapp, it.estado_nuevo.datos);
}
if (choque) {
  const ocupados = (p.ocupados || []).concat(ya.map(function (x) { return { inicio_ms: Number(x.inicio_ms), fin_ms: Number(x.fin_ms) }; }));
  const datos = Object.assign({}, it.estado_nuevo.datos, { hora: '' });
  return volver('Uy, ese horario se acaba de ocupar. Tengo libre ' + sugerirHorarios(c.fecha, c.hora, ocupados, ahora) + '. ¿Cuál te acomoda?', datos);
}
return [{ json: Object.assign({}, it, { insertar: true }) }];

//// Fila cita
// Exactamente las columnas de pb_citas (insert con autoMap).
return [{ json: $('Confirmar cita').first().json.cita }];

//// Filas chat
// Dos filas para pb_chat_mensajes (visitante y asistente). La del asistente guarda el estado de la cita (cita_json).
const v = $('Validar').first().json;
const p = $('Preparar').first().json;
const it = $('Confirmar cita').isExecuted ? $('Confirmar cita').first().json : $('Interpretar').first().json;
let respuesta = it.respuesta;
let estado = it.estado_nuevo;
let agendada = false;
if (it.agendar && it.insertar) {
  const ins = $('Insertar cita').isExecuted ? $('Insertar cita').first().json : {};
  agendada = !!(ins && ins.id !== undefined);
  if (!agendada) {
    respuesta = 'Uy, no pude guardar tu reunión por un problema técnico. Escríbenos por WhatsApp y la agendamos al toque: ' + p.whatsapp;
    estado = Object.assign({}, estado, { estado: 'por_confirmar', cita_id: '' });
  }
}
const comun = { sesion: v.sesion, ip_hash: v.ip_hash, turno: p.turno, intencion: it.intencion };
return [
  { json: Object.assign({}, comun, { rol: 'usuario', texto: v.mensaje, fecha_ms: v.ahora, cita_json: '', pagina: JSON.stringify(v.pagina || {}), error: '', ms_ia: 0 }) },
  { json: Object.assign({}, comun, { rol: 'asistente', texto: respuesta, fecha_ms: Date.now(), cita_json: JSON.stringify(estado), pagina: '', error: it.error || '', ms_ia: it.ms_ia || 0 }) }
];

//// Respuesta
// @incluir comun-chat
// {respuesta, escribiendo_ms} para la web (+ "cita" si se agendó). Lo demás (aprendizaje, aviso a Abner) corre DESPUÉS de responder.
const f = $('Filas chat').all().map(function (i) { return i.json; });
const asis = f.find(function (x) { return x.rol === 'asistente'; }) || {};
const estado = leerEstado(asis.cita_json);
const it = $('Confirmar cita').isExecuted ? $('Confirmar cita').first().json : $('Interpretar').first().json;
const agendada = estado.estado === 'agendada' && !!estado.cita_id && it.agendar === true;
const cuerpo = { respuesta: asis.texto, escribiendo_ms: escribiendoMs(asis.texto) };
if (agendada) cuerpo.cita = { agendada: true, fecha: estado.datos.fecha, hora: estado.datos.hora, modalidad: estado.datos.modalidad };
if (it.accion === 'formulario_seguimiento') cuerpo.accion = 'formulario_seguimiento';
return [{ json: { status: 200, cuerpo: cuerpo, agendada: agendada, aprender: it.aprender === true || agendada } }];

//// Pedir aprendizaje
// @incluir comun-chat
// @incluir prompt-vendedor
// Segunda llamada a la IA (después de responder): resumen para Abner + preguntas, objeciones y datos útiles (memoria de largo plazo).
const v = $('Validar').first().json;
const cfg = $('Config').first().json;
const filas = $('Filas chat').all().map(function (i) { return i.json; });
const hist = $('Historial').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined; }).sort(function (a, b) { return a.id - b.id; });
const conversacion = hist.concat(filas).map(function (r) { return (r.rol === 'usuario' ? 'Visitante: ' : 'Vale: ') + Array.from(String(r.texto || '')).slice(0, 500).join(''); }).join('\n');
// Notas que ya existen: si la idea es la misma, el modelo debe copiar el texto exacto (así sube la frecuencia en vez de duplicar).
const previas = $('Aprendizaje').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.activo !== false && typeof j.texto === 'string'; })
  .slice(0, 30).map(function (j) { return '- (' + j.tipo + ') ' + limpio(j.texto, 160); }).join('\n');
const cuerpo = { model: cfg.CHAT_MODELO, stream: false, format: ESQUEMA_APRENDIZAJE, keep_alive: '10m', options: { num_ctx: 8192, temperature: 0.2, num_predict: 400 },
  messages: [{ role: 'system', content: PROMPT_APRENDIZAJE }, { role: 'user', content: (previas ? 'NOTAS QUE YA EXISTEN (solo referencia: si el visitante dijo LO MISMO, copia el texto exacto de esa nota; si no habló de eso, NO la incluyas):\n' + previas + '\n\n' : '') + 'CONVERSACIÓN:\n' + conversacion }] };
return [{ json: { cuerpo: cuerpo, sesion: v.sesion } }];

//// Procesar aprendizaje
// @incluir comun-chat
// Filtra las notas (sin datos personales ni instrucciones) y arma el upsert por "clave". La frecuencia sube 1 por conversación distinta.
const v = $('Validar').first().json;
const r = $input.first().json || {};
const res = $('Respuesta').first().json;
const o = r.message && typeof r.message.content === 'string' ? extraerJson(r.message.content) : null;
const ahora = Date.now();
const existentes = {};
$('Aprendizaje').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && typeof j.clave === 'string'; }).forEach(function (j) { existentes[j.clave] = j; });
const total = Object.keys(existentes).length;
const filas = [];
const vistos = {};
const visitante = $('Historial').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.rol === 'usuario'; }).map(function (j) { return String(j.texto || ''); }).concat([v.mensaje]).join('\n');
// Palabras del nombre y del negocio del visitante: una nota que las contenga no se guarda (datos personales).
const asis = $('Filas chat').all().map(function (i) { return i.json; }).find(function (j) { return j.rol === 'asistente'; }) || {};
const dv = leerEstado(asis.cita_json).datos;
const prohibidas = (dv.nombre + ' ' + dv.negocio).split(/\s+/).map(function (w) { return sinTildes(w).toLowerCase().replace(/[^a-z0-9ñ]/g, ''); })
  .filter(function (w) { return w.length >= 4 && ANCLA_IGNORAR.indexOf(w) < 0 && sinTildes(dv.rubro || '').toLowerCase().indexOf(w) < 0; });
[['preguntas_frecuentes', 'pregunta', 1], ['objeciones', 'objecion', 1], ['datos_utiles', 'dato', 1]].forEach(function (par) {
  const lista = o && Array.isArray(o[par[0]]) ? o[par[0]] : [];
  lista.slice(0, 3).forEach(function (x) {
    const texto = notaSegura(x, par[1], prohibidas);
    if (!texto || !anclada(texto, visitante, par[2])) return;
    const clave = claveNota(par[1], texto);
    if (clave.length < par[1].length + 5 || vistos[clave]) return;
    vistos[clave] = true;
    const e = existentes[clave];
    if (e) {
      const otra = e.ultima_sesion !== v.sesion;
      filas.push({ clave: clave, tipo: e.tipo || par[1], texto: e.texto || texto, frecuencia: (Number(e.frecuencia) || 0) + (otra ? 1 : 0), activo: e.activo !== false,
        origen: e.origen || 'auto', ultima_sesion: v.sesion, ultima_vez: ahora, creado_ms: Number(e.creado_ms) || ahora });
    } else if (total + filas.length < CHAT.MAX_APRENDIZAJE) {
      filas.push({ clave: clave, tipo: par[1], texto: texto, frecuencia: 1, activo: true, origen: 'auto', ultima_sesion: v.sesion, ultima_vez: ahora, creado_ms: ahora });
    }
  });
});
let resumen = o && typeof o.resumen === 'string' ? limpio(o.resumen, 600) : '';
if (!resumen) resumen = 'Lo que escribió el visitante: ' + limpio(visitante.split('\n').slice(-5).join(' / '), 500);
return [{ json: { resumen: resumen, filas: filas, agendada: res.agendada === true, ia_ok: !!o } }];

//// Filas aprendizaje
return $('Procesar aprendizaje').first().json.filas.map(function (f) { return { json: f }; });

//// Aviso cita
// @incluir comun
// @incluir comun-chat
// Mensaje a cada admin (AUTORIZADOS rol admin; si no hay, el dueño) con todos los datos + resumen. Sin token: no se avisa.
const cfg = $('Config').first().json;
const c = $('Fila cita').first().json;
const ap = $('Procesar aprendizaje').first().json;
if (!cfg.BOT_TOKEN || !cfg.DESTINOS.length) return [];
const texto = avisoCitaTexto(c, ap.resumen, h);
return cfg.DESTINOS.map(function (id) { return { json: enviar(id, texto) }; });

//// Archivo ICS
// @incluir comun-chat
// Un .ics (VEVENT en UTC, 30 min, alarma 30 min antes) por destinatario, como binario "data" para sendDocument.
const cfg = $('Config').first().json;
const c = $('Fila cita').first().json;
const ap = $('Procesar aprendizaje').first().json;
const ics = icsCita(Object.assign({}, c, { resumen: ap.resumen }), Date.now());
const nombre = 'cita-' + slugSimple(c.negocio) + '-' + c.fecha + '.ics';
const caption = 'Cita ' + c.negocio + ' – ' + fechaCorta(c.fecha) + ' ' + c.hora + '. Abre el archivo para agregarla a tu calendario.';
const out = [];
for (const id of cfg.DESTINOS) {
  const bin = await this.helpers.prepareBinaryData(Buffer.from(ics, 'utf8'), nombre, 'text/calendar');
  out.push({ json: { chat_id: id, caption: caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }, binary: { data: bin } });
}
return out;

//// Resultado aviso
// Cuántos mensajes y archivos llegaron (para la columna aviso_telegram de pb_citas).
const c = $('Fila cita').first().json;
const ap = $('Procesar aprendizaje').first().json;
const msj = $('Enviar aviso').all().map(function (i) { return i.json; });
const ics = $input.all().map(function (i) { return i.json; });
const okM = msj.filter(function (j) { return j && j.ok === true; }).length;
const okI = ics.filter(function (j) { return j && !j.error && (j.ok === true || j.message_id !== undefined || (j.result && j.result.message_id !== undefined) || j.document !== undefined); }).length;
return [{ json: { cita_id: c.cita_id, aviso_telegram: 'mensaje ' + okM + '/' + msj.length + ', ics ' + okI + '/' + ics.length, resumen: ap.resumen } }];

//// Respuesta seguimiento
// @incluir comun-chat
// v3: seguimiento sin IA. Con número y correo -> resultado de WF15 (vista pública, sin datos personales); si falta algo, se pide
// (y la web muestra su formulario dentro del chat: accion "formulario_seguimiento").
const p = $('Preparar').first().json;
const v = $('Validar').first().json;
let texto, accion = '', pedido = null;
if ($('WF15 Seguimiento').isExecuted) {
  const r = $('WF15 Seguimiento').first().json || {};
  if (r.error !== undefined && r.ok === undefined) texto = 'Ahora mismo no puedo revisar tu pedido. Intenta en unos minutos o escríbenos por WhatsApp: ' + p.whatsapp;
  else texto = textoSeguimiento(r);
  if (r.ok && r.pedido) pedido = r.pedido; else if (r.motivo !== 'limite') accion = 'formulario_seguimiento';
} else if (p.numero && !p.correo) { texto = 'Gracias. ¿Con qué correo hiciste la compra del pedido ' + p.numero + '?'; accion = 'formulario_seguimiento'; }
else if (!p.numero && p.correo) { texto = '¿Cuál es el número de tu pedido? Empieza con PB-, por ejemplo PB-000123 (lo ves en la confirmación de compra y en "Mi cuenta").'; accion = 'formulario_seguimiento'; }
else { texto = 'Claro, te ayudo con el seguimiento. Escríbeme el número de tu pedido (empieza con PB-, por ejemplo PB-000123) y el correo con el que compraste.'; accion = 'formulario_seguimiento'; }
const comun = { sesion: v.sesion, ip_hash: v.ip_hash, turno: p.turno, intencion: 'seguimiento' };
return [{ json: { texto: texto, accion: accion, pedido: pedido, filas: [
  Object.assign({}, comun, { rol: 'usuario', texto: v.mensaje, fecha_ms: v.ahora, cita_json: '', pagina: JSON.stringify(v.pagina || {}), error: '', ms_ia: 0 }),
  Object.assign({}, comun, { rol: 'asistente', texto: texto, fecha_ms: Date.now(), cita_json: JSON.stringify(p.estado || leerEstado(null)), pagina: '', error: '', ms_ia: 0 })
] } }];

//// Filas seguimiento
return $('Respuesta seguimiento').first().json.filas.map(function (f) { return { json: f }; });

//// Cuerpo seguimiento
// @incluir comun-chat
// {respuesta, escribiendo_ms, accion?, pedido?} para la web (pedido = vista pública de WF15, para la tarjeta de estado del chat).
const r = $('Respuesta seguimiento').first().json;
const cuerpo = { respuesta: r.texto, escribiendo_ms: escribiendoMs(r.texto) };
if (r.accion) cuerpo.accion = r.accion;
if (r.pedido) cuerpo.pedido = r.pedido;
return [{ json: { status: 200, cuerpo: cuerpo, agendada: false, aprender: false } }];
