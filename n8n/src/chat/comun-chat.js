// --- comun-chat.js (Palmera Brava, WF11 Chat-Vendedor): reglas DETERMINISTAS del chat y de las citas ---
// Se inserta donde un Code dice "// @incluir comun-chat". Sin require ni crypto (el task runner los bloquea).
// Lo que diga el modelo nunca basta: aquí se validan correo, teléfono, fecha y hora, se arma el resumen fijo y el .ics.
const CHAT = {
  MODELO: 'llama3.1:8b', MAX_MENSAJE: 800, MAX_RESPUESTA: 700, HISTORIAL: 12, MAX_TEXTO_HIST: 600,
  LIMITE_SESION: 20, LIMITE_IP: 40, LIMITE_GLOBAL: 150, VENTANA_MS: 600000,
  CACHE_MS: 600000, APRENDER_CADA: 6, MIN_FRECUENCIA: 2, MAX_NOTAS: 10, MAX_APRENDIZAJE: 500,
  CITA_MIN: 30, ABRE: 9 * 60, CIERRA: 20 * 60, ANTICIPACION_MIN: 60, MAX_DIAS: 60, MAX_CITAS_CONTACTO: 2, DIAS_CALENDARIO: 14,
  WHATSAPP: '51995542938', DOMINIOS_OK: ['wa.me', 'abnercayao.github.io']
};
const CAMPOS_CITA = ['nombre', 'negocio', 'rubro', 'correo', 'telefono', 'fecha', 'hora', 'modalidad', 'notas'];
const OBLIGATORIOS_CITA = ['nombre', 'negocio', 'rubro', 'correo', 'telefono', 'fecha', 'hora', 'modalidad'];
const NOMBRE_CAMPO = {
  nombre: 'tu nombre', negocio: 'el nombre de tu negocio', rubro: 'el rubro (a qué se dedica tu negocio)', correo: 'tu correo',
  telefono: 'tu teléfono o WhatsApp', fecha: 'el día', hora: 'la hora', modalidad: 'si prefieres videollamada o reunión presencial en Tarapoto'
};
const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Esquemas JSON para "format" de Ollama (salida estructurada).
const ESQUEMA_CHAT = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    intencion: { type: 'string', enum: ['consulta_producto', 'interes_servicio', 'agendar', 'confirmar_cita', 'otro'] },
    cita: {
      type: 'object',
      properties: { nombre: { type: 'string' }, negocio: { type: 'string' }, rubro: { type: 'string' }, correo: { type: 'string' }, telefono: { type: 'string' },
        fecha: { type: 'string' }, hora: { type: 'string' }, modalidad: { type: 'string' }, notas: { type: 'string' } },
      required: CAMPOS_CITA
    },
    listo_para_agendar: { type: 'boolean' },
    cliente_confirmo: { type: 'boolean' }
  },
  required: ['respuesta', 'intencion', 'cita', 'listo_para_agendar', 'cliente_confirmo']
};
const ESQUEMA_APRENDIZAJE = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    preguntas_frecuentes: { type: 'array', items: { type: 'string' } },
    objeciones: { type: 'array', items: { type: 'string' } },
    datos_utiles: { type: 'array', items: { type: 'string' } }
  },
  required: ['resumen', 'preguntas_frecuentes', 'objeciones', 'datos_utiles']
};

function sinTildes(s) { return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// Texto de una línea, sin < > ni caracteres de control, con tope de caracteres.
function limpio(s, max) {
  if (s === null || s === undefined || typeof s === 'object') return '';
  return Array.from(String(s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max || 200).join('').trim();
}
// Hash corto NO criptográfico (FNV-1a): solo para agrupar por IP sin guardar la IP.
function fnv(s, semilla) {
  let x = semilla >>> 0;
  for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return ('0000000' + x.toString(16)).slice(-8);
}
function hashIp(ip) { return fnv('pb|' + ip, 2166136261) + fnv(ip + '|chat', 33554467); }
// IP del visitante: el proxy (tools/chat-proxy.py) debe REEMPLAZAR X-Forwarded-For por CF-Connecting-IP o por la IP del socket.
function ipDe(hdr) {
  const g = function (k) { const v = hdr && hdr[k]; return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] || '') : ''; };
  const ip = (g('cf-connecting-ip') || g('x-real-ip') || g('x-forwarded-for').split(',')[0] || '').trim().slice(0, 64);
  return /^[0-9a-f.:]{3,64}$/i.test(ip) ? ip.toLowerCase() : 'directo';
}

