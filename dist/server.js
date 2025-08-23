"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const transaction_1 = __importDefault(require("./routes/transaction"));
const whatsappWebhook_1 = __importDefault(require("./whatsappWebhook"));
const body_parser_1 = __importDefault(require("body-parser"));
require("./models/UserMapping");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: false }));
// IMPORTANTE: Registrar as rotas da API ANTES de qualquer rota catch-all
app.use('/api', transaction_1.default);
app.use('/api/whatsapp-webhook', whatsappWebhook_1.default);
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
mongoose_1.default.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado ao MongoDB Atlas'))
    .catch(err => console.error('❌ Erro ao conectar com o MongoDB', err));
app.listen(port, () => {
    console.log(`🚀 Servidor backend rodando em http://localhost:${port}`);
    console.log(`📱 Webhook disponível em http://localhost:${port}/api/whatsapp-webhook`);
    console.log(`📊 API de transações em http://localhost:${port}/api/transactions`);
});
