'use strict';

const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class AuditLog extends Model {
    static associate(models) {
      // Sin asociaciones foráneas estrictas para permitir bitácora histórica inmutable
    }
  }
  AuditLog.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false
    },
    elementId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: false
    },
    user: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    freezeTableName: true,
    modelName: 'AuditLog',
    tableName: 'audit_logs'
  });
  return AuditLog;
};
