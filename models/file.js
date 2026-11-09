'use strict';

const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class File extends Model {
    static associate(models) {
      // Relación uno a muchos: un archivo puede ser la imagen de varios productos
      // Clave foránea corregida a 'fileId' en la tabla products
      File.hasMany(models.Product, {
        as: 'products',
        foreignKey: "fileId"
      });
    }
  }
  File.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    mime: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    storedInDatabase: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    data: {
      type: DataTypes.BLOB('long'),
      allowNull: true
    }
  }, {
    sequelize,
    freezeTableName: true,
    modelName: 'File',
    tableName: 'files'
  });
  return File;
};
