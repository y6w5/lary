import express from 'express';

export function keepAlive() {
  const app = express();

  app.get('/', (req, res) => {
    res.json({ status: '✅ Online', timestamp: new Date().toISOString() });
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🌐 Keep-alive running on port ${port}`));
}
