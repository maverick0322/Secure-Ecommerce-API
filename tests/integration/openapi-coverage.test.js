'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {generateDocumentation}=require('../../swagger');
it('documents every registered HTTP route and resolves all schema references',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openapi-final-'));
  try{
    const file=path.join(dir,'openapi.json');await generateDocumentation(file);
    const spec=JSON.parse(fs.readFileSync(file,'utf8'));
    const source=fs.readFileSync(path.resolve('index.js'),'utf8');
    const mounts=[...source.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(['"](\.\/routes\/[^'"]+)['"]\)/g)];
    expect(mounts.length).toBeGreaterThanOrEqual(10);
    for(const [,prefix,module] of mounts){
      const router=require(path.resolve(module));
      for(const layer of router.stack.filter(layer=>layer.route)){
        const route=layer.route;
        const url=(prefix+(route.path==='/'?'':route.path)).replace(/:([A-Za-z][A-Za-z0-9_]*)/g,'{$1}');
        for(const method of Object.keys(route.methods)){
          const operation=spec.paths[url]?.[method];
          if(!operation) throw new Error(`OpenAPI missing ${method.toUpperCase()} ${url}`);
          expect(operation.description).toBeTruthy();expect(operation.responses[500]).toBeDefined();
          expect(operation.security).toBeDefined();
        }
      }
    }
    function references(value){
      if(!value||typeof value!=='object')return;
      if(value.$ref){expect(value.$ref).toMatch(/^#\/definitions\//);expect(spec.definitions[value.$ref.split('/').at(-1)]).toBeDefined();}
      for(const child of Object.values(value)) references(child);
    }references(spec);
  }finally{for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
},30000);
