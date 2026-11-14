'use strict';
// Derive information_schema rows from the existing real-MySQL DDL snapshot,
// independently of the Word contract that stage4-verify checks.
function schemaMetadata(){
  const {ddl}=require('./final-schema.json');
  const rows={tables:[],columns:[],primary:[],fks:[],indexes:[],checks:[],engines:[],ddl};
  for(const [table,sql] of Object.entries(ddl)){
    rows.tables.push({name:table});rows.engines.push({t:table,engine:'InnoDB'});
    for(const line of sql.split('\n')){
      const column=/^  `([^`]+)` ([a-z]+(?:\([^)]*\))?(?: unsigned)?)/i.exec(line);
      if(column){
        const value=/ DEFAULT ('[^']*'|NULL|[0-9]+)/.exec(line)?.[1];
        const text=/^(char|varchar|enum|text)/.test(column[2]);
        rows.columns.push({t:table,c:column[1],type:column[2],nullable:line.includes('NOT NULL')?'NO':'YES',
          def:value===undefined||value==='NULL'?null:value.replace(/^'|'$/g,''),extra:line.includes('AUTO_INCREMENT')?'auto_increment':'',
          charset:text?(/CHARACTER SET (\w+)/.exec(line)?.[1]||'utf8mb4'):null,
          collation:text?(/COLLATE (\w+)/.exec(line)?.[1]||'utf8mb4_unicode_ci'):null});
      }
      const primary=/PRIMARY KEY \(([^)]+)\)/.exec(line);
      if(primary)[...primary[1].matchAll(/`([^`]+)`/g)].forEach((match,i)=>{
        rows.primary.push({t:table,c:match[1]});rows.indexes.push({t:table,name:'PRIMARY',nonUnique:0,c:match[1],seq:i+1,expression:null});
      });
      const index=/(UNIQUE )?KEY `([^`]+)` \((.*)\)/.exec(line);
      if(index){
        const fields=[...index[3].matchAll(/`([^`]+)`/g)].map(m=>m[1]);
        const functional=index[3].startsWith('(');
        (functional?[null]:fields).forEach((field,i)=>rows.indexes.push({t:table,name:index[2],nonUnique:index[1]?0:1,
          c:field,expression:functional?index[3]:null,seq:i+1}));
      }
      const fk=/FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`([^`]+)`\)/.exec(line);
      if(fk)rows.fks.push({t:table,c:fk[1],p:fk[2],pc:fk[3],ps:'secure_ecommerce',
        d:/ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION)/.exec(line)?.[1]||'RESTRICT',
        u:/ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION)/.exec(line)?.[1]||'RESTRICT'});
      const check=/CONSTRAINT `([^`]+)` CHECK/.exec(line);
      if(check)rows.checks.push({t:table,name:check[1],enforced:'YES',clause:line});
    }
  }
  return rows;
}
module.exports={schemaMetadata};
