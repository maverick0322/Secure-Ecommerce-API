'use strict';

const { QueryTypes } = require('sequelize');

const USER_STATUS = "ENUM('ACTIVE','SUSPENDED','DISABLED')";
const SELLER_STATUS = "ENUM('PENDING','APPROVED','REJECTED','SUSPENDED')";
const ORDER_STATUS = "ENUM('PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED')";

function select(queryInterface, sql, replacements) {
  return queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

async function requireTarget(queryInterface) {
  const [server] = await select(queryInterface, `
    SELECT DATABASE() AS db, VERSION() AS version, @@session.sql_mode AS sqlMode,
           @@session.foreign_key_checks AS foreignKeyChecks`);

  if (server.db !== 'secure_ecommerce') {
    throw new Error('These migrations require the secure_ecommerce database.');
  }

  const version = /^8\.0\.(\d+)\b/.exec(server.version);
  if (!version || Number(version[1]) < 18 || /mariadb/i.test(server.version)) {
    throw new Error('These migrations require MySQL 8.0.18 or later in the 8.0 series.');
  }
  if (!/\bSTRICT_(TRANS|ALL)_TABLES\b/.test(server.sqlMode) || Number(server.foreignKeyChecks) !== 1) {
    throw new Error('Enable strict SQL mode and foreign_key_checks before migrating.');
  }
}

function characterOptions(column) {
  const { charset, collation } = column;
  if (!/^\w+$/.test(charset || '') || !/^\w+$/.test(collation || '')) {
    throw new Error('Expected a MySQL character set and collation for the existing text column.');
  }
  return `CHARACTER SET ${charset} COLLATE ${collation}`;
}

async function legacyUuid(queryInterface) {
  const [column] = await select(queryInterface, `
    SELECT COLUMN_TYPE AS columnType, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id'`);
  if (!column || column.columnType.toLowerCase() !== 'char(36)') {
    throw new Error('Expected users.id to be the normalized CHAR(36) primary key.');
  }
  return `CHAR(36) ${characterOptions(column)}`;
}

function foreignKey(name, column, parent, parentColumn) {
  return `CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${parent} (${parentColumn}) ON DELETE RESTRICT ON UPDATE RESTRICT`;
}

function alter(queryInterface, table, clauses) {
  return queryInterface.sequelize.query(`ALTER TABLE ${table}\n  ${clauses.join(',\n  ')}`);
}

function rejectUndo() {
  throw new Error('Automatic undo is disabled for the secure_ecommerce migrations. Review the applied DDL and the recovery plan.');
}

module.exports = { USER_STATUS, SELLER_STATUS, ORDER_STATUS, select, requireTarget, characterOptions, legacyUuid, foreignKey, alter, rejectUndo };
