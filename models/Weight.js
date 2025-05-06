const pool = require("../config/db");

class Weight {
    static async create({ UserId, WeightDate, Weight }) {
        const [result] = await pool.execute(
            'INSERT INTO Weight_History (UserId, WeightDate, Weight) VALUES (?, ?, ?)',
            [UserId, WeightDate, Weight]
        );
        return result.insertId;
    }

    static async findByUser(UserId) {
        const [rows] = await pool.execute(
            'SELECT * FROM Weight_History WHERE UserId = ? ORDER BY WeightDate DESC',
            [UserId]
        );
        return rows;
    }

    static async delete(WeightId) {
        const [result] = await pool.execute(
            'DELETE FROM Weight_History WHERE WeightId = ?',
            [WeightId]
        );
        return result.affectedRows > 0;
    }
}

module.exports = Weight;