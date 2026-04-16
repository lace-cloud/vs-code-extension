import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Diagnostic, GeneratePhase } from '../types/render';
import type { ShowToastFn } from './useToast';
import { CANVAS_EVENTS } from '../events';

const PHASE_LABELS: Record<GeneratePhase, string> = {
  generating: 'Generating Terraform...',
  formatting: 'Formatting...',
  validating: 'Validating...',
};

export function useGenerationStatus(showToast: ShowToastFn) {
  const [generating, setGenerating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Diagnostic[]>([]);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      switch (msg.command) {
        case 'generateProgress': {
          setGenerating(true);
          setValidationErrors([]);
          showToast(PHASE_LABELS[msg.phase as GeneratePhase], 'progress');
          break;
        }
        case 'generateSuccess': {
          setGenerating(false);
          setValidationErrors([]);
          setErrorBannerDismissed(false);
          showToast('Successfully generated', 'success');
          break;
        }
        case 'generateError': {
          setGenerating(false);
          const diags: Diagnostic[] = msg.diagnostics ?? [];
          setValidationErrors(diags);
          setErrorBannerDismissed(false);
          if (diags.length > 0) {
            showToast(`Validation: ${diags.length} error(s)`, 'error');
          } else {
            showToast(`Generate error: ${msg.message}`, 'error');
          }
          break;
        }
      }
    };

    window.addEventListener(CANVAS_EVENTS.HOST_MESSAGE, handler);
    return () => window.removeEventListener(CANVAS_EVENTS.HOST_MESSAGE, handler);
  }, [showToast]);

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
