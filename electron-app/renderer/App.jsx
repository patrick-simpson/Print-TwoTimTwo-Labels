import React, { useState, useEffect } from 'react';
import SetupWizard from './components/SetupWizard.jsx';
import StatusPanel from './components/StatusPanel.jsx';

export default function App() {
  // undefined = still loading, null = no config yet, object = configured
  const [config, setConfig] = useState(undefined);

  useEffect(() => {
    window.awana.getConfig().then(cfg => setConfig(cfg || null));
  }, []);

  if (config === undefined) return null; // Loading

  if (!config || !config.printerName) {
    return <SetupWizard onSaved={setConfig} />;
  }

  return <StatusPanel config={config} onReset={() => setConfig(null)} />;
}
