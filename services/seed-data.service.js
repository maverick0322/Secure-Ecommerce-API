'use strict';

// Los datos iniciales completan una base nueva sin modificar registros existentes.
async function insertMissingRecords(queryInterface, Sequelize, tableName, records, identityFields) {
  const [target] = await queryInterface.sequelize.query('SELECT DATABASE() AS db', {type:Sequelize.QueryTypes.SELECT});
  if(target.db==='secure_ecommerce') throw new Error('Historical seeders are forbidden on secure_ecommerce.');
  for (const record of records) {
    const identities = identityFields.map(field => ({ [field]: record[field] }));
    if (record.id !== undefined) identities.push({ id: record.id });
    const existing = await queryInterface.select(null, tableName, {
      where: { [Sequelize.Op.or]: identities }, limit: 1
    });
    if (existing.length === 0) {
      await queryInterface.bulkInsert(tableName, [record], { ignoreDuplicates: true });
    }
  }
}

function rejectAutomaticSeedRemoval() {
  throw new Error('La reversión automática de datos iniciales está deshabilitada para preservar registros y contraseñas existentes. Revise los registros manualmente.');
}

module.exports = { insertMissingRecords, rejectAutomaticSeedRemoval };
