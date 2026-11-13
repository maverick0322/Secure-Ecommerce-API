'use strict';
const tables=['users','admins','sellers','buyers','user_addresses','categories','products','product_categories','carts','cart_items','orders','order_items','order_status_history','audit_logs'].sort();
async function verifyConnection(sequelize,{uuid=process.env.DB_EXPECTED_UUID}={}){
  await sequelize.authenticate();
  const [[server]]=await sequelize.query(`SELECT DATABASE() AS db,CURRENT_USER() AS account,VERSION() AS version,
    @@server_uuid AS uuid,@@session.sql_mode AS mode,@@session.foreign_key_checks AS fks`);
  if(server.db!=='secure_ecommerce'||!server.account.startsWith('ecommerce_app@')||!/^8\.0\./.test(server.version)||
    !/STRICT_(TRANS|ALL)_TABLES/.test(server.mode)||Number(server.fks)!==1||(uuid&&server.uuid!==uuid)) throw new Error('Database identity or session safety verification failed.');
  const [rows]=await sequelize.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
  const actual=rows.map(r=>r.name).filter(n=>n!=='SequelizeMeta').sort();
  if(JSON.stringify(actual)!==JSON.stringify(tables)) throw new Error('The API requires exactly the final 14 business tables.');
  return {database:server.db,account:server.account,version:server.version,uuid:server.uuid};
}
module.exports={verifyConnection,tables};
