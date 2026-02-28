import { useState } from 'react';
import { usePiAuth } from '@/hooks/use-pi-auth';
import PiPaymentModal from '@/components/pi-network/pi-payment-modal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Coins, Wallet } from 'lucide-react';

const PiTestnetPayoutPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { user, isAuthenticated, isLoading, isPiBrowser, authenticate, openPiBrowser } = usePiAuth();

  const handlePaymentComplete = (paymentData: any) => {
    console.log('Payment completed:', paymentData);
    // You can add additional logic here, like updating user balance
  };

  const handleAuthenticate = async () => {
    try {
      await authenticate();
    } catch (error) {
      console.error('Authentication failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-600 flex items-center justify-center">
        <div className="text-white text-center">
          <Wallet className="h-12 w-12 mx-auto mb-4 animate-pulse" />
          <p>Loading Pi Network...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-600 p-4">
      <div className="max-w-md mx-auto pt-8">
        <Card className="bg-white/10 backdrop-blur-md border-white/20">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Coins className="h-16 w-16 text-yellow-400" />
            </div>
            <CardTitle className="text-2xl font-bold text-white">
              Testnet Payouts
            </CardTitle>
            <CardDescription className="text-blue-100">
              Get testnet Pi coins to try out the platform
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {!isPiBrowser ? (
              <div className="space-y-4">
                <Alert variant="destructive" className="border-red-300 bg-red-50">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-red-800">
                    This app requires Pi Browser. Please open in Pi Browser to continue.
                  </AlertDescription>
                </Alert>

                <Button 
                  onClick={openPiBrowser}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                >
                  Open in Pi Browser
                </Button>

                <p className="text-center text-blue-100 text-sm">
                  Click above to open this app in Pi Browser for authentication.
                </p>
              </div>
            ) : !isAuthenticated ? (
              <div className="space-y-4">
                <Alert variant="destructive" className="border-orange-300 bg-orange-50">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-orange-800">
                    Pi account not linked. Authenticate with Pi Browser to continue.
                  </AlertDescription>
                </Alert>

                <Button 
                  onClick={handleAuthenticate}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                >
                  Authenticate with Pi
                </Button>

                <p className="text-center text-blue-100 text-sm">
                  Connect your Pi account to receive testnet payouts.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white/10 rounded-lg p-4 border border-white/20">
                  <p className="text-sm text-blue-100 mb-2">Authenticated as:</p>
                  <div className="flex items-center space-x-3">
                    {user?.avatar && (
                      <img 
                        src={user.avatar} 
                        alt={user.username}
                        className="w-10 h-10 rounded-full"
                      />
                    )}
                    <div>
                      <p className="text-white font-medium">{user?.username}</p>
                      <p className="text-blue-200 text-sm">UID: {user?.uid}</p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => setIsModalOpen(true)}
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                  size="lg"
                >
                  Receive your 0.01 Testnet Pi
                </Button>

                <p className="text-center text-blue-100 text-sm">
                  Click button above to receive 0.01 Pi to your testnet Pi wallet.
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-white/20">
              <div className="flex justify-between">
                <Button 
                  variant="ghost" 
                  className="text-blue-100 hover:text-white hover:bg-white/10"
                  onClick={() => window.history.back()}
                >
                  Close
                </Button>
                <Button 
                  variant="outline" 
                  className="border-white/20 text-blue-100 hover:bg-white/10"
                  onClick={() => window.open('https://minepi.com', '_blank')}
                >
                  Go to Top Up
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-blue-100 text-sm">
            This is a testnet environment for testing purposes only.
          </p>
          <p className="text-blue-200 text-xs mt-2">
            Testnet Pi has no real-world value.
          </p>
          {isPiBrowser && (
            <div className="mt-4 p-3 bg-white/10 rounded-lg border border-white/20">
              <p className="text-green-300 text-sm font-medium">
                ✅ Running in Pi Browser
              </p>
              <p className="text-blue-200 text-xs mt-1">
                Production mode: Sandbox disabled
              </p>
            </div>
          )}
        </div>
      </div>

      <PiPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPaymentComplete={handlePaymentComplete}
        userUid={user?.uid}
      />
    </div>
  );
};

export default PiTestnetPayoutPage;
