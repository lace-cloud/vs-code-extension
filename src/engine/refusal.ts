// How the engine's refusals and unsuccessful applies are named in a notice:
// the one wording each surface that reports one shares.
import { type ApplyResult, type ConnectError, reasonWire } from '@lace-cloud/canvas/engine';

// The code a refusal is told by: the API's own when the API decided it, else
// the reason Lace did.
export const refusalCode = (error: ConnectError): string =>
  error.apiCode ?? reasonWire(error.reason);

// `subject` refused, with the code and what the engine said.
export const refusedText = (subject: string, error: ConnectError): string =>
  `${subject} (${refusalCode(error)}): ${error.message}`;

// The reasons an apply that was not successful gives.
export const applyErrorsText = (result: Pick<ApplyResult, 'errors'>): string =>
  result.errors.map((error) => error.message).join('; ');
