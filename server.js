const dotenv = require('dotenv');
const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Weight = require('./models/Weight');
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const pool = require("./config/db");

require('dotenv').config();
const path = require('path');

const IntakeLog = require('./models/IntakeLog');

const uploadRoutes = require('./routes/uploadRoutes');
app.use('/api', uploadRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create MySQL connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
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


app.get('/api/recipes/rating', async (req, res) => {
    const { recipeId, userId } = req.query;
    
    try {
        const [ratings] = await pool.execute(
            `SELECT Rating, Comment 
             FROM RecipeRating 
             WHERE RecipeId = ? AND UserId = ?`,
            [recipeId, userId]
        );
        
        res.json({
            rating: ratings[0] || null
        });
    } catch (error) {
        console.error('Get rating error:', error);
        res.status(500).json({ error: 'Failed to get rating' });
    }
});

// Dodaj/aktualizuj ocenę
app.post('/api/recipes/rate', async (req, res) => {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
  
      const { recipeId, userId, rating, comment } = req.body;
  
      // 1. Dodaj/aktualizuj ocenę
      await connection.execute(
        `INSERT INTO RecipeRating (RecipeId, UserId, Rating, Comment)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         Rating = VALUES(Rating), Comment = VALUES(Comment)`,
        [recipeId, userId, rating, comment]
      );
  
      // 2. Oblicz nową średnią
      const [avgResult] = await connection.execute(
        `SELECT AVG(Rating) as averageRating, COUNT(*) as ratingCount
         FROM RecipeRating
         WHERE RecipeId = ?`,
        [recipeId]
      );
  
      // 3. Zaktualizuj przepis
      await connection.execute(
        `UPDATE Recipe
         SET AverageRating = ?, RatingCount = ?
         WHERE RecipeId = ?`,
        [
          parseFloat(avgResult[0].averageRating).toFixed(1),
          avgResult[0].ratingCount,
          recipeId
        ]
      );
  
      await connection.commit();
  
      res.json({
        success: true,
        averageRating: parseFloat(avgResult[0].averageRating).toFixed(1),
        ratingCount: avgResult[0].ratingCount,
        userRating: rating // Dodajemy ocenę użytkownika w odpowiedzi
      });
  
    } catch (error) {
      if (connection) await connection.rollback();
      console.error('Rating error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to rate recipe'
      });
    } finally {
      if (connection) connection.release();
    }
  });

// Usuń ocenę
app.delete('/api/recipes/rating', async (req, res) => {
    const { recipeId, userId } = req.body;
    let connection;

    try {
        connection = await pool.getConnection(); // <-- get a connection

        await connection.beginTransaction();
        
        // 1. Usuń ocenę
        await connection.execute(
            `DELETE FROM RecipeRating
             WHERE RecipeId = ? AND UserId = ?`,
            [recipeId, userId]
        );
        
        // 2. Oblicz nową średnią
        const [avgResult] = await connection.execute(
            `SELECT AVG(Rating) as averageRating, COUNT(*) as ratingCount
             FROM RecipeRating
             WHERE RecipeId = ?`,
            [recipeId]
        );
        
        // 3. Zaktualizuj przepis
        await connection.execute(
            `UPDATE Recipe
             SET AverageRating = ?, RatingCount = ?
             WHERE RecipeId = ?`,
            [
                avgResult[0].ratingCount > 0 ? parseFloat(avgResult[0].averageRating).toFixed(1) : 0,
                avgResult[0].ratingCount || 0,
                recipeId
            ]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            averageRating: avgResult[0].ratingCount > 0 ? parseFloat(avgResult[0].averageRating).toFixed(1) : 0,
            ratingCount: avgResult[0].ratingCount || 0
        });
    } catch (error) {
        if (connection) await connection.rollback(); // use connection.rollback() instead of pool
        console.error('Delete rating error:', error);
        res.status(500).json({ error: 'Failed to delete rating' });
    } finally {
        if (connection) connection.release(); // Always release the connection back to the pool
    }
});

