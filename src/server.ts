import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import transactionRoutes from './routes/transaction';
import twilioWebhook from './twilioWebhook';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001; // Você pode manter 3001 para evitar conflitos

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Rotas da API
app.use('/api', transactionRoutes);
app.use('/api', twilioWebhook);

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log('Conectado ao MongoDB Atlas'))
  .catch(err => console.error('Erro ao conectar com o MongoDB', err));

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});