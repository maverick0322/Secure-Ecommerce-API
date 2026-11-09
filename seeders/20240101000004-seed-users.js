'use strict';

const bcrypt = require('bcrypt');
const {
  insertMissingRecords,
  rejectAutomaticSeedRemoval
} = require('../services/seed-data.service');
module.exports = {
  async up(queryInterface, Sequelize) {
    const adminRoleId = '09e30209-acbf-4391-baea-c719dd271c5f';
    const userRoleId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    await insertMissingRecords(queryInterface, Sequelize, 'roles', [{
      id: adminRoleId,
      name: 'Administrador',
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: userRoleId,
      name: 'Usuario',
      createdAt: new Date(),
      updatedAt: new Date()
    }], ['name']);
    const roles = await queryInterface.select(null, 'roles', {});
    const initialUsers = [{
      id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
      email: 'gvera@uv.mx',
      name: 'Guillermo Vera',
      role: 'Administrador',
      protected: true
    }, {
      id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf7',
      email: 'patito@uv.mx',
      name: 'Usuario Patito',
      role: 'Usuario',
      protected: false
    }];
    for (const {
      role: roleName,
      ...user
    } of initialUsers) {
      const role = roles.find(item => item.name === roleName);
      if (!role) throw new Error(`No se encontró el rol inicial ${roleName}; revise los datos existentes.`);
      const existing = await queryInterface.select(null, 'users', {
        where: {
          [Sequelize.Op.or]: [{
            id: user.id
          }, {
            email: user.email
          }]
        },
        limit: 1
      });
      if (existing.length > 0) continue;
      // La contraseña de demostración solo se asigna al crear un usuario faltante.
      await queryInterface.bulkInsert('users', [{
        ...user,
        roleId: role.id,
        passwordHash: await bcrypt.hash('patito', 10),
        createdAt: new Date(),
        updatedAt: new Date()
      }], {
        ignoreDuplicates: true
      });
    }
  },
  async down() {
    rejectAutomaticSeedRemoval();
  }
};