app.post('/api/auth/verify-password', async (req, res) => {
    const { userId, password } = req.body;

    if (!userId || !password) {
        return res.status(400).json({ success: false, message: "Missing credentials" });
    }

    db.query('SELECT Password FROM user WHERE UserId = ?', [userId], async (err, results) => {
        if (err) {
            console.error("Verify password error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, results[0].Password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Incorrect password" });
        }

        return res.json({ success: true });
    });
});
app.post('/api/auth/change-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
        return res.status(400).json({ 
            success: false, 
            message: 'UserId and new password are required' 
        });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ 
            success: false, 
            message: 'Password must be at least 8 characters' 
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // wrap callback-based db.query into Promise
        const runQuery = (sql, params) => {
            return new Promise((resolve, reject) => {
                db.query(sql, params, (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            });
        };

        await runQuery('UPDATE user SET Password = ? WHERE UserId = ?', [hashedPassword, userId]);
        

        res.json({ 
            success: true,
            message: 'Password changed successfully' 
        });

    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to change password' 
        });
    }
});
app.get('/delete-account', (req, res) => {
    const token = req.query.token;
    res.sendFile(path.join(__dirname, 'public/delete-account.html'));
});
// Request account deletion endpoint
app.post('/api/auth/request-account-deletion', (req, res) => {
    const { email } = req.body;

    // 1. Check if user exists
    db.query('SELECT * FROM user WHERE Email = ?', [email], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = results[0];

        // 2. Generate deletion token (valid for 24 hours)
        const token = jwt.sign(
            { userId: user.UserId, action: 'delete-account' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // 3. Create deletion link
        const deletionUrl = `${API_BASE_URL}/delete-account?token=${token}`;

        // 4. Send email with deletion link
        const mailOptions = {
            from: `"Helcro-Support" <${process.env.SMTP_USER}>`,
            to: email,
            subject: 'Confirm Account Deletion',
            html: `
                <h2>Account Deletion Request</h2>
                <p>We received a request to delete your account.</p>
                <p>Click the button below to permanently delete your account:</p>
                <a href="${deletionUrl}" style="
                    display: inline-block;
                    padding: 10px 20px;
                    background-color: #dc3545;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 15px 0;
                ">Delete My Account</a>
                <p>This link will expire in 24 hours.</p>
                <p>If you didn't request this, please secure your account immediately.</p>
            `
        };

        transporter.sendMail(mailOptions, (mailError) => {
            if (mailError) {
                console.error('Email sending error:', mailError);
                return res.status(500).json({ success: false, message: 'Failed to send email' });
            }

            // 5. Store deletion token in database (optional)
            db.query(
                'UPDATE user SET deletion_token = ?, deletion_token_expires = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE UserId = ?',
                [token, user.UserId],
                (updateError) => {
                    if (updateError) {
                        console.error('Token update error:', updateError);
                        // Continue anyway - the JWT token is sufficient
                    }
                    res.json({ success: true, message: 'Deletion email sent' });
                }
            );
        });
    });
});

// Actual account deletion endpoint (using callback style)
app.post('/api/auth/delete-account', (req, res) => {
    const { token } = req.body;

    // Verify token
    jwt.verify(token, process.env.JWT_SECRET, (jwtError, decoded) => {
        if (jwtError) {
            console.error('JWT verification error:', jwtError);
            
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(400).json({ success: false, message: 'Token has expired' });
            }
            
            return res.status(400).json({ success: false, message: 'Invalid token' });
        }
        
        if (decoded.action !== 'delete-account') {
            return res.status(400).json({ success: false, message: 'Invalid token' });
        }

        // Optional: Verify token against database
        db.query(
            'SELECT * FROM user WHERE UserId = ? AND deletion_token = ? AND deletion_token_expires > NOW()',
            [decoded.userId, token],
            (selectError, tokens) => {
                if (selectError) {
                    console.error('Database error:', selectError);
                    return res.status(500).json({ success: false, message: 'Server error' });
                }

                if (tokens.length === 0) {
                    return res.status(400).json({ success: false, message: 'Invalid or expired token' });
                }

                // Delete user from database
                db.query('DELETE FROM user WHERE UserId = ?', [decoded.userId], (deleteError) => {
                    if (deleteError) {
                        console.error('Deletion error:', deleteError);
                        return res.status(500).json({ success: false, message: 'Failed to delete account' });
                    }

                    res.json({ success: true, message: 'Account deleted successfully' });
                });
            }
        );
    });
});
// ===== DODANE NOWE ENDPOINTY ===== //

