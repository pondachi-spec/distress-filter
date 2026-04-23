const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'password';

    if (username !== adminUser) {
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = password === adminPass;
    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, username });
});

module.exports = router;
