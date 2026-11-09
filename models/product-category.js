'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductCategory extends Model {}

  ProductCategory.init({
    categoryId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    productId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true }
  }, {
    sequelize,
    modelName: 'ProductCategory',
    tableName: 'product_categories',
    freezeTableName: true
  });

  return ProductCategory;
};
