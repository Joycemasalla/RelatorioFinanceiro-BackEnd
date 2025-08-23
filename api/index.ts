import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      message: 'API Backend Funcionando!',
      endpoints: [
        'GET /api/whatsapp-webhook - Webhook verification ✅',
        'POST /api/whatsapp-webhook - Receive WhatsApp messages ✅', 
        'GET /api/transactions - Get all transactions',
        'GET /api/transactions?userId=ID - Get user transactions',
        'POST /api/transactions - Create transaction',
        'DELETE /api/transactions?userId=ID&id=ID - Delete transaction'
      ],
      status: 'online',
      timestamp: new Date().toISOString()
    });
  }
  
  return res.status(405).json({ error: 'Method Not Allowed' });
}