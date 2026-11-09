'use strict';

const {
  rejectAutomaticSeedRemoval
} = require('../services/seed-data.service');
module.exports = {
  async up(queryInterface) {
    const categories = await queryInterface.select(null, 'categories', {});
    const products = await queryInterface.select(null, 'products', {});
    const links = await queryInterface.select(null, 'product_categories', {});
    const initialPairs = [['Televisores', 'Smart TV 55 Pulgadas 4K Ultra HD'], ['Celulares y tecnología', 'Smartphone 128GB Octa-Core'], ['Laptops', 'Laptop Ultrabook 16GB RAM SSD 512GB'], ['Electrodomésticos', 'Refrigerador Automático 11 Pies Cúbicos'], ['Hogar y muebles', 'Sillón Reclinable Ergonómico de Confort'], ['Moda', 'Chamarra Casual Térmica Impermeable'], ['Deportes', 'Bicicleta de Montaña R29 Aluminio'], ['Construcción', 'Taladro Rotomartillo Profesional 650W'], ['Oficina', 'Silla de Oficina Ejecutiva Ergonómica'], ['Juguetes', 'Set de Bloques de Construcción 500 Pzas'], ['Bebés', 'Carriola Plegable Ultra Ligera para Bebé'], ['Salud', 'Monitor de Presión Arterial Digital de Brazo'], ['Belleza', 'Kit Cuidado Facial con Ácido Hialurónico'], ['Videojuegos', 'Consola de Videojuegos 1TB Next-Gen'], ['Supermercado', 'Café de Altura Gourmet en Grano 1 Kg']];
    for (const [categoryName, productTitle] of initialPairs) {
      const category = categories.find(item => item.name === categoryName);
      const product = products.find(item => item.title === productTitle);
      if (!category || !product) continue;
      if (links.some(item => item.categoryId === category.id && item.productId === product.id)) continue;
      await queryInterface.bulkInsert('product_categories', [{
        categoryId: category.id,
        productId: product.id,
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
