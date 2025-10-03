// Simple test script to verify Gemini API connectivity
const API_KEY = "AIzaSyB_keeUJQhLwK8fUlnDRDoZDuO4rreneqY";

async function testGeminiConnection() {
  try {
    console.log("🔍 Testing Gemini API connection...");
    console.log("🌐 API Key:", API_KEY.substring(0, 10) + "...");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    console.log("📡 URL:", url.substring(0, 80) + "...");
    
    const payload = {
      contents: [{
        parts: [{
          text: "Write a short, creative social media post about testing APIs. Make it fun and engaging!"
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100
      }
    };
    
    console.log("📦 Payload size:", JSON.stringify(payload).length, "bytes");
    console.log("⏰ Starting request at:", new Date().toISOString());
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.log("📊 Response status:", response.status);
    console.log("📋 Response headers:", JSON.stringify([...response.headers.entries()]));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log("❌ Error response body:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log("✅ Success! Response:", JSON.stringify(data, null, 2));
    
    return data;
    
  } catch (error) {
    console.log("💥 Error caught:", error.name, "-", error.message);
    console.log("🔍 Error stack:", error.stack);
    throw error;
  }
}

// Run the test
testGeminiConnection()
  .then(() => {
    console.log("🎉 Test completed successfully!");
  })
  .catch((error) => {
    console.log("💔 Test failed:", error.message);
  });