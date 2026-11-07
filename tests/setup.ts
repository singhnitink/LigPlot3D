// NGL's file streamer expects a browser FileReader; Node has none. This shim only
// implements the three methods NGL calls. Test-only — never bundled into the app.
type ReaderEvent = { target: NodeFileReader };

class NodeFileReader {
  onload: ((e: ReaderEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  result: string | ArrayBuffer | null = null;

  readAsText(blob: Blob) {
    blob.text().then(t => { this.result = t; this.onload?.({ target: this }); }, e => this.onerror?.(e));
  }

  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then(b => { this.result = b; this.onload?.({ target: this }); }, e => this.onerror?.(e));
  }

  readAsBinaryString(blob: Blob) {
    blob.arrayBuffer().then(b => {
      this.result = Array.from(new Uint8Array(b), c => String.fromCharCode(c)).join('');
      this.onload?.({ target: this });
    }, e => this.onerror?.(e));
  }
}

const g = globalThis as unknown as { FileReader?: unknown };
if (!g.FileReader) g.FileReader = NodeFileReader;
