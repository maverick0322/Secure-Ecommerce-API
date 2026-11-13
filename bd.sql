-- Bootstrap for the legacy schema on a fresh MySQL data directory.
-- Account provisioning is performed separately by a MySQL administrator.
CREATE DATABASE IF NOT EXISTS `mercadolibrenode`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
