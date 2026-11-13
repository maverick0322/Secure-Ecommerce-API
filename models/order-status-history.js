'use strict';
module.exports=(sequelize,T)=>{
  const states=['PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED'];
  const History=sequelize.define('OrderStatusHistory',{
    id:{type:T.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true,allowNull:false},orderId:{type:T.BIGINT.UNSIGNED,allowNull:false},
    previousStatus:{type:T.ENUM(...states),allowNull:true},newStatus:{type:T.ENUM(...states),allowNull:false},
    changedByUserId:{type:T.UUID,allowNull:true},reason:{type:T.STRING(255),allowNull:true},occurredAt:{type:T.DATE(3),allowNull:false}
  },{tableName:'order_status_history',timestamps:false});
  History.associate=({Order,User})=>{
    History.belongsTo(Order,{as:'order',foreignKey:'orderId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
    History.belongsTo(User,{as:'actor',foreignKey:'changedByUserId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  };return History;
};
