'use strict';

const {
  insertMissingRecords,
  rejectAutomaticSeedRemoval
} = require('../services/seed-data.service');
module.exports = {
  async up(queryInterface, Sequelize) {
    await insertMissingRecords(queryInterface, Sequelize, 'categories', [{
      id: 1,
      name: 'Televisores',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 2,
      name: 'Celulares y tecnología',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 3,
      name: 'Laptops',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 4,
      name: 'Electrodomésticos',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 5,
      name: 'Hogar y muebles',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 6,
      name: 'Moda',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 7,
      name: 'Deportes',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 8,
      name: 'Construcción',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 9,
      name: 'Oficina',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 10,
      name: 'Juguetes',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 11,
      name: 'Bebés',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 12,
      name: 'Salud',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 13,
      name: 'Belleza',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 14,
      name: 'Videojuegos',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 15,
      name: 'Supermercado',
      protected: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }], ['name']);
  },
  async down() {
    rejectAutomaticSeedRemoval();
  }
};
