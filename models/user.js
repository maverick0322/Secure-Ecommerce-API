'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate({ Admin, Seller, Buyer }) {
      User.hasOne(Admin, { as: 'admin', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
      User.hasOne(Seller, { as: 'seller', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
      User.hasOne(Buyer, { as: 'buyer', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    }
  }

  User.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    phoneNumber: { type: DataTypes.STRING(20), allowNull: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'SUSPENDED', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
    emailVerifiedAt: { type: DataTypes.DATE(3), allowNull: false },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false },
    deletedAt: { type: DataTypes.DATE(3), allowNull: true }
  }, {
    sequelize, modelName: 'User', tableName: 'users', paranoid: true,
    defaultScope: { attributes: { exclude: ['passwordHash'] } }
  });
  return User;
};
