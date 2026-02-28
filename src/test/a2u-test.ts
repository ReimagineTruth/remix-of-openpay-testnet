// Simple test file to verify A2U integration
import { PiNetworkService } from '../integrations/pi-network/pi-service';

// Test the A2U flow with sample data
const testA2UFlow = async () => {
  try {
    console.log('Testing A2U flow...');
    
    // Test payment data
    const paymentData = {
      amount: 0.01,
      memo: 'Test A2U payment',
      metadata: {
        feature: 'test',
        timestamp: new Date().toISOString()
      },
      uid: 'test-user-123'
    };

    // Validate payment data
    PiNetworkService.validatePaymentData(paymentData);
    console.log('✅ Payment data validation passed');

    // Test incomplete payments cleanup
    await PiNetworkService.cleanupIncompletePayments();
    console.log('✅ Cleanup completed');

    console.log('✅ A2U flow test completed successfully');
  } catch (error) {
    console.error('❌ A2U flow test failed:', error);
  }
};

// Export for manual testing
export { testA2UFlow };
