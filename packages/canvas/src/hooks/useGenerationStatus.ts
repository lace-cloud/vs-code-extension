import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEngine } from '../state/engine-context';
import type { Diagnostic, GeneratePhase } from '../types/render';
import type { ShowToastFn } from './useToast';

const PHASE_LABELS: Record<GeneratePhase, string> = {
  generating: 'Generating Terraform...',
  formatting: 'Formatting...',
  validating: 'Validating...',
};

export function useGenerationStatus(showToast: ShowToastFn) {
  const engine = useEngine();
  const [generating, setGenerating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Diagnostic[]>([]);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState(false);

  useEffect(() => {
    return engine.onEvent((event) => {
      switch (event.type) {
        case 'generateProgress':
          setGenerating(true);
          setValidationErrors([]);
          showToast(PHASE_LABELS[event.phase], 'progress');
          return;
        case 'generateSuccess':
          setGenerating(false);
          setValidationErrors([]);
          setErrorBannerDismissed(false);
          showToast('Successfully generated', 'success');
          return;
        case 'generateError': {
          setGenerating(false);
          const diags = event.diagnostics ?? [];
          setValidationErrors(diags);
          setErrorBannerDismissed(false);
          if (diags.length > 0) {
            showToast(`Validation: ${diags.length} error(s)`, 'error');
          } else {
            showToast(`Generate error: ${event.message}`, 'error');
          }
          return;
        }
      }
    });
  }, [engine, showToast]);

  const erroredNodeIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const d of validationErrors) {
      if (d.instance_id) ids.add(d.instance_id);
    }
    return ids;
  }, [validationErrors]);

  const dismissErrorBanner = useCallback(() => setErrorBannerDismissed(true), []);

  return {
    generating,
    validationErrors,
    erroredNodeIds,
    errorBannerDismissed,
    dismissErrorBanner,
  };
}
