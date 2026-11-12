// Independent fixture for the final account/catalog columns. No cutover migration is invoked.
const uuid = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';
const profile = `userId ${uuid} NOT NULL PRIMARY KEY, FOREIGN KEY (userId) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT`;

module.exports = `
CREATE TABLE users (
  id ${uuid} NOT NULL PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
  passwordHash VARCHAR(255) NOT NULL, phoneNumber VARCHAR(20) NULL,
  status ENUM('ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'ACTIVE', emailVerifiedAt DATETIME(3) NOT NULL,
  createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL, deletedAt DATETIME(3) NULL
) ENGINE=InnoDB;
CREATE TABLE admins (${profile}) ENGINE=InnoDB;
CREATE TABLE buyers (${profile}) ENGINE=InnoDB;
CREATE TABLE sellers (
  ${profile}, storeName VARCHAR(120) NOT NULL, status ENUM('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  requestedAt DATETIME(3) NOT NULL, reviewedAt DATETIME(3) NULL, reviewedByUserId ${uuid} NULL,
  rejectionReason VARCHAR(255) NULL, updatedAt DATETIME(3) NOT NULL,
  FOREIGN KEY (reviewedByUserId) REFERENCES admins(userId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE categories (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE, protected TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL, deletedAt DATETIME(3) NULL,
  CHECK (protected IN (0, 1))
) ENGINE=InnoDB;
CREATE TABLE products (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, sellerId ${uuid} NOT NULL, title VARCHAR(255) NOT NULL,
  description TEXT NULL, price DECIMAL(12,2) NOT NULL, stock INT UNSIGNED NOT NULL DEFAULT 0,
  imagePublicId VARCHAR(255) NULL, createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL, deletedAt DATETIME(3) NULL,
  CHECK (price >= 0), FOREIGN KEY (sellerId) REFERENCES sellers(userId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE product_categories (
  productId INT NOT NULL, categoryId INT NOT NULL, createdAt DATETIME(3) NOT NULL, deletedAt DATETIME(3) NULL,
  PRIMARY KEY (productId, categoryId),
  FOREIGN KEY (productId) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, actorUserId ${uuid} NULL, action VARCHAR(80) NOT NULL,
  targetType VARCHAR(40) NULL, targetId VARCHAR(64) NULL, ipAddress VARCHAR(45) NULL, outcome VARCHAR(16) NOT NULL,
  details JSON NULL, occurredAt DATETIME(3) NOT NULL,
  FOREIGN KEY (actorUserId) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
INSERT INTO users (id, email, name, passwordHash, emailVerifiedAt, createdAt, updatedAt) VALUES (
  '00000000-0000-4000-8000-000000000003', 'admin@example.invalid', 'Fixture admin',
  '$2b$12$hmnizYOPb1xBiBIQkYvRyOLPAhrU1mSWnV2pyV.79LHR8LlsuSk6O', NOW(3), NOW(3), NOW(3));
INSERT INTO admins (userId) VALUES ('00000000-0000-4000-8000-000000000003');
INSERT INTO categories (id, name, protected, createdAt, updatedAt) VALUES (1, 'Protected fixture', 1, NOW(3), NOW(3));
`;
