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

    static async findWithMealsAndProducts(UserId, LogDate) {
        // First get the IntakeLog for specific date
        const intakeLog = await this.findByUserAndDate(UserId, LogDate);
        if (!intakeLog) return null;

        // Get all meals associated with this IntakeLog
        const [meals] = await pool.execute(
            `SELECT m.*, ihm.MealId, m.MealName, m.MealType, m.CreatedAt
             FROM IntakeLog_has_Meal ihm
                      JOIN Meal m ON ihm.MealId = m.MealId
             WHERE ihm.UserId = ? AND ihm.IntakeLogId = ?`,
            [UserId, intakeLog.IntakeLogId]
        );

        // Get products for each meal only for this IntakeLog
        for (const meal of meals) {
            const [products] = await pool.execute(
                `SELECT p.*, mhp.grams
                 FROM Meal_has_Product mhp
                          JOIN Product p ON mhp.ProductId = p.ProductId
                 WHERE mhp.MealId = ?`,
                [meal.MealId]
            );
            meal.products = products.map(product => ({
                ...product,
                calories: (product.calories / 100) * product.grams,
                proteins: (product.proteins / 100) * product.grams,
                fats: (product.fats / 100) * product.grams,
                carbohydrates: (product.carbohydrates / 100) * product.grams
            }));
        }

        return {
            ...intakeLog,
            meals
        };
    }

    static async addMealToIntakeLog({ UserId, IntakeLogId, MealId }) {
        const [result] = await pool.execute(
            'INSERT INTO IntakeLog_has_Meal (UserId, IntakeLogId, MealId) VALUES (?, ?, ?)',
            [UserId, IntakeLogId, MealId]
        );
        return result.affectedRows > 0;
    }

    static async addProductToMeal({ MealId, ProductId, grams }) {
        const [result] = await pool.execute(
            'INSERT INTO Meal_has_Product (MealId, ProductId, grams) VALUES (?, ?, ?)',
            [MealId, ProductId, grams]
        );
        return result.affectedRows > 0;
    }

    static async updateProductsForIntakeLog(IntakeLogId, products, MealId = null) {
        // If MealId is provided, only update that specific meal
        if (MealId) {
            // Delete existing products
            await pool.execute(
                'DELETE FROM Meal_has_Product WHERE MealId = ?',
                [MealId]
            );

            // Add new products
            for (const product of products) {
                await this.addProductToMeal({
                    MealId,
                    ProductId: product.ProductId,
                    grams: product.grams
                });
            }
            return true;
        }

        // Otherwise update all meals for this intake log (existing behavior)
        const [meals] = await pool.execute(
            'SELECT MealId FROM IntakeLog_has_Meal WHERE IntakeLogId = ?',
            [IntakeLogId]
        );

        if (meals.length === 0) return false;

        for (const meal of meals) {
            // Delete existing products
            await pool.execute(
                'DELETE FROM Meal_has_Product WHERE MealId = ?',
                [meal.MealId]
            );

            // Add new products
            for (const product of products) {
                await this.addProductToMeal({
                    MealId: meal.MealId,
                    ProductId: product.ProductId,
                    grams: product.grams
                });
            }
        }

        return true;
    }
}

module.exports = IntakeLog;