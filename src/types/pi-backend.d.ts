// Type declarations for pi-backend package
declare module 'pi-backend' {
  export interface PaymentData {
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

  export interface PaymentArgs {
    amount: number;
    memo: string;
    metadata: object;
    uid: string;
  }

  export default class PiNetwork {
    constructor(apiKey: string, walletPrivateSeed: string, options?: { network?: string });
    
    createPayment(paymentData: PaymentArgs): Promise<string>;
    
    submitPayment(paymentId: string): Promise<string>;
    
    completePayment(paymentId: string, txid: string): Promise<PaymentData>;
    
    getPayment(paymentId: string): Promise<PaymentData>;
    
    cancelPayment(paymentId: string): Promise<PaymentData>;
    
    getIncompleteServerPayments(): Promise<PaymentData[]>;
  }
}
