const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.register = async (req, res) => {
  try {
    const { UserName, Email, Password, Height, Weight, Gender } = req.body;
    
    // Hashowanie hasła
    const hashedPassword = await bcrypt.hash(Password, 10);
    
    const UserId = await User.create({
      UserName,
      Email,
      Password: hashedPassword,
      Height,
      Weight,
      Gender
    });

    res.status(201).json({ 
      message: 'Rejestracja zakończona pomyślnie',
      UserId 
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Email lub nazwa użytkownika już istnieje' });
    }
    res.status(500).json({ error: 'Błąd serwera' });
  }
};

exports.login = async (req, res) => {
  try {
    const { Email, Password } = req.body;
    const user = await User.findByEmail(Email);
    
    if (!user || !(await bcrypt.compare(Password, user.Password))) {
      return res.status(401).json({ error: 'Nieprawidłowe dane logowania' });
    }

    // Tutaj możesz dodać generowanie tokena JWT
    res.json({ message: 'Zalogowano pomyślnie', user });
  } catch (error) {
    res.status(500).json({ error: 'Błąd serwera' });
  }
};