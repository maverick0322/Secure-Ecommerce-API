'use strict';

module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    protected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false },
    deletedAt: { type: DataTypes.DATE(3), allowNull: true }
  }, { tableName: 'categories', paranoid: true });

  Category.associate = ({ Product, ProductCategory }) => {
    Category.belongsToMany(Product, { as: 'products', through: { model: ProductCategory, unique: false },
      foreignKey: 'categoryId', otherKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  };
  return Category;
};
