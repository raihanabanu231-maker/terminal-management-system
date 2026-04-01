const axios = require('axios');

/**
 * Sends an invitation email using the Brevo SMTP REST API (Axios).
 * Direct REST usage is more stable in cloud environments like Render 
 * compared to SDK wrappers which can have initialization conflicts.
 */
exports.sendInviteEmail = async (toEmail, inviteLink, details = {}) => {
  const { roleName, companyName } = details;

  // 1. Validation
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    console.error("⚠️ EMAIL_CONFIGURATION_MISSING: BREVO_API_KEY or SENDER_EMAIL is not set.");
    throw new Error("Email service not configured.");
  }

  console.log(`📧 Sending invitation via REST API to: ${toEmail}`);

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { 
          name: "TMS Admin", 
          email: process.env.SENDER_EMAIL 
        },
        to: [
          { email: toEmail }
        ],
        subject: `Invitation to join ${companyName || 'TMS Platform'}`,
        htmlContent: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 12px; background-color: #fdfdfd;">
            <div style="text-align: center; border-bottom: 2px solid #4CAF50; padding-bottom: 15px; margin-bottom: 20px;">
              <h1 style="color: #4CAF50; margin: 0;">ATPL TMS Invitation</h1>
            </div>
            
            <p>Hello,</p>
            <p>You have been invited to join <strong>${companyName || 'our organization'}</strong> on the Terminal Management System.</p>
            
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 5px solid #4CAF50;">
              <p style="margin: 0;"><strong>Assigned Role:</strong> ${roleName || 'Team Member'}</p>
            </div>

            <p>Please click the button below to secure your account and access the dashboard:</p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${inviteLink}" 
                 style="background-color: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                 Finalize Account Setup
              </a>
            </div>

            <p style="color: #777; font-size: 0.85em;">This link is valid for **72 hours**. If you didn't expect this invitation, you can ignore this email safely.</p>
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="font-size: 11px; color: #aaa; text-align: center;">Sent securely via ATPL Group • Terminal Management System</p>
          </div>
        `
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout for responsiveness
      }
    );

    console.log(`✅ Professional Invite Sent. MessageId: ${response.data.messageId}`);
    return response.data;

  } catch (error) {
    // Standardize error reporting from Axios
    const errorCode = error.response ? error.response.status : 'TIMEOUT/NETWORK';
    const errorData = error.response ? error.response.data : error.message;
    
    console.error(`❌ BREVO_REST_FAILURE [${errorCode}]:`, JSON.stringify(errorData));

    // Specific error mapping for easier troubleshooting
    if (errorCode === 401) {
      throw new Error("Invalid Brevo API Key. Please update BREVO_API_KEY.");
    } else if (errorCode === 400 && JSON.stringify(errorData).includes("sender")) {
      throw new Error(`The sender email (${process.env.SENDER_EMAIL}) is not verified in Brevo.`);
    } else {
      throw new Error(`Email delivery failed: ${JSON.stringify(errorData)}`);
    }
  }
};

/**
 * Sends a password reset email using the Brevo SMTP REST API.
 */
exports.sendResetPasswordEmail = async (toEmail, resetLink) => {
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    console.error("⚠️ EMAIL_CONFIGURATION_MISSING: BREVO_API_KEY or SENDER_EMAIL is not set.");
    throw new Error("Email service not configured.");
  }

  console.log(`📧 Sending password reset via REST API to: ${toEmail}`);

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { 
          name: "TMS Security", 
          email: process.env.SENDER_EMAIL 
        },
        to: [
          { email: toEmail }
        ],
        subject: "Reset your ATPL TMS password",
        htmlContent: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 12px; background-color: #fdfdfd;">
            <div style="text-align: center; border-bottom: 2px solid #f44336; padding-bottom: 15px; margin-bottom: 20px;">
              <h1 style="color: #f44336; margin: 0;">Password Reset Request</h1>
            </div>
            
            <p>Hello,</p>
            <p>We received a request to reset the password for your Terminal Management System account.</p>
            <p>If you made this request, please click the button below to set a new password:</p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${resetLink}" 
                 style="background-color: #f44336; color: white; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                 Reset My Password
              </a>
            </div>

            <p style="color: #777; font-size: 0.85em;">This link is valid for **1 hour**. If you did not request a password reset, you can ignore this email safely.</p>
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="font-size: 11px; color: #aaa; text-align: center;">Sent securely via ATPL Group • Terminal Management System Security</p>
          </div>
        `
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(`✅ Password Reset Email Sent. MessageId: ${response.data.messageId}`);
    return response.data;

  } catch (error) {
    const errorCode = error.response ? error.response.status : 'TIMEOUT/NETWORK';
    const errorData = error.response ? error.response.data : error.message;
    console.error(`❌ BREVO_RESET_FAILURE [${errorCode}]:`, JSON.stringify(errorData));
    throw new Error(`Email delivery failed: ${JSON.stringify(errorData)}`);
  }
};
