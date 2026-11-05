import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ShopProvider } from './context/ShopContext';
import { PaymentProvider } from './context/PaymentContext';
import { ConfirmProvider } from './components/ui';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ShopProvider>
          <PaymentProvider>
            <ConfirmProvider>
              <App />
              <Toaster position="top-center" richColors closeButton />
            </ConfirmProvider>
          </PaymentProvider>
        </ShopProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
