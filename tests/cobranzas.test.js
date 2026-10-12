const test=require('node:test');
const assert=require('node:assert/strict');
const fc=require('../cobranzas.js');
test('importes argentinos preservan centavos y separadores',()=>{
 for(const [input,out] of [['100.000',100000],['1.234,56',1234.56],['125000',125000],['100.50',100.50],['25,75',25.75]])assert.equal(fc.amount(input),out);
});
test('importes inválidos y precisión excesiva se rechazan',()=>{
 for(const input of ['','-1','NaN','Infinity','0','0.001','1abc','9007199254740992'])assert.throws(()=>fc.amount(input));
});
test('WhatsApp normaliza formatos argentinos completos sin inventar área',()=>{
 for(const input of ['+54 9 385 555-0101','3855550101','0385 15 5550101','54 385 5550101'])assert.equal(fc.phone(input),'5493855550101');
 assert.equal(fc.phone('5550101'),null);
});
test('mensaje de mora usa saldo pendiente y fecha de la cuota',()=>{
 const url=fc.whatsapp({telefono:'3855550101',cliente_nombre:'TEST María',producto:'Sommier',vencimiento:'2026-10-08',saldo:40000,importe:100000,estado_operativo:'vencida'});
 const text=new URL(url).searchParams.get('text');assert.match(text,/08\/10\/2026/);assert.match(text,/40\.000/);assert.doesNotMatch(text,/100\.000/);assert.match(text,/comprobante/);
});
test('recordatorio próximo y de hoy se diferencian',()=>{
 const q={telefono:'3855550101',cliente_nombre:'TEST Carlos',producto:'Celular',vencimiento:'2026-10-14',saldo:50000};
 assert.match(decodeURIComponent(fc.whatsapp({...q,estado_operativo:'proxima'})),/14\/10\/2026/);
 assert.match(decodeURIComponent(fc.whatsapp({...q,estado_operativo:'hoy'})),/vence hoy/);
});
test('no hay enlace de WhatsApp para teléfonos incompletos',()=>assert.equal(fc.whatsapp({telefono:'5550101'}),null));
test('fechas de registración usan Argentina y fecha efectiva no se desplaza',()=>{
 assert.equal(fc.date('2026-10-08'),'08/10/2026');assert.match(fc.stamp('2026-10-12T01:30:00Z'),/11\/10\/26/);
});
test('contenido declarado por el cliente se escapa',()=>assert.equal(fc.esc('<script>"&'), '&lt;script&gt;&quot;&amp;'));
