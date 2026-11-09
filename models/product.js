'use strict';

const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      // Relación muchos a muchos con categoría a través de product_categories
      Product.belongsToMany(models.Category, {
        as: "categories",
        through: models.ProductCategory,
        foreignKey: "productId",
        otherKey: "categoryId"
      });
      // Relación de pertenencia con archivo para la imagen
      Product.belongsTo(models.File, {
        as: 'file',
        foreignKey: "fileId"
      });
    }
  }
  Product.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      defaultValue: 'Sin titulo'
    },
    description: {
      type: DataTypes.TEXT,
      defaultValue: 'Sin descripcion'
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    fileId: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    freezeTableName: true,
    modelName: 'Product',
    tableName: 'products'
  });
  return Product;
};
