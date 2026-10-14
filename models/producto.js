'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class producto extends Model {
    static associate(models) {
      // Relación muchos a muchos con categoría a través de categoriaproducto
      producto.belongsToMany(models.categoria, {
        as: 'categorias',
        through: 'categoriaproducto',
        foreignKey: 'productoid'
      });
      // Relación de pertenencia con archivo para la imagen
      producto.belongsTo(models.archivo, { foreignKey: 'archivoid' });
    }
  }

  producto.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    titulo: {
      type: DataTypes.STRING,
      defaultValue: 'Sin titulo'
    },
    descripcion: {
      type: DataTypes.TEXT,
      defaultValue: 'Sin descripcion'
    },
    precio: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    archivoid: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    freezeTableName: true,
    modelName: 'producto'
  });

  return producto;
};
