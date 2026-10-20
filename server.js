const express = require('express');
const mysql = require('mysql2');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'db_inventory'
});

db.connect((err) => {
  if (err) {
    console.error('MySQL connection failed:', err.message);
    process.exit(1);
  }
  console.log('✓ Stockify Pro connected to MySQL');
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function validateItem(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const quantity = Number(body.quantity);
  const price = Number(body.price);

  if (!name || name.length > 100 || !category || category.length > 50) {
    return { error: 'Nama barang (maks. 100 karakter) dan kategori (maks. 50 karakter) wajib diisi.' };
  }
  if (body.quantity === '' || body.quantity === undefined ||
      !Number.isInteger(quantity) || quantity < 0) {
    return { error: 'Stok harus berupa bilangan bulat minimal 0.' };
  }
  if (body.price === '' || body.price === undefined ||
      !Number.isFinite(price) || price < 0) {
    return { error: 'Harga harus berupa angka minimal 0.' };
  }
  return { value: { name, category, quantity, price } };
}

function showError(res, message, status = 400) {
  return res.status(status).render('error', { message });
}

// Dashboard: search + category filter + sort + statistics
app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const sortOptions = {
    newest: 'id DESC',
    oldest: 'id ASC',
    name: 'name ASC',
    stock_asc: 'quantity ASC',
    stock_desc: 'quantity DESC',
    value_desc: '(quantity * price) DESC'
  };
  const sort = sortOptions[req.query.sort] ? req.query.sort : 'newest';

  let sql = 'SELECT * FROM items WHERE 1=1';
  const params = [];
  if (q) {
    sql += ' AND (name LIKE ? OR category LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ` ORDER BY ${sortOptions[sort]}`;

  db.query(sql, params, (err, items) => {
    if (err) {
      console.error(err);
      return showError(res, 'Data inventaris gagal dimuat.', 500);
    }

    const statsSql = `
      SELECT COUNT(*) AS kinds,
             COALESCE(SUM(quantity), 0) AS units,
             COALESCE(SUM(quantity * price), 0) AS worth,
             COALESCE(SUM(CASE WHEN quantity <= 5 THEN 1 ELSE 0 END), 0) AS lowStock
      FROM items`;

    db.query(statsSql, (statsErr, statRows) => {
      if (statsErr) {
        console.error(statsErr);
        return showError(res, 'Statistik inventaris gagal dimuat.', 500);
      }

      db.query('SELECT DISTINCT category FROM items ORDER BY category ASC', (catErr, catRows) => {
        if (catErr) {
          console.error(catErr);
          return showError(res, 'Kategori gagal dimuat.', 500);
        }
        res.render('index', {
          items,
          q,
          category,
          sort,
          categories: catRows.map(row => row.category),
          stats: statRows[0]
        });
      });
    });
  });
});

// CSV export respects current search/category filters
app.get('/export', (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  let sql = 'SELECT id, name, category, quantity, price, (quantity * price) AS total_value, created_at FROM items WHERE 1=1';
  const params = [];
  if (q) {
    sql += ' AND (name LIKE ? OR category LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY id DESC';

  db.query(sql, params, (err, rows) => {
    if (err) return showError(res, 'Gagal mengekspor data.', 500);
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['ID', 'Nama Barang', 'Kategori', 'Stok', 'Harga', 'Nilai Stok', 'Tanggal Dibuat'];
    const lines = [header, ...rows.map(row => [
      row.id, row.name, row.category, row.quantity, row.price, row.total_value, row.created_at
    ])].map(row => row.map(escapeCsv).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stockify-inventory.csv"');
    res.send('\uFEFF' + lines.join('\r\n'));
  });
});

app.get('/add', (req, res) => res.render('add', { error: null, form: {} }));

app.post('/add', (req, res) => {
  const parsed = validateItem(req.body);
  if (parsed.error) return res.status(400).render('add', { error: parsed.error, form: req.body });
  const { name, category, quantity, price } = parsed.value;
  db.query(
    'INSERT INTO items (name, category, quantity, price) VALUES (?, ?, ?, ?)',
    [name, category, quantity, price],
    err => {
      if (err) {
        console.error(err);
        return showError(res, 'Barang gagal disimpan ke database.', 500);
      }
      res.redirect('/');
    }
  );
});

app.get('/edit/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return showError(res, 'ID barang tidak valid.');
  db.query('SELECT * FROM items WHERE id = ?', [id], (err, rows) => {
    if (err) return showError(res, 'Data barang gagal dimuat.', 500);
    if (!rows.length) return showError(res, 'Barang tidak ditemukan.', 404);
    res.render('edit', { item: rows[0], error: null });
  });
});

app.post('/edit/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return showError(res, 'ID barang tidak valid.');
  const parsed = validateItem(req.body);
  if (parsed.error) return res.status(400).render('edit', { item: { id, ...req.body }, error: parsed.error });

  const { name, category, quantity, price } = parsed.value;
  db.query(
    'UPDATE items SET name=?, category=?, quantity=?, price=? WHERE id=?',
    [name, category, quantity, price, id],
    (err, result) => {
      if (err) return showError(res, 'Barang gagal diperbarui.', 500);
      if (!result.affectedRows) {
        return db.query('SELECT id FROM items WHERE id=?', [id], (checkErr, rows) => {
          if (checkErr) return showError(res, 'Gagal memeriksa data barang.', 500);
          if (!rows.length) return showError(res, 'Barang tidak ditemukan.', 404);
          res.redirect('/');
        });
      }
      res.redirect('/');
    }
  );
});

app.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return showError(res, 'ID barang tidak valid.');
  db.query('DELETE FROM items WHERE id=?', [id], (err, result) => {
    if (err) return showError(res, 'Barang gagal dihapus.', 500);
    if (!result.affectedRows) return showError(res, 'Barang tidak ditemukan.', 404);
    res.redirect('/');
  });
});

app.use((req, res) => showError(res, 'Halaman yang kamu cari tidak ditemukan.', 404));

app.listen(PORT, () => {
  console.log('────────────────────────────────────');
  console.log('  STOCKIFY PRO · INVENTORY STUDIO');
  console.log(`  http://localhost:${PORT}`);
  console.log('────────────────────────────────────');
});

process.on('SIGINT', () => db.end(() => process.exit(0)));