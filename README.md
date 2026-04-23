# The Distress Filter

AI-Powered Motivated Seller Intelligence Dashboard

## Setup

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment variables

Edit `backend/.env`:

```
ATTOM_API_KEY=your_attom_api_key_here
MONGODB_URI=mongodb://localhost:27017/distress-filter
JWT_SECRET=your_secret_here
PORT=3002
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password
```

### 3. Start MongoDB

Make sure MongoDB is running locally on port 27017.

### 4. Start the backend

```bash
cd backend
npm start
```

Backend runs on: http://localhost:3002

### 5. Start the frontend

```bash
cd frontend
npm run dev
```

Frontend runs on: http://localhost:5173

## Login

Default credentials: `admin` / `password`

## Features

- Search ATTOM Data API by zip code with filters
- Motivation Score Engine (0–100): HOT / WARM / COLD
- Lead table sorted by score descending
- Export leads to CSV
- Send any lead to Alisha AI Caller (localhost:3000)
- JWT authentication
