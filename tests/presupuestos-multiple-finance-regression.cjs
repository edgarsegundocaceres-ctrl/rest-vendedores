// Existing 79 financial checks on the schema including the NEW incremental migration.
const fs=require('node:fs'),path=require('node:path');
const {setup,root}=require('./motor-precios-db.cjs');
require('./finance-db.cjs').setup=async db=>{await setup(db);for(const file of ['20261022121122_cuotas_comerciales_multiplos_100.sql','20261025033232_presupuestos_multiproducto_multiopcion.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));};
require('./finance-engine-smoke.cjs');
