// A stand-in for `vscode.EventEmitter`.
export class Emitter<T> {
  listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire = (value: T) => {
    for (const listener of [...this.listeners]) listener(value);
  };
  dispose = () => this.listeners.clear();
}
