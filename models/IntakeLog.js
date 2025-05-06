const pool = require("../config/db");

class IntakeLog {
    static async create({ UserId, LogDate }) {
        try {
            // First check if log already exists for this user/date
            const existing = await this.findByUserAndDate(UserId, LogDate);
            if (existing) {
                return existing.IntakeLogId; // Return existing ID instead of creating new
            }

            const [result] = await pool.execute(
                'INSERT INTO IntakeLog (UserId, LogDate) VALUES (?, ?)',
                [UserId, LogDate]
            );
            return result.insertId;
        } catch (error) {
            // Handle unique constraint violation
            if (error.code === 'ER_DUP_ENTRY') {
                const existing = await this.findByUserAndDate(UserId, LogDate);
                return existing.IntakeLogId;
            }
            console.error('Error creating IntakeLog:', error);
            throw error;
        }
    }

    static async findByUserAndDate(UserId, LogDate) {
        try {
            const [rows] = await pool.execute(
                'SELECT * FROM IntakeLog WHERE UserId = ? AND LogDate = ?',
                [UserId, LogDate]
            );
            return rows[0];
        } catch (error) {
            console.error('Error finding IntakeLog:', error);
            throw error;
        }
    }

    static async findWithProducts(UserId, LogDate) {
        const connection = await pool.getConnection();
        try {
            // First get the IntakeLog for specific date
            const [intakeLog] = await connection.execute(
                'SELECT * FROM IntakeLog WHERE UserId = ? AND LogDate = ?',
                [UserId, LogDate]
            );

            if (intakeLog.length === 0) return null;

            // Get all products with their actual grams values AND original product data
            const [products] = await connection.execute(
                `SELECT
                     p.*,
                     ihp.MealId,
                     m.MealType,
                     ihp.MealName,
                     ihp.grams
                 FROM IntakeLog_has_Product ihp
                          JOIN Product p ON ihp.ProductId = p.ProductId
                          JOIN Meal m ON ihp.MealId = m.MealId
                 WHERE ihp.IntakeLogId = ?`,
                [intakeLog[0].IntakeLogId]
            );

            return {
                ...intakeLog[0],
                products: products.map(product => ({
                    ...product,
                    // Calculate nutrition based on grams
                    calculated_calories: (product.calories / 100) * product.grams,
                    calculated_proteins: (product.proteins / 100) * product.grams,
                    calculated_fats: (product.fats / 100) * product.grams,
                    calculated_carbohydrates: (product.carbohydrates / 100) * product.grams
                }))
            };
        } catch (error) {
            console.error('Error:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    static async addProductToIntakeLog({ IntakeLogId, ProductId, MealId, MealName }) {
        const [result] = await pool.execute(
            'INSERT INTO IntakeLog_has_Product (IntakeLogId, ProductId, MealId, MealName) VALUES (?, ?, ?, ?)',
            [IntakeLogId, ProductId, MealId, MealName]
        );
        return result.affectedRows > 0;
    }

    static async updateProductsForIntakeLog(IntakeLogId, products, MealId = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Ensure products is always an array
            const productsArray = Array.isArray(products) ? products : [];

            if (MealId) {
                // Delete existing products for this meal
                await connection.execute(
                    'DELETE FROM IntakeLog_has_Product WHERE IntakeLogId = ? AND MealId = ?',
                    [IntakeLogId, MealId]
                );

                // Add new products
                for (const product of productsArray) {
                    if (product && product.productId) {  // Additional safety check
                        await connection.execute(
                            'INSERT INTO IntakeLog_has_Product (IntakeLogId, ProductId, MealId, grams) VALUES (?, ?, ?, ?)',
                            [
                                IntakeLogId,
                                product.productId,
                                MealId,
                                product.grams || 100  // Default to 100g if not specified
                            ]
                        );
                    }
                }
            } else {
                // Delete all products for this intake log
                await connection.execute(
                    'DELETE FROM IntakeLog_has_Product WHERE IntakeLogId = ?',
                    [IntakeLogId]
                );

                // Add new products
                for (const product of productsArray) {
                    if (product && product.productId && product.MealId) {  // Additional safety check
                        await connection.execute(
                            'INSERT INTO IntakeLog_has_Product (IntakeLogId, ProductId, MealId, grams) VALUES (?, ?, ?, ?)',
                            [
                                IntakeLogId,
                                product.productId,
                                product.MealId,
                                product.grams || 100  // Default to 100g if not specified
                            ]
                        );
                    }
                }
            }

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            console.error('Error updating products:', error);
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = IntakeLog;