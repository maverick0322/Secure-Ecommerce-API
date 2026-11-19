'use strict';
const crypto = require('node:crypto');
const db = require('../../models');
const accounts = require('../../services/accounts.service');
const hashes = require('../../services/password-hash.service');
const audit = require('../../services/audit.service');

describe('accounts.service unit coverage', () => {
  const tx = { LOCK: { UPDATE: 'UPDATE' } };

  beforeEach(() => {
    jest.spyOn(db.sequelize, 'transaction').mockImplementation(work => work(tx));
    jest.spyOn(audit, 'business').mockResolvedValue({});
    jest.spyOn(audit, 'write').mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates BUYER and SELLER public accounts and rejects invalid profiles or duplicate emails', async () => {
    await expect(accounts.createPublicAccount({
      email: 'bad@example.invalid', name: 'Bad', password: 'Password1!', profile: 'ADMIN'
    })).rejects.toMatchObject({ status: 400 });

    const validHash = hashes.createDummyHash();
    jest.spyOn(hashes, 'hash').mockResolvedValue(validHash);
    const userId = crypto.randomUUID();
    jest.spyOn(db.User, 'create').mockResolvedValue({
      id: userId, email: 'buyer@example.invalid', name: 'Buyer', status: 'ACTIVE'
    });
    const buyerCreate = jest.spyOn(db.Buyer, 'create').mockResolvedValue({});
    const sellerCreate = jest.spyOn(db.Seller, 'create').mockResolvedValue({});

    const buyer = await accounts.createPublicAccount({
      email: 'buyer@example.invalid', name: 'Buyer', password: 'Password1!', profile: 'BUYER'
    }, { ipAddress: '127.0.0.1' });
    expect(buyer).toEqual({ id: userId, email: 'buyer@example.invalid', name: 'Buyer', profile: 'BUYER', status: 'ACTIVE' });
    expect(buyerCreate).toHaveBeenCalledWith({ userId }, { transaction: tx });

    const seller = await accounts.createVerifiedRegistration({
      email: 'seller@example.invalid', name: 'Seller', passwordHash: validHash, profile: 'SELLER', storeName: 'Tienda'
    });
    expect(seller).toMatchObject({ profile: 'SELLER', sellerStatus: 'PENDING' });
    expect(sellerCreate).toHaveBeenCalledWith(expect.objectContaining({ userId, storeName: 'Tienda' }), { transaction: tx });

    await expect(accounts.createVerifiedRegistration({
      email: 'x@example.invalid', name: 'X', passwordHash: 'not-a-hash', profile: 'BUYER'
    })).rejects.toThrow('Invalid pending registration');

    db.User.create.mockRejectedValueOnce(new db.Sequelize.UniqueConstraintError({}));
    await expect(accounts.createVerifiedRegistration({
      email: 'dup@example.invalid', name: 'Dup', passwordHash: validHash, profile: 'BUYER'
    })).rejects.toMatchObject({ status: 409 });

    db.User.create.mockRejectedValueOnce(new Error('unexpected DB error'));
    await expect(accounts.createVerifiedRegistration({
      email: 'err@example.invalid', name: 'Err', passwordHash: validHash, profile: 'BUYER'
    })).rejects.toThrow('unexpected DB error');
  });

  it('reviews pending sellers (APPROVED/REJECTED) and enforces admin/state guards', async () => {
    const adminId = crypto.randomUUID();
    const sellerId = crypto.randomUUID();
    const activeAdmin = { id: adminId, status: 'ACTIVE', emailVerifiedAt: new Date(), deletedAt: null };
    const sellerRow = { userId: sellerId, status: 'PENDING', update: jest.fn().mockResolvedValue({}) };

    jest.spyOn(db.User, 'findByPk').mockResolvedValue(activeAdmin);
    jest.spyOn(db.Admin, 'findByPk').mockResolvedValue({ userId: adminId });
    jest.spyOn(db.Seller, 'findByPk').mockResolvedValue(sellerRow);

    const approved = await accounts.reviewSeller(adminId, sellerId, 'APPROVED', null, '127.0.0.1');
    expect(approved).toMatchObject({ userId: sellerId, status: 'APPROVED', reviewedByUserId: adminId });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'seller.approved', ipAddress: '127.0.0.1' }), { transaction: tx });

    sellerRow.status = 'PENDING';
    const rejected = await accounts.reviewSeller(adminId, sellerId, 'REJECTED', 'Docs incompletos', 'not-an-ip');
    expect(rejected).toMatchObject({ userId: sellerId, status: 'REJECTED', rejectionReason: 'Docs incompletos' });
    expect(audit.write).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'seller.rejected', ipAddress: null }), { transaction: tx });

    sellerRow.status = 'APPROVED';
    await expect(accounts.reviewSeller(adminId, sellerId, 'APPROVED', null, '127.0.0.1')).rejects.toMatchObject({ status: 409 });

    db.Seller.findByPk.mockResolvedValueOnce(null);
    await expect(accounts.reviewSeller(adminId, sellerId, 'APPROVED', null, '127.0.0.1')).rejects.toMatchObject({ status: 404 });

    db.Admin.findByPk.mockResolvedValueOnce(null);
    await expect(accounts.reviewSeller(adminId, sellerId, 'APPROVED', null, '127.0.0.1')).rejects.toMatchObject({ status: 403 });
  });
});
