'use strict';

const express = require('express');
const request = require('supertest');
const addresses = require('../../services/addresses.service');
const { tokenFor, mockAccountLookups } = require('../support/auth-fixtures');
const app = express();
app.use(express.json());
app.use('/api/addresses', require('../../routes/addresses.routes'));
const buyer = tokenFor('BUYER');
const admin = tokenFor('ADMIN');
const header = `Bearer ${buyer.token}`;
beforeEach(mockAccountLookups);
afterEach(() => jest.restoreAllMocks());

it('requires an authenticated buyer', async () => {
  expect((await request(app).get('/api/addresses')).status).toBe(401);
  expect((await request(app).get('/api/addresses').set('Authorization',`Bearer ${admin.token}`)).status).toBe(403);
});
it('lists only the current buyer addresses', async () => {
  const list = jest.spyOn(addresses,'list').mockResolvedValue([{ id:'1' }]);
  expect((await request(app).get('/api/addresses').set('Authorization',header)).body).toEqual([{ id:'1' }]);
  expect(list).toHaveBeenCalledWith(buyer.account.id);
});
it('rejects assignment of ownership and malformed identifiers before persistence', async () => {
  const insert = jest.spyOn(addresses,'create'); const update = jest.spyOn(addresses,'update');
  expect((await request(app).post('/api/addresses').set('Authorization',header).send({ buyerId:'other' })).status).toBe(400);
  expect((await request(app).put('/api/addresses/0').set('Authorization',header).send({ city:'City' })).status).toBe(400);
  expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});
it('creates, edits, changes defaults and removes owned addresses', async () => {
  const body = { recipientName:'Name',street:'Street',exteriorNumber:'1',neighborhood:'District',city:'City',state:'State',postalCode:'01000' };
  jest.spyOn(addresses,'create').mockResolvedValue({ id:'1',...body });
  const update = jest.spyOn(addresses,'update').mockResolvedValue({});
  const remove = jest.spyOn(addresses,'remove').mockResolvedValue();
  expect((await request(app).post('/api/addresses').set('Authorization',header).send(body)).status).toBe(201);
  expect((await request(app).put('/api/addresses/1').set('Authorization',header).send({ city:'New' })).status).toBe(204);
  expect(update).toHaveBeenLastCalledWith(buyer.account.id,'1',{ city:'New' },{ipAddress:expect.any(String)});
  expect((await request(app).put('/api/addresses/1/default').set('Authorization',header)).status).toBe(204);
  expect(update).toHaveBeenLastCalledWith(buyer.account.id,'1',{ isDefault:true },{ipAddress:expect.any(String)});
  expect((await request(app).delete('/api/addresses/1').set('Authorization',header)).status).toBe(204);
  expect(remove).toHaveBeenCalledWith(buyer.account.id,'1',{ipAddress:expect.any(String)});
});
it('sanitizes unexpected errors', async () => {
  jest.spyOn(addresses,'list').mockRejectedValue(new Error('database password: secret'));
  const response = await request(app).get('/api/addresses').set('Authorization',header);
  expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('secret');
});
