'use strict';

const {
  insertMissingRecords,
  rejectAutomaticSeedRemoval
} = require('../services/seed-data.service');
module.exports = {
  async up(queryInterface, Sequelize) {
    await insertMissingRecords(queryInterface, Sequelize, 'products', [{
      id: 1,
      title: 'Smart TV 55 Pulgadas 4K Ultra HD',
      description: 'Televisor LED 4K UHD con HDR y aplicaciones de streaming integradas',
      price: 8999.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 2,
      title: 'Smartphone 128GB Octa-Core',
      description: 'Teléfono inteligente con cámara triple de 64MP y pantalla AMOLED de 120Hz',
      price: 5499.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 3,
      title: 'Laptop Ultrabook 16GB RAM SSD 512GB',
      description: 'Laptop ultradelgada con procesador de última generación para trabajo y desarrollo',
      price: 15999.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 4,
      title: 'Refrigerador Automático 11 Pies Cúbicos',
      description: 'Refrigerador con despachador de agua exterior y tecnología de ahorro inverter',
      price: 9800.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 5,
      title: 'Sillón Reclinable Ergonómico de Confort',
      description: 'Sillón tapizado en tela transpirable con soporte lumbar para descanso óptimo',
      price: 3200.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 6,
      title: 'Chamarra Casual Térmica Impermeable',
      description: 'Chamarra ligera resistente al viento y lluvia con forro interior térmico',
      price: 799.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 7,
      title: 'Bicicleta de Montaña R29 Aluminio',
      description: 'Bicicleta de 21 velocidades con frenos de disco hidráulicos y suspensión delantera',
      price: 4500.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 8,
      title: 'Taladro Rotomartillo Profesional 650W',
      description: 'Herramienta de perforación con velocidad variable, modo reversible y estuche',
      price: 850.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 9,
      title: 'Silla de Oficina Ejecutiva Ergonómica',
      description: 'Silla con respaldo de malla transpirable, soporte lumbar y brazos ajustables',
      price: 1999.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 10,
      title: 'Set de Bloques de Construcción 500 Pzas',
      description: 'Juguete didáctico y educativo para estimulación creativa infantil',
      price: 450.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 11,
      title: 'Carriola Plegable Ultra Ligera para Bebé',
      description: 'Carriola compacta con arnés de 5 puntos y toldo con protección solar UPF50',
      price: 2100.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 12,
      title: 'Monitor de Presión Arterial Digital de Brazo',
      description: 'Baumanómetro digital automático con detector de arritmias y memoria dual',
      price: 620.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 13,
      title: 'Kit Cuidado Facial con Ácido Hialurónico',
      description: 'Tratamiento completo con limpiador, sérum hidratante y protector solar FPS 50+',
      price: 890.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 14,
      title: 'Consola de Videojuegos 1TB Next-Gen',
      description: 'Sistema de entretenimiento con gráficos en 4K y control inalámbrico de alta precisión',
      price: 11499.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: 15,
      title: 'Café de Altura Gourmet en Grano 1 Kg',
      description: 'Café 100% arábica de estricta altura cosechado en Coatepec, Veracruz',
      price: 280.00,
      fileId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }], ['title']);
  },
  async down() {
    rejectAutomaticSeedRemoval();
  }
};
