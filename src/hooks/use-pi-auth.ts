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
  const [isPiBrowser, setIsPiBrowser] = useState(false);

  useEffect(() => {
    // Check if Pi SDK is available and if we're in Pi Browser
    const checkPiAuth = async () => {
      try {
        // Check if running in Pi Browser environment
        if (typeof window !== 'undefined' && (window as any).Pi) {
          const Pi = (window as any).Pi;
          setIsPiBrowser(true);
          
          // Check if user is already authenticated
          const authResult = await Pi.authenticate();
          
          if (authResult && authResult.user) {
            setUser(authResult.user);
            setIsAuthenticated(true);
            console.log('User authenticated:', authResult.user);
          }
        } else {
          setIsPiBrowser(false);
          console.warn('Pi SDK not available. Please use Pi Browser.');
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
        
        // Force re-authentication
        const authResult = await Pi.authenticate();
        
        if (authResult && authResult.user) {
          setUser(authResult.user);
          setIsAuthenticated(true);
          console.log('Authentication successful:', authResult.user);
          return authResult.user;
        }
      }
      throw new Error('Pi SDK not available. Please use Pi Browser.');
    } catch (error) {
      console.error('Pi authentication error:', error);
      setIsAuthenticated(false);
      throw error;
    }
  };

  const openPiBrowser = () => {
    // Open the app in Pi Browser for production environment
    const currentUrl = window.location.href;
    const piBrowserUrl = `https://app.minepi.com/app?url=${encodeURIComponent(currentUrl)}`;
    window.open(piBrowserUrl, '_blank');
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    isPiBrowser,
    authenticate,
    openPiBrowser,
  };
};
