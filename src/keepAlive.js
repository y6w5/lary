import express from 'express';

export function keepAlive() {
  const app = express();

  app.get('/', (req, res) => res.send('✅ Online'));
  app.get('/health', (req, res) => res.send('ok'));

  const port = process.env.PORT || 10000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive running on port ${port}`);
  });
}
