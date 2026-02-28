import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';

interface PiPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentComplete?: (paymentData: any) => void;
  userUid?: string;
}

interface PaymentFormData {
  amount: string;
  memo: string;
}

interface PaymentStep {
  id: 'create' | 'submit' | 'complete';
  label: string;
  description: string;
}

const PAYMENT_STEPS: PaymentStep[] = [
  {
    id: 'create',
    label: 'Creating Payment',
    description: 'Initializing payment with Pi Network...'
  },
  {
    id: 'submit',
    label: 'Submitting to Blockchain',
    description: 'Sending transaction to Pi Blockchain...'
  },
  {
    id: 'complete',
    label: 'Completing Payment',
    description: 'Finalizing payment with Pi Network...'
  }
];

export const PiPaymentModal: React.FC<PiPaymentModalProps> = ({
  isOpen,
  onClose,
  onPaymentComplete,
  userUid = '',
}) => {
  const [formData, setFormData] = useState<PaymentFormData>({
    amount: '0.01',
    memo: 'OpenPay developer payout testing (A2U)',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<PaymentStep['id'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [paymentResult, setPaymentResult] = useState<any>(null);

  const handleInputChange = (field: keyof PaymentFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userUid) {
      setError('User UID is required for payment');
      return;
    }

    if (!formData.amount || Number(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (Number(formData.amount) > 1) {
      setError('Testnet payments cannot exceed 1 Pi');
      return;
    }

    setIsLoading(true);
    setError(null);
    setCurrentStep('create');

    try {
      // Step 1: Create payment
      const response = await fetch('http://localhost:8788/api/a2u-withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: userUid,
          amount: Number(formData.amount),
          memo: formData.memo,
          metadata: {
            feature: 'a2u_withdraw',
            requested_at: new Date().toISOString(),
            app: 'OpenPay',
            user_agent: navigator.userAgent,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Payment failed');
      }

      const data = await response.json();
      
      // Simulate step progression for better UX
      setCurrentStep('submit');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setCurrentStep('complete');
      await new Promise(resolve => setTimeout(resolve, 1000));

      setPaymentResult(data);
      setSuccess(true);
      onPaymentComplete?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
      setCurrentStep(null);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setSuccess(false);
      setPaymentResult(null);
      setError(null);
      setCurrentStep(null);
      onClose();
    }
  };

  const getCurrentStepInfo = () => {
    return PAYMENT_STEPS.find(step => step.id === currentStep);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Testnet Payouts</DialogTitle>
          <DialogDescription>
            Click the button below to receive {formData.amount} Pi app-to-user payout to your testnet Pi wallet.
            You must be authenticated in Pi Browser to continue.
          </DialogDescription>
        </DialogHeader>

        {!success ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (Pi)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                disabled={isLoading}
                placeholder="0.01"
              />
              <p className="text-xs text-muted-foreground">Maximum: 1 Pi for testnet</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="memo">Memo</Label>
              <Textarea
                id="memo"
                value={formData.memo}
                onChange={(e) => handleInputChange('memo', e.target.value)}
                disabled={isLoading}
                placeholder="Payment description"
                rows={2}
              />
            </div>

            {!userUid && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Pi account not linked. Authenticate with Pi Browser to continue.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isLoading && currentStep && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{getCurrentStepInfo()?.label}</span>
                  </div>
                  <p className="text-xs mt-1">{getCurrentStepInfo()?.description}</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                disabled={isLoading || !userUid}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Receive your ${formData.amount} Testnet Pi`
                )}
              </Button>

              {!userUid && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLoading}
                  className="w-full"
                >
                  Authenticate with Pi
                </Button>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              This is for OpenPay developer payouts testing (A2U). Only {formData.amount} pi per click is allowed.
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Payment successful! {formData.amount} Pi has been sent to your wallet.
              </AlertDescription>
            </Alert>

            {paymentResult && (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <h4 className="font-semibold text-sm">Payment Details:</h4>
                  <div className="space-y-1 text-sm">
                    <p><strong>Payment ID:</strong> {paymentResult.paymentId}</p>
                    <p><strong>Transaction ID:</strong> {paymentResult.txid}</p>
                    <p><strong>Network:</strong> {paymentResult.paymentData?.network || 'Testnet'}</p>
                    <p><strong>Status:</strong> 
                      <span className={`ml-1 px-2 py-1 rounded text-xs ${
                        paymentResult.payment?.status?.developer_completed 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {paymentResult.payment?.status?.developer_completed ? 'Completed' : 'Processing'}
                      </span>
                    </p>
                    {paymentResult.paymentData?.transaction?._link && (
                      <p>
                        <strong>Blockchain Explorer:</strong>{' '}
                        <a 
                          href={paymentResult.paymentData.transaction._link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          View Transaction
                        </a>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleClose} className="flex-1">
                Close
              </Button>
              <Button variant="outline" onClick={() => window.open('https://minepi.com', '_blank')}>
                Go to Top Up
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PiPaymentModal;