// ---------- fechas en hora de Perú (UTC-5 fijo, sin horario de verano) ----------
function lima(ms) {
  const d = new Date(ms - 5 * 3600000);
  return { fecha: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay(), hora: d.toISOString().slice(11, 16) };
}
function partesFecha(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y: y, m: mo, d: d, dow: t.getUTCDay() };
}
function sumarDias(f, n) { const p = partesFecha(f); return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10); }
function msLima(fecha, hora) {
  const p = partesFecha(fecha); const h = /^(\d{2}):(\d{2})$/.exec(hora || '');
  return p && h ? Date.UTC(p.y, p.m - 1, p.d, +h[1] + 5, +h[2]) : NaN;
}
function minutos(hora) { const h = /^(\d{2}):(\d{2})$/.exec(hora || ''); return h ? +h[1] * 60 + +h[2] : NaN; }
function hhmm(min) { return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }
function fechaLarga(f) { const p = partesFecha(f); return p ? DIAS_LARGO[p.dow] + ' ' + p.d + ' de ' + MESES[p.m - 1] : f; }
function fechaCorta(f) { const p = partesFecha(f); return p ? DIAS_LARGO[p.dow].slice(0, 3) + ' ' + p.d + ' ' + MESES[p.m - 1].slice(0, 3) : f; }
// "10:00", "10am", "3 pm", "15h", "4 y media", "las 4 de la tarde" -> "HH:MM". Sin a. m./p. m. y antes de las 8 se asume tarde.
function normHora(s) {
  const t = sinTildes(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /(\d{1,2})(?:\s*(?::|\.|h|hrs?)\s*(\d{2}))?\s*(y media|y treinta)?\s*(a\.?\s?m\.?|p\.?\s?m\.?|de la manana|de la tarde|de la noche|del mediodia)?/.exec(t);
  if (!m) return '';
  let h = +m[1]; const mi = m[2] !== undefined ? +m[2] : m[3] ? 30 : 0; const suf = m[4] || '';
  if (mi > 59 || h > 23) return '';
  if (/^p|tarde|noche/.test(suf) && h < 12) h += 12;
  else if (/^a|manana/.test(suf) && h === 12) h = 0;
  else if (!suf && h >= 1 && h <= 7) h += 12;
  return hhmm(h * 60 + mi);
}
// "2026-10-09", "9/10/2026", "9/10", "09-10-2026" -> "YYYY-MM-DD" ('' si no se entiende). hoy = "YYYY-MM-DD" de Lima.
function normFecha(s, hoy) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/.exec(t);
    if (!m) return '';
    d = +m[1]; mo = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +hoy.slice(0, 4);
    if (!m[3] && (('' + y) + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2)) < hoy) y += 1;
  }
  const f = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  return partesFecha(f) ? f : '';
}
// Día y hora escritos por el visitante en ESTE mensaje (mandan sobre lo que interprete el modelo):
// "2026-10-10", "9/10", "el sábado 10", "el 10 de octubre", "el viernes", "mañana", "pasado mañana"; "a las 4 de la tarde", "16:00", "10am".
function fechaHoraDeTexto(m, ahoraMs) {
  const out = {};
  const hoy = lima(ahoraMs).fecha;
  let t = sinTildes(m).toLowerCase().replace(/\s+/g, ' ');
  const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // hora
  let h = /\b(\d{1,2}:\d{2})\s*(a\.? ?m\.?|p\.? ?m\.?|de la manana|de la tarde|de la noche|hrs?|h)?(?![\d:])/.exec(t) ||
    /\b(?:a las|a la|las|desde las|tipo|como a las)\s+(\d{1,2}(?:[:.]\d{2})?)\s*(y media|y treinta)?\s*(a\.? ?m\.?|p\.? ?m\.?|de la manana|de la tarde|de la noche|del mediodia|hrs?|h)?(?![\d\/])/.exec(t) ||
    /\b(\d{1,2})\s*(a\.? ?m\.?|p\.? ?m\.?)(?![a-z])/.exec(t);
  if (h) { const hh = normHora(h.slice(1).filter(Boolean).join(' ').replace(/(\d)\.(\d{2})/, '$1:$2')); if (hh) out.hora = hh; }
  else if (/\b(al )?mediodia\b/.test(t)) out.hora = '12:00';
  t = t.replace(/de la manana/g, ' ');
  // fecha
  let f = '';
  const iso = /\b(\d{4}-\d{1,2}-\d{1,2})\b/.exec(t);
  const barra = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/.exec(t);
  const conMes = new RegExp('\\b(\\d{1,2}) de (' + MES.join('|') + ')\\b').exec(t);
  const diaNum = new RegExp('\\b(' + DIAS.join('|') + ')\\s+(\\d{1,2})\\b(?!\\s*(?::|am|pm|de la|hrs?\\b|h\\b))').exec(t);
  const elNum = /\b(?:el|para el|este|del) (\d{1,2})\b(?!\s*(?::|am|pm|de la|hrs?\b|h\b|de (?!(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))))/.exec(t);
  const soloDia = new RegExp('\\b(?:el|este|para el|proximo|el proximo) (' + DIAS.join('|') + ')\\b').exec(t);
  if (iso) f = normFecha(iso[1], hoy);
  else if (barra) f = normFecha(barra[1], hoy);
  else if (conMes) { const mo = MES.indexOf(conMes[2]) + 1; f = normFecha(conMes[1] + '/' + mo, hoy); }
  else if (diaNum || elNum) {
    const num = +(diaNum ? diaNum[2] : elNum[1]); const dow = diaNum ? DIAS.indexOf(diaNum[1]) : -1;
    let primero = '';
    for (let i = 0; i <= CHAT.MAX_DIAS; i++) {
      const x = sumarDias(hoy, i); const p = partesFecha(x);
      if (p.d !== num) continue;
      if (!primero) primero = x;
      if (dow < 0 || p.dow === dow) { f = x; break; }
    }
    if (!f) f = primero;
  } else if (/\bpasado manana\b/.test(t)) f = sumarDias(hoy, 2);
  else if (/\bmanana\b/.test(t)) f = sumarDias(hoy, 1);
  else if (/\bhoy\b/.test(t) && out.hora) f = hoy;
  else if (soloDia) { const dow = DIAS.indexOf(soloDia[1]); for (let i = 1; i <= 7; i++) { const x = sumarDias(hoy, i); if (partesFecha(x).dow === dow) { f = x; break; } } }
  if (f) out.fecha = f;
  return out;
}
// Teléfono peruano: celular 9 dígitos que empieza en 9 (con o sin +51) o fijo de 8 dígitos (código de ciudad + número).
function normTelefono(s) {
  let dg = String(s || '').replace(/[^\d]/g, '');
  if (dg.length === 11 && dg.indexOf('51') === 0) dg = dg.slice(2);
  if (dg.length === 9 && dg[0] === '0') dg = dg.slice(1);
  if (/^9\d{8}$/.test(dg)) return { ok: true, valor: '+51 ' + dg.slice(0, 3) + ' ' + dg.slice(3, 6) + ' ' + dg.slice(6), wa: '51' + dg, celular: true };
  if (/^[1-8]\d{7}$/.test(dg)) return { ok: true, valor: '+51 ' + dg, wa: '', celular: false };
  return { ok: false };
}
function normCorreo(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(t) || t.length > 100) return { ok: false, motivo: 'Ese correo no parece válido. ¿Me lo escribes de nuevo? (por ejemplo, nombre@gmail.com)' };
  if (/\.(con|cmo|cpm|comm|om)$/.test(t) || /@(gmial|gmal|gamil|hotmal|hotmial|outlok)\./.test(t)) return { ok: false, motivo: '¿Tu correo está bien escrito? Me parece que tiene un error de tipeo (' + t + ').' };
  return { ok: true, valor: t };
}
function normModalidad(s) {
  const t = sinTildes(String(s || '')).toLowerCase();
  if (!t.trim()) return '';
  if (/presencial|en persona|personal|local|oficina|tienda|visita|cara a cara/.test(t)) return 'presencial';
  if (/video|virtual|online|en linea|zoom|meet|teams|llamada|remot|whatsapp/.test(t)) return 'videollamada';
  return '?';
}
function textoModalidad(m) { return m === 'presencial' ? 'presencial en Tarapoto' : 'videollamada'; }
// Horarios libres de una fecha (bloques de 30 min, futuros con anticipación, sin choque).
function libresDe(fecha, ocupados, ahoraMs) {
  const p = partesFecha(fecha);
  if (!p || p.dow === 0) return [];
  const out = [];
  for (let m = CHAT.ABRE; m + CHAT.CITA_MIN <= CHAT.CIERRA; m += CHAT.CITA_MIN) {
    const ini = msLima(fecha, hhmm(m));
    if (ini < ahoraMs + CHAT.ANTICIPACION_MIN * 60000) continue;
    if (choca(ini, ini + CHAT.CITA_MIN * 60000, ocupados)) continue;
    out.push(hhmm(m));
  }
  return out;
}
function choca(ini, fin, ocupados) {
  return (ocupados || []).some(function (o) { return Number(o.inicio_ms) < fin && ini < Number(o.fin_ms || Number(o.inicio_ms) + CHAT.CITA_MIN * 60000); });
}
// Sugerencia: hasta 3 horarios libres en la fecha pedida (desde la hora pedida) o en los próximos días hábiles.
function sugerirHorarios(fecha, horaDesde, ocupados, ahoraMs) {
  const hoy = lima(ahoraMs).fecha;
  let f = partesFecha(fecha) && fecha >= hoy ? fecha : hoy;
  for (let i = 0; i < 10; i++) {
    let l = libresDe(f, ocupados, ahoraMs);
    if (i === 0 && horaDesde) { const desde = minutos(horaDesde); const despues = l.filter(function (x) { return minutos(x) >= desde; }); if (despues.length) l = despues; }
    if (l.length) {
      const tres = l.slice(0, 3);
      return 'el ' + fechaLarga(f) + ' a las ' + (tres.length > 1 ? tres.slice(0, -1).join(', ') + ' o ' + tres[tres.length - 1] : tres[0]);
    }
    f = sumarDias(f, 1);
  }
  return '';
}
// Valida y normaliza los datos de la cita. ctx = {ahoraMs, ocupados:[{inicio_ms, fin_ms}]}.
// Devuelve {datos, errores:{campo: mensaje}, faltan:[campos], ok, inicio_ms, fin_ms}. Un dato inválido se vacía (se vuelve a pedir).
function validarCita(entrada, ctx) {
  const e = entrada || {}; const d = {}; const errores = {};
  const ahoraMs = ctx.ahoraMs; const hoy = lima(ahoraMs).fecha;
  d.nombre = limpio(e.nombre, 60);
  if (d.nombre && (!/[a-záéíóúñü]{2}/i.test(d.nombre) || /[\d@]/.test(d.nombre))) { errores.nombre = 'No me quedó claro tu nombre, ¿me lo repites?'; d.nombre = ''; }
  d.negocio = limpio(e.negocio, 80);
  d.rubro = limpio(e.rubro, 60);
  d.correo = '';
  if (limpio(e.correo, 120)) { const c = normCorreo(e.correo); if (c.ok) d.correo = c.valor; else errores.correo = c.motivo; }
  d.telefono = '';
  if (limpio(e.telefono, 40)) { const t = normTelefono(e.telefono); if (t.ok) d.telefono = t.valor; else errores.telefono = 'Ese número no parece un teléfono de Perú. ¿Me pasas tu celular de 9 dígitos (por ejemplo, 987 654 321)?'; }
  d.fecha = '';
  if (limpio(e.fecha, 40)) {
    const f = normFecha(e.fecha, hoy); const p = partesFecha(f);
    if (!p) errores.fecha = 'No entendí bien el día. ¿Me dices la fecha (por ejemplo, viernes 9 de octubre)?';
    else if (f < hoy) errores.fecha = 'Esa fecha ya pasó. ¿Te va bien ' + sugerirHorarios(hoy, '', ctx.ocupados, ahoraMs) + '?';
    else if (p.dow === 0) errores.fecha = 'Los domingos Abner no tiene reuniones (atiende de lunes a sábado de 9:00 a 20:00). ¿Te va bien ' + sugerirHorarios(sumarDias(f, 1), '', ctx.ocupados, ahoraMs) + '?';
    else if (f > sumarDias(hoy, CHAT.MAX_DIAS)) errores.fecha = 'Por ahora agendo hasta dentro de ' + CHAT.MAX_DIAS + ' días. ¿Te va bien una fecha más cercana?';
    else d.fecha = f;
  }
  d.hora = '';
  if (limpio(e.hora, 40)) {
    const h = normHora(e.hora); const m = minutos(h);
    if (!h) errores.hora = 'No entendí bien la hora. ¿A qué hora te acomoda (de 9:00 a 20:00)?';
    else if (m % CHAT.CITA_MIN !== 0) errores.hora = 'Las reuniones empiezan en punto o y media (por ejemplo, ' + hhmm(m - (m % 30)) + ' o ' + hhmm(m - (m % 30) + 30) + '). ¿Cuál prefieres?';
    else if (m < CHAT.ABRE || m + CHAT.CITA_MIN > CHAT.CIERRA) errores.hora = 'Las reuniones son de 9:00 a 20:00 (la última empieza a las 19:30). ' + (d.fecha ? '¿Te va bien ' + sugerirHorarios(d.fecha, '', ctx.ocupados, ahoraMs) + '?' : '¿Qué hora dentro de ese horario te acomoda?');
    else d.hora = h;
  }
  let inicio = NaN, fin = NaN;
  if (d.fecha && d.hora) {
    inicio = msLima(d.fecha, d.hora); fin = inicio + CHAT.CITA_MIN * 60000;
    if (inicio < ahoraMs + CHAT.ANTICIPACION_MIN * 60000) { errores.hora = (inicio < ahoraMs ? 'Esa hora ya pasó. ' : 'Esa hora está muy cerca; necesito al menos una hora de anticipación. ') + '¿Te va bien ' + sugerirHorarios(d.fecha, d.hora, ctx.ocupados, ahoraMs) + '?'; d.hora = ''; }
    else if (choca(inicio, fin, ctx.ocupados)) { errores.hora = 'Ese horario ya está ocupado. Tengo libre ' + sugerirHorarios(d.fecha, d.hora, ctx.ocupados, ahoraMs) + '. ¿Cuál te acomoda?'; d.hora = ''; }
  }
  d.modalidad = normModalidad(e.modalidad);
  if (d.modalidad === '?') { errores.modalidad = '¿Prefieres videollamada o reunión presencial en Tarapoto?'; d.modalidad = ''; }
  d.notas = limpio(e.notas, 300);
  const faltan = OBLIGATORIOS_CITA.filter(function (c) { return !d[c]; });
  const ok = !Object.keys(errores).length && !faltan.length;
  return { datos: d, errores: errores, faltan: faltan, ok: ok, inicio_ms: ok ? inicio : null, fin_ms: ok ? fin : null };
}
// Firma de los datos: el resumen confirmado debe ser exactamente el que se agenda.
function firmaCita(d) { return CAMPOS_CITA.map(function (c) { return sinTildes(d[c] || '').toLowerCase(); }).join('|'); }
function resumenCita(d) {
  return 'Perfecto. Revisa por favor los datos de tu reunión con Abner:\n' +
    '- Nombre: ' + d.nombre + '\n' +
    '- Negocio: ' + d.negocio + ' (' + d.rubro + ')\n' +
    '- Correo: ' + d.correo + '\n' +
    '- Teléfono/WhatsApp: ' + d.telefono + '\n' +
    '- Día y hora: ' + fechaLarga(d.fecha) + ', de ' + d.hora + ' a ' + hhmm(minutos(d.hora) + CHAT.CITA_MIN) + ' (hora de Perú)\n' +
    '- Modalidad: ' + textoModalidad(d.modalidad) + '\n' +
    (d.notas ? '- Notas: ' + d.notas + '\n' : '') +
    '¿Está todo correcto para agendarla?';
}
function faltanTexto(faltan) {
  const l = faltan.slice(0, 2).map(function (c) { return NOMBRE_CAMPO[c]; });
  return l.length > 1 ? l[0] + ' y ' + l[1] : l[0] || '';
}
// Respuestas del visitante al resumen.
function afirmativo(m) {
  const t = sinTildes(m).toLowerCase().replace(/[¡!¿?.,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(si+|sip|claro|correcto|confirmo|confirmado|exacto|ok|okey|okay|oki|dale|de acuerdo|perfecto|listo|esta bien|todo bien|todo correcto|agendala|agendalo|adelante|asi es|bien|genial|excelente|ya|va|vale)( |$)/.test(t) ||
    /\b(confirmo|todo (esta )?(bien|correcto)|esta (todo )?(bien|correcto)|agendala|agendalo|puedes agendar)\b/.test(t);
}
function negativo(m) {
  const t = sinTildes(m).toLowerCase().replace(/[¡!¿?.,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(no|nop|nel|negativo|espera|cambia|corrige|mejor)( |$)/.test(t) ||
    /\b(cambia|cambiar|cambiemos|corrige|corregir|equivoq\w*|incorrect\w*|no es correcto|no esta bien|esta mal|otra hora|otro dia|cancela\w*)\b/.test(t);
}
function preguntaSiEsBot(m) {
  const t = sinTildes(m).toLowerCase();
  return /\b(eres|sos|seras|es)\s+(un |una )?(bot|robot|ia|inteligencia artificial|maquina|programa|humana?|persona|real|de verdad)\b/.test(t) ||
    /\b(hablo|estoy hablando|chateo) con (un |una )?(bot|robot|persona|humano|humana|ia|maquina)\b/.test(t) || /\b(chatbot|chat ?gpt)\b/.test(t);
}
// Intento de cambiarle el rol o sacarle las instrucciones: se responde con un texto fijo (no se confía en el modelo).
function pareceInyeccion(m) {
  const t = sinTildes(m).toLowerCase();
  return /\b(ignora|ignore|olvida|olvidate de|omite|saltate)\b.{0,40}\b(instruccion|regla|indicacion|prompt|anterior)/.test(t) ||
    /\b(prompt|instrucciones) (del|de) sistema\b|\bsystem prompt\b|\bjailbreak\b|\bmodo (desarrollador|dios|sin restricciones)\b|\bdan mode\b/.test(t) ||
    /\b(ahora eres|a partir de ahora eres|actua como|finge (que eres|ser)|haz de cuenta que eres|juega a ser|hazte pasar por)\b/.test(t) ||
    /\b(revela|muestrame|dime|escribe|copia|repite)\b.{0,30}\b(tus|las) (instrucciones|reglas)\b/.test(t);
}
const RESPUESTA_INYECCION = 'Solo puedo ayudarte con Palmera Brava: ropa fresca, tallas, envíos y pedidos, o agendarte una reunión con Abner para tener algo así en tu negocio. ¿Qué buscas hoy?';
// ¿La respuesta ya pide alguno de los datos que faltan?
const PIDE_CAMPO = { nombre: /\bnombre\b/, negocio: /\bnegocio\b/, rubro: /\brubro\b|\bdedica/, correo: /\bcorreo\b|\be-?mail\b/, telefono: /\btelefono\b|\bwhatsapp\b|\bcelular\b|\bnumero\b/,
  fecha: /\bdias?\b|\bfecha\b|\bcuando\b|\bdisponib/, hora: /\bhoras?\b|\bhorario\b|\bdisponib/, modalidad: /\bmodalidad\b|\bvideollamada\b|\bpresencial\b/ };
function pideAlgo(respuesta, faltan) { const t = sinTildes(respuesta).toLowerCase(); return faltan.some(function (c) { return PIDE_CAMPO[c] && PIDE_CAMPO[c].test(t); }); }
function mencionaIA(t) { return /\b(ia|inteligencia artificial|asistente virtual|bot|virtual)\b/.test(sinTildes(t).toLowerCase()); }
// Respuesta para la web: sin < >, sin markdown, solo enlaces de wa.me y del sitio, máx. 700 caracteres (corta en una oración).
function limpiarRespuesta(t) {
  let s = String(t === null || t === undefined ? '' : t).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ');
  s = s.replace(/\*\*|__|`+|^#+\s*/gm, '').replace(/^\s*[*•]\s+/gm, '- ');
  s = s.replace(/https?:\/\/[^\s<>"')]+/g, function (u) {
    let host = '';
    try { host = new URL(u).hostname.toLowerCase(); } catch (e) { host = ''; }
    return CHAT.DOMINIOS_OK.indexOf(host) >= 0 ? u : '';
  });
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (Array.from(s).length > CHAT.MAX_RESPUESTA) {
    const corto = Array.from(s).slice(0, CHAT.MAX_RESPUESTA).join('');
    const i = Math.max(corto.lastIndexOf('. '), corto.lastIndexOf('? '), corto.lastIndexOf('! '), corto.lastIndexOf('\n'));
    s = (i > 200 ? corto.slice(0, i + 1) : corto.replace(/\s+\S*$/, '') + '…').trim();
  }
  return s;
}
// Junta dos frases asegurando el punto final de la primera.
function unir(a, b) { let x = String(a || '').trim(); if (x && !/[.!?…:]$/.test(x)) x += '.'; return (x + ' ' + String(b || '').trim()).trim(); }
function escribiendoMs(t) { return Math.min(6000, Math.max(800, Array.from(String(t || '')).length * 30)); }
// Si el modelo devolvió texto alrededor del JSON, rescata el primer objeto.
function extraerJson(s) {
  const t = String(s || '');
  try { return JSON.parse(t); } catch (e) { /* sigue */ }
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i >= 0 && f > i) { try { return JSON.parse(t.slice(i, f + 1)); } catch (e) { return null; } }
  return null;
}
// Estado de la cita guardado en la última fila "asistente" (pb_chat_mensajes.cita_json).
function leerEstado(json) {
  let o = null;
  try { o = JSON.parse(json || 'null'); } catch (e) { o = null; }
  const d = {};
  CAMPOS_CITA.forEach(function (c) { d[c] = o && o.datos && typeof o.datos[c] === 'string' ? o.datos[c] : ''; });
  const est = o && ['recogiendo', 'por_confirmar', 'agendada'].indexOf(o.estado) >= 0 ? o.estado : 'ninguno';
  return { datos: d, estado: est, firma: o && typeof o.firma === 'string' ? o.firma : '', cita_id: o && typeof o.cita_id === 'string' ? o.cita_id : '' };
}
function hayDatos(d) { return CAMPOS_CITA.some(function (c) { return !!(d && d[c]); }); }
// Texto del estado para el prompt.
function estadoTexto(est) {
  if (est.estado === 'agendada') return 'La reunión YA ESTÁ AGENDADA para el ' + fechaLarga(est.datos.fecha) + ' a las ' + est.datos.hora + ' (' + textoModalidad(est.datos.modalidad) + '). No agendes otra; si quiere cambiarla, que escriba por WhatsApp.';
  if (est.estado === 'ninguno' && !hayDatos(est.datos)) return 'Todavía no se ha hablado de una reunión.';
  if (est.estado === 'ninguno') return 'El visitante aún no aceptó la reunión. Datos que ya mencionó: ' + CAMPOS_CITA.filter(function (c) { return est.datos[c]; }).map(function (c) { return c + ': ' + est.datos[c]; }).join('; ') + '.';
  const tiene = CAMPOS_CITA.filter(function (c) { return est.datos[c]; }).map(function (c) { return c + ': ' + est.datos[c]; });
  const faltan = OBLIGATORIOS_CITA.filter(function (c) { return !est.datos[c]; });
  return 'El visitante quiere una reunión. Datos ya recogidos: ' + (tiene.length ? tiene.join('; ') : 'ninguno') + '. ' +
    (faltan.length ? 'Faltan: ' + faltan.join(', ') + ' (pídelos de a pocos).' : 'Ya están todos los datos.') +
    (est.estado === 'por_confirmar' ? ' El sistema ya mostró el resumen y espera que el visitante confirme.' : '');
}
// Calendario de los próximos días para que el modelo convierta "el viernes" en una fecha exacta.
function calendarioTexto(ahoraMs) {
  const hoy = lima(ahoraMs).fecha; const l = [];
  for (let i = 0; i < CHAT.DIAS_CALENDARIO; i++) {
    const f = sumarDias(hoy, i); const p = partesFecha(f);
    l.push((i === 0 ? 'hoy ' : i === 1 ? 'mañana ' : '') + DIAS_LARGO[p.dow] + ' ' + p.d + ' de ' + MESES[p.m - 1] + ' = ' + f + (p.dow === 0 ? ' (sin reuniones)' : ''));
  }
  return l.join('; ');
}
function fechaTexto(ahoraMs) { const l = lima(ahoraMs); const p = partesFecha(l.fecha); return 'Hoy es ' + DIAS_LARGO[p.dow] + ' ' + p.d + ' de ' + MESES[p.m - 1] + ' de ' + p.y + ' y son las ' + l.hora + ' en Perú.'; }

// ---------- catálogo compacto (usa inferirFrescura/stockTotal de validar.js si están incluidos) ----------
function precioTexto(n) { return 'S/ ' + Number(n).toFixed(2); }
function compactarCatalogo(prod, site, sitioUrl) {
  const lista = (prod && Array.isArray(prod.productos) ? prod.productos : []).filter(function (p) { return p && p.activo !== false && typeof p.id === 'string'; });
  const ids = {};
  const precios = [];
  const lineas = lista.slice(0, 120).map(function (p) {
    ids[p.id] = limpio(p.nombre, 80);
    const oferta = Number(p.precio_oferta) > 0 && Number(p.precio_oferta) < Number(p.precio);
    const precio = oferta ? precioTexto(p.precio_oferta) + ' en oferta (antes ' + precioTexto(p.precio) + ')' : precioTexto(p.precio);
    precios.push({ id: p.id, nombre: limpio(p.nombre, 80), texto: precio });
    const colores = (Array.isArray(p.colores) ? p.colores : []).map(function (c) { return typeof c === 'string' ? c : c && c.nombre; }).filter(Boolean);
    const spc = p.stock_por_color && typeof p.stock_por_color === 'object' ? p.stock_por_color : null;
    const col = colores.map(function (c) { const n = spc && Number.isInteger(spc[c]) ? spc[c] : null; return limpio(c, 30) + (n === null ? '' : ' ' + n + (n === 0 ? ' (agotado)' : '')); }).join(', ');
    const total = typeof stockTotal === 'function' ? stockTotal(p) : Number.isInteger(p.stock) ? p.stock : null;
    const fr = typeof inferirFrescura === 'function' ? inferirFrescura(p).valor : Number.isInteger(p.frescura) ? p.frescura : null;
    return [p.id, limpio(p.nombre, 80), p.categoria + (p.subcategoria ? ' (' + limpio(p.subcategoria, 30) + ')' : ''), precio,
      'tallas ' + (Array.isArray(p.tallas) && p.tallas.length ? p.tallas.join(', ') : 'única'),
      'colores: ' + (col || 'consultar') + (spc ? '' : total === null ? '' : ' (total ' + total + ')'),
      limpio(p.material || '', 50) || 'material por confirmar', fr ? 'frescura ' + fr + '/5' : ''].filter(Boolean).join(' | ');
  });
  return { catalogo: lineas.length ? lineas.join('\n') : '(Sin productos activos ahora.)', ids: ids, precios: precios, n: lineas.length, tienda: tiendaTexto(site, sitioUrl), whatsapp: whatsappDe(site) };
}
// ¿Pregunta por el precio de la ropa (no del servicio de Abner)?
function preguntaPrecio(m) {
  const t = sinTildes(m).toLowerCase();
  return /\b(precios?|a cuanto|cuanto (cuesta|cuestan|vale|valen|sale|salen|esta|estan)|cuesta|cuestan|costo)\b/.test(t) &&
    !/\b(servicio|pagina|sistema|bot|asistente|algo asi|implementar|abner|negocio)\b/.test(t);
}
// Productos del catálogo que se nombran en el texto (palabras de >= 4 letras del nombre, por raíz). Máx. 2, el mejor primero.
function productosNombrados(precios, texto) {
  const pal = function (s) { return sinTildes(s).toLowerCase().split(/[^a-z0-9ñ]+/).filter(function (w) { return w.length >= 4 && PALABRAS_VACIAS.indexOf(w) < 0; }).map(function (w) { return w.slice(0, 5); }); };
  const t = new Set(pal(texto));
  const l = (precios || []).map(function (p) { const ws = Array.from(new Set(pal(p.nombre))); const s = ws.filter(function (w) { return t.has(w); }).length; return { p: p, s: s, r: ws.length ? s / ws.length : 0 }; })
    .filter(function (x) { return x.s >= 2 || (x.s >= 1 && x.r === 1); }).sort(function (a, b) { return b.s - a.s || b.r - a.r; });
  if (l.length > 1 && l[0].s >= l[1].s + 2) return [l[0].p];
  return l.slice(0, 2).map(function (x) { return x.p; });
}
function whatsappDe(site) { const w = site && String(site.whatsapp || '').replace(/\D/g, ''); return /^51\d{9}$/.test(w || '') ? w : CHAT.WHATSAPP; }
function tiendaTexto(site, sitioUrl) {
  const s = site && typeof site === 'object' ? site : {};
  const wa = whatsappDe(s);
  const pagos = (Array.isArray(s.metodos_pago) ? s.metodos_pago : []).map(function (x) { return typeof x === 'string' ? x : x && (x.nombre || x.tipo); }).filter(Boolean).map(function (x) { return limpio(x, 40); });
  const zonas = (Array.isArray(s.zonas_reparto) ? s.zonas_reparto : []).map(function (x) { return limpio(x, 40); }).filter(Boolean);
  return [
    '- Tienda: ' + (limpio(s.nombre, 60) || 'Palmera Brava') + (s.lema ? ' ("' + limpio(s.lema, 80) + '")' : '') + ', en ' + (limpio(s.direccion, 80) || 'Tarapoto, San Martín') + '. La dirección exacta se coordina por WhatsApp.',
    '- Atención: ' + (s.horario && s.horario.texto ? limpio(s.horario.texto, 80) : 'todos los días de 8:00 a. m. a 8:00 p. m.') + '.',
    '- WhatsApp: ' + (limpio(s.telefono_visible, 30) || '+' + wa) + ' (https://wa.me/' + wa + ').',
    '- Envíos: ' + (limpio(s.envio, 240) || 'se coordinan por WhatsApp.') + (zonas.length ? ' Zonas de reparto: ' + zonas.join(', ') + '.' : ''),
    '- Pagos: ' + (pagos.length ? pagos.join(', ') + '.' : 'se coordinan por WhatsApp al confirmar el pedido (no menciones métodos concretos).'),
    '- Web: ' + (sitioUrl || '') + ' (catálogo con filtros Hombres, Mujeres, Niños, Accesorios, Novedades y Ofertas; bolsa de compras; "Guía de tallas" en cada prenda; blog).'
  ].join('\n');
}

// ---------- aprendizaje ----------
const PALABRAS_VACIAS = ['el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'o', 'a', 'un', 'una', 'que', 'se', 'por', 'para', 'con', 'su', 'sus', 'es', 'hay', 'me', 'mi', 'le', 'lo', 'al', 'si', 'no', 'mas', 'muy', 'tan', 'como'];
function claveNota(tipo, texto) {
  const w = sinTildes(texto).toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(function (x) { return x.length > 2 && PALABRAS_VACIAS.indexOf(x) < 0; });
  return (tipo + ':' + Array.from(new Set(w)).sort().join(' ')).slice(0, 140);
}
// Nota "anclada" en lo que escribió el visitante: al menos `min` palabras de contenido (>= 4 letras, raíz de 5) aparecen en su texto.
// Evita notas inventadas por el modelo (por ejemplo, copiar un ejemplo del prompt), que luego se repetirían en otras conversaciones.
const ANCLA_IGNORAR = ['negocio', 'negocios', 'tienda', 'palmera', 'brava', 'abner', 'cliente', 'clientes', 'visitante', 'servicio', 'quiere', 'quieren', 'puede', 'pueden', 'tiene', 'tienen', 'sobre', 'algo', 'esta', 'este', 'esto', 'para', 'pero', 'porque', 'cuando', 'donde', 'todo', 'toda', 'bien', 'hace', 'hacer', 'saber', 'sabe', 'tener', 'pregunta', 'preguntan', 'interesa', 'interes', 'web', 'pagina'];
function anclada(nota, textoVisitante, min) {
  const raiz = function (w) { return w.slice(0, 5); };
  const visto = new Set(sinTildes(textoVisitante).toLowerCase().split(/[^a-z0-9ñ]+/).filter(function (w) { return w.length >= 4; }).map(raiz));
  const pal = Array.from(new Set(sinTildes(nota).toLowerCase().split(/[^a-z0-9ñ]+/).filter(function (w) { return w.length >= 4 && PALABRAS_VACIAS.indexOf(w) < 0 && ANCLA_IGNORAR.indexOf(w) < 0; }).map(raiz)));
  return pal.filter(function (w) { return visto.has(w); }).length >= min;
}
// Rubro del negocio cuando el visitante lo dice al presentarse ("tengo una panadería", "mi ferretería") y el modelo no lo extrajo.
const RE_RUBRO = /\b(tengo|tenemos|manejo|administro|mi|nuestra|nuestro|es|soy de|trabajo en)\s+(?:una |un |la |el |mi )?(panaderia|pasteleria|restaurante|restaurant|cafeteria|polleria|cevicheria|pizzeria|jugueria|heladeria|ferreteria|bodega|minimarket|farmacia|botica|libreria|hotel|hostal|spa|barberia|peluqueria|salon de belleza|gimnasio|veterinaria|clinica|consultorio|taller|lavanderia|floreria|boutique|zapateria|optica|imprenta|distribuidora|licoreria|carniceria|muebleria|joyeria|perfumeria|agencia de viajes|inmobiliaria|academia|catering|tienda(?: de [a-z]+)?)\b/;
function rubroDe(texto) {
  const m = RE_RUBRO.exec(sinTildes(texto).toLowerCase());
  if (!m) return '';
  const r = m[2].replace(/eria\b/g, 'ería').replace(/^clinica$/, 'clínica').replace(/^optica$/, 'óptica').replace(/^salon /, 'salón ');
  return r === 'tienda de palmera' ? '' : r;
}
// Nota aprendida segura: corta, sin datos personales, sin instrucciones (anti prompt injection).
// prohibidas = palabras del nombre y del negocio del visitante (no se guardan datos personales).
function notaSegura(texto, tipo, prohibidas) {
  const t = limpio(texto, 160);
  if (Array.from(t).length < 8) return '';
  const s = sinTildes(t).toLowerCase();
  if (/@|https?:|www\.|\d{6,}/.test(s)) return '';
  if (/\bno se (menciona|mencionan|menciono|expreso|expresaron|identifico|identificaron)\b|\bno (expreso|menciono|hubo|hay|tuvo|proporciono|presento|planteo|dio|indico|hizo|tiene)\b.{0,30}\b(objecion|duda|freno|pregunta)|\bningun[ao]s? (objecion|duda|freno|pregunta)|\bsin (objeciones|dudas)\b|\bno aplica\b|\bexplicit/.test(s)) return '';
  if (/\b\d{1,2}:\d{2}\b|\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\bagendad[ao]\b|\bquedo agendad/.test(s)) return '';
  if ((prohibidas || []).some(function (w) { return w && new RegExp('\\b' + w + '\\b').test(s); })) return '';
  if (/\b(ignora\w*|instruccion\w*|prompt|sistema|olvida\w*|actua como|eres (un|una)|tu rol|responde siempre|di que|debes decir|nunca digas|siempre di|revela\w*|contrasena|token)\b/.test(s)) return '';
  if (tipo === 'dato' && (/%/.test(s) || /\b(descuento\w*|gratis|regal\w*|promocion\w*|cupon\w*)\b/.test(s))) return '';
  return t;
}
// Notas para el prompt: las del admin primero; las automáticas solo si se repitieron en >= MIN_FRECUENCIA conversaciones.
function notasAprendidas(filas) {
  const ok = (filas || []).filter(function (f) { return f && f.activo !== false && typeof f.texto === 'string' && f.texto.trim() && (f.origen === 'admin' || Number(f.frecuencia) >= CHAT.MIN_FRECUENCIA); });
  ok.sort(function (a, b) { return (a.origen === 'admin' ? 0 : 1) - (b.origen === 'admin' ? 0 : 1) || Number(b.frecuencia) - Number(a.frecuencia); });
  const nombre = { pregunta: 'Pregunta frecuente', objecion: 'Objeción', dato: 'Dato útil' };
  const l = ok.slice(0, CHAT.MAX_NOTAS).map(function (f) { return '- ' + (nombre[f.tipo] || 'Nota') + ': ' + limpio(f.texto, 160) + (f.origen === 'admin' ? ' (del admin)' : ' (x' + Number(f.frecuencia) + ')'); });
  return { texto: l.length ? l.join('\n') : '(todavía no hay notas)', n: l.length };
}

// ---------- aviso y archivo .ics ----------
function avisoCitaTexto(c, resumen, esc) {
  const tel = normTelefono(c.telefono);
  return 'Nueva cita desde el chat de la web (Valeria)\n\n' +
    'Cuándo: ' + esc(fechaLarga(c.fecha)) + ', ' + esc(c.hora) + '–' + esc(hhmm(minutos(c.hora) + CHAT.CITA_MIN)) + ' (hora de Perú)\n' +
    'Modalidad: ' + esc(textoModalidad(c.modalidad)) + '\n' +
    'Nombre: ' + esc(c.nombre) + '\n' +
    'Negocio: ' + esc(c.negocio) + ' (' + esc(c.rubro) + ')\n' +
    'Correo: ' + esc(c.correo) + '\n' +
    'Teléfono/WhatsApp: ' + esc(c.telefono) + (tel.ok && tel.wa ? ' (https://wa.me/' + tel.wa + ')' : '') + '\n' +
    (c.notas ? 'Notas: ' + esc(c.notas) + '\n' : '') +
    '\nResumen de la conversación: ' + esc(resumen || 'sin resumen') + '\n' +
    'Id: ' + esc(c.cita_id) + ' (tabla pb_citas)\n' +
    'Siguiente paso: abre el archivo .ics para agregarla a tu calendario y escríbele para confirmar.';
}
function icsTexto(s) { return String(s === null || s === undefined ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
// RFC 5545: líneas de máx. 75 octetos (UTF-8), continuación con un espacio.
function icsPlegar(linea) {
  const out = []; let actual = ''; let bytes = 0; let limite = 75;
  for (const ch of linea) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limite) { out.push(actual); actual = ' '; bytes = 1; limite = 75; }
    actual += ch; bytes += b;
  }
  out.push(actual);
  return out.join('\r\n');
}
function icsUtc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsCita(c, ahoraMs) {
  const desc = ['Reunión de 30 minutos con ' + c.nombre + ' (' + c.negocio + ', ' + c.rubro + ').', 'Correo: ' + c.correo, 'Teléfono/WhatsApp: ' + c.telefono,
    'Modalidad: ' + textoModalidad(c.modalidad), c.notas ? 'Notas: ' + c.notas : '', c.resumen ? 'Resumen del chat: ' + c.resumen : '',
    'Agendada desde el chat de la web (Valeria). Id: ' + c.cita_id].filter(Boolean).join('\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Palmera Brava//Chat vendedor//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + c.cita_id + '@palmera-brava', 'DTSTAMP:' + icsUtc(ahoraMs), 'DTSTART:' + icsUtc(Number(c.inicio_ms)), 'DTEND:' + icsUtc(Number(c.fin_ms)),
    'SUMMARY:' + icsTexto('Cita Palmera Brava – ' + c.negocio), 'DESCRIPTION:' + icsTexto(desc),
    'LOCATION:' + icsTexto(c.modalidad === 'presencial' ? 'Presencial en Tarapoto (lugar por coordinar)' : 'Videollamada (enlace por enviar)'),
    'STATUS:CONFIRMED', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsTexto('Cita con ' + c.negocio), 'TRIGGER:-PT30M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].map(icsPlegar).join('\r\n') + '\r\n';
}
function slugSimple(s) { return sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'negocio'; }
function nuevoIdCita(ms) { return 'cit-' + Number(ms).toString(36) + Math.random().toString(36).slice(2, 6); }
// --- fin comun-chat.js ---
