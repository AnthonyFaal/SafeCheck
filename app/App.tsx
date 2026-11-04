import { useEffect, useState } from 'react';
import { useShareIntent } from 'expo-share-intent';
import { ErrorBoundary } from './src/ui/components/ErrorBoundary';
import SafetyCompanion from './src/SafetyCompanion';

export default function App() {
  const [sharedText, setSharedText] = useState<string | null>(null);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ scheme: 'safecheck' });

  useEffect(() => {
    if (!hasShareIntent) return;
    const text = (shareIntent.text ?? shareIntent.webUrl ?? '').trim();
    // The scanner is text-only by design. Do not import files from a share sheet.
    if (text) setSharedText(text.slice(0, 10_000));
    resetShareIntent();
  }, [hasShareIntent, resetShareIntent, shareIntent.text, shareIntent.webUrl]);

  return <ErrorBoundary><SafetyCompanion sharedText={sharedText} onSharedTextHandled={() => setSharedText(null)} /></ErrorBoundary>;
}