// Rejestracja użytkownika
app.post('/api/auth/register', async (req, res) => {
    
    const { UserName, Email, Password, Height, Weight, Gender, Birthday } = req.body;

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
                    { UserName, Email, Password: hashedPassword, Height, Weight, Gender, Birthday },
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
app.post('/api/auth/google-login', async (req, res) => {
    const { googleId, email, name } = req.body;
  
    try {
      // 1. Sprawdź czy użytkownik istnieje
      db.query('SELECT * FROM user WHERE google_id = ? OR email = ?', 
        [googleId, email], 
        async (err, results) => {
          if (err) throw err;
  
          let user;
          if (results.length > 0) {
            user = results[0];
          } else {
            // 2. Jeśli nie, stwórz nowego użytkownika
            db.query(
              'INSERT INTO user (google_id, email, name) VALUES (?, ?, ?)',
              [googleId, email, name],
              (err, result) => {
                if (err) throw err;
                user = {
                  UserId: result.insertId,
                  email,
                  name,
                  google_id: googleId
                };
              }
            );
          }
  
          // 3. Generuj token
          const token = jwt.sign(
            { id: user.UserId },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
          );
  
          // 4. Sprawdź czy ma uzupełniony profil
          const hasProfileData = user.Height && user.Weight && user.Birthday;
  
          res.json({
            token,
            user,
            hasProfileData: !!hasProfileData
          });
        }
      );
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
  app.post('/api/auth/complete-profile', async (req, res) => {
    const { userId, Height, Weight, Birthday, Gender } = req.body;
  
    try {
      db.query(
        'UPDATE user SET Height = ?, Weight = ?, Birthday = ?, Gender = ? WHERE UserId = ?',
        [Height, Weight, Birthday, Gender, userId],
        (err, result) => {
          if (err) throw err;
          res.json({ success: true });
        }
      );
    } catch (error) {
      res.status(500).json({ error: 'Failed to update profile' });
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
                    Gender: user.Gender,
                    Birthday: user.Birthday,
                    AvatarImage: user.AvatarImage
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
    db.query('SELECT UserId, UserName, Email, Height, Weight, Gender, AvatarImage FROM user WHERE UserId = ?',
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
            const resetUrl = API_BASE_URL+`/reset-password?token=${token}`;

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
// ===== PUBLIC ROUTES ===== //

// Get all recipes (public access)
app.get('/api/recipes', (req, res) => {
    db.query(`
        SELECT r.*, u.UserName, GROUP_CONCAT(c.Name) as categories
        FROM Recipe r
        JOIN user u ON r.UserId = u.UserId
        LEFT JOIN Recipe_has_Category rc ON r.RecipeId = rc.RecipeId
        LEFT JOIN Category c ON rc.CategoryId = c.CategoryId
        GROUP BY r.RecipeId
        ORDER BY r.Name
    `, (err, recipes) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(recipes.map(recipe => ({
            ...recipe,
            Image: recipe.Image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
            rating: 4.5,
            categories: recipe.categories ? recipe.categories.split(',') : []
        })));
    });
});

// Get recipes by category (public access)
app.get('/api/recipes/category/:categoryName', (req, res) => {
    const { categoryName } = req.params;
    
    db.query(`
        SELECT r.*, u.UserName 
        FROM Recipe r
        JOIN user u ON r.UserId = u.UserId
        JOIN Recipe_has_Category rc ON r.RecipeId = rc.RecipeId
        JOIN Category c ON rc.CategoryId = c.CategoryId
        WHERE c.Name = ?
        ORDER BY r.Name
    `, [categoryName], (err, recipes) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(recipes.map(recipe => ({
            ...recipe,
            Image: recipe.Image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
            rating: 4.5
        })));
    });
});

// Koniec Recipes Public

// Sample endpoint to get data
app.get('/users', (req, res) => {
    db.query('SELECT * FROM user', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err });
        }
        res.json(results);
    });
});

app.put('/api/users/:userId/avatar', authenticateToken, (req, res) => {
    const userId = req.params.userId;
    const { avatarUrl } = req.body;

    // Validate inputs
    if (!avatarUrl) {
        return res.status(400).json({
            success: false,
            error: 'Avatar URL is required'
        });
    }

    db.query(
        'UPDATE user SET AvatarImage = ? WHERE UserId = ?',
        [avatarUrl, userId],
        (err, result) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Database error',
                    details: err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            res.json({
                success: true,
                message: 'Avatar updated successfully',
                avatarUrl: avatarUrl
            });
        }
    );
});

// Get user's current avatar
app.get('/api/users/:userId/avatar', authenticateToken, (req, res) => {
    const userId = req.params.userId;

    db.query(
        'SELECT AvatarImage FROM User WHERE UserId = ?',
        [userId],
        (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Database error',
                    details: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            res.json({
                success: true,
                avatarUrl: results[0].AvatarImage
            });
        }
    );
});

app.get('/products', (req, res) => {
    db.query('SELECT * FROM Product', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err });
        }
        res.json(results);
    });
});

app.get('/meals', async (req, res) => {
    try {
        const [meals] = await pool.execute(
            'SELECT MealId, MealType FROM Meal ORDER BY MealId'
        );
        res.json(meals);
    } catch (error) {
        console.error('Error fetching meal types:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching meal types',
            error: error.message
        });
    }
});

