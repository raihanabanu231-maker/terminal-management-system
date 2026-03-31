const Brevo = require('@getbrevo/brevo');

try {
  const apiInstance = new Brevo.TransactionalEmailsApi();
  console.log("TransactionalEmailsApi instance created.");
  
  // Method 1 (older)
  // apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, 'test');
  
  // Method 2 (modern)
  // let config = new Brevo.Configuration();
  // config.apiKey = 'test';
  
  console.log("Brevo.TransactionalEmailsApiApiKeys:", !!Brevo.TransactionalEmailsApiApiKeys);
} catch (e) {
  console.error("Test Error:", e.message);
}
