'use strict';
jest.mock('../../scripts/database/stage4',()=>({
  business:Object.keys(jest.requireActual('../support/final-schema.json').ddl).filter(table=>table!=='SequelizeMeta'),
  connect:jest.fn(),artifact:jest.fn(),assertEmpty:jest.fn()}));
const admin=require('../../scripts/database/stage4');
const {verifySchema}=require('../../scripts/database/stage4-verify');
const {schemaMetadata}=require('../support/schema-metadata');
let rows,connection;
beforeEach(()=>{
  rows=schemaMetadata();
  jest.spyOn(require('mysql2/promise'),'createConnection').mockRejectedValue(new Error('Unexpected network access'));
  jest.spyOn(console,'log').mockImplementation(()=>{});
  connection={end:jest.fn(),query:jest.fn(async sql=>{
    if(sql==='SHOW TABLES')return [rows.tables];
    if(sql.startsWith('SHOW CREATE TABLE'))return [[{'Create Table':rows.ddl[sql.match(/`([^`]+)`/)[1]]}]];
    if(!sql.startsWith('SELECT'))throw new Error('Unexpected non-read query');
    for(const [marker,key] of [['information_schema.COLUMNS','columns'],["CONSTRAINT_NAME='PRIMARY'",'primary'],
      ['REFERENTIAL_CONSTRAINTS','fks'],['information_schema.STATISTICS','indexes'],['CHECK_CONSTRAINTS','checks'],['information_schema.TABLES','engines']]){
      if(sql.includes(marker))return [rows[key]];
    }
    throw new Error('Unexpected metadata query');
  })};
  admin.connect.mockResolvedValue(connection);admin.assertEmpty.mockResolvedValue();
});
afterEach(()=>{jest.restoreAllMocks();jest.clearAllMocks();});
it('verifies the independent MySQL DDL dictionary regardless of metadata row order',async()=>{
  rows.tables.reverse();rows.fks.reverse();rows.columns.reverse();
  await verifySchema();expect(connection.end).toHaveBeenCalledTimes(1);
  expect(admin.artifact).toHaveBeenCalledWith('schema-verification.json',expect.objectContaining({tables:expect.arrayContaining(['orders','audit_logs'])}));
});
it.each(['extra-table','money','snapshot-json','cascade','cross-schema','checkout-unique','unenforced-check'])('rejects schema drift: %s',async scenario=>{
  if(scenario==='extra-table')rows.tables.push({name:'roles'});
  if(scenario==='money')rows.columns.find(r=>r.t==='products'&&r.c==='price').type='decimal(10,2)';
  if(scenario==='snapshot-json')rows.columns.find(r=>r.t==='orders'&&r.c==='deliveryAddressSnapshot').type='text';
  if(scenario==='cascade')rows.fks[0].d='CASCADE';if(scenario==='cross-schema')rows.fks[0].ps='other_database';
  if(scenario==='checkout-unique')rows.indexes=rows.indexes.filter(r=>r.t!=='orders'||r.nonUnique!==0);
  if(scenario==='unenforced-check')rows.checks[0].enforced='NO';
  await expect(verifySchema()).rejects.toThrow();expect(connection.end).toHaveBeenCalledTimes(1);expect(admin.artifact).not.toHaveBeenCalled();
});
it('does not certify a populated database even when its structure is correct',async()=>{
  admin.assertEmpty.mockRejectedValue(new Error('Synthetic nonempty database'));
  await expect(verifySchema()).rejects.toThrow('Synthetic nonempty database');expect(admin.artifact).not.toHaveBeenCalled();
  expect(connection.end).toHaveBeenCalled();
});
