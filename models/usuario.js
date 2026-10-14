'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class usuario extends Model {
    static associate(models) {
      usuario.belongsTo(models.rol, { foreignKey: 'rolid' });
    }
  }

  usuario.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    passwordhash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: false
    },
    protegido: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    rolid: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    sequelize,
    freezeTableName: true,
    modelName: 'usuario'
  });

  return usuario;
};
