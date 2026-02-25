require('dotenv').config();
const SibApiV3Sdk = require('sib-api-v3-sdk');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.AccountApi();

async function testKey() {
    try {
        console.log("🔍 Testing Brevo API Key from .env...");
        console.log("Key Prefix:", process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.substring(0, 10) + "..." : "UNDEFINED");

        const data = await apiInstance.getAccount();
        console.log("✅ SUCCESS! Your Brevo Key is Valid.");
        console.log("Account Email:", data.email);
    } catch (error) {
        console.error("❌ FAILURE! Brevo says your key is invalid.");
        console.error("Error Detail:", error.response ? error.response.body : error.message);
        console.log("\n💡 TIP: If you see 'unauthorized', you must generate a NEW 'v3 API Key' in Brevo.");
    }
}

testKey();
