// Suite financiera existente sobre esquema actualizado; solo fixtures efímeros.
const fs=require('node:fs'),path=require('node:path');
const {setup,root}=require('./motor-precios-db.cjs');
require('./finance-db.cjs').setup=async db=>{await setup(db);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022121122_cuotas_comerciales_multiplos_100.sql'),'utf8'));};
require('./finance-engine-smoke.cjs');
