const axios = require('axios');

// Configurações
const WEBHOOK_URL = 'http://localhost:3000/api/whatsapp-webhook'; // Para teste local
// const WEBHOOK_URL = 'https://seu-projeto.vercel.app/api/whatsapp-webhook'; // Para produção

const VERIFY_TOKEN = 'seu_verify_token_aqui';

// Teste 1: Verificação do webhook
async function testWebhookVerification() {
  console.log('🔍 Testando verificação do webhook...');
  
  try {
    const response = await axios.get(WEBHOOK_URL, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'test_challenge_12345'
      }
    });
    
    console.log('✅ Verificação bem-sucedida!');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
  } catch (error) {
    console.log('❌ Erro na verificação:');
    console.log('Status:', error.response?.status);
    console.log('Data:', error.response?.data);
  }
}

// Teste 2: Simulação de mensagem recebida
async function testIncomingMessage() {
  console.log('📱 Testando mensagem recebida...');
  
  const messageData = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry_id',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
                phone_number_id: 'test_phone_number_id'
              },
              messages: [
                {
                  from: '5511999999999', // Número de teste
                  id: 'message_id_123',
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: {
                    body: '50 no mercado'
                  },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  try {
    const response = await axios.post(WEBHOOK_URL, messageData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Mensagem processada com sucesso!');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
  } catch (error) {
    console.log('❌ Erro ao processar mensagem:');
    console.log('Status:', error.response?.status);
    console.log('Data:', error.response?.data);
  }
}

// Executar testes
async function runTests() {
  console.log('🧪 Iniciando testes do webhook...\n');
  
  await testWebhookVerification();
  console.log('\n' + '='.repeat(50) + '\n');
  await testIncomingMessage();
  
  console.log('\n✨ Testes concluídos!');
}

// Executar se chamado diretamente
if (require.main === module) {
  runTests();
}

module.exports = { testWebhookVerification, testIncomingMessage };