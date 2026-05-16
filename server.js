import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { solscanService } from './server/SolscanService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the root (since this is where index.html lives)
app.use(express.static(__dirname));

// API Endpoint: Trending Tokens
app.get('/api/trending', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 12;
        const tokens = await solscanService.fetchTrendingTokens(count);
        res.json(tokens);
    } catch (error) {
        console.error('Error fetching trending tokens:', error);
        res.status(500).json({ error: 'Failed to fetch trending tokens' });
    }
});

// API Endpoint: Pump.fun Graduates
app.get('/api/graduates', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 8;
        const tokens = await solscanService.fetchLaunchpadTokens('graduated', count);
        res.json(tokens);
    } catch (error) {
        console.error('Error fetching graduate tokens:', error);
        res.status(500).json({ error: 'Failed to fetch graduate tokens' });
    }
});

// API Endpoint: Token Details
app.get('/api/token/:mint', async (req, res) => {
    try {
        const mint = req.params.mint;
        // In the future, we can add `enrichToken` equivalent here
        const details = await solscanService.getCachedToken(mint);
        res.json(details);
    } catch (error) {
        console.error('Error fetching token details:', error);
        res.status(500).json({ error: 'Failed to fetch token details' });
    }
});

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';

// API Endpoint: Spotify Login
app.get('/api/spotify/login', (req, res) => {
    if (!SPOTIFY_CLIENT_ID) {
        return res.status(500).send('Spotify integration not configured.');
    }
    const scopes = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
    const redirectUri = 'http://localhost:3000/auth/spotify/callback';
    res.redirect(`https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`);
});

// Callback for Spotify
app.get('/auth/spotify/callback', (req, res) => {
    res.send(`
        <html><body><script>
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            if (token) {
                localStorage.setItem('spotify_access_token', token);
                window.location.href = '/';
            } else {
                document.body.innerHTML = 'Spotify connection failed. Please make sure you have the client ID configured. <br><a href="/">Return to Game</a>';
            }
        </script></body></html>
    `);
});

// Catch-all to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Solscan API Key Configured: ${process.env.SOLSCAN_API_KEY ? 'Yes' : 'No'}`);
});
