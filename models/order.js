'use strict';
module.exports=(sequelize,T)=>{
  const Order=sequelize.define('Order',{
    id:{type:T.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false},
    buyerId:{type:T.UUID,allowNull:false},sellerId:{type:T.UUID,allowNull:false},checkoutId:{type:T.UUID,allowNull:false},
    status:{type:T.ENUM('PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED'),allowNull:false,defaultValue:'PENDING'},
    total:{type:T.DECIMAL(12,2),allowNull:false},deliveryAddressSnapshot:{type:T.JSON,allowNull:false},
    createdAt:{type:T.DATE(3),allowNull:false},updatedAt:{type:T.DATE(3),allowNull:false}
  },{tableName:'orders'});
  Order.associate=({Buyer,Seller,OrderItem,OrderStatusHistory})=>{
    Order.belongsTo(Buyer,{as:'buyer',foreignKey:'buyerId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Order.belongsTo(Seller,{as:'seller',foreignKey:'sellerId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Order.hasMany(OrderItem,{as:'items',foreignKey:'orderId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    Order.hasMany(OrderStatusHistory,{as:'history',foreignKey:'orderId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  };return Order;
};
