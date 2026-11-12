'use strict';

module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define('Product', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    sellerId: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, validate: { min: 0 } },
    stock: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    imagePublicId: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false },
    deletedAt: { type: DataTypes.DATE(3), allowNull: true }
  }, { tableName: 'products', paranoid: true });

  Product.associate = ({ Seller, Category, ProductCategory }) => {
    Product.belongsTo(Seller, { as: 'seller', foreignKey: 'sellerId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    Product.belongsToMany(Category, { as: 'categories', through: { model: ProductCategory, unique: false },
      foreignKey: 'productId', otherKey: 'categoryId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return Product;
};
