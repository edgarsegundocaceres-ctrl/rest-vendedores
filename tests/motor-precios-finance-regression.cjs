// Reejecuta la suite financiera existente después de instalar el motor.
// Los costos siguientes existen exclusivamente en los fixtures efímeros TEST.
const {setup,rpc}=require('./motor-precios-db.cjs');
require('./finance-db.cjs').setup=async db=>{await setup(db);await rpc(db,'guardar_costo_producto_rest',{p_producto:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',p_costo:500000});await rpc(db,'guardar_costo_producto_rest',{p_producto:'dddddddd-dddd-4ddd-8ddd-000000000002',p_costo:300});await rpc(db,'actualizar_dolar_rest',{p_valor:1500});};
require(process.env.MOTOR_FINANCE_UI==='1'?'./finance-ui-smoke.cjs':'./finance-engine-smoke.cjs');
