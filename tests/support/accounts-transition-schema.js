// Fixture for the disposable Stage 3A server only. No migration is run by this suite.
const uuid = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';
const audit = 'FOREIGN KEY (actorUserId) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT';
const profile = `userId ${uuid} NOT NULL PRIMARY KEY,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT`;

module.exports = `
CREATE TABLE roles (
  id ${uuid} NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
) ENGINE=InnoDB;
CREATE TABLE users (
  id ${uuid} NOT NULL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, passwordHash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL, protected TINYINT(1) DEFAULT 0, roleId ${uuid} NOT NULL,
  createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
  phoneNumber VARCHAR(20) NULL, status ENUM('ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  emailVerifiedAt DATETIME(3) NULL, deletedAt DATETIME(3) NULL,
  FOREIGN KEY (roleId) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
CREATE TABLE admins (${profile}) ENGINE=InnoDB;
CREATE TABLE buyers (${profile}) ENGINE=InnoDB;
CREATE TABLE sellers (
  ${profile}, storeName VARCHAR(120) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  requestedAt DATETIME(3) NOT NULL, reviewedAt DATETIME(3) NULL, reviewedByUserId ${uuid} NULL,
  rejectionReason VARCHAR(255) NULL, updatedAt DATETIME(3) NOT NULL,
  FOREIGN KEY (reviewedByUserId) REFERENCES admins(userId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, action VARCHAR(255) NOT NULL, elementId VARCHAR(255) NULL,
  ip VARCHAR(255) NOT NULL, \`user\` VARCHAR(255) NOT NULL, date DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
  actorUserId ${uuid} NULL, targetType VARCHAR(40) NULL, targetId VARCHAR(64) NULL, ipAddress VARCHAR(45) NULL,
  outcome VARCHAR(16) NULL, details JSON NULL, occurredAt DATETIME(3) NULL, ${audit}
) ENGINE=InnoDB;
INSERT INTO roles (id, name, createdAt, updatedAt) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Usuario', NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000002', 'Administrador', NOW(), NOW());
INSERT INTO users (id, email, passwordHash, name, roleId, emailVerifiedAt, createdAt, updatedAt) VALUES
  ('00000000-0000-4000-8000-000000000003', 'admin@example.invalid',
   '$2b$12$hmnizYOPb1xBiBIQkYvRyOLPAhrU1mSWnV2pyV.79LHR8LlsuSk6O', 'Fixture admin',
   '00000000-0000-4000-8000-000000000002', NOW(3), NOW(), NOW());
INSERT INTO admins (userId) VALUES ('00000000-0000-4000-8000-000000000003');
`;
