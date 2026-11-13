'use strict';
module.exports = (sequelize, T) => {
  const Cart = sequelize.define('Cart', {
    id: { type:T.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false },
    buyerId:{type:T.UUID,allowNull:false,unique:true},
    createdAt:{type:T.DATE(3),allowNull:false},updatedAt:{type:T.DATE(3),allowNull:false},deletedAt:{type:T.DATE(3),allowNull:true}
  },{tableName:'carts',paranoid:true});
  Cart.associate = ({Buyer,CartItem}) => {
    Cart.belongsTo(Buyer,{as:'buyer',foreignKey:'buyerId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Cart.hasMany(CartItem,{as:'items',foreignKey:'cartId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  };
  return Cart;
};
