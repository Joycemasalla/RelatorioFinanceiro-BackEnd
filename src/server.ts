import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import transactionRoutes from './routes/transaction';
import whatsappWebhook from './whatsappWebhook';
import bodyParser from 'body-parser';
import './models/UserMapping';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));

// IMPORTANTE: Registrar as rotas da API ANTES de qualquer rota catch-all
app.use('/api', transactionRoutes);
app.use('/api/whatsapp-webhook', whatsappWebhook);

// Rota de teste para a raiz
app.get('/', (req, res) => {
  res.json({ 
    message: 'Servidor backend rodando!',
    endpoints: [
      'GET /api/whatsapp-webhook - Webhook verification',
      'POST /api/whatsapp-webhook - Receive WhatsApp messages',
      'GET /api/transactions/:userId - Get user transactions',
      'POST /api/transactions - Create transaction',
      'DELETE /api/transactions/:userId/:id - Delete transaction'
    ]
  });
});

// Rota de teste específica para debug
app.get('/test', (req, res) => {
  res.json({ status: 'Backend funcionando', timestamp: new Date().toISOString() });
});

// Middleware de erro para rotas não encontradas
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Rota não encontrada',
    path: req.originalUrl,
    message: 'Esta rota não existe no backend'
  });
});

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log('✅ Conectado ao MongoDB Atlas'))
  .catch(err => console.error('❌ Erro ao conectar com o MongoDB', err));

app.listen(port, () => {
  console.log(`🚀 Servidor backend rodando em http://localhost:${port}`);
  console.log(`📱 Webhook disponível em http://localhost:${port}/api/whatsapp-webhook`);
  console.log(`📊 API de transações em http://localhost:${port}/api/transactions`);
});