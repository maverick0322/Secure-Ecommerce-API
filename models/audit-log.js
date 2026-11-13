'use strict';
module.exports=(sequelize,T)=>{
  const immutable=()=>{throw new Error('Audit logs are append-only.');};
  const Audit=sequelize.define('AuditLog',{
    id:{type:T.INTEGER,autoIncrement:true,primaryKey:true,allowNull:false},
    actorUserId:{type:T.UUID,allowNull:true},action:{type:T.STRING(80),allowNull:false},
    targetType:{type:T.STRING(40),allowNull:true},targetId:{type:T.STRING(64),allowNull:true},
    ipAddress:{type:T.STRING(45),allowNull:true},outcome:{type:T.STRING(16),allowNull:false},
    details:{type:T.JSON,allowNull:true},occurredAt:{type:T.DATE(3),allowNull:false}
  },{tableName:'audit_logs',timestamps:false,hooks:{beforeUpdate:immutable,beforeBulkUpdate:immutable,beforeDestroy:immutable,beforeBulkDestroy:immutable}});
  Audit.associate=({User})=>Audit.belongsTo(User,{as:'actor',foreignKey:'actorUserId',onDelete:'RESTRICT',onUpdate:'RESTRICT'});
  return Audit;
};
