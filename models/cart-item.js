'use strict';
module.exports = (sequelize,T) => {
  const Item = sequelize.define('CartItem',{
    id:{type:T.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false},
    cartId:{type:T.BIGINT.UNSIGNED,allowNull:false},productId:{type:T.INTEGER,allowNull:false},
    quantity:{type:T.INTEGER.UNSIGNED,allowNull:false,validate:{min:1}},
    createdAt:{type:T.DATE(3),allowNull:false},updatedAt:{type:T.DATE(3),allowNull:false},deletedAt:{type:T.DATE(3),allowNull:true}
  },{tableName:'cart_items',paranoid:true});
  Item.associate = ({Cart,Product}) => {
    Item.belongsTo(Cart,{as:'cart',foreignKey:'cartId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Item.belongsTo(Product,{as:'product',foreignKey:'productId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  };
  return Item;
};
