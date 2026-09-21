const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const pureStart = html.indexOf("const FINANCE_TZ='");
const pureEnd = html.indexOf('async function financeFetchByValues');
assert.ok(pureStart >= 0 && pureEnd > pureStart, 'No se encontró el bloque financiero puro');

const context = { Intl, Date, Number, String, Map, Set, Math };
vm.createContext(context);
vm.runInContext(html.slice(pureStart, pureEnd), context);

const today = '2026-09-21';
const client = (id, city = 'Capital') => ({ id, nombre: `Cliente ${id}`, dni: `3000000${id}`, telefono: '3854169751', ciudad: city });
const seller = id => ({ id, nombre: `Vendedor ${id}` });
const row = (id, due, amount, paid, state = 'pendiente', accountState = 'activa', clientId = '1', accountId = 'a1', unit = 'hogar', sellerId = 's1', city = 'Capital') => ({
  id,
  vencimiento: due,
  importe: amount,
  importe_pagado: paid,
  saldo: amount - paid,
  estado: state,
  accountEstado: accountState,
  account: { id: accountId, unidad: unit, vendedor_id: sellerId },
  client: client(clientId, city),
  seller: seller(sellerId),
  product: `Producto ${id}`,
});

const rows = [
  row('future', '2026-09-25', 100, 0),
  row('today', today, 200, 0),
  row('overdue', '2026-09-10', 300, 0, 'pendiente', 'activa', '2', 'a2', 'celulares', 's2', 'Banda'),
  row('partial', '2026-09-27', 400, 100, 'parcial', 'activa', '2', 'a2', 'celulares', 's2', 'Banda'),
  row('paid', '2026-09-05', 500, 500, 'pagada', 'activa', '3'),
  row('annulled', '2026-09-01', 600, 0, 'anulada', 'anulada', '4'),
  row('overdue-partial', '2026-09-11', 250, 50, 'parcial', 'activa', '2', 'a3', 'celulares', 's2', 'Banda'),
  row('closed', '2026-08-01', 100, 100, 'pagada', 'finalizada', '5'),
];

assert.equal(context.financeVisualState(rows[0], today).key, 'upcoming', 'Cuota futura');
assert.equal(context.financeVisualState(rows[1], today).key, 'today', 'Cuota que vence hoy');
assert.equal(context.financeVisualState(rows[2], today).key, 'overdue', 'Cuota vencida');
assert.equal(context.financeVisualState(rows[3], today).key, 'partial', 'Cuota parcial futura');
assert.equal(context.financeVisualState(rows[4], today).key, 'paid', 'Cuota pagada no debe quedar vencida');
assert.equal(context.financeVisualState(rows[5], today).key, 'annulled', 'Cuota anulada no debe quedar vencida');
assert.equal(context.financeVisualState(rows[6], today).key, 'overdue', 'Una parcial vencida conserva alerta roja');
assert.equal(context.financeVisualState(rows[7], today).key, 'closed', 'Cuenta finalizada sin saldo queda gris');

const summary = context.financeSummarize(rows, today);
assert.equal(summary.programmed, 1850, 'Total programado excluye anuladas');
assert.equal(summary.applied, 750, 'Total aplicado');
assert.equal(summary.balance, 1100, 'Saldo del período');
assert.equal(summary.overdue, 500, 'Total vencido pendiente');
assert.equal(summary.overdueCount, 2, 'Cantidad de cuotas vencidas');
assert.equal(summary.debtors, 1, 'Cliente con dos operaciones vencidas se cuenta una vez');
assert.equal(summary.today, 200, 'Total que vence hoy');
assert.equal(summary.next7, 400, 'Total de los próximos siete días');

const combined = context.financeFilterRows(rows, { window: 'month', state: 'partial', unit: 'celulares', seller: 's2', city: 'Banda', query: 'producto partial' }, today);
assert.equal(combined.length, 1, 'Filtros combinados');
assert.equal(combined[0].id, 'partial');
assert.equal(context.financeFilterRows(rows, { window: 'overdue' }, today).length, 2, 'Filtro vencidos');
assert.equal(context.financeFilterRows(rows, { window: 'next7' }, today).length, 2, 'Filtro próximos siete días');
assert.equal(context.financeFilterRows(rows, { state: 'paid' }, today).length, 2, 'Pagadas incluye cuenta cerrada sin saldo');
assert.equal(context.financeFilterRows(rows, { state: 'pending' }, today).some(item => item.id === 'overdue-partial'), false, 'Pendientes no mezcla parciales');

assert.equal(context.financeMonthRange('2024-02').to, '2024-02-29', 'Febrero bisiesto');
assert.equal(context.financeMonthRange('2025-02').to, '2025-02-28', 'Febrero no bisiesto');
assert.equal(context.financeMonthRange('2026-04').to, '2026-04-30', 'Mes de 30 días');
assert.equal(context.financeMonthRange('2026-12').to, '2026-12-31', 'Mes de 31 días');
assert.equal(context.financeShiftMonth('2026-12', 1), '2027-01', 'Cambio de año hacia adelante');
assert.equal(context.financeShiftMonth('2026-01', -1), '2025-12', 'Cambio de año hacia atrás');

assert.equal(context.financeWhatsAppNumber('385 416-9751'), '5493854169751', 'WhatsApp local');
assert.equal(context.financeWhatsAppNumber('0385 416-9751'), '5493854169751', 'WhatsApp con cero inicial');
assert.equal(context.financeWhatsAppNumber('+54 9 385 416-9751'), '5493854169751', 'WhatsApp internacional móvil');
assert.equal(context.financeWhatsAppNumber('+54 385 416-9751'), '5493854169751', 'WhatsApp internacional sin nueve');

assert.equal(context.financePortalState([]), 'missing', 'Cliente sin portal');
assert.equal(context.financePortalState([{ portal_token: 'uno', activo: true }]), 'ready', 'Coincidencia única de portal');
assert.equal(context.financePortalState([{ portal_token: 'uno', activo: true }, { portal_token: 'dos', activo: true }]), 'ambiguous', 'Coincidencia ambigua de portal');
assert.equal(context.financePortalState([{ portal_token: 'uno', activo: false }]), 'missing', 'Portal revocado no se comparte');

const financeBlock = html.slice(html.indexOf('// ===== Módulo financiero REST'), html.indexOf('let adminInteresesCache'));
assert.doesNotMatch(financeBlock, /\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/, 'La fase 1 financiera debe ser sólo lectura');
assert.match(financeBlock, /profile\?\.rol\s*!==\s*'admin'/, 'El acceso requiere rol administrativo en la interfaz');
assert.match(html, /\.eq\('cliente_id',clientId\)/, 'La ficha consulta una sola persona');
assert.match(html, /\.gte\('vencimiento',from\)\.lte\('vencimiento',to\)/, 'La agenda consulta un rango acotado en servidor');
assert.match(html, /@media\(max-width:560px\).*collections/s, 'Existe diseño mobile-first/responsivo');

const staticMarkup = html.slice(0, html.indexOf('<script>\nconst sb='));
const ids = [...staticMarkup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual(duplicates, [], `IDs HTML duplicados: ${duplicates.join(', ')}`);
['solicitudesAdmin', 'catalogoAdmin', 'logisticaAdmin', 'referidosAdmin', 'sellerRoot', 'clientRoot', 'cobranzasAdmin', 'financialClientDetail'].forEach(id => assert.ok(ids.includes(id), `Falta el módulo ${id}`));

console.log('OK: 32 controles del módulo financiero superados');
