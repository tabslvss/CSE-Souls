import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/vhs.css';
import './styles/pad.css';
import './game/fx/vhsSetting';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SessionProvider } from './session';
import { installUiSounds } from './sound';
import { startPadNav } from './ui/padNav';

installUiSounds();
startPadNav();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
