'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('producto', [
      {
        id: 1,
        titulo: 'Smart TV 55 Pulgadas 4K Ultra HD',
        descripcion: 'Televisor LED 4K UHD con HDR y aplicaciones de streaming integradas',
        precio: 8999.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 2,
        titulo: 'Smartphone 128GB Octa-Core',
        descripcion: 'Teléfono inteligente con cámara triple de 64MP y pantalla AMOLED de 120Hz',
        precio: 5499.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 3,
        titulo: 'Laptop Ultrabook 16GB RAM SSD 512GB',
        descripcion: 'Laptop ultradelgada con procesador de última generación para trabajo y desarrollo',
        precio: 15999.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 4,
        titulo: 'Refrigerador Automático 11 Pies Cúbicos',
        descripcion: 'Refrigerador con despachador de agua exterior y tecnología de ahorro inverter',
        precio: 9800.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 5,
        titulo: 'Sillón Reclinable Ergonómico de Confort',
        descripcion: 'Sillón tapizado en tela transpirable con soporte lumbar para descanso óptimo',
        precio: 3200.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 6,
        titulo: 'Chamarra Casual Térmica Impermeable',
        descripcion: 'Chamarra ligera resistente al viento y lluvia con forro interior térmico',
        precio: 799.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 7,
        titulo: 'Bicicleta de Montaña R29 Aluminio',
        descripcion: 'Bicicleta de 21 velocidades con frenos de disco hidráulicos y suspensión delantera',
        precio: 4500.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 8,
        titulo: 'Taladro Rotomartillo Profesional 650W',
        descripcion: 'Herramienta de perforación con velocidad variable, modo reversible y estuche',
        precio: 850.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 9,
        titulo: 'Silla de Oficina Ejecutiva Ergonómica',
        descripcion: 'Silla con respaldo de malla transpirable, soporte lumbar y brazos ajustables',
        precio: 1999.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 10,
        titulo: 'Set de Bloques de Construcción 500 Pzas',
        descripcion: 'Juguete didáctico y educativo para estimulación creativa infantil',
        precio: 450.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 11,
        titulo: 'Carriola Plegable Ultra Ligera para Bebé',
        descripcion: 'Carriola compacta con arnés de 5 puntos y toldo con protección solar UPF50',
        precio: 2100.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 12,
        titulo: 'Monitor de Presión Arterial Digital de Brazo',
        descripcion: 'Baumanómetro digital automático con detector de arritmias y memoria dual',
        precio: 620.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 13,
        titulo: 'Kit Cuidado Facial con Ácido Hialurónico',
        descripcion: 'Tratamiento completo con limpiador, sérum hidratante y protector solar FPS 50+',
        precio: 890.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 14,
        titulo: 'Consola de Videojuegos 1TB Next-Gen',
        descripcion: 'Sistema de entretenimiento con gráficos en 4K y control inalámbrico de alta precisión',
        precio: 11499.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 15,
        titulo: 'Café de Altura Gourmet en Grano 1 Kg',
        descripcion: 'Café 100% arábica de estricta altura cosechado en Coatepec, Veracruz',
        precio: 280.00,
        archivoid: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('producto', null, {});
  }
};
