/**
 * Connection Test - Force Fresh Code Load
 * This file helps verify if the development build is loading fresh code
 */

console.log('🔄 CONNECTION TEST LOADED AT:', new Date().toISOString());
console.log('📱 This message should appear in Metro logs if connected properly');

// Export a test function that will be called from the app
export const testConnection = () => {
  const timestamp = new Date().toISOString();
  console.log('✅ FRESH CONNECTION VERIFIED AT:', timestamp);
  return timestamp;
};

export default {
  testConnection,
  loadTime: new Date().toISOString()
};