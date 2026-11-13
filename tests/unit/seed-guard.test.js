'use strict';
const Sequelize=require('sequelize');
const {insertMissingRecords}=require('../../services/seed-data.service');
it('blocks every historical seed before looking at or writing business records on the final schema',async()=>{
  const query={sequelize:{query:jest.fn().mockResolvedValue([{db:'secure_ecommerce'}])},select:jest.fn(),bulkInsert:jest.fn()};
  await expect(insertMissingRecords(query,Sequelize,'categories',[{id:1}],['id'])).rejects.toThrow('forbidden');
  expect(query.select).not.toHaveBeenCalled();expect(query.bulkInsert).not.toHaveBeenCalled();
});
it('retains historical isolated seeding without overwriting existing records',async()=>{
  const query={sequelize:{query:jest.fn().mockResolvedValue([{db:'legacy_isolated'}])},
    select:jest.fn().mockResolvedValueOnce([{id:1}]).mockResolvedValueOnce([]),bulkInsert:jest.fn()};
  await insertMissingRecords(query,Sequelize,'categories',[{id:1},{id:2}],['id']);
  expect(query.bulkInsert).toHaveBeenCalledTimes(1);expect(query.bulkInsert).toHaveBeenCalledWith('categories',[{id:2}],{ignoreDuplicates:true});
});
it('never provisions historical fixture users with a default or weak password',async()=>{
  const seed=require('../../seeders/20240101000004-seed-users');
  const query={select:jest.fn(),bulkInsert:jest.fn()};
  for(const password of ['', 'Password123456!']){
    jest.replaceProperty(process,'env',{...process.env,LEGACY_SEED_USER_PASSWORD:password});
    await expect(seed.up(query,Sequelize)).rejects.toMatchObject({status:400});
  }
  expect(query.select).not.toHaveBeenCalled();expect(query.bulkInsert).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
