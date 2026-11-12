'use strict';

const { addressInput, addressId } = require('../../validators/address');
const models = require('../../models');
const addresses = require('../../services/addresses.service');
const valid = { recipientName: 'Recipient', street: 'Street', exteriorNumber: '1', neighborhood: 'District',
  city: 'City', state: 'State', postalCode: '01000' };

afterEach(() => jest.restoreAllMocks());

it('validates a full address, trimming text and accepting nullable optional fields', () => {
  expect(addressInput({ ...valid, street: ' Street ', label: null, country: 'MX', isDefault: true }))
    .toEqual({ ...valid, label: null, country: 'MX', isDefault: true });
  expect(addressInput({ city: 'New city' }, true)).toEqual({ city: 'New city' });
});

it.each([null, [], {}, { ...valid, buyerId: 'other' }, { ...valid, isDefault: 1 }, { ...valid, country: 'mx' },
  { ...valid, city: '' }, { ...valid, street: 'x'.repeat(256) }, { ...valid, postalCode: '01\n000' },
  { street: 'Street' }, { ...valid, label: 1 }])('rejects invalid or mass-assigned address %j', body => {
  expect(() => addressInput(body)).toThrow();
});

it.each(['0','-1','1 OR 1=1','1e2','18446744073709551616',null,1])('rejects invalid BIGINT ID %j', id => {
  expect(() => addressId(id)).toThrow();
});

it('preserves full unsigned BIGINT precision', () => {
  expect(addressId('18446744073709551615')).toBe('18446744073709551615');
});

function transaction() {
  jest.spyOn(models.AuditLog,'create').mockResolvedValue({});
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  jest.spyOn(models.sequelize, 'transaction').mockImplementation(work => work(tx));
  jest.spyOn(models.User, 'findByPk').mockResolvedValue({ status: 'ACTIVE', emailVerifiedAt: new Date() });
  jest.spyOn(models.Buyer, 'findByPk').mockResolvedValue({ userId: 'buyer' });
  return tx;
}

it('serializes default creation on the buyer account and clears the old default first', async () => {
  const tx = transaction();
  const clear = jest.spyOn(models.UserAddress, 'update').mockResolvedValue([1]);
  const insert = jest.spyOn(models.UserAddress, 'create').mockResolvedValue({ id: '1' });
  await addresses.create('buyer', { ...valid, isDefault: true });
  expect(models.User.findByPk).toHaveBeenCalledWith('buyer', { transaction: tx, lock: 'UPDATE' });
  expect(clear).toHaveBeenCalledWith({ isDefault: false }, { where: { buyerId: 'buyer', isDefault: true }, transaction: tx });
  expect(insert).toHaveBeenCalledWith({ ...valid, isDefault: true, buyerId: 'buyer' }, { transaction: tx });
  expect(clear.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
});

it('does not touch other defaults when creating a regular address', async () => {
  transaction();
  const clear = jest.spyOn(models.UserAddress, 'update');
  jest.spyOn(models.UserAddress, 'create').mockResolvedValue({});
  await addresses.create('buyer', valid);
  expect(clear).not.toHaveBeenCalled();
});

it('rejects inactive buyers before writing', async () => {
  transaction();
  models.User.findByPk.mockResolvedValue({ status: 'SUSPENDED' });
  const insert = jest.spyOn(models.UserAddress, 'create');
  await expect(addresses.create('buyer', valid)).rejects.toMatchObject({ status: 403 });
  expect(insert).not.toHaveBeenCalled();
});

it('rejects missing buyer profiles', async () => {
  transaction(); models.Buyer.findByPk.mockResolvedValue(null);
  await expect(addresses.create('buyer', valid)).rejects.toMatchObject({ status: 403 });
});

it.each(['update','remove'])('hides missing or foreign addresses during %s', async action => {
  const tx = transaction();
  const find = jest.spyOn(models.UserAddress, 'findOne').mockResolvedValue(null);
  await expect(addresses[action]('buyer','5',{})).rejects.toMatchObject({ status: 404 });
  expect(find).toHaveBeenCalledWith({ where: { id: '5', buyerId: 'buyer' }, transaction: tx, lock: 'UPDATE' });
});

it('updates only a locked owned address and excludes it from default clearing', async () => {
  const tx = transaction(); const row = { update: jest.fn() };
  jest.spyOn(models.UserAddress,'findOne').mockResolvedValue(row);
  const clear = jest.spyOn(models.UserAddress,'update').mockResolvedValue([1]);
  await addresses.update('buyer','5',{ isDefault:true });
  expect(clear).toHaveBeenCalledWith({ isDefault:false }, expect.objectContaining({ where: {
    buyerId:'buyer',isDefault:true,id:{ [models.Sequelize.Op.ne]:'5' }
  } }));
  expect(row.update).toHaveBeenCalledWith({ isDefault:true },{ transaction:tx });
});

it('removes addresses using paranoid deletion and scopes listing by buyer', async () => {
  const tx = transaction(); const row = { destroy:jest.fn() };
  jest.spyOn(models.UserAddress,'findOne').mockResolvedValue(row);
  await addresses.remove('buyer','5');
  expect(row.destroy).toHaveBeenCalledWith({ transaction:tx });
  expect(models.UserAddress.options.paranoid).toBe(true);
  const list = jest.spyOn(models.UserAddress,'findAll').mockResolvedValue([]);
  await addresses.list('buyer');
  expect(list).toHaveBeenCalledWith({ where:{ buyerId:'buyer' },order:[['isDefault','DESC'],['id','ASC']] });
});
