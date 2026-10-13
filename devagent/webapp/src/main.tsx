import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChiefApp } from './components/ChiefApp';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('the #root element is missing');
}
createRoot(rootElement).render(
  <StrictMode>
    <ChiefApp />
  </StrictMode>,
);