app.get('/intakeLog', async (req, res) => {
    try {
        const { userId, date } = req.query;
        if (!userId || !date) {
            return res.status(400).json({
                success: false,
                message: 'User ID and date are required'
            });
        }

        const connection = await pool.getConnection();
        try {
            // 1. Get IntakeLog
            const [intakeLog] = await connection.execute(
                'SELECT * FROM IntakeLog WHERE UserId = ? AND LogDate = ?',
                [userId, date]
            );

            if (intakeLog.length === 0) {
                return res.json({ success: true, meals: [] });
            }

            // 2. Get all products with calculations
            const [products] = await connection.execute(`
                SELECT
                    p.*,
                    ihp.grams,
                    ihp.MealId,
                    m.MealType,
                    COALESCE(ihp.MealName, m.MealType) AS MealName
                FROM IntakeLog_has_Product ihp
                         JOIN Product p ON ihp.ProductId = p.ProductId
                         JOIN Meal m ON ihp.MealId = m.MealId
                WHERE ihp.IntakeLogId = ?
                ORDER BY m.MealId
            `, [intakeLog[0].IntakeLogId]);

            // 3. Group by meal
            const mealsMap = new Map();
            products.forEach(product => {
                const grams = product.grams || 100;
                if (!mealsMap.has(product.MealId)) {
                    mealsMap.set(product.MealId, {
                        id: product.MealId,
                        MealId: product.MealId,
                        type: product.MealType,
                        name: product.MealName,
                        products: []
                    });
                }
                mealsMap.get(product.MealId).products.push({
                    ...product,
                    calories: (product.calories * grams / 100),
                    proteins: (product.proteins * grams / 100),
                    fats: (product.fats * grams / 100),
                    carbohydrates: (product.carbohydrates * grams / 100),
                    originalValues: {
                        calories: product.calories,
                        proteins: product.proteins,
                        fats: product.fats,
                        carbohydrates: product.carbohydrates
                    }
                });
            });

            res.json({
                success: true,
                meals: Array.from(mealsMap.values())
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

app.post('/intakeLog', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, date, mealType, mealName, products, mealId } = req.body;

        if (!userId || !date || !mealType || !mealId) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'userId, date, mealType and mealId are required'
            });
        }

        await connection.beginTransaction();

        try {
            // 1. Handle IntakeLog
            let IntakeLogId;
            const [existingLog] = await connection.execute(
                'SELECT IntakeLogId FROM IntakeLog WHERE UserId = ? AND LogDate = ? FOR UPDATE',
                [userId, date]
            );

            IntakeLogId = existingLog.length > 0 ? existingLog[0].IntakeLogId : (
                await connection.execute(
                    'INSERT INTO IntakeLog (UserId, LogDate) VALUES (?, ?)',
                    [userId, date]
                )
            )[0].insertId;

            // 2. Verify meal exists (don't insert new ones)
            const [mealCheck] = await connection.execute(
                'SELECT MealId FROM Meal WHERE MealId = ?',
                [mealId]
            );

            if (mealCheck.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'Invalid MealId - meal type does not exist'
                });
            }

            // 3. Delete existing products for this meal
            await connection.execute(
                'DELETE FROM IntakeLog_has_Product WHERE IntakeLogId = ? AND MealId = ?',
                [IntakeLogId, mealId]
            );

            // 4. Insert new products
            for (const product of products) {
                await connection.execute(
                    'INSERT INTO IntakeLog_has_Product (IntakeLogId, ProductId, MealId, grams) VALUES (?, ?, ?, ?)',
                    [IntakeLogId, product.productId, mealId, product.grams || 100]
                );
            }

            await connection.commit();

            // 5. Return the saved data
            const [savedProducts] = await connection.execute(`
                SELECT p.*, ihp.grams, ihp.MealId
                FROM IntakeLog_has_Product ihp
                         JOIN Product p ON ihp.ProductId = p.ProductId
                WHERE ihp.IntakeLogId = ? AND ihp.MealId = ?
            `, [IntakeLogId, mealId]);

            res.status(201).json({
                success: true,
                products: savedProducts,
                meal: {
                    id: mealId,
                    type: mealType,
                    name: mealName || mealType
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    } finally {
        connection.release();
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

// Delete a meal and its products
app.delete('/intakeLog/meal', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, mealId } = req.body;

        await connection.beginTransaction();

        // First delete from IntakeLog_has_Product
        await connection.execute(
            'DELETE FROM IntakeLog_has_Product WHERE MealId = ?',
            [mealId]
        );

        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting meal:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        connection.release();
    }
});

// Rename a meal (only for "Other" meals)
app.put('/intakeLog/meal', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, mealId, newMealName } = req.body;

        await connection.beginTransaction();

        // 1. Update MealName in IntakeLog_has_Product for all products in this meal
        await connection.execute(
            'UPDATE IntakeLog_has_Product SET MealName = ? WHERE MealId = ?',
            [newMealName, mealId]
        );

        // 2. (Optional) Update the Meal table if you store the name there too
        // If you have a MealName column in the Meal table:
        await connection.execute(
            'UPDATE Meal SET MealName = ? WHERE MealId = ?',
            [newMealName, mealId]
        );

        await connection.commit();

        res.json({
            success: true,
            mealId,
            newMealName
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error renaming meal:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        connection.release();
    }
});

app.post('/intakeLog/copyMeal', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, fromDate, fromMealId, toDate, toMealId } = req.body;

        console.log('Received copy request:', {
            userId,
            fromDate,
            fromMealId,
            toDate,
            toMealId
        });

        // Validate required fields
        if (!userId || !fromDate || !fromMealId || !toDate || !toMealId) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        await connection.beginTransaction();

        // 1. Get source intake log and meal type
        const [fromIntakeLog] = await connection.execute(
            'SELECT IntakeLogId FROM IntakeLog WHERE UserId = ? AND LogDate = ?',
            [userId, fromDate]
        );

        if (fromIntakeLog.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Source intake log not found'
            });
        }

        // 2. Get source meal type name
        const [fromMealType] = await connection.execute(
            'SELECT MealType FROM Meal WHERE MealId = ?',
            [fromMealId]
        );

        // 3. Get target meal type name
        const [toMealType] = await connection.execute(
            'SELECT MealType FROM Meal WHERE MealId = ?',
            [toMealId]
        );

        // 4. Get source products
        const [products] = await connection.execute(
            `SELECT ProductId, grams, MealName 
             FROM IntakeLog_has_Product 
             WHERE IntakeLogId = ? AND MealId = ?`,
            [fromIntakeLog[0].IntakeLogId, fromMealId]
        );

        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'No products found in source meal'
            });
        }

        // 5. Get or create target intake log
        let toIntakeLogId;
        const [toIntakeLog] = await connection.execute(
            'SELECT IntakeLogId FROM IntakeLog WHERE UserId = ? AND LogDate = ? FOR UPDATE',
            [userId, toDate]
        );

        toIntakeLogId = toIntakeLog.length > 0 ? toIntakeLog[0].IntakeLogId : (
            await connection.execute(
                'INSERT INTO IntakeLog (UserId, LogDate) VALUES (?, ?)',
                [userId, toDate]
            )
        )[0].insertId;

        // 6. Clear existing products in target meal (if any)
        await connection.execute(
            'DELETE FROM IntakeLog_has_Product WHERE IntakeLogId = ? AND MealId = ?',
            [toIntakeLogId, toMealId]
        );

        // 7. Copy products to target meal with updated MealName
        for (const product of products) {
            // Use the target meal type as the new MealName, unless it's "Other"
            const newMealName = toMealType[0].MealType === 'Other' ? product.MealName : toMealType[0].MealType;

            await connection.execute(
                'INSERT INTO IntakeLog_has_Product (IntakeLogId, ProductId, MealId, MealName, grams) VALUES (?, ?, ?, ?, ?)',
                [toIntakeLogId, product.ProductId, toMealId, newMealName, product.grams]
            );
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Meal copied successfully',
            meal: {
                id: toMealId,
                type: toMealType[0].MealType
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error copying meal:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// GET /weight - Get all weight entries for user
app.get('/weight', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const weights = await Weight.findByUser(userId);
        res.json({ success: true, weights });
    } catch (error) {
        console.error('Error fetching weight history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/weight', async (req, res) => {
    try {
        const { userId, date, weight } = req.body;

        if (!userId || !date || !weight) {
            return res.status(400).json({
                success: false,
                message: 'User ID, date, and weight are required'
            });
        }

        const weightId = await Weight.create({
            UserId: userId,
            WeightDate: date,
            Weight: parseFloat(weight)
        });

        res.status(201).json({
            success: true,
            weight: {
                WeightId: weightId,
                WeightDate: date,
                Weight: weight
            }
        });
    } catch (error) {
        console.error('Error adding weight:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

app.delete('/weight/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const success = await Weight.delete(id);

        if (!success) {
            return res.status(404).json({ success: false, message: 'Weight entry not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting weight:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update the export endpoint in server.js
app.get('/api/export/nutrition-data', (req, res) => {
    const { startDate, endDate, format, userId } = req.query;

    if (!startDate || !endDate || !format || !userId) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    db.query(`
        SELECT
            p.product_name,
            p.calories,
            p.proteins,
            p.fats,
            p.carbohydrates,
            ilhp.grams,
            m.MealType,
            ilhp.MealDate,
            (p.calories * ilhp.grams / 100) AS calculated_calories,
            (p.proteins * ilhp.grams / 100) AS calculated_proteins,
            (p.fats * ilhp.grams / 100) AS calculated_fats,
            (p.carbohydrates * ilhp.grams / 100) AS calculated_carbs
        FROM IntakeLog_has_Product ilhp
                 JOIN Product p ON ilhp.ProductId = p.ProductId
                 JOIN Meal m ON ilhp.MealId = m.MealId
                 JOIN IntakeLog il ON ilhp.IntakeLogId = il.IntakeLogId
        WHERE il.LogDate BETWEEN ? AND ?
          AND il.UserId = ?
        ORDER BY ilhp.MealDate
    `, [startDate, endDate, userId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'No data found for the selected date range' });
        }

        try {
            switch (format) {
                case 'csv':
                    return exportAsCSV(res, results);
                case 'excel':
                    return exportAsExcel(res, results);
                case 'pdf':
                    return exportAsPDF(res, results);
                case 'txt':
                    return exportAsTXT(res, results);
                default:
                    return res.status(400).json({ error: 'Invalid export format' });
            }
        } catch (error) {
            console.error('Export error:', error);
            return res.status(500).json({ error: 'Export failed' });
        }
    });
});

// Helper functions for different export formats
function exportAsCSV(res, data) {
    let csv = 'Product,Calories,Proteins,Fats,Carbohydrates,Grams,MealType,MealDate,Calculated Calories,Calculated Proteins,Calculated Fats,Calculated Carbs\n';

    data.forEach(row => {
        csv += `"${row.product_name}",${row.calories},${row.proteins},${row.fats},${row.carbohydrates},${row.grams},${row.MealType},"${row.MealDate}",${row.calculated_calories},${row.calculated_proteins},${row.calculated_fats},${row.calculated_carbs}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=nutrition-data.csv');
    res.send(csv);
}

function exportAsExcel(res, data) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Nutrition Data');

    // Add headers
    worksheet.columns = [
        { header: 'Product', key: 'product_name' },
        { header: 'Calories', key: 'calories' },
        { header: 'Proteins', key: 'proteins' },
        { header: 'Fats', key: 'fats' },
        { header: 'Carbohydrates', key: 'carbohydrates' },
        { header: 'Grams', key: 'grams' },
        { header: 'Meal Type', key: 'MealType' },
        { header: 'Meal Date', key: 'MealDate' },
        { header: 'Calculated Calories', key: 'calculated_calories' },
        { header: 'Calculated Proteins', key: 'calculated_proteins' },
        { header: 'Calculated Fats', key: 'calculated_fats' },
        { header: 'Calculated Carbs', key: 'calculated_carbs' }
    ];

    // Add data
    worksheet.addRows(data);

    // Write to response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=nutrition-data.xlsx');

    workbook.xlsx.write(res)
        .then(() => res.end())
        .catch(err => {
            console.error('Excel export error:', err);
            res.status(500).json({ error: 'Excel export failed' });
        });
}

function exportAsPDF(res, data) {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=nutrition-data.pdf');

    doc.pipe(res);

    // Add title
    doc.fontSize(20).text('Nutrition Data Export', { align: 'center' });
    doc.moveDown();

    // Add table headers
    doc.fontSize(12);
    doc.text('Product', 50, 100);
    doc.text('Calories', 200, 100);
    doc.text('Proteins', 250, 100);
    doc.text('Fats', 300, 100);
    doc.text('Carbs', 350, 100);
    doc.text('Grams', 400, 100);
    doc.text('Meal', 450, 100);

    // Add data rows
    let y = 120;
    data.forEach(row => {
        doc.text(row.product_name.substring(0, 20), 50, y);
        doc.text(row.calories.toString(), 200, y);
        doc.text(row.proteins.toString(), 250, y);
        doc.text(row.fats.toString(), 300, y);
        doc.text(row.carbohydrates.toString(), 350, y);
        doc.text(row.grams.toString(), 400, y);
        doc.text(row.MealType, 450, y);
        y += 20;

        // Add new page if we're at the bottom
        if (y > 700) {
            doc.addPage();
            y = 100;
        }
    });

    doc.end();
}

function exportAsTXT(res, data) {
    let text = 'Nutrition Data Export\n\n';
    text += 'Product\tCalories\tProteins\tFats\tCarbs\tGrams\tMeal Type\tMeal Date\n';

    data.forEach(row => {
        text += `${row.product_name}\t${row.calories}\t${row.proteins}\t${row.fats}\t${row.carbohydrates}\t${row.grams}\t${row.MealType}\t${row.MealDate}\n`;
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=nutrition-data.txt');
    res.send(text);
}

// ===== RECIPE ENDPOINTS ===== //
// Get recipe details (public access)
app.get('/api/recipes/detail/:recipeId', async (req, res) => {
    const { recipeId } = req.params;
    try {
        // 1. Get basic recipe data + average rating + rating count
        const [recipeResults] = await pool.execute(
            `SELECT r.*, 
                    u.UserName, 
                    AVG(rr.Rating) as averageRating,
                    COUNT(rr.Rating) as ratingCount
             FROM Recipe r
             JOIN user u ON r.UserId = u.UserId
             LEFT JOIN RecipeRating rr ON r.RecipeId = rr.RecipeId
             WHERE r.RecipeId = ?
             GROUP BY r.RecipeId`,
            [recipeId]
        );
        const [commentResults] = await pool.execute(
            `SELECT rr.Rating, rr.Comment, u.UserName
             FROM RecipeRating rr
             JOIN user u ON rr.UserId = u.UserId
             WHERE rr.RecipeId = ?`,
            [recipeId]
        );
        if (recipeResults.length === 0) {
            return res.status(404).json({ error: 'Recipe not found' });
        }
        
        const recipe = recipeResults[0];

        // 2. Get categories
        const [categoryResults] = await pool.execute(
            `SELECT c.Name 
             FROM Recipe_has_Category rc 
             JOIN Category c ON rc.CategoryId = c.CategoryId
             WHERE rc.RecipeId = ?`,
            [recipeId]
        );

        // 3. Get products (with macros and images)
        const [productResults] = await pool.execute(
            `SELECT 
                p.ProductId, 
                p.product_name as name, 
                p.image,
                rp.Amount,
                p.calories,
                p.proteins,
                p.fats,
                p.carbohydrates
             FROM Recipe_has_Product rp 
             JOIN Product p ON rp.ProductId = p.ProductId
             WHERE rp.RecipeId = ?`,
            [recipeId]
        );

        // 4. Calculate total nutritional values
        let totalCalories = 0;
        let totalProteins = 0;
        let totalFats = 0;
        let totalCarbs = 0;

        productResults.forEach(product => {
            const amount = product.Amount || 100; // default to 100g
            totalCalories += (product.calories / 100) * amount;
            totalProteins += (product.proteins / 100) * amount;
            totalFats += (product.fats / 100) * amount;
            totalCarbs += (product.carbohydrates / 100) * amount;
        });

        // 5. Return all data
        res.json({
            RecipeId: recipe.RecipeId,
            name: recipe.Name,
            description: recipe.Description,
            Image: recipe.Image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
            UserName: recipe.UserName,
            averageRating: parseFloat(recipe.averageRating) || 0,
            ratingCount: recipe.ratingCount || 0,
            steps: recipe.Steps ? recipe.Steps.split('||') : [],
            categories: categoryResults.map(c => c.Name),
            products: productResults.map(p => ({
                ProductId: p.ProductId,
                name: p.name,
                image: p.image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
                amount: p.Amount,
                calories: (p.calories / 100) * (p.Amount || 100),
                proteins: (p.proteins / 100) * (p.Amount || 100),
                fats: (p.fats / 100) * (p.Amount || 100),
                carbohydrates: (p.carbohydrates / 100) * (p.Amount || 100)
            })),
            totalNutrition: {
                calories: totalCalories || 0,
                proteins: totalProteins || 0,
                fats: totalFats || 0,
                carbohydrates: totalCarbs || 0
            },
            comments: commentResults.map(c => ({
                userName: c.UserName,
                rating: c.Rating,
                comment: c.Comment
            }))           
        });

    } catch (error) {
        console.error('Error fetching recipe details:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Get all categories
app.get('/api/categories', (req, res) => {
    db.query('SELECT * FROM Category', (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Get products for recipe selection
app.get('/api/recipe-products', (req, res) => {
    const { search } = req.query;
    let query = 'SELECT ProductId, product_name, image FROM Product';
    let params = [];
    
    if (search) {
        query += ' WHERE product_name LIKE ?';
        params.push(`%${search}%`);
    }
    
    query += ' ORDER BY product_name ';
    
    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Create a new recipe
app.post('/api/recipes', authenticateToken, (req, res) => {
    const { UserId, Name, Description, Steps, Image } = req.body;
    
    console.log('Creating recipe with:', { UserId, Name, Description, Steps, Image }); // Debug log

    // Validate inputs
    if (!UserId || !Name || !Description || !Steps) {
        console.log('Missing required fields'); // Debug log
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Insert into database
    db.query(
        'INSERT INTO Recipe (UserId, Name, Description, Steps, Image) VALUES (?, ?, ?, ?, ?)',
        [UserId, Name, Description, Steps, Image || null], // Ensure Image is null if not provided
        (err, result) => {
            if (err) {
                console.error('Database error:', err); // Detailed error logging
                return res.status(500).json({ 
                    error: 'Database error',
                    details: err.message 
                });
            }
            res.status(201).json({ 
                success: true, 
                RecipeId: result.insertId,
                message: 'Recipe created successfully'
            });
        }
    );
});

// Add categories to recipe
app.post('/api/recipes/:recipeId/categories', authenticateToken, (req, res) => {
    const { recipeId } = req.params;
    const { categoryIds } = req.body;
    const UserId = req.user.id;

    if (!categoryIds || !Array.isArray(categoryIds)) {
        return res.status(400).json({ error: 'Invalid category IDs' });
    }

    // First verify the recipe belongs to the user
    db.query(
        'SELECT UserId FROM Recipe WHERE RecipeId = ?',
        [recipeId],
        (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0 || results[0].UserId !== UserId) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            // Delete existing categories first (optional)
            db.query(
                'DELETE FROM Recipe_has_Category WHERE RecipeId = ?',
                [recipeId],
                (err) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    // Insert new categories
                    const values = categoryIds.map(catId => [recipeId, catId]);
                    
                    if (values.length === 0) {
                        return res.json({ success: true, message: 'Categories updated' });
                    }

                    db.query(
                        'INSERT INTO Recipe_has_Category (RecipeId, CategoryId) VALUES ?',
                        [values],
                        (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ error: 'Database error' });
                            }
                            res.json({ success: true, message: 'Categories added to recipe' });
                        }
                    );
                }
            );
        }
    );
});

// Add products to recipe
app.post('/api/recipes/:recipeId/products', authenticateToken, (req, res) => {
    const { recipeId } = req.params;
    const { products } = req.body;
    const UserId = req.user.id;

    if (!products || !Array.isArray(products)) {
        return res.status(400).json({ error: 'Invalid products data' });
    }

    // First verify the recipe belongs to the user
    db.query(
        'SELECT UserId FROM Recipe WHERE RecipeId = ?',
        [recipeId],
        (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0 || results[0].UserId !== UserId) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            // Delete existing products first (optional)
            db.query(
                'DELETE FROM Recipe_has_Product WHERE RecipeId = ?',
                [recipeId],
                (err) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    // Insert new products
                    const values = products.map(p => [recipeId, p.ProductId, p.Amount]);
                    
                    if (values.length === 0) {
                        return res.json({ success: true, message: 'Products updated' });
                    }

                    db.query(
                        'INSERT INTO Recipe_has_Product (RecipeId, ProductId, Amount) VALUES ?',
                        [values],
                        (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ error: 'Database error' });
                            }
                            res.json({ success: true, message: 'Products added to recipe' });
                        }
                    );
                }
            );
        }
    );
});

// Get recipe details
app.get('/api/recipes/:recipeId', authenticateToken, (req, res) => {
    const { recipeId } = req.params;
    const UserId = req.user.id;

    db.query(
        'SELECT * FROM Recipe WHERE RecipeId = ? AND UserId = ?',
        [recipeId, UserId],
        (err, recipeResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (recipeResults.length === 0) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            const recipe = recipeResults[0];

            // Get categories
            db.query(
                `SELECT c.CategoryId, c.Name 
                 FROM Recipe_has_Category rc 
                 JOIN Category c ON rc.CategoryId = c.CategoryId
                 WHERE rc.RecipeId = ?`,
                [recipeId],
                (err, categoryResults) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    // Get products
                    db.query(
                        `SELECT p.ProductId, p.product_name, rp.Amount 
                         FROM Recipe_has_Product rp 
                         JOIN Product p ON rp.ProductId = p.ProductId
                         WHERE rp.RecipeId = ?`,
                        [recipeId],
                        (err, productResults) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ error: 'Database error' });
                            }

                            // Format the response
                            res.json({
                                ...recipe,
                                steps: recipe.Steps ? recipe.Steps.split('||') : [],
                                categories: categoryResults,
                                products: productResults
                            });
                        }
                    );
                }
            );
        }
    );
});

// Get all recipes with categories and products
app.get('/api/recipes', authenticateToken, (req, res) => {
    // First get all recipes
    db.query(`
        SELECT r.*, u.UserName 
        FROM Recipe r
        JOIN user u ON r.UserId = u.UserId
        ORDER BY r.Name
    `, (err, recipeResults) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (recipeResults.length === 0) {
            return res.json([]);
        }

        // Get categories for all recipes
        db.query(`
            SELECT rc.RecipeId, c.CategoryId, c.Name 
            FROM Recipe_has_Category rc
            JOIN Category c ON rc.CategoryId = c.CategoryId
        `, (err, categoryResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            // Get products for all recipes
            db.query(`
                SELECT rp.RecipeId, p.ProductId, p.product_name, rp.Amount 
                FROM Recipe_has_Product rp
                JOIN Product p ON rp.ProductId = p.ProductId
            `, (err, productResults) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                // Format the response
                const recipes = recipeResults.map(recipe => {
                    const categories = categoryResults
                        .filter(c => c.RecipeId === recipe.RecipeId)
                        .map(c => c.Name);
                    
                    const products = productResults
                        .filter(p => p.RecipeId === recipe.RecipeId)
                        .map(p => ({
                            name: p.product_name,
                            amount: p.Amount
                        }));
                    
                    return {
                        RecipeId: recipe.RecipeId,
                        name: recipe.Name,
                        description: recipe.Description,
                        products: products,
                        photo: recipe.Image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
                        categories: categories,
                        rating: 4.5, // Default rating for now
                        UserId: recipe.UserId,
                        userName: recipe.UserName,
                        steps: recipe.Steps ? recipe.Steps.split('||') : []
                    };
                });

                res.json(recipes);
            });
        });
    });
});
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;

  db.query('SELECT Height, Weight, Birthday FROM user WHERE UserId = ?', [userId], (err, results) => {
        if (err) {
            console.error("Error fetching user data:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json(results[0]);
    });
});
app.post('/api/calculate-goals', (req, res) => {
    const { age, weight, height, gender, goal } = req.body;

    if (!age || !weight || !height || !gender || !goal) {
        return res.status(400).json({ error: "Missing fields" });
    }

    // Mifflin-St Jeor Equation for BMR
    let bmr;
    if (gender === 'M') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    let activityMultiplier = 1.2; // sedentary
    let calories;

    switch (goal) {
        case 'weight_loss':
            calories = bmr * activityMultiplier - 500;
            break;
        case 'muscle_gain':
            calories = bmr * activityMultiplier + 300;
            break;
        case 'maintenance':
        default:
            calories = bmr * activityMultiplier;
            break;
    }

    const proteins = weight * 2; // in grams
    const fats = (calories * 0.25) / 9;
    const carbs = (calories - (proteins * 4 + fats * 9)) / 4;

    res.json({
        DailyCalories: Math.round(calories),
        DailyProteins: Math.round(proteins),
        DailyFats: Math.round(fats),
        DailyCarbs: Math.round(carbs)
    });
});
app.post('/api/goal', (req, res) => {
    const { UserId, DailyCalories, DailyProteins, DailyFats, DailyCarbs } = req.body;

    if (!UserId || !DailyCalories || !DailyProteins || !DailyFats || !DailyCarbs) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const query = `
        INSERT INTO Goal (UserId, DailyCalories, DailyProteins, DailyFats, DailyCarbs)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            DailyCalories = ?, DailyProteins = ?, DailyFats = ?, DailyCarbs = ?
    `;
    
    db.query(query, [
        UserId, DailyCalories, DailyProteins, DailyFats, DailyCarbs,
        DailyCalories, DailyProteins, DailyFats, DailyCarbs
    ], (err, results) => {
        if (err) {
            console.error("Error saving goal:", err);
            return res.status(500).json({ error: "Database error" });
        }

        res.json({ message: "Goal saved successfully" });
    });
});
app.get('/api/goal/:id', (req, res) => {
    const userId = req.params.id;

    db.query('SELECT * FROM Goal WHERE UserId = ?', [userId], (err, results) => {
        if (err) {
            console.error("Error fetching goal data:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "Goal not found" });
        }

        res.json(results[0]); // return the first (or only) goal
    });
});
app.put('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    const { Height, Weight, Birthday } = req.body;
    if (
        Height === undefined || Height === null ||
        Weight === undefined || Weight === null ||
        !Birthday // this one should still be a non-empty string
    ) {
        return res.status(400).json({ error: "Height, weight, and birthday are required" });
    }

    const sql = `
        UPDATE user 
        SET Height = ?, Weight = ?, Birthday = ? 
        WHERE UserId = ?
    `;

    db.query(sql, [Height, Weight, Birthday, userId], (err, result) => {
        if (err) {
            console.error("Error updating user:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ message: "User updated successfully" });
    });
});


// Get all categories (public access)
app.get('/api/categories/public', (req, res) => {
    db.query('SELECT * FROM Category', (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

// Get recipes by category (public access)
app.get('/api/recipes/public/by-category', (req, res) => {
    const { category } = req.query;
    
    if (!category) {
        return res.status(400).json({ error: 'Category parameter is required' });
    }

    db.query(`
        SELECT r.*, u.UserName 
        FROM Recipe r
        JOIN user u ON r.UserId = u.UserId
        JOIN Recipe_has_Category rc ON r.RecipeId = rc.RecipeId
        JOIN Category c ON rc.CategoryId = c.CategoryId
        WHERE c.Name = ?
        ORDER BY r.Name
    `, [category], (err, recipeResults) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (recipeResults.length === 0) {
            return res.json([]);
        }

        // Get products for these recipes
        db.query(`
            SELECT rp.RecipeId, p.product_name, rp.Amount 
            FROM Recipe_has_Product rp
            JOIN Product p ON rp.ProductId = p.ProductId
            WHERE rp.RecipeId IN (?)
        `, [recipeResults.map(r => r.RecipeId)], (err, productResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            // Format the response
            const recipes = recipeResults.map(recipe => ({
                RecipeId: recipe.RecipeId,
                Name: recipe.Name,
                Description: recipe.Description,
                Image: recipe.Image || "https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg",
                rating: 4.5,
                UserId: recipe.UserId,
                UserName: recipe.UserName,
                steps: recipe.Steps ? recipe.Steps.split('||') : [],
                products: productResults
                    .filter(p => p.RecipeId === recipe.RecipeId)
                    .map(p => ({
                        name: p.product_name,
                        amount: p.Amount
                    })),
                categories: [category] // Since we're filtering by one category
            }));

            res.json(recipes);
        });
    });
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


async function fetchAndInsertMultiplePages(startPage , endPage ) {
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
