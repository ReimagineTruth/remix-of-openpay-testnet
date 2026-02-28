// Pi Network type declarations
declare global {
  interface Window {
    Pi: {
      authenticate: () => Promise<{ user: PiUser }>;
      createPayment: (paymentData: any) => Promise<any>;
    };
  }
}

interface PiUser {
  uid: string;
  username: string;
  avatar: string;
}

export {};
