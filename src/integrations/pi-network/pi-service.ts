import PiNetwork from 'pi-backend';

// DO NOT expose these values to public
const apiKey = process.env.VITE_PI_API_KEY || "t23dd3gdfkmiihd7xhqdvj37f1jwbbries0ird2l47uafanttrhkudrqed6giias";
const walletPrivateSeed = process.env.VITE_PI_WALLET_PRIVATE_SEED || "SA7HAEE64IDWFQ2MSXO5AK355PBVRMBCZOLDNAWTMY5JK3LPBQ7MYQO6"; // starts with S

const pi = new PiNetwork(apiKey, walletPrivateSeed);

export interface PaymentArgs {
  amount: number;
  memo: string;
  metadata: object;
  uid: string;
}

export interface PaymentDTO {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: object;
  from_address: string;
  to_address: string;
  direction: "user_to_app" | "app_to_user";
  created_at: string;
  network: string;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: null | {
    txid: string;
    verified: boolean;
    _link: string;
  };
}

export interface PaymentRecord {
  payment_id: string;
  pi_uid: string;
  amount: number;
  memo: string;
  txid?: string;
  status: 'created' | 'submitted' | 'completed' | 'cancelled' | 'failed';
  created_at?: string;
  completed_at?: string;
}

export class PiNetworkService {
  /**
   * Create an A2U (App-to-User) payment
   * Step 1 of the A2U flow
   */
  static async createPayment(paymentData: PaymentArgs): Promise<string> {
    try {
      const paymentId = await pi.createPayment(paymentData);
      console.log('Payment created with ID:', paymentId);
      return paymentId;
    } catch (error) {
      console.error('Error creating payment:', error);
      throw new Error(`Failed to create payment: ${error}`);
    }
  }

  /**
   * Submit the payment to the Pi Blockchain
   * Step 2 of the A2U flow
   */
  static async submitPayment(paymentId: string): Promise<string> {
    try {
      const txid = await pi.submitPayment(paymentId);
      console.log('Payment submitted with transaction ID:', txid);
      return txid;
    } catch (error) {
      console.error('Error submitting payment:', error);
      throw new Error(`Failed to submit payment: ${error}`);
    }
  }

  /**
   * Complete the payment in the Pi server
   * Step 3 of the A2U flow
   */
  static async completePayment(paymentId: string, txid: string): Promise<PaymentDTO> {
    try {
      const completedPayment = await pi.completePayment(paymentId, txid);
      console.log('Payment completed:', completedPayment);
      return completedPayment;
    } catch (error) {
      console.error('Error completing payment:', error);
      throw new Error(`Failed to complete payment: ${error}`);
    }
  }

  /**
   * Get payment details
   */
  static async getPayment(paymentId: string): Promise<PaymentDTO> {
    try {
      const payment = await pi.getPayment(paymentId);
      return payment;
    } catch (error) {
      console.error('Error getting payment:', error);
      throw new Error(`Failed to get payment: ${error}`);
    }
  }

  /**
   * Cancel a payment
   */
  static async cancelPayment(paymentId: string): Promise<PaymentDTO> {
    try {
      const cancelledPayment = await pi.cancelPayment(paymentId);
      console.log('Payment cancelled:', cancelledPayment);
      return cancelledPayment;
    } catch (error) {
      console.error('Error cancelling payment:', error);
      throw new Error(`Failed to cancel payment: ${error}`);
    }
  }

  /**
   * Get incomplete server payments
   * Used to clean up any incomplete payments before creating new ones
   */
  static async getIncompleteServerPayments(): Promise<any[]> {
    try {
      const incompletePayments = await pi.getIncompleteServerPayments();
      return incompletePayments || [];
    } catch (error) {
      console.error('Error getting incomplete payments:', error);
      throw new Error(`Failed to get incomplete payments: ${error}`);
    }
  }

  /**
   * Complete A2U payment flow (create -> submit -> complete)
   * This follows the exact flow from Pi Network documentation
   */
  static async completeA2UPaymentFlow(paymentData: PaymentArgs): Promise<PaymentDTO> {
    let paymentId: string | null = null;
    let txid: string | null = null;

    try {
      // Step 0: Clean up any incomplete payments first
      await this.cleanupIncompletePayments();

      // Step 1: Create payment
      paymentId = await this.createPayment(paymentData);
      console.log('Step 1: Payment created successfully');

      // Step 2: Submit payment to blockchain
      txid = await this.submitPayment(paymentId);
      console.log('Step 2: Payment submitted to blockchain');

      // Step 3: Complete payment
      const completedPayment = await this.completePayment(paymentId, txid);
      console.log('Step 3: Payment completed successfully');

      return completedPayment;
    } catch (error) {
      console.error('A2U payment flow failed:', error);
      
      // Attempt cleanup on failure
      if (paymentId && !txid) {
        try {
          await this.cancelPayment(paymentId);
          console.log('Cleaned up incomplete payment');
        } catch (cleanupError) {
          console.error('Failed to cleanup payment:', cleanupError);
        }
      }
      
      throw error;
    }
  }

  /**
   * Clean up incomplete payments
   * This is crucial before creating new payments to avoid conflicts
   */
  static async cleanupIncompletePayments(): Promise<void> {
    try {
      const incompletePayments = await this.getIncompleteServerPayments();
      
      if (incompletePayments && incompletePayments.length > 0) {
        console.log(`Found ${incompletePayments.length} incomplete payments, cleaning up...`);
        
        for (const incompletePayment of incompletePayments) {
          try {
            const oldTxid = incompletePayment?.transaction?.txid;
            if (oldTxid) {
              // If there's a transaction, try to complete it
              await this.completePayment(incompletePayment.identifier, oldTxid);
              console.log(`Completed payment ${incompletePayment.identifier}`);
            } else {
              // If no transaction, cancel it
              await this.cancelPayment(incompletePayment.identifier);
              console.log(`Cancelled payment ${incompletePayment.identifier}`);
            }
          } catch (error) {
            console.error(`Failed to cleanup payment ${incompletePayment.identifier}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error during cleanup of incomplete payments:', error);
      // Don't throw here, allow the main flow to continue
    }
  }

  /**
   * Validate payment data before processing
   */
  static validatePaymentData(paymentData: PaymentArgs): void {
    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    
    if (!paymentData.uid || paymentData.uid.trim() === '') {
      throw new Error('User UID is required');
    }
    
    if (!paymentData.memo || paymentData.memo.trim() === '') {
      throw new Error('Memo is required');
    }
    
    if (!paymentData.metadata) {
      throw new Error('Metadata is required');
    }
    
    // Additional validation for testnet
    if (paymentData.amount > 1) {
      throw new Error('Testnet payments cannot exceed 1 Pi');
    }
  }

  /**
   * Create payment record for database storage
   */
  static createPaymentRecord(
    paymentId: string, 
    paymentData: PaymentArgs, 
    status: PaymentRecord['status'] = 'created'
  ): PaymentRecord {
    return {
      payment_id: paymentId,
      pi_uid: paymentData.uid,
      amount: paymentData.amount,
      memo: paymentData.memo,
      status,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Update payment record with transaction data
   */
  static updatePaymentRecordWithTxid(
    record: PaymentRecord, 
    txid: string, 
    status: PaymentRecord['status']
  ): PaymentRecord {
    return {
      ...record,
      txid,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : undefined,
    };
  }
}

export default PiNetworkService;
