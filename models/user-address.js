'use strict';

module.exports = (sequelize, T) => {
  const Address = sequelize.define('UserAddress', {
    id: { type: T.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false,
      get() { const value = this.getDataValue('id'); return value == null ? value : String(value); } },
    buyerId: { type: T.UUID, allowNull: false },
    label: { type: T.STRING(40), allowNull: true },
    recipientName: { type: T.STRING(120), allowNull: false },
    street: { type: T.STRING(255), allowNull: false },
    exteriorNumber: { type: T.STRING(20), allowNull: false },
    interiorNumber: { type: T.STRING(20), allowNull: true },
    neighborhood: { type: T.STRING(120), allowNull: false },
    city: { type: T.STRING(120), allowNull: false },
    state: { type: T.STRING(120), allowNull: false },
    postalCode: { type: T.STRING(12), allowNull: false },
    country: { type: T.CHAR(2), allowNull: false, defaultValue: 'MX' },
    isDefault: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: T.DATE(3), allowNull: false },
    updatedAt: { type: T.DATE(3), allowNull: false },
    deletedAt: { type: T.DATE(3), allowNull: true }
  }, { tableName: 'user_addresses', paranoid: true });
  Address.associate = ({ Buyer }) => Address.belongsTo(Buyer, {
    as: 'buyer', foreignKey: 'buyerId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
  });
  return Address;
};
