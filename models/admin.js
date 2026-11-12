'use strict';

module.exports = (sequelize, DataTypes) => {
  const Admin = sequelize.define('Admin', {
    userId: { type: DataTypes.UUID, primaryKey: true, allowNull: false }
  }, { tableName: 'admins', timestamps: false });

  Admin.associate = ({ User }) => {
    Admin.belongsTo(User, { as: 'user', foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return Admin;
};
