-- =====================================================================
-- Script de Creación de Base de Datos y Usuario para la API E-Commerce
-- Práctica: Backend API en Node.js (Universidad Veracruzana)
-- Base de Datos: mercadolibrenode
-- =====================================================================

-- 1. Eliminar y crear la base de datos con soporte completo para UTF-8 (emojis, acentos, ñ)
DROP DATABASE IF EXISTS mercadolibrenode; 
CREATE DATABASE mercadolibrenode CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mercadolibrenode; 

-- 2. Crear usuario de aplicación para conexión desde Node.js (local y remota/red LAN/Docker)
CREATE USER IF NOT EXISTS 'mercadolibre_user'@'localhost' IDENTIFIED BY 'M3rc@d0';
CREATE USER IF NOT EXISTS 'mercadolibre_user'@'%' IDENTIFIED BY 'M3rc@d0';

-- 3. Asignar privilegios completos sobre la base de datos de la aplicación
GRANT ALL ON mercadolibrenode.* TO 'mercadolibre_user'@'localhost';
GRANT ALL ON mercadolibrenode.* TO 'mercadolibre_user'@'%';

-- 4. Aplicar los cambios de privilegios
FLUSH PRIVILEGES;

-- 5. Consulta para verificar los privilegios asignados
SHOW GRANTS FOR 'mercadolibre_user'@'localhost';
SHOW GRANTS FOR 'mercadolibre_user'@'%';
