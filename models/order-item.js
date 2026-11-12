'use strict';
module.exports=(sequelize,T)=>{
  const Item=sequelize.define('OrderItem',{
    id:{type:T.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false},orderId:{type:T.BIGINT.UNSIGNED,allowNull:false},
    productId:{type:T.INTEGER,allowNull:false},productTitle:{type:T.STRING(255),allowNull:false},
    quantity:{type:T.INTEGER.UNSIGNED,allowNull:false},unitPrice:{type:T.DECIMAL(12,2),allowNull:false}
  },{tableName:'order_items',timestamps:false});
  Item.associate=({Order,Product})=>{
    Item.belongsTo(Order,{as:'order',foreignKey:'orderId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Item.belongsTo(Product,{as:'product',foreignKey:'productId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  };return Item;
};
