const SibApiV3Sdk = require('sib-api-v3-sdk');
const defaultClient = SibApiV3Sdk.ApiClient.instance;

// Configure API key authorization: api-key
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

exports.sendInviteEmail = async (toEmail, inviteLink) => {
  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = "TMS Invitation";
    sendSmtpEmail.htmlContent = `
        <h3>You are invited to TMS</h3>
        <p>Click the link below to register:</p>
        <a href="${inviteLink}" 
           style="background:#4CAF50;padding:10px 20px;color:white;text-decoration:none;border-radius:5px;">
           Register Now
        </a>
      `;
    sendSmtpEmail.sender = { name: "TMS System", email: process.env.SENDER_EMAIL };
    sendSmtpEmail.to = [{ email: toEmail }];

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("Email sent via Brevo:", result);

  } catch (error) {
    console.warn("⚠️ Failed to send email via Brevo (Check API Key). Falling back to console log.");
    console.log(`\n📨 MOCK EMAIL TO: ${toEmail}`);
    console.log(`🔗 LINK: ${inviteLink}\n`);
    // Do not throw error so the flow continues
  }
};
