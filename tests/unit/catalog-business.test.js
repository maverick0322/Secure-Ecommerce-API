'use strict';
const db=require('../../models'),catalog=require('../../services/catalog.service'),audit=require('../../services/audit.service');
const tx={LOCK:{UPDATE:'UPDATE'}};let product,category;
beforeEach(()=>{
  product={id:1,sellerId:'seller',update:jest.fn(),destroy:jest.fn()};category={id:2,protected:false,update:jest.fn(),destroy:jest.fn()};
  category.update.mockImplementation(async()=>category);
  jest.spyOn(db.sequelize,'transaction').mockImplementation((options,work)=>(work||options)(tx));
  jest.spyOn(db.User,'findByPk').mockResolvedValue({status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Seller,'findByPk').mockResolvedValue({status:'APPROVED'});jest.spyOn(db.Admin,'findByPk').mockResolvedValue({});
  jest.spyOn(db.Product,'findByPk').mockResolvedValue(product);jest.spyOn(db.Product,'create').mockResolvedValue(product);
  jest.spyOn(db.Category,'findByPk').mockResolvedValue(category);jest.spyOn(db.Category,'findAll').mockResolvedValue([]);
  jest.spyOn(db.Category,'create').mockResolvedValue(category);jest.spyOn(audit,'business').mockResolvedValue();
  jest.spyOn(db.sequelize.getQueryInterface(),'describeTable').mockResolvedValue({price:{type:'DECIMAL(12,2)'}});
});
afterEach(()=>jest.restoreAllMocks());
it('creates and edits only server-owned products with audit in the same transaction',async()=>{
  await catalog.createProduct({id:'seller'},{title:'Synthetic',price:'12.50'});
  expect(db.Product.create).toHaveBeenCalledWith({title:'Synthetic',price:'12.50',sellerId:'seller'},{transaction:tx});
  await catalog.updateProduct({id:'seller'},1,{stock:0});expect(product.update).toHaveBeenCalledWith({stock:0},{transaction:tx});
  await catalog.removeProduct({id:'seller'},1);expect(product.destroy).toHaveBeenCalledWith({transaction:tx});
  expect(audit.business).toHaveBeenCalledWith('seller','producto.eliminar','product',1,tx,{});
});
it.each(['inactive','unapproved','foreign-owner','missing'])('blocks catalog writes for %s',async kind=>{
  if(kind==='inactive')db.User.findByPk.mockResolvedValue(null);
  if(kind==='unapproved')db.Seller.findByPk.mockResolvedValue(null);
  if(kind==='foreign-owner')product.sellerId='other';if(kind==='missing')db.Product.findByPk.mockResolvedValue(null);
  await expect(catalog.updateProduct({id:'seller'},1,{stock:1})).rejects.toMatchObject({status:['missing','foreign-owner'].includes(kind)?404:403});
  expect(product.update).not.toHaveBeenCalled();expect(audit.business).not.toHaveBeenCalled();
});
it.each([['TEXT',503],['DECIMAL(10,2)',409]])('rejects incompatible money schema %s',async(type,status)=>{
  db.sequelize.getQueryInterface().describeTable.mockResolvedValue({price:{type}});
  await expect(catalog.createProduct({id:'seller'},{title:'Synthetic',price:'9999999999.99'})).rejects.toMatchObject({status});
  expect(db.Product.create).not.toHaveBeenCalled();
});
it('associates once, revives the same link, and soft-deletes without replacing history',async()=>{
  const qi=db.sequelize.getQueryInterface();jest.spyOn(qi,'bulkInsert').mockResolvedValue();
  const link={deletedAt:new Date(),restore:jest.fn(),destroy:jest.fn()};
  jest.spyOn(db.ProductCategory,'findOne').mockResolvedValue(null);
  await catalog.changeCategory({id:'seller'},1,2,false);
  expect(qi.bulkInsert).toHaveBeenCalledWith('product_categories',[expect.objectContaining({productId:1,categoryId:2,createdAt:expect.any(Date)})],{transaction:tx},db.ProductCategory.rawAttributes);
  db.ProductCategory.findOne.mockResolvedValue(link);await catalog.changeCategory({id:'seller'},1,2,false);expect(link.restore).toHaveBeenCalledWith({transaction:tx});
  link.deletedAt=null;await catalog.changeCategory({id:'seller'},1,2,true);expect(link.destroy).toHaveBeenCalledWith({transaction:tx});
  expect(qi.bulkInsert).toHaveBeenCalledTimes(1);
});
it('requires an existing category and propagates transactional audit failures',async()=>{
  db.Category.findByPk.mockResolvedValue(null);
  await expect(catalog.changeCategory({id:'seller'},1,2,false)).rejects.toMatchObject({status:404});
  audit.business.mockRejectedValue(new Error('Synthetic audit failure'));
  await expect(catalog.removeProduct({id:'seller'},1)).rejects.toThrow('Synthetic audit failure');
});
it('keeps admin-only category mutations, uniqueness and protected-category policy',async()=>{
  await catalog.mutateCategory({id:'admin'},null,'New category');
  expect(db.Category.create).toHaveBeenCalledWith({name:'New category',protected:false},{transaction:tx});
  await catalog.mutateCategory({id:'admin'},2,'Edited');expect(category.update).toHaveBeenCalledWith({name:'Edited'},{transaction:tx});
  category.protected=true;await expect(catalog.mutateCategory({id:'admin'},2,null,true)).rejects.toMatchObject({status:400});
  category.protected=false;await catalog.mutateCategory({id:'admin'},2,null,true);expect(category.destroy).toHaveBeenCalled();
  db.Category.findAll.mockResolvedValue([{id:99}]);await expect(catalog.mutateCategory({id:'admin'},2,'Duplicate')).rejects.toMatchObject({status:409});
  db.Admin.findByPk.mockResolvedValue(null);await expect(catalog.mutateCategory({id:'admin'},2,'Denied')).rejects.toMatchObject({status:403});
});
it('treats hostile search text as a bound Sequelize value and filters seller visibility',async()=>{
  const find=jest.spyOn(db.Product,'findAll').mockResolvedValue([]),search="'; DROP TABLE users; --";
  await catalog.listProducts(search);
  expect(find.mock.calls[0][0].where.title[db.Sequelize.Op.like]).toBe('%'+search+'%');
  expect(find.mock.calls[0][0].include[0]).toMatchObject({required:true,where:{status:'APPROVED'},include:[expect.objectContaining({where:expect.objectContaining({status:'ACTIVE'})})]});
  for(const value of [[],{},'x'.repeat(256)])expect(()=>catalog.listProducts(value)).toThrow();
  jest.spyOn(db.Product,'findOne').mockResolvedValue(null);await expect(catalog.getProduct(1)).rejects.toMatchObject({status:404});
});
it('preserves Unicode/byte limits and rejects mass assignment or malformed numeric values',()=>{
  expect(catalog.productInput({title:'  Café 🙂  ',price:0,description:null,stock:4294967295},true)).toEqual({title:'Café 🙂',price:'0.00',description:null,stock:4294967295});
  for(const value of [{sellerId:'other'},[],{}, {title:' '},{price:Infinity},{price:'01'},{price:'1.001'},{stock:1.5},{stock:4294967296},{description:'é'.repeat(32768)}])expect(()=>catalog.productInput(value)).toThrow();
});
