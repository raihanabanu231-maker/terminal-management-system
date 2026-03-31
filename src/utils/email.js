const Brevo = require('@getbrevo/brevo');
const defaultClient = Brevo.ApiClient.instance;

/**
 * Sends an invitation email to a new user via Brevo Transactional Email service.
 * Standardizes on the modern @getbrevo/brevo SDK.
 */
exports.sendInviteEmail = async (toEmail, inviteLink, details = {}) => {
  const { roleName, companyName } = details;

  // 1. Pre-flight check for environment variables
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    console.warn("⚠️ EMAIL_CONFIG_MISSING: Invitation created but email service is not configured (BREVO_API_KEY or SENDER_EMAIL).");
    throw new Error("Brevo Email Service is not configured on this server.");
  }

  // 2. Configure Authentications (Dynamic for multi-environment support)
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = process.env.BREVO_API_KEY;

  const apiInstance = new Brevo.TransactionalEmailsApi();

  console.log(`📧 Attempting to send invitation to: ${toEmail}`);

  try {
    const sendSmtpEmail = new Brevo.SendSmtpEmail();

    sendSmtpEmail.subject = `Invitation to join ${companyName || 'TMS Platform'}`;
    sendSmtpEmail.htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 25px; border-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #4CAF50; margin: 0;">Welcome to ATPL TMS</h1>
            <p style="color: #666; font-size: 0.9em; margin-top: 5px;">Unified Terminal Management</p>
          </div>
          
          <p>Hello,</p>
          <p>You have been formally invited to join the <strong>${companyName || 'TMS Organization'}</strong> on our platform.</p>
          
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50;">
            <p style="margin: 5px 0;"><strong>Role:</strong> ${roleName || 'Team Member'}</p>
            <p style="margin: 5px 0;"><strong>Company:</strong> ${companyName || 'Enterprise TMS'}</p>
          </div>

          <p>To finalize your account setup and access the dashboard, please click the button below:</p>
          
          <div style="text-align: center; margin: 35px 0;">
            <a href="${inviteLink}" 
               style="background-color: #4CAF50; color: #ffffff; padding: 14px 30px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
               Complete My Registration
            </a>
          </div>

          <p style="font-size: 0.85em; color: #888;">Note: This secure link will remain valid for **72 hours**. If you did not expect this request, please contact your administrator or ignore this email.</p>
          
          <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;" />
          <p style="font-size: 11px; color: #aaa; text-align: center;">Sent securely via Terminal Management System (TMS) • ATPL Group</p>
        </div>
      `;

    // 3. Sender Verification: Must be a verified email in Brevo
    sendSmtpEmail.sender = { name: "TMS Admin", email: process.env.SENDER_EMAIL };
    sendSmtpEmail.to = [{ email: toEmail }];

    // 4. Send Email
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Professional Invite Sent. MessageId: ${result.messageId}`);
    return result;

  } catch (error) {
    // Extract the precise error from the response body if available
    const errorBody = error.response && error.response.body ? JSON.stringify(error.response.body) : error.message;
    console.error("❌ BREVO_SERVICE_ERROR:", errorBody);

    // Provide clear troubleshooting hints based on common errors
    if (errorBody.includes("unauthorized")) {
      throw new Error("Brevo Error: Invalid API Key. Please check BREVO_API_KEY.");
    } else if (errorBody.includes("invalid_sender")) {
      throw new Error(`Brevo Error: Sender email (${process.env.SENDER_EMAIL}) is not verified in your account.`);
    } else {
      throw new Error(`Email delivery failed: ${errorBody}`);
    }
  }
};
