class User {
    static async create({ UserName, Email, Password, Height, Weight, Gender }) {
      const [result] = await pool.execute(
        'INSERT INTO user (UserName, Email, Password, Height, Weight, Gender) VALUES (?, ?, ?, ?, ?, ?)',
        [UserName, Email, Password, Height, Weight, Gender]
      );
      return result.insertId;
    }
  
    static async findByEmail(Email) {
      const [rows] = await pool.execute('SELECT * FROM user WHERE Email = ?', [Email]);
      return rows[0];
    }
  
    
  }
  
  module.exports = User;