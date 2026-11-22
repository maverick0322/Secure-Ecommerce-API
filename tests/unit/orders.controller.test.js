'use strict';
const crypto = require('node:crypto');
const ordersController = require('../../controllers/orders.controller');
const ordersService = require('../../services/orders.service');

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('orders.controller unit coverage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('handles quote, confirm (201 new and 200 replayed), list, get and transition', async () => {
    const account = { id: crypto.randomUUID(), profile: 'BUYER' };
    const checkoutId = crypto.randomUUID();
    const reqBase = { account, ip: '127.0.0.1' };

    jest.spyOn(ordersService, 'quote').mockResolvedValue({ total: '25.00', quote: 'signed-quote' });
    const resQuote = makeRes();
    await ordersController.quote({ ...reqBase, body: { addressId: '1' } }, resQuote);
    expect(resQuote.json).toHaveBeenCalledWith({ total: '25.00', quote: 'signed-quote' });

    const confirmSpy = jest.spyOn(ordersService, 'confirm')
      .mockResolvedValueOnce({ replayed: false, orders: [{ id: 10 }] })
      .mockResolvedValueOnce({ replayed: true, orders: [{ id: 10 }] });

    const confirmBody = { quote: 'signed-quote-token' };
    const resNew = makeRes();
    await ordersController.confirm({ ...reqBase, body: confirmBody }, resNew);
    expect(resNew.status).toHaveBeenCalledWith(201);
    expect(confirmSpy).toHaveBeenCalledWith(account.id, 'signed-quote-token', '127.0.0.1');

    const resReplayed = makeRes();
    await ordersController.confirm({ ...reqBase, body: confirmBody }, resReplayed);
    expect(resReplayed.status).toHaveBeenCalledWith(200);

    jest.spyOn(ordersService, 'list').mockResolvedValue([{ id: 10 }]);
    const resList = makeRes();
    await ordersController.list(reqBase, resList);
    expect(resList.json).toHaveBeenCalledWith([{ id: 10 }]);

    jest.spyOn(ordersService, 'get').mockResolvedValue({ id: 10 });
    const resGet = makeRes();
    await ordersController.get({ ...reqBase, params: { id: '10' } }, resGet);
    expect(resGet.json).toHaveBeenCalledWith({ id: 10 });

    jest.spyOn(ordersService, 'transition').mockResolvedValue({ id: 10, status: 'PREPARING' });
    const resTrans = makeRes();
    await ordersController.transition({ ...reqBase, params: { id: '10' }, body: { status: 'PREPARING' } }, resTrans);
    expect(resTrans.json).toHaveBeenCalledWith({ id: 10, status: 'PREPARING' });
  });

  it.each([1213, 1205, 1062])('maps MySQL concurrency errno %d to HTTP 409', async errno => {
    const dbErr = new Error('lock conflict');
    dbErr.original = { errno };
    jest.spyOn(ordersService, 'list').mockRejectedValue(dbErr);
    const res = makeRes();
    await ordersController.list({ account: { id: crypto.randomUUID() }, ip: '127.0.0.1' }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  });
});
