import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ExternalLink, RefreshCw, CheckCircle, Clock, XCircle } from 'lucide-react';

// Define types locally to avoid import issues
interface PaymentDTO {
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

interface A2UPaymentStatusProps {
  paymentId: string;
  onClose?: () => void;
}

export const A2UPaymentStatus: React.FC<A2UPaymentStatusProps> = ({ 
  paymentId, 
  onClose 
}) => {
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchPaymentStatus = async () => {
    try {
      setError(null);
      const response = await fetch(`http://localhost:8788/api/a2u-payment/${paymentId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch payment status');
      }
      
      const data = await response.json();
      if (data.success) {
        setPayment(data.payment);
      } else {
        throw new Error(data.error || 'Failed to get payment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch payment status');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPaymentStatus();
  }, [paymentId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchPaymentStatus();
  };

  const getStatusBadge = () => {
    if (!payment) return null;

    const { status } = payment;
    
    if (status.cancelled || status.user_cancelled) {
      return <Badge variant="destructive">Cancelled</Badge>;
    }
    
    if (status.developer_completed && status.transaction_verified) {
      return <Badge variant="default" className="bg-green-500">Completed</Badge>;
    }
    
    if (status.developer_completed && !status.transaction_verified) {
      return <Badge variant="secondary">Pending Verification</Badge>;
    }
    
    if (status.developer_approved) {
      return <Badge variant="outline">In Progress</Badge>;
    }
    
    return <Badge variant="outline">Created</Badge>;
  };

  const getStatusIcon = () => {
    if (!payment) return <Clock className="h-5 w-5 text-gray-400" />;

    const { status } = payment;
    
    if (status.cancelled || status.user_cancelled) {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    
    if (status.developer_completed && status.transaction_verified) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    
    return <Clock className="h-5 w-5 text-blue-500" />;
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Payment Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Fetching payment details from Pi Network...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error || !payment) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-red-600">Payment Status Error</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{error || 'Payment not found'}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline">
              {isRefreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Retry
            </Button>
            {onClose && (
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            Payment Status
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardTitle>
        <CardDescription>
          Payment ID: {paymentId}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium">Amount</p>
            <p className="text-2xl font-bold">{payment.amount} Pi</p>
          </div>
          <div>
            <p className="font-medium">Network</p>
            <p className="text-lg">{payment.network}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-medium">Memo</p>
          <p className="text-sm bg-gray-50 p-2 rounded">{payment.memo}</p>
        </div>

        <div className="space-y-2">
          <p className="font-medium">User</p>
          <p className="text-sm font-mono bg-gray-50 p-2 rounded">{payment.user_uid}</p>
        </div>

        {payment.transaction && (
          <div className="space-y-2">
            <p className="font-medium">Transaction Details</p>
            <div className="bg-gray-50 p-3 rounded space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Transaction ID:</span>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-white px-2 py-1 rounded">
                    {payment.transaction.txid}
                  </code>
                  {payment.transaction._link && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <a
                        href={payment.transaction._link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Verified:</span>
                <Badge variant={payment.transaction.verified ? "default" : "secondary"}>
                  {payment.transaction.verified ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="font-medium">Status Details</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
              <span>Approved:</span>
              <Badge variant={payment.status.developer_approved ? "default" : "secondary"}>
                {payment.status.developer_approved ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
              <span>Verified:</span>
              <Badge variant={payment.status.transaction_verified ? "default" : "secondary"}>
                {payment.status.transaction_verified ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
              <span>Completed:</span>
              <Badge variant={payment.status.developer_completed ? "default" : "secondary"}>
                {payment.status.developer_completed ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
              <span>Cancelled:</span>
              <Badge variant={payment.status.cancelled ? "destructive" : "secondary"}>
                {payment.status.cancelled ? "Yes" : "No"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Created: {new Date(payment.created_at).toLocaleString()}</p>
          <p>Direction: {payment.direction.replace('_', ' to ')}</p>
          {payment.from_address && (
            <p>From: {payment.from_address.slice(0, 8)}...{payment.from_address.slice(-8)}</p>
          )}
          {payment.to_address && (
            <p>To: {payment.to_address.slice(0, 8)}...{payment.to_address.slice(-8)}</p>
          )}
        </div>

        {onClose && (
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default A2UPaymentStatus;
