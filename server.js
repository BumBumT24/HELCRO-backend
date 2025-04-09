const dotenv = require('dotenv');
const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const pool = require("./config/db");

require('dotenv').config();
const path = require('path');

const IntakeLog = require('./models/IntakeLog');

// Create MySQL connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});
// Konfiguracja mailera
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false // <-- THIS is the key
    }
});
dotenv.config({
    path: path.resolve(__dirname, '../.env') // dostosuj ścieżkę
});


const API_BASE_URL = process.env.API_BASE_URL;
console.log('API_BASE_URL:', process.env.API_BASE_URL);
db.connect(err => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to MySQL');
});
// ===== DODANE NOWE ENDPOINTY ===== //

// Rejestracja użytkownika
app.post('/api/auth/register', async (req, res) => {

    const { UserName, Email, Password, Height, Weight, Gender } = req.body;

    try {
        // Sprawdź czy użytkownik już istnieje
        db.query('SELECT * FROM user WHERE Email = ? OR UserName = ?',
            [Email, UserName],
            async (err, results) => {
                if (err) throw err;

                if (results.length > 0) {
                    return res.status(400).json({ error: 'User arleady exists' });
                }

                // Hashowanie hasła
                const hashedPassword = await bcrypt.hash(Password, 10);

                // Dodanie nowego użytkownika
                db.query('INSERT INTO user SET ?',
                    { UserName, Email, Password: hashedPassword, Height, Weight, Gender },
                    (err, result) => {
                        if (err) throw err;
                        res.status(201).json({ message: 'Registration completed successfully!', UserId: result.insertId });
                    }
                );
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Logowanie użytkownika
app.post('/api/auth/login', async (req, res) => {
    const { Email, Password } = req.body;

    try {
        db.query('SELECT * FROM user WHERE Email = ?', [Email], async (err, results) => {
            if (err) throw err;

            if (results.length === 0) {
                return res.status(401).json({ error: 'Invalid login credentials.' });
            }

            const user = results[0];
            const isMatch = await bcrypt.compare(Password, user.Password);

            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid login credentials.' });
            }

            // Generowanie tokena JWT
            const token = jwt.sign(
                { id: user.UserId },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            // Zwróć pełne dane użytkownika
            res.json({
                message: 'Logged in successfully',
                token,
                user: {
                    UserId: user.UserId,
                    UserName: user.UserName,
                    Email: user.Email,
                    Height: user.Height,
                    Weight: user.Weight,
                    Gender: user.Gender
                }
            });

        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Middleware do weryfikacji tokena
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Przykładowy chroniony endpoint
// server.js - zaktualizowany endpoint
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.query('SELECT UserId, UserName, Email, Height, Weight, Gender FROM user WHERE UserId = ?',
        [req.user.id], // Zmienione z req.user.UserId na req.user.id
        (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json(results[0]);
        }
    );
});
// Serwowanie statycznej strony resetowania hasła
app.get('/reset-password', (req, res) => {
    const token = req.query.token;
    res.sendFile(path.join(__dirname, 'public/reset-password.html'));
});

// Endpoint do obsługi formularza
app.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    // 1. Walidacja hasła
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: 'The password must be at least 8 characters long.' });
    }

    try {
        // 2. Weryfikacja tokena JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Sprawdzenie w bazie (opcjonalne - dodatkowe zabezpieczenie)
        db.query(
            'SELECT UserId FROM user WHERE UserId = ? AND reset_token = ? AND reset_token_expires > NOW()',
            [decoded.UserId, token],
            async (err, results) => {
                if (err) {
                    console.error('Database error', err);
                    return res.status(500).json({ message: 'Server error' });
                }

                if (results.length === 0) {
                    return res.status(400).json({ message: 'Invalid or expired token.' });
                }

                // 4. Hashowanie nowego hasła
                const hashedPassword = await bcrypt.hash(newPassword, 10);

                // 5. Aktualizacja hasła w bazie
                db.query(
                    'UPDATE user SET Password = ?, reset_token = NULL, reset_token_expires = NULL WHERE UserId = ?',
                    [hashedPassword, decoded.UserId],
                    (err) => {
                        if (err) {
                            console.error('Password update error:', err);
                            return res.status(500).json({ message: 'Error during password reset' });
                        }

                        res.json({ message: 'The password has been successfully reset.' });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Błąd:', error);
        res.status(400).json({ message: 'Invalid or expired token.' });
    }
});

// Endpoint do wysłania linku resetującego
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    // 1. Walidacja emaila
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    try {
        // 2. Sprawdzenie czy użytkownik istnieje w bazie
        db.query('SELECT UserId, Email FROM user WHERE Email = ?', [email], async (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Server error' });
            }

            if (results.length === 0) {
                // Zwracamy informację, że email nie istnieje
                return res.status(404).json({ message: 'Invalid email' });
            }

            const user = results[0];

            // 3. Generowanie tokena resetującego
            const token = jwt.sign(
                { UserId: user.UserId },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            // 4. Tworzenie linku resetującego
            const resetUrl = API_BASE_URL + `/reset-password?token=${token}`;

            // 5. Konfiguracja i wysyłka emaila
            const mailOptions = {
                from: `"Helcro-Support" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Password reset - Helcro',
                html: `
                    <h2>Password Reset</h2>
                    <p>We received a request to reset the password for this email address.</p>
                    <p>Click the link below to reset your password:</p>
                    <a href="${resetUrl}" style="
                        display: inline-block;
                        padding: 10px 20px;
                        background-color: brown;
                        color: white;
                        text-decoration: none;
                        border-radius: 5px;
                        margin: 15px 0;
                    ">Reset Password</a>
                    <p>The link will be valid for 1 hour.</p>
                    <p>If you didn't request this, please ignore this message.</p>
                `
            };

            // 6. Wysłanie emaila
            transporter.sendMail(mailOptions, (error) => {
                if (error) {
                    console.error('Error sending email', error);
                    return res.status(500).json({ message: 'Error sending email' });
                }

                // 7. Zapis tokena w bazie (opcjonalne)
                db.query(
                    'UPDATE user SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE UserId = ?',
                    [token, user.UserId],
                    (err) => {
                        if (err) {
                            console.error('Error saving token:', err);
                            // Kontynuuj pomimo błędu - token JWT jest już wystarczający
                        }
                        res.json({ message: 'A password reset link has been sent to the provided email address.' });
                    }
                );
            });
        });
    } catch (error) {
        console.error('Błąd:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Endpoint do resetowania hasła
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    // 1. Walidacja hasła
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: 'The password must be at least 8 characters long.' });
    }

    try {
        // 2. Weryfikacja tokena JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Sprawdzenie w bazie (opcjonalne - dodatkowe zabezpieczenie)
        db.query(
            'SELECT UserId FROM user WHERE UserId = ? AND reset_token = ? AND reset_token_expires > NOW()',
            [decoded.UserId, token],
            async (err, results) => {
                if (err) {
                    console.error('Błąd bazy danych:', err);
                    return res.status(500).json({ message: 'Server error' });
                }

                if (results.length === 0) {
                    return res.status(400).json({ message: 'Invalid or expired token' });
                }

                // 4. Hashowanie nowego hasła
                const hashedPassword = await bcrypt.hash(newPassword, 10);

                // 5. Aktualizacja hasła w bazie
                db.query(
                    'UPDATE user SET Password = ?, reset_token = NULL, reset_token_expires = NULL WHERE UserId = ?',
                    [hashedPassword, decoded.UserId],
                    (err) => {
                        if (err) {
                            console.error('Password update error:', err);
                            return res.status(500).json({ message: 'Error during password reset' });
                        }

                        res.json({ message: 'The password has been successfully reset.' });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Błąd:', error);
        res.status(400).json({ message: 'Invalid or expired token' });
    }
});

// ===== KONIEC NOWYCH ENDPOINTÓW ===== //
// Sample endpoint to get data
app.get('/users', (req, res) => {
    db.query('SELECT * FROM user', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err });
        }
        res.json(results);
    });
});

app.get('/products', (req, res) => {
    db.query('SELECT * FROM product', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err });
        }
        res.json(results);
    });
});
// GET /intakeLog - Fetch IntakeLog for a user and date
app.get('/intakeLog', async (req, res) => {
    try {
        const { userId, date } = req.query;

        if (!userId || !date) {
            return res.status(400).json({ message: 'User ID and date are required' });
        }

        const intakeLog = await IntakeLog.findWithMealsAndProducts(userId, date);

        if (!intakeLog) {
            return res.status(200).json({ meals: [] }); // Return empty array if no data
        }

        // Return properly structured meals with all needed fields
        res.json({
            meals: intakeLog.meals.map(meal => ({
                id: meal.MealId,
                type: meal.MealType,
                name: meal.MealName,
                time: meal.createdAt || new Date().toISOString(), // Add fallback for time
                products: meal.products || []
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
// POST /intakeLog - Create or update IntakeLog
app.post('/intakeLog', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, date, mealType, mealName, products, mealId } = req.body;

        // Validate required fields
        if (!userId || !date || !mealType) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'userId, date, and mealType are required'
            });
        }

        await connection.beginTransaction();

        try {
            // 1. Find or create IntakeLog (enforce one log per user per date)
            let IntakeLogId;
            const [existingLog] = await connection.execute(
                'SELECT IntakeLogId FROM IntakeLog WHERE UserId = ? AND LogDate = ? FOR UPDATE',
                [userId, date]
            );

            if (existingLog.length > 0) {
                IntakeLogId = existingLog[0].IntakeLogId;
            } else {
                try {
                    const [intakeLogResult] = await connection.execute(
                        'INSERT INTO IntakeLog (UserId, LogDate) VALUES (?, ?)',
                        [userId, date]
                    );
                    IntakeLogId = intakeLogResult.insertId;
                } catch (error) {
                    // Handle case where unique constraint violation occurs (race condition)
                    if (error.code === 'ER_DUP_ENTRY') {
                        const [duplicateLog] = await connection.execute(
                            'SELECT IntakeLogId FROM IntakeLog WHERE UserId = ? AND LogDate = ?',
                            [userId, date]
                        );
                        IntakeLogId = duplicateLog[0].IntakeLogId;
                    } else {
                        throw error;
                    }
                }
            }

            // 2. Handle meal (create new or use existing)
            let MealId;
            const mealNameToUse = mealName || mealType;

            if (mealId) {
                // Update existing meal
                MealId = mealId;

                // Update meal name/type if needed
                await connection.execute(
                    'UPDATE Meal SET MealName = ?, MealType = ? WHERE MealId = ?',
                    [mealNameToUse, mealType, MealId]
                );

                // Clear existing products to avoid duplicates
                await connection.execute(
                    'DELETE FROM Meal_has_Product WHERE MealId = ?',
                    [MealId]
                );
            } else {
                // Create new meal
                const [mealResult] = await connection.execute(
                    'INSERT INTO Meal (MealName, MealType) VALUES (?, ?)',
                    [mealNameToUse, mealType]
                );
                MealId = mealResult.insertId;

                // Link meal to intake log
                await connection.execute(
                    'INSERT INTO IntakeLog_has_Meal (UserId, IntakeLogId, MealId) VALUES (?, ?, ?)',
                    [userId, IntakeLogId, MealId]
                );
            }

            // 3. Add products to meal with duplicate prevention
            for (const product of products) {
                // First check if product already exists (in case of retries)
                const [existingProduct] = await connection.execute(
                    'SELECT 1 FROM Meal_has_Product WHERE MealId = ? AND ProductId = ?',
                    [MealId, product.productId]
                );

                if (existingProduct.length === 0) {
                    await connection.execute(
                        'INSERT INTO Meal_has_Product (MealId, ProductId, grams) VALUES (?, ?, ?)',
                        [MealId, product.productId, product.grams || 100]
                    );
                } else {
                    // Update existing product entry if needed
                    await connection.execute(
                        'UPDATE Meal_has_Product SET grams = ? WHERE MealId = ? AND ProductId = ?',
                        [product.grams || 100, MealId, product.productId]
                    );
                }
            }

            await connection.commit();
            connection.release();

            res.status(201).json({
                success: true,
                IntakeLogId,
                MealId,
                mealType,
                mealName: mealNameToUse
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            console.error('Transaction error in /intakeLog:', error);
            res.status(500).json({
                success: false,
                message: 'Transaction failed',
                error: error.message
            });
        }
    } catch (error) {
        connection.release();
        console.error('Error in /intakeLog:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// PUT /intakeLog/:id - Update existing IntakeLog
app.put('/intakeLog/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;

        const success = await IntakeLog.updateProductsForIntakeLog(id, products);

        if (!success) {
            return res.status(404).json({ message: 'Intake log not found' });
        }

        res.json({ message: 'Intake log updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
/*
app.get('/receptury', (req, res) => {
    db.query('SELECT r.Nazwa AS NazwaReceptury, p.id AS ProduktID, p.product_name AS products, rhp.Ilosc AS Ilosc FROM Receptury_has_Produkty rhp JOIN products p ON rhp.Produkty_idProduktu = p.id JOIN Receptury r ON rhp.Receptury_idReceptury = r.idReceptury  -- Corrected column name here WHERE rhp.Receptury_idReceptury = 1;', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err });
        }
        res.json(results);
    });
});
*/
/*
async function fetchAndInsertProducts(page) {
    try {
        const response = await axios.get(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=&page=${page}&json=true`);
        const products = response.data.products;

        if (products && products.length > 0) {
            products.forEach(product => {
                const { product_name, nutriments, image_front_url } = product;
                if (!nutriments) return; // Skip if no nutrition data

                const query = `INSERT INTO product (product_name, proteins, fats, carbohydrates, sugars, fibers, salt, calories, image)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                db.query(query, [
                    product_name || "Unknown",
                    nutriments.proteins_100g || 0,
                    nutriments.fat_100g || 0,
                    nutriments.carbohydrates_100g || 0,
                    nutriments.sugars_100g || 0,
                    nutriments.fiber_100g || 0,
                    nutriments.salt_100g || 0, // Ensure this is in grams
                    nutriments["energy-kcal_100g"] || 0, // Correct calories field,
                    image_front_url || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg"

                ], (err, result) => {
                    if (err) {
                        console.error("Error inserting product into database:", err);
                    } else {
                        console.log(`Inserted product: ${product_name}`);
                    }
                });
            });
        }
    } catch (error) {
        console.error("Error fetching data from Open Food Facts:", error);
    }
}


async function fetchAndInsertMultiplePages(startPage, endPage) {
    for (let page = startPage; page <= endPage; page++) {
        console.log(`Fetching page ${page}...`);
        await fetchAndInsertProducts(page);
    }
    console.log(`END`);
}

fetchAndInsertMultiplePages(10, 20);//Od strony do Strony

fetchAndInsertProducts(1);
*/

app.listen(3000, "0.0.0.0", () => console.log('Server running on port 3000'));
