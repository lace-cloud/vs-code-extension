// A version as a page draws it: the version, and the word Deprecated beside
// it when the registry has deprecated it. The word is read, never hidden.
import { DEPRECATED, isDeprecated } from '../protocol/registry-protocol';
import './deprecated-mark.css';

export function VersionLabel({ version, status }: { version: string; status: string }) {
  return (
    <>
      {version}
      {isDeprecated(status) && (
        <>
          {' '}
          <span className="deprecated-mark">{DEPRECATED}</span>
        </>
      )}
    </>
  );
}
