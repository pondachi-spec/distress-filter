const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/leads', require('./routes/leads'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'Distress Filter', port: PORT });
});

// Connect to MongoDB then start server
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('[MongoDB] Connected');
        app.listen(PORT, () => {
            console.log(`\n===========================================`);
            console.log(`🔍 Distress Filter Backend Running on Port ${PORT}`);
            console.log(`💻 API Base: http://localhost:${PORT}/api`);
            console.log(`===========================================\n`);
        });
    })
    .catch(err => {
        console.error('[MongoDB] Connection failed:', err.message);
        process.exit(1);
    });
