const SibApiV3Sdk = require('sib-api-v3-sdk');
const defaultClient = SibApiV3Sdk.ApiClient.instance;

exports.sendInviteEmail = async (toEmail, inviteLink, details = {}) => {
  const { roleName, companyName } = details;

  // 🔐 Late-binding the API key and instance to ensure it captures Render Environment changes
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = process.env.MAIL_SERVICE_KEY;
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  console.log(`📧 Attempting Email to: ${toEmail}. Key Prefix: ${process.env.MAIL_SERVICE_KEY ? process.env.MAIL_SERVICE_KEY.substring(0, 10) + "..." : "MISSING"}`);

  try {
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = `Invitation to join ${companyName || 'TMS Platform'}`;
    sendSmtpEmail.htmlContent = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #4CAF50;">Welcome to TMS!</h2>
          <p>Hello,</p>
          <p>You have been invited to join <strong>${companyName || 'our platform'}</strong> as a <strong>${roleName || 'Team Member'}</strong>.</p>
          <p>The Terminal Management System (TMS) allows you to manage merchants, devices, and operations seamlessly.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteLink}" 
               style="background-color: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block;">
               Complete Your Registration
            </a>
          </div>

          <p>This link will expire in 72 hours. If you did not expect this invitation, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #777;">Sent securely by the Terminal Management System.</p>
        </div>
      `;
    sendSmtpEmail.sender = { name: "TMS Admin", email: process.env.SENDER_EMAIL };
    sendSmtpEmail.to = [{ email: toEmail }];

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("Professional Email sent via Brevo:", result.messageId);

  } catch (error) {
    const errorDetail = error.response ? error.response.body : error.message;
    console.error("❌ BREVO ERROR:", errorDetail);

    // Throw error so the controller catch block handles it
    throw new Error(`Email delivery failed: ${JSON.stringify(errorDetail)}`);
  }
};
