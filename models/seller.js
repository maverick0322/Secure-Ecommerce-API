'use strict';

module.exports = (sequelize, DataTypes) => {
  const Seller = sequelize.define('Seller', {
    userId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    storeName: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'), allowNull: false, defaultValue: 'PENDING' },
    requestedAt: { type: DataTypes.DATE(3), allowNull: false },
    reviewedAt: { type: DataTypes.DATE(3), allowNull: true },
    reviewedByUserId: { type: DataTypes.UUID, allowNull: true },
    rejectionReason: { type: DataTypes.STRING(255), allowNull: true },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false }
  }, { tableName: 'sellers', createdAt: false });

  Seller.associate = ({ User, Admin }) => {
    Seller.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    Seller.belongsTo(Admin, { as: 'reviewedBy', foreignKey: 'reviewedByUserId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return Seller;
};
