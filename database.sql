CREATE DATABASE IF NOT EXISTS db_inventory
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE db_inventory;

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Jika tabel items sudah ada dari versi sebelumnya, jalankan file ini juga.
-- Struktur di atas tidak menghapus data lama.