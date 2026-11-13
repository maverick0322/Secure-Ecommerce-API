'use strict';

module.exports = (sequelize, DataTypes) => {
  const Buyer = sequelize.define('Buyer', {
    userId: { type: DataTypes.UUID, primaryKey: true, allowNull: false }
  }, { tableName: 'buyers', timestamps: false });

  Buyer.associate = ({ User }) => {
    Buyer.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return Buyer;
};
