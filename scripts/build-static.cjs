// Los documentos de costos y fixtures reales NUNCA se publican como assets.
const fs=require('node:fs'),path=require('node:path');
const preview=process.env.VERCEL_ENV==='preview',out=path.resolve('dist');
const skip=new Set(['.git','.vercel','node_modules','dist','docs','scripts']);
const secretFixtures=new Set(['catalogo-celulares-auditado.json','catalogo-hogar-auditado.json','cruce-proveedor-celulares.json']);
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
function copy(dir='',dest=out){for(const e of fs.readdirSync(dir||'.',{withFileTypes:true})){
 if(e.name.startsWith('.')||skip.has(e.name)||secretFixtures.has(e.name))continue;
 if(!preview&&(['tests','supabase','preview-runtime'].includes(e.name)||e.name.includes('preview')))continue;
 if(e.name.endsWith('.cjs')||e.name.endsWith('.test.js'))continue;
 const src=path.join(dir,e.name),target=path.join(dest,e.name);
 if(e.isDirectory()){fs.mkdirSync(target,{recursive:true});copy(src,target)}else if(e.isFile())fs.copyFileSync(src,target);
}}
copy();console.log('Assets preparados para '+(preview?'preview aislado':'producción')+'; costos de proveedor y reportes excluidos.');
