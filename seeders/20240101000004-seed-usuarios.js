'use strict';
const bcrypt = require('bcrypt');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // UUIDs deterministas para mantener estabilidad referencial
    const adminRolId = '09e30209-acbf-4391-baea-c719dd271c5f';
    const usuarioRolId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

    // 1. Inserción de Roles
    await queryInterface.bulkInsert('rol', [
      {
        id: adminRolId,
        nombre: 'Administrador',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: usuarioRolId,
        nombre: 'Usuario',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // 2. Hash criptográfico seguro con factor de costo 10 para la contraseña 'patito'
    const passwordHash = await bcrypt.hash('patito', 10);

    // 3. Inserción de Usuarios iniciales requeridos por el PDF
    await queryInterface.bulkInsert('usuario', [
      {
        id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        email: 'gvera@uv.mx',
        passwordhash: passwordHash,
        nombre: 'Guillermo Vera',
        rolid: adminRolId,
        protegido: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf7',
        email: 'patito@uv.mx',
        passwordhash: passwordHash,
        nombre: 'Usuario Patito',
        rolid: usuarioRolId,
        protegido: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('usuario', null, {});
    await queryInterface.bulkDelete('rol', null, {});
  }
};
