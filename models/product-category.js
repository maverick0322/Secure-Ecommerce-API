'use strict';

module.exports = (sequelize, DataTypes) => {
  const ProductCategory = sequelize.define('ProductCategory', {
    productId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    categoryId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    deletedAt: { type: DataTypes.DATE(3), allowNull: true }
  }, { tableName: 'product_categories', paranoid: true, updatedAt: false });

  ProductCategory.associate = ({ Product, Category }) => {
    ProductCategory.belongsTo(Product, { as: 'product', foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    ProductCategory.belongsTo(Category, { as: 'category', foreignKey: 'categoryId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return ProductCategory;
};
