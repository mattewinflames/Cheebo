import crypto from 'crypto';

const NEXI_BASE_URL = 'https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp/api/v1';
const NEXI_API_KEY = process.env.NEXI_API_KEY || '2e570a58-9914-477a-9ede-35baff23a376';

async function testCreateHppOrder() {
  const orderId = `ORD${Date.now().toString().slice(-10)}`;
  const correlationId = crypto.randomUUID();

  // Payload conforme al DTO Nexi XPay 360 /orders/hpp
  const payload = {
    order: {
      orderId: orderId,
      amount: 1550, // 15.50€ in centesimi
      currency: 'EUR',
    },
    paymentSession: {
      action: 'PAYMENT',
      amount: 1550,
      currency: 'EUR',
      resultUrl: 'https://example.com/esito?status=success',
      cancelUrl: 'https://example.com/esito?status=cancel',
      notificationUrl: 'https://example.com/api/nexi-webhook',
    },
  };

  console.log(`🚀 Inizio test creazione ordine Nexi HPP (ID: ${orderId})...`);

  try {
    const response = await fetch(`${NEXI_BASE_URL}/orders/hpp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': NEXI_API_KEY,
        'Correlation-Id': correlationId,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Errore risposta Nexi:', JSON.stringify(data, null, 2));
      return;
    }

    console.log('✅ Risposta ricevuta con successo!\n');
    console.log('--------------------------------------------------');
    console.log('🔗 URL Checkout Nexi (Hosted Page):');
    console.log(data.hostedPage);
    console.log('--------------------------------------------------');
    console.log('🔑 Security Token:', data.securityToken);

  } catch (error) {
    console.error('💥 Errore di rete o di esecuzione:', error);
  }
}

testCreateHppOrder();