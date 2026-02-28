import { useState, useEffect } from 'react';

interface PiUser {
  uid: string;
  username: string;
  avatar: string;
}

export const usePiAuth = () => {
  const [user, setUser] = useState<PiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check if Pi SDK is available
    const checkPiAuth = async () => {
      try {
        // Check if running in Pi Browser environment
        if (typeof window !== 'undefined' && (window as any).Pi) {
          const Pi = (window as any).Pi;
          
          // Authenticate user
          const authResult = await Pi.authenticate();
          
          if (authResult && authResult.user) {
            setUser(authResult.user);
            setIsAuthenticated(true);
          }
        }
      } catch (error) {
        console.error('Pi authentication error:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkPiAuth();
  }, []);

  const authenticate = async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).Pi) {
        const Pi = (window as any).Pi;
        const authResult = await Pi.authenticate();
        
        if (authResult && authResult.user) {
          setUser(authResult.user);
          setIsAuthenticated(true);
          return authResult.user;
        }
      }
      throw new Error('Pi SDK not available');
    } catch (error) {
      console.error('Pi authentication error:', error);
      throw error;
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    authenticate,
  };
};
